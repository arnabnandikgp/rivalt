//! Atomically install the selected payouts in the same ordered frozen pages that
//! supplied the search. A partial page list cannot advance the settlement header.
use super::*;
use crate::state::accounts::{FrozenRecoveryPayout, SCHEMA_VERSION};

#[derive(AnchorDeserialize, InitSpace)]
struct PagePrefix {
    schema_version: u16,
    _revision: u64,
    venue: Address,
    epoch: u64,
    page_index: u64,
    row_count: u8,
}

pub(super) fn store(
    header: &PreparedSettlement,
    captured: &[SearchMember],
    members: &[MemberResult],
    pages: &mut [AccountView],
) -> Result<()> {
    require!(
        pages.len() as u64 == header.count.div_ceil(8)
            && captured.len() as u64 == header.count
            && members.len() == captured.len(),
        ClearingError::Resolution
    );
    for (index, page) in pages.iter_mut().enumerate() {
        // Scoped history verifies ownership and records the revision of every
        // writable remaining account. Recheck the full page identity and size here.
        let address = *page.address();
        let mut bytes = page.try_borrow_mut()?;
        let prefix_end = 8 + PagePrefix::INIT_SPACE;
        require!(
            bytes.len() == 8 + FrozenMarginPage::INIT_SPACE
                && bytes[..8] == *FrozenMarginPage::DISCRIMINATOR,
            ClearingError::Resolution
        );
        let prefix: PagePrefix = crate::wire::read(&bytes[8..prefix_end])?;
        let start = index * 8;
        let count = (members.len() - start).min(8);
        require!(
            prefix.schema_version == SCHEMA_VERSION
                && prefix.venue == header.venue
                && prefix.epoch == header.epoch
                && prefix.page_index == index as u64
                && usize::from(prefix.row_count) == count,
            ClearingError::Resolution
        );
        let expected = create_program_address(
            &[
                b"frozen-margin-page",
                header.venue.as_ref(),
                &prefix.page_index.to_le_bytes(),
                &[bytes[bytes.len() - 1]],
            ],
            &crate::ID,
        )
        .map_err(|_| ClearingError::Resolution)?;
        require_keys_eq!(address, expected, ClearingError::Resolution);
        for local in 0..count {
            let offset = prefix_end + local * FrozenMargin::INIT_SPACE;
            let data = &mut bytes[offset..offset + FrozenMargin::INIT_SPACE];
            let mut frozen: FrozenMargin = crate::wire::read(data)?;
            let original = &captured[start + local];
            let selected = &members[start + local];
            require!(
                frozen.id == original.id
                    && frozen.id == selected.id
                    && frozen.cash == original.cash
                    && frozen.claims == original.claims
                    && frozen.lots == original.lots,
                ClearingError::Reconciliation
            );
            frozen.recovery_payout = FrozenRecoveryPayout {
                claim_delta: selected.claim_delta,
                movements: selected.movements,
                final_cash: selected.cash,
            };
            crate::wire::write(&frozen, data)?;
        }
    }
    Ok(())
}
