//! Bounded live-index traversal shared by backing and terminal retirement. The
//! owning certificate must fence safety/membership and financial dependencies.
use crate::{instructions::account_safety::settlement_membership, state::accounts::*, ClearingError};
use anchor_lang::{AccountDeserialize, prelude::*};
use financial_core::clearing::scalable::membership::{MembershipCursor, Request};

pub(crate) fn step(cursor: &mut MembershipCursor, venue: &Address, accounts: &[AccountView]) -> Result<Option<Box<MarginAccount>>> {
    match cursor.request() {
        Request::Node { .. } => {
            require!(accounts.len() == 1, ClearingError::Resolution);
            settlement_membership::advance_node(cursor, venue, &accounts[0])?;
        }
        Request::Page { .. } => {
            require!(accounts.len() == 1, ClearingError::Resolution);
            settlement_membership::advance_page(cursor, venue, &accounts[0])?;
        }
        Request::Member { id, .. } => {
            require!(accounts.len() == 2, ClearingError::Resolution);
            let entry = settlement_membership::financial_member(cursor, venue, &accounts[0])?;
            let account = &accounts[1];
            require!(account.owner() == &crate::ID && !account.is_signer() && !account.executable()
                && account.data_len() == 8 + MarginAccount::INIT_SPACE && *account.address() == entry.root, ClearingError::Resolution);
            let root = Box::new(MarginAccount::try_deserialize(&mut &account.try_borrow()?[..])?);
            require!(root.schema_version == SCHEMA_VERSION && root.revision > 0 && root.venue == *venue
                && root.id == id && root.lifecycle == MEMBER_FINANCIAL
                && root.activation_generation == entry.activation_generation, ClearingError::Resolution);
            let canonical = create_program_address(&[b"margin-v3", root.portfolio.as_ref(), &root.subaccount_index.to_le_bytes(), &[root.bump]],
                &crate::ID).map_err(|_| ClearingError::Resolution)?;
            require_keys_eq!(canonical, *account.address(), ClearingError::Resolution);
            crate::engine::account::model(&root)?;
            cursor.member(id).map_err(|_| ClearingError::Resolution)?;
            return Ok(Some(root));
        }
        Request::Done => return Err(ClearingError::Resolution.into()),
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestAccount;
    use std::collections::BTreeMap;
    fn account<T: Discriminator + SchemaWrite<anchor_lang::BorshConfig,Src=T>>(key: Address, value:&T) -> TestAccount {
        let mut bytes=Vec::new();crate::wire::write_discriminated(value,&mut bytes).unwrap();
        TestAccount::new(key,crate::ID,&bytes,false,false)
    }
    #[test]
    fn real_sparse_pages_traverse_every_financial_root_once_across_serialized_restarts() {
        // Independent fixed identities include a gap above JS's exact-integer range.
        let ids=[0u64,64,(1u64<<54)+63];
        let venue=Address::new_unique();
        let mut nodes:BTreeMap<(u8,u64),MemberIndexNode>=BTreeMap::new();
        let mut pages:BTreeMap<u64,MemberPage>=BTreeMap::new();
        let mut roots=BTreeMap::new();
        for (ordinal,id) in ids.into_iter().enumerate() {
            let portfolio=Address::new_unique();
            let (key,bump)=find_program_address(&[b"margin-v3",portfolio.as_ref(),&0u32.to_le_bytes()],&crate::ID);
            let root=MarginAccount {schema_version:SCHEMA_VERSION,revision:3,venue,portfolio,id,cash:11+ordinal as u64,
                mode:MODE_CROSS,isolated_market_index:CROSS_MARKET_SENTINEL,delegate_epoch:1,
                lifecycle:MEMBER_FINANCIAL,activation_generation:7+ordinal as u64,bump,..Default::default()};
            roots.insert(id,(key,root));
            let page_index=id/64;
            let page=pages.entry(page_index).or_insert_with(||MemberPage {schema_version:SCHEMA_VERSION,revision:4,venue,page_index,
                bump:find_program_address(&[b"member-page",venue.as_ref(),&page_index.to_le_bytes()],&crate::ID).1,..Default::default()});
            page.allocated_mask|=1<<(id%64);page.financial_mask|=1<<(id%64);
            page.members.entries[(id%64)as usize]=MemberEntry {root:key,lifecycle:MEMBER_FINANCIAL,activation_generation:7+ordinal as u64};
            for level in 0..15u8 {
                let prefix=page_index>>(4*(u32::from(level)+1));
                let slot=((page_index>>(4*u32::from(level)))&15)as usize;
                let node=nodes.entry((level,prefix)).or_insert_with(||MemberIndexNode {schema_version:SCHEMA_VERSION,revision:5,venue,level,prefix,
                    bump:find_program_address(&[b"member-index",venue.as_ref(),&[level],&prefix.to_le_bytes()],&crate::ID).1,..Default::default()});
                node.counts[slot]+=1;node.populated_mask|=1<<slot;
            }
        }
        let mut cursor=MembershipCursor::new(3).unwrap();let mut seen=Vec::new();let mut steps=0;
        while cursor.request()!=Request::Done {
            let mut loaded=match cursor.request() {
                Request::Node{level,prefix,..}=>{let value=&nodes[&(level,prefix)];vec![account(find_program_address(&[b"member-index",venue.as_ref(),&[level],&prefix.to_le_bytes()],&crate::ID).0,value)]},
                Request::Page{index,..}=>vec![account(find_program_address(&[b"member-page",venue.as_ref(),&index.to_le_bytes()],&crate::ID).0,&pages[&index])],
                Request::Member{id,..}=>{
                    let page=&pages[&(id/64)];let (key,root)=&roots[&id];
                    vec![account(find_program_address(&[b"member-page",venue.as_ref(),&(id/64).to_le_bytes()],&crate::ID).0,page),account(*key,root)]
                },Request::Done=>unreachable!(),
            };
            let views:Vec<_>=loaded.iter_mut().map(TestAccount::view).collect();
            if let Some(root)=step(&mut cursor,&venue,&views).unwrap(){seen.push((root.id,root.cash,root.activation_generation));}
            cursor=MembershipCursor::from_checkpoint(&cursor.checkpoint(),3).unwrap();
            steps+=1;assert!(steps<150);
        }
        assert_eq!(seen,vec![(0,11,7),(64,12,8),((1u64<<54)+63,13,9)]);
        assert_eq!(seen.iter().map(|entry|entry.1).sum::<u64>(),36);
    }
}
