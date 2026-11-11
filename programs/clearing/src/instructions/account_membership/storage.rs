//! Physical recovery allocation authentication. The reusable workspace seeds
//! deliberately omit an epoch; the storage lock and every work payload retain
//! explicit epoch fences. No capacity can be earned from a balance or receipt
//! without the corresponding real canonical allocation.
use crate::{state::accounts::*, ClearingError};
use anchor_lang::{pinocchio::sysvars::rent::Rent, prelude::*};
use financial_core::clearing::scalable::recovery_storage::{Allocation, Provisioning};

pub(crate) fn allocation_kind(kind: u8, register: u32, page: u64) -> Result<Allocation> {
    match (kind, register, page) {
        (0, 0, 0) => Ok(Allocation::Prepared),
        (1, 0, 0) => Ok(Allocation::Rates),
        (2, 0, 0) => Ok(Allocation::Plan),
        (3, 0, page) => Ok(Allocation::FrozenRows { page }),
        (4, register, page) if register < 46 || (64..=70).contains(&register) => {
            Ok(Allocation::Limbs { register, page })
        }
        _ => Err(ClearingError::Resolution.into()),
    }
}
pub(crate) fn prefix(kind: u8) -> Result<&'static [u8]> {
    match kind {
        0 => Ok(b"prepared-settlement"),
        1 => Ok(b"settlement-rates"),
        2 => Ok(b"settlement-plan"),
        3 => Ok(b"frozen-margin-page"),
        4 => Ok(b"resolution-limbs"),
        _ => Err(ClearingError::Resolution.into()),
    }
}
pub(crate) fn register_seed(kind: u8, bytes: &[u8; 4]) -> &[u8] {
    if kind == 4 {
        bytes
    } else {
        &[]
    }
}
pub(crate) fn page_seed(kind: u8, bytes: &[u8; 8]) -> &[u8] {
    if kind == 3 || kind == 4 {
        bytes
    } else {
        &[]
    }
}

pub(crate) fn allocation_address(venue: &Address, allocation: Allocation) -> (Address, u8) {
    match allocation {
        Allocation::Prepared => {
            find_program_address(&[b"prepared-settlement", venue.as_ref()], &crate::ID)
        }
        Allocation::Rates => {
            find_program_address(&[b"settlement-rates", venue.as_ref()], &crate::ID)
        }
        Allocation::Plan => find_program_address(&[b"settlement-plan", venue.as_ref()], &crate::ID),
        Allocation::FrozenRows { page } => find_program_address(
            &[b"frozen-margin-page", venue.as_ref(), &page.to_le_bytes()],
            &crate::ID,
        ),
        Allocation::Limbs { register, page } => find_program_address(
            &[
                b"resolution-limbs",
                venue.as_ref(),
                &register.to_le_bytes(),
                &page.to_le_bytes(),
            ],
            &crate::ID,
        ),
    }
}

pub(crate) fn allocation_shape(allocation: Allocation) -> (&'static [u8], usize, usize) {
    match allocation {
        Allocation::Prepared => (
            PreparedSettlement::DISCRIMINATOR,
            8 + PreparedSettlement::INIT_SPACE,
            8 + PreparedSettlement::INIT_SPACE - 1,
        ),
        Allocation::Rates => (
            SettlementRates::DISCRIMINATOR,
            8 + SettlementRates::INIT_SPACE,
            8 + SettlementRates::INIT_SPACE - 1,
        ),
        Allocation::Plan => (
            SettlementPlan::DISCRIMINATOR,
            8 + SettlementPlan::INIT_SPACE,
            8 + SettlementPlan::INIT_SPACE - 1,
        ),
        Allocation::FrozenRows { .. } => (
            FrozenMarginPage::DISCRIMINATOR,
            8 + FrozenMarginPage::INIT_SPACE,
            8 + FrozenMarginPage::INIT_SPACE - 1,
        ),
        Allocation::Limbs { .. } => (SettlementLimbPage::DISCRIMINATOR, LIMB_PAGE_BYTES, 80),
    }
}

fn owned_prefix(
    account: &AccountView,
    venue: &Address,
    discriminator: &[u8],
    size: usize,
) -> Result<()> {
    require!(
        account.owner() == &crate::ID && !account.executable() && !account.is_signer(),
        ClearingError::Resolution
    );
    let bytes = account.try_borrow()?;
    require!(
        bytes.len() == size
            && &bytes[..8] == discriminator
            && u16::from_le_bytes(bytes[8..10].try_into().unwrap()) == SETTLEMENT_SCHEMA
            && u64::from_le_bytes(bytes[10..18].try_into().unwrap()) > 0
            && &bytes[18..50] == venue.as_ref(),
        ClearingError::Resolution
    );
    Ok(())
}

/// Rent must come from the runtime sysvar, never an instruction argument. The
/// lifecycle controller separately authenticates the storage header, authority
/// and unfrozen safety; this helper cannot create or unlock a workspace.
pub(crate) fn verify_funded_allocation(
    venue: &Address,
    state: Provisioning,
    generation: u64,
    ordinal: u64,
    allocation: &AccountView,
    receipt: &AccountView,
    rent: &Rent,
) -> Result<Provisioning> {
    let expected = state
        .expected(generation, ordinal)
        .map_err(|_| ClearingError::Resolution)?;
    let (key, bump) = allocation_address(venue, expected);
    require_keys_eq!(*allocation.address(), key, ClearingError::Resolution);
    let (discriminator, size, bump_offset) = allocation_shape(expected);
    owned_prefix(allocation, venue, discriminator, size)?;
    let minimum = rent.try_minimum_balance(size)?;
    require!(allocation.lamports() >= minimum, ClearingError::Resolution);
    {
        let bytes = allocation.try_borrow()?;
        require!(
            bytes[bump_offset] == bump
                && u64::from_le_bytes(bytes[50..58].try_into().unwrap()) <= state.completed_epoch,
            ClearingError::Resolution
        );
        match expected {
            Allocation::FrozenRows { page } => {
                require!(
                    u64::from_le_bytes(bytes[58..66].try_into().unwrap()) == page,
                    ClearingError::Resolution
                );
            }
            Allocation::Limbs { register, page } => {
                require!(
                    u32::from_le_bytes(bytes[66..70].try_into().unwrap()) == register
                        && u64::from_le_bytes(bytes[70..78].try_into().unwrap()) == page,
                    ClearingError::Resolution
                );
            }
            _ => {}
        }
    }
    owned_prefix(
        receipt,
        venue,
        StorageFunding::DISCRIMINATOR,
        8 + StorageFunding::INIT_SPACE,
    )?;
    let receipt_bytes = receipt.try_borrow()?;
    let receipt_key = create_program_address(
        &[
            b"storage-funding",
            venue.as_ref(),
            key.as_ref(),
            &[receipt_bytes[122]],
        ],
        &crate::ID,
    )
    .map_err(|_| ClearingError::Resolution)?;
    require_keys_eq!(*receipt.address(), receipt_key, ClearingError::Resolution);
    require!(
        &receipt_bytes[50..82] == key.as_ref()
            && receipt_bytes[82..114] != [0; 32]
            && u64::from_le_bytes(receipt_bytes[114..122].try_into().unwrap())
                <= allocation.lamports()
            && receipt.lamports() >= rent.try_minimum_balance(8 + StorageFunding::INIT_SPACE)?,
        ClearingError::Resolution
    );
    state
        .record(generation, ordinal)
        .map_err(|_| ClearingError::Resolution.into())
}

#[cfg(test)]
mod tests;
