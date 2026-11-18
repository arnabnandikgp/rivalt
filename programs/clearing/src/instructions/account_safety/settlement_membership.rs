//! Read-only successor membership binding. The owning freeze controller must
//! lock membership mutations and bind venue/epoch/count; these helpers alone
//! do not establish a frozen epoch or authorize any financial action.
use crate::{state::accounts::*, ClearingError};
use anchor_lang::prelude::*;
use financial_core::clearing::scalable::membership::{MembershipCursor, Request};

fn prefix(
    account: &AccountView,
    bytes: &[u8],
    venue: &Address,
    size: usize,
    discriminator: &[u8],
) -> Result<()> {
    require!(
        account.owner() == &crate::ID
            && !account.is_signer()
            && !account.executable()
            && bytes.len() == size,
        ClearingError::Resolution
    );
    require!(
        &bytes[..8] == discriminator
            && u16::from_le_bytes(bytes[8..10].try_into().unwrap()) == SETTLEMENT_SCHEMA
            && &bytes[18..50] == venue.as_ref(),
        ClearingError::Resolution
    );
    Ok(())
}

pub(crate) fn advance_node(
    cursor: &mut MembershipCursor,
    venue: &Address,
    account: &AccountView,
) -> Result<()> {
    let Request::Node {
        level,
        prefix: expected_prefix,
        ..
    } = cursor.request()
    else {
        return Err(ClearingError::Resolution.into());
    };
    let bytes = account.try_borrow()?;
    prefix(
        account,
        &bytes,
        venue,
        MEMBER_INDEX_BYTES,
        MemberIndexNode::DISCRIMINATOR,
    )?;
    require!(
        bytes[50] == level
            && u64::from_le_bytes(bytes[51..59].try_into().unwrap()) == expected_prefix,
        ClearingError::Resolution
    );
    let expected = create_program_address(
        &[
            b"member-index",
            venue.as_ref(),
            &[level],
            &expected_prefix.to_le_bytes(),
            &[bytes[189]],
        ],
        &crate::ID,
    )
    .map_err(|_| ProgramError::from(ClearingError::Resolution))?;
    require_keys_eq!(*account.address(), expected, ClearingError::Resolution);
    let populated = u16::from_le_bytes(bytes[59..61].try_into().unwrap());
    let counts = core::array::from_fn(|index| {
        u64::from_le_bytes(bytes[61 + index * 8..69 + index * 8].try_into().unwrap())
    });
    cursor
        .node(populated, counts)
        .map_err(|_| ClearingError::Resolution.into())
}

fn page_identity(account: &AccountView, bytes: &[u8], venue: &Address, index: u64) -> Result<u64> {
    prefix(
        account,
        bytes,
        venue,
        MEMBER_PAGE_BYTES,
        MemberPage::DISCRIMINATOR,
    )?;
    require!(
        u64::from_le_bytes(bytes[50..58].try_into().unwrap()) == index,
        ClearingError::Resolution
    );
    let expected = create_program_address(
        &[
            b"member-page",
            venue.as_ref(),
            &index.to_le_bytes(),
            &[bytes[2698]],
        ],
        &crate::ID,
    )
    .map_err(|_| ProgramError::from(ClearingError::Resolution))?;
    require_keys_eq!(*account.address(), expected, ClearingError::Resolution);
    let allocated = u64::from_le_bytes(bytes[58..66].try_into().unwrap());
    let financial = u64::from_le_bytes(bytes[66..74].try_into().unwrap());
    require!(financial & !allocated == 0, ClearingError::Resolution);
    Ok(financial)
}

pub(crate) fn advance_page(
    cursor: &mut MembershipCursor,
    venue: &Address,
    account: &AccountView,
) -> Result<()> {
    let Request::Page { index, .. } = cursor.request() else {
        return Err(ClearingError::Resolution.into());
    };
    let bytes = account.try_borrow()?;
    let financial = page_identity(account, &bytes, venue, index)?;
    cursor
        .page(financial)
        .map_err(|_| ClearingError::Resolution.into())
}

/// Return the exact next Financial entry. The future valuation handler must
/// additionally load its canonical root and compare stable ID, venue, lifecycle,
/// activation generation and current frozen authority before deriving claims.
/// Do not advance the member cursor until that row is successfully persisted.
pub(crate) fn financial_member(
    cursor: &MembershipCursor,
    venue: &Address,
    account: &AccountView,
) -> Result<MemberEntry> {
    let Request::Member { id, .. } = cursor.request() else {
        return Err(ClearingError::Resolution.into());
    };
    let bytes = account.try_borrow()?;
    let financial = page_identity(account, &bytes, venue, id / 64)?;
    let slot = (id % 64) as usize;
    require!(financial & (1u64 << slot) != 0, ClearingError::Resolution);
    let start = 74 + slot * 41;
    let root = Address::new_from_array(bytes[start..start + 32].try_into().unwrap());
    let lifecycle = bytes[start + 32];
    let activation_generation =
        u64::from_le_bytes(bytes[start + 33..start + 41].try_into().unwrap());
    require!(
        root != Address::default() && lifecycle == MEMBER_FINANCIAL && activation_generation != 0,
        ClearingError::Resolution
    );
    Ok(MemberEntry {
        root,
        lifecycle,
        activation_generation,
    })
}

#[cfg(test)]
mod tests;
