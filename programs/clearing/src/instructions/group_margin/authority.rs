//! Owner-only, per-root trading grants. No cash, claim or configuration authority.
use super::*;
use crate::{constants::orders::INVALIDATED, instructions::group_trading::book};

#[event_cpi]
#[derive(Accounts)]
pub struct SetMarginDelegate<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", &group.domain], bump = group.bump)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"margin-v2", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()],
        bump = margin.bump, has_one = group, has_one = owner)]
    pub margin: Box<Account<'info, MarginAccountV2>>,
}

pub(crate) fn candidate(
    root: &MarginAccountV2,
    actor: Pubkey,
    delegate: Pubkey,
    expiry_slot: u64,
    slot: u64,
) -> Result<MarginAccountV2> {
    model(root)?;
    book::validate(root)?;
    require_keys_eq!(actor, root.owner, ClearingError::Authority);
    require!(
        (delegate == Pubkey::default() && expiry_slot == 0)
            || (delegate != Pubkey::default()
                && delegate != root.owner
                && expiry_slot > slot
                && expiry_slot - slot <= crate::constants::orders::MAX_ORDER_SLOTS),
        ClearingError::Authority
    );
    require!(
        root.delegate != delegate || root.delegate_expiry_slot != expiry_slot,
        ClearingError::Authority
    );
    let mut next = root.clone();
    next.delegate = delegate;
    next.delegate_expiry_slot = expiry_slot;
    next.delegate_epoch = root
        .delegate_epoch
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    next.nonce = root.nonce.checked_add(1).ok_or(ClearingError::Arithmetic)?;
    // Grants cannot revive old orders. Releasing their cached reservations needs
    // no price; owner orders retain their existing authority and reserve snapshot.
    next.reserved = 0;
    for stored in &mut next.book.orders {
        if stored.order.active() && stored.delegate_epoch != 0 {
            stored.order.state = INVALIDATED;
            stored.order.reserve = 0;
        }
        next.reserved = checked(math::cash_add(next.reserved, stored.order.reserve))?;
    }
    super::super::group_trading::advance(&mut next)?;
    book::validate(&next)?;
    Ok(next)
}

pub fn set(ctx: Context<SetMarginDelegate>, delegate: Pubkey, expiry_slot: u64) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    // A pause may not prevent revocation. Frozen default snapshots remain immutable.
    require!(
        cfg!(feature = "successor-test-profile")
            && accounts.group.schema_version == SCHEMA_VERSION
            && accounts.group.profile_version == PROFILE_VERSION
            && accounts.group.market_count == 2
            && (accounts.group.mode == 1 || (cross_profile_enabled() && accounts.group.mode == 2)),
        ClearingError::Profile
    );
    super::super::group_safety::account_model(&accounts.margin)?;
    let clock = Clock::get()?;
    let next = candidate(
        &accounts.margin,
        accounts.owner.key(),
        delegate,
        expiry_slot,
        clock.slot,
    )?;
    accounts.margin.set_inner(next);
    accounts.group.sequence = accounts
        .group
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    let emitted = crate::events::MarginAuthorityChangedV2 {
        group: accounts.group.key(),
        sequence: accounts.group.sequence,
        slot: clock.slot,
        margin: accounts.margin.key(),
        state: crate::events::MarginAccountSnapshotV2::from(&**accounts.margin),
    };
    crate::event_cpi::emit(&emitted, ctx.accounts.event_authority.to_account_info())?;
    Ok(())
}
