//! Optional contributor-funded SOL capacity for the candidate margin tail.
use crate::{state::accounts::*, ClearingError};
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
pub struct ManageProfitCapacity {
    pub actor: Signer,
    #[account(mut, unsafe(dup))]
    pub payer: Signer,
    #[account(mut, unsafe(dup))]
    /// CHECK: the extension records the only permitted recipient of its principal.
    pub previous_contributor: UncheckedAccount,
    #[account(seeds = [b"venue-v3", venue.domain.as_ref()], bump = venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds = [b"safety-v3", venue.address().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<BorshAccount<VenueSafety>>,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, has_one = venue)]
    pub margin: Box<BorshAccount<MarginAccount>>,
    pub system_program: Program<System>,
}

#[cfg(not(feature = "profit-attribution-qualification"))]
pub fn manage(_: &mut Context<ManageProfitCapacity>, _: u16, _: u64, _: u64) -> Result<()> {
    Err(ClearingError::Profile.into())
}

#[cfg(feature = "profit-attribution-qualification")]
pub fn manage(
    ctx: &mut Context<ManageProfitCapacity>,
    requested: u16,
    revision: u64,
    max_payment: u64,
) -> Result<()> {
    use anchor_lang::pinocchio::{
        sysvars::{rent::Rent, Sysvar},
        Resize,
    };
    use anchor_lang::system_program::{self, Transfer};
    let empty = ctx.remaining_accounts()?.is_empty();
    let accounts = &mut ctx.accounts;
    let margin = &mut accounts.margin;
    let mut account = margin.account().clone();
    let margin_owner = margin.owner;
    require!(
        empty
            && accounts.venue.schema_version == SCHEMA_VERSION
            && accounts.venue.profile_version == PROFILE_VERSION
            && margin.schema_version == SCHEMA_VERSION
            && accounts.safety.schema_version == SCHEMA_VERSION
            && margin.revision == revision
            && valid_margin_size(account.data_len()),
        ClearingError::Profile
    );
    let rent = Rent::get()?;
    let current_size = account.data_len();
    let extended = current_size != MARGIN_ALLOCATION;
    let width = if extended {
        (current_size - MARGIN_PREFIX - 8 - RENT_CREDIT_BYTES) / 2
    } else {
        INITIAL_ATTRIBUTION_BYTES
    };
    let next_width = usize::from(requested);
    require!(
        (INITIAL_ATTRIBUTION_BYTES..=MAX_ATTRIBUTION_SLOT).contains(&next_width)
            && (next_width > width || (extended && next_width == INITIAL_ATTRIBUTION_BYTES)),
        ClearingError::Capacity
    );
    margin.release_borrow()?;
    let (prior, principal) = {
        let bytes = account.try_borrow()?;
        require!(
            bytes[MARGIN_PREFIX..].starts_with(crate::profit_attribution::MAGIC),
            ClearingError::Profile
        );
        if extended {
            let credit = &bytes[current_size - RENT_CREDIT_BYTES..];
            (
                Address::new_from_array(credit[..32].try_into().unwrap()),
                u64::from_le_bytes(credit[32..].try_into().unwrap()),
            )
        } else {
            (margin_owner, 0)
        }
    };
    require_keys_eq!(
        prior,
        *accounts.previous_contributor.address(),
        ClearingError::Authority
    );
    if next_width == INITIAL_ATTRIBUTION_BYTES {
        require!(
            accounts.actor.address() == &margin_owner || accounts.actor.address() == &prior,
            ClearingError::Authority
        );
        require!(
            max_payment == 0
                && margin.positions.iter().all(|position| position.lots == 0)
                && margin.reserved == 0
                && margin.book.orders.iter().all(|entry| !entry.order.active())
                && matches!(accounts.safety.mode, ACTIVE | CUSTODY | RESOLVED | RETIRED),
            ClearingError::Resolution
        );
        let retained = account
            .lamports()
            .checked_sub(principal)
            .ok_or(ClearingError::Arithmetic)?;
        require!(
            retained >= rent.try_minimum_balance(MARGIN_ALLOCATION)?,
            ClearingError::Capacity
        );
        let mut recipient = accounts.previous_contributor.account().clone();
        let balance = recipient
            .lamports()
            .checked_add(principal)
            .ok_or(ClearingError::Arithmetic)?;
        account.resize(MARGIN_ALLOCATION)?;
        account.try_borrow_mut()?[MARGIN_PREFIX + 8..].fill(0);
        account.set_lamports(retained);
        recipient.set_lamports(balance);
    } else {
        require_keys_eq!(
            margin_owner,
            *accounts.actor.address(),
            ClearingError::Authority
        );
        require!(
            !accounts.safety.paused
                && matches!(accounts.safety.mode, ACTIVE | CUSTODY)
                && accounts.payer.account().owner() == &system_program::ID
                && accounts.payer.account().data_len() == 0,
            ClearingError::Authority
        );
        let size = MARGIN_PREFIX + 8 + 2 * next_width + RENT_CREDIT_BYTES;
        let top_up = rent
            .try_minimum_balance(size)?
            .saturating_sub(account.lamports());
        let repayment = if accounts.payer.address() == &prior {
            0
        } else {
            principal
        };
        let debit = top_up
            .checked_add(repayment)
            .ok_or(ClearingError::Arithmetic)?;
        require!(debit <= max_payment, ClearingError::Capacity);
        let new_credit = principal
            .checked_add(top_up)
            .ok_or(ClearingError::Arithmetic)?;
        let system = accounts.system_program.address();
        if repayment > 0 {
            system_program::transfer(
                CpiContext::new(
                    system,
                    Transfer {
                        from: accounts.payer.try_to_cpi_handle_mut()?,
                        to: accounts.previous_contributor.try_to_cpi_handle_mut()?,
                    },
                ),
                repayment,
            )?;
        }
        if top_up > 0 {
            system_program::transfer(
                CpiContext::new(
                    system,
                    Transfer {
                        from: accounts.payer.try_to_cpi_handle_mut()?,
                        to: margin.try_to_cpi_handle_mut()?,
                    },
                ),
                top_up,
            )?;
        }
        account.resize(size)?;
        let mut data = account.try_borrow_mut()?;
        let bytes = &mut data[MARGIN_PREFIX + 8..];
        bytes.copy_within(width..2 * width, next_width);
        bytes[width..next_width].fill(0);
        bytes[next_width + width..2 * next_width].fill(0);
        bytes[2 * next_width..2 * next_width + 32]
            .copy_from_slice(accounts.payer.address().as_ref());
        bytes[2 * next_width + 32..].copy_from_slice(&new_credit.to_le_bytes());
    }
    margin.reacquire_guard_only()?;
    Ok(())
}
