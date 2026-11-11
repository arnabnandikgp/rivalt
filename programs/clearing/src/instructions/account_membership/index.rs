//! Canonical writable radix-path authentication and bounded scalar updates.
//! The lifecycle handler owns root/page/count changes and frozen-safety checks;
//! scoped history, not this adapter, owns every account revision increment.
use crate::{state::accounts::*, ClearingError};
use anchor_lang::prelude::*;
use financial_core::clearing::scalable::membership_update::{
    self, Change, NodeAddress, NodeSummary, PathUpdate, INDEX_LEVELS,
};

fn read_node(
    account: &AccountView,
    venue: &Address,
    key: NodeAddress,
    revision: u64,
) -> Result<NodeSummary> {
    require!(
        account.owner() == &crate::ID
            && account.is_writable()
            && !account.is_signer()
            && !account.executable(),
        ClearingError::Resolution
    );
    let bytes = account.try_borrow()?;
    require!(
        bytes.len() == MEMBER_INDEX_BYTES
            && bytes[..8] == *MemberIndexNode::DISCRIMINATOR
            && u16::from_le_bytes(bytes[8..10].try_into().unwrap()) == SETTLEMENT_SCHEMA
            && revision > 0
            && revision < u64::MAX
            && u64::from_le_bytes(bytes[10..18].try_into().unwrap()) == revision
            && &bytes[18..50] == venue.as_ref()
            && bytes[50] == key.level
            && u64::from_le_bytes(bytes[51..59].try_into().unwrap()) == key.prefix,
        ClearingError::Resolution
    );
    let expected = create_program_address(
        &[
            b"member-index",
            venue.as_ref(),
            &[key.level],
            &key.prefix.to_le_bytes(),
            &[bytes[189]],
        ],
        &crate::ID,
    )
    .map_err(|_| ProgramError::from(ClearingError::Resolution))?;
    require_keys_eq!(*account.address(), expected, ClearingError::Resolution);
    Ok(NodeSummary {
        populated_mask: u16::from_le_bytes(bytes[59..61].try_into().unwrap()),
        counts: core::array::from_fn(|slot| {
            u64::from_le_bytes(bytes[61 + 8 * slot..69 + 8 * slot].try_into().unwrap())
        }),
    })
}

/// Read and validate the entire predecessor path before allowing a scalar write.
/// Native callers also get no partial mutation when the final ancestor is invalid.
pub(crate) fn prepare(
    accounts: &[AccountView],
    venue: &Address,
    id: u64,
    financial_mask: u64,
    financial_count: u64,
    change: Change,
    revisions: [u64; INDEX_LEVELS],
) -> Result<PathUpdate> {
    require!(accounts.len() == INDEX_LEVELS, ClearingError::Resolution);
    // Keep authentication errors distinct from the arithmetic planner's errors.
    // The fixed small summary array is heap-backed, never an SBF context frame.
    let mut summaries = Vec::with_capacity(INDEX_LEVELS);
    for level in 0..INDEX_LEVELS as u8 {
        let (key, _) =
            membership_update::address(id, level).map_err(|_| ClearingError::Resolution)?;
        summaries.push(read_node(
            &accounts[usize::from(level)],
            venue,
            key,
            revisions[usize::from(level)],
        )?);
    }
    membership_update::prepare(id, financial_mask, financial_count, change, |key| {
        Ok(summaries[usize::from(key.level)])
    })
    .map_err(|_| ClearingError::Resolution.into())
}

/// Only call after prepare in the same invocation; the owning Solana instruction
/// commits root, page, registry, backing changes and this path atomically.
pub(crate) fn commit(accounts: &mut [AccountView], id: u64, update: PathUpdate) -> Result<()> {
    require!(accounts.len() == INDEX_LEVELS, ClearingError::Resolution);
    for (level, account) in accounts.iter_mut().enumerate() {
        let (_, slot) =
            membership_update::address(id, level as u8).map_err(|_| ClearingError::Resolution)?;
        let mut bytes = account.try_borrow_mut()?;
        require!(bytes.len() == MEMBER_INDEX_BYTES, ClearingError::Resolution);
        bytes[59..61].copy_from_slice(&update.populated_masks[level].to_le_bytes());
        bytes[61 + slot * 8..69 + slot * 8]
            .copy_from_slice(&update.child_counts[level].to_le_bytes());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
