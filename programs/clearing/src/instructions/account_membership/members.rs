//! Canonical fixed header and stable member-page identities. A page's physical
//! allocation does not establish membership; only an authenticated owner transition
//! may fill a slot or update its Financial bit.
use crate::{state::accounts::*, ClearingError};
use anchor_lang::prelude::*;

pub(crate) fn index_root(venue: &Address) -> Address {
    find_program_address(&[b"member-index", venue.as_ref(), &[14], &0u64.to_le_bytes()], &crate::ID).0
}
pub(crate) fn registry(header: &VenueRegistry) -> Result<()> {
    require!(header.schema_version == SCHEMA_VERSION && header.membership_epoch > 0
        && header.financial_count <= header.registered_count && header.registered_count <= header.next_id
        && header.live_index == index_root(&header.venue), ClearingError::Resolution);
    Ok(())
}
pub(crate) fn page(page: &MemberPage, header: &VenueRegistry) -> Result<()> {
    registry(header)?;
    require!(page.schema_version == SCHEMA_VERSION && page.venue == header.venue
        && page.page_index <= u64::MAX / 64 && page.financial_mask & !page.allocated_mask == 0,
        ClearingError::Resolution);
    for (slot, entry) in page.members.entries.iter().enumerate() {
        let bit = 1u64 << slot;
        if page.allocated_mask & bit == 0 {
            require!(entry.root == Address::default() && entry.lifecycle == 0 && entry.activation_generation == 0,
                ClearingError::Resolution);
        } else {
            let id = page.page_index * 64 + slot as u64;
            require!(id < header.next_id && entry.root != Address::default()
                && matches!(entry.lifecycle, MEMBER_REGISTERED | MEMBER_FINANCIAL | MEMBER_RETIRED)
                && (page.financial_mask & bit != 0) == (entry.lifecycle == MEMBER_FINANCIAL)
                && (entry.lifecycle != MEMBER_FINANCIAL || entry.activation_generation > 0), ClearingError::Resolution);
        }
    }
    Ok(())
}
pub(crate) fn vacant(page: &MemberPage, header: &VenueRegistry, id: u64) -> Result<()> {
    self::page(page, header)?;
    require!(id == header.next_id && page.page_index == id / 64 && page.allocated_mask & (1u64 << (id % 64)) == 0,
        ClearingError::Resolution);
    Ok(())
}
pub(crate) fn member(page: &MemberPage, header: &VenueRegistry, key: &Address, root: &MarginAccount) -> Result<()> {
    self::page(page, header)?;
    require!(root.schema_version == SCHEMA_VERSION && root.venue == header.venue
        && page.page_index == root.id / 64 && page.allocated_mask & (1u64 << (root.id % 64)) != 0,
        ClearingError::Resolution);
    let entry = page.members.entries[(root.id % 64) as usize];
    require!(entry.root == *key && entry.lifecycle == root.lifecycle
        && entry.activation_generation == root.activation_generation, ClearingError::Resolution);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn header() -> VenueRegistry {
        let venue = Address::new_unique();
        VenueRegistry { schema_version: SCHEMA_VERSION, revision: 1, venue,
            membership_epoch: 3, live_index: index_root(&venue), ..Default::default() }
    }
    #[test]
    fn sparse_registration_never_reuses_a_retired_id_or_advances_financial_epoch() {
        let mut registry = header();
        let mut pages: Vec<MemberPage> = Vec::new();
        for id in 0..193u64 {
            if id % 64 == 0 { pages.push(MemberPage { schema_version: SCHEMA_VERSION, revision: 1,
                venue: registry.venue, page_index: id / 64, ..Default::default() }); }
            let page = &mut pages[(id / 64) as usize];
            vacant(page, &registry, id).unwrap();
            page.members.entries[(id % 64) as usize] = MemberEntry { root: Address::new_unique(),
                lifecycle: MEMBER_REGISTERED, activation_generation: 0 };
            page.allocated_mask |= 1 << (id % 64);
            registry.next_id += 1; registry.registered_count += 1;
            self::page(page, &registry).unwrap();
            // Retiring an empty root leaves its slot permanently allocated.
            page.members.entries[(id % 64) as usize].lifecycle = MEMBER_RETIRED;
            registry.registered_count -= 1;
            assert!(vacant(page, &registry, id).is_err());
        }
        assert_eq!((registry.next_id, registry.registered_count, registry.financial_count, registry.membership_epoch), (193,0,0,3));
        for page in &pages { self::page(page, &registry).unwrap(); }
        assert_eq!(pages.iter().map(|page| page.allocated_mask.count_ones()).sum::<u32>(),193);
    }
    #[test]
    fn full_width_slot_identity_and_generation_are_authenticated_independently() {
        let mut registry = header();
        let id = (1u64 << 54) + 63;
        registry.next_id = id + 1; registry.registered_count = 1; registry.financial_count = 1;
        let key = Address::new_unique();
        let root = MarginAccount { schema_version: SCHEMA_VERSION, venue: registry.venue, id,
            lifecycle: MEMBER_FINANCIAL, activation_generation: 7, ..Default::default() };
        let mut page = MemberPage { schema_version: SCHEMA_VERSION, venue: registry.venue, page_index: id / 64,
            allocated_mask: 1 << 63, financial_mask: 1 << 63, ..Default::default() };
        page.members.entries[63] = MemberEntry { root: key, lifecycle: MEMBER_FINANCIAL, activation_generation: 7 };
        member(&page, &registry, &key, &root).unwrap();
        for mutation in 0..8 {
            let mut bytes = Vec::new(); crate::wire::write(&page, &mut bytes).unwrap();
            let mut bad: MemberPage = crate::wire::read(&bytes).unwrap();
            match mutation { 0 => bad.financial_mask = 0, 1 => bad.allocated_mask = 0,
                2 => bad.members.entries[63].activation_generation = 6,
                3 => bad.members.entries[63].lifecycle = MEMBER_REGISTERED,
                4 => bad.members.entries[63].root = Address::new_unique(),
                5 => bad.page_index += 1, 6 => bad.members.entries[0].activation_generation = 1,
                7 => bad.schema_version = 8, _=>unreachable!() }
            assert!(member(&bad, &registry, &key, &root).is_err(), "mutation {mutation}");
        }
    }
}
