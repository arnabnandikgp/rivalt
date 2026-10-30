//! Delegate changes invalidate stale order authority without requiring prices.
use super::*;
use crate::constants::orders::INVALIDATED;

pub(crate) fn candidate(
    root: &MarginAccount,
    actor: Pubkey,
    delegate: Pubkey,
    expiry_slot: u64,
    slot: u64,
) -> Result<MarginAccount> {
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
    super::advance(&mut next)?;
    book::validate(&next)?;
    Ok(next)
}
