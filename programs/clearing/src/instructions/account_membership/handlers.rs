//! Owner-authorized membership changes. Root eligibility, exact page membership,
//! fifteen index nodes and the fixed registry header commit in one transaction.
use super::{contexts::*, index, lifecycle, members};
use crate::{events::MarginMembershipChanged, state::accounts::*, ClearingError};
use anchor_lang::{AccountDeserialize, pinocchio::{Resize, sysvars::{rent::Rent, Sysvar}}, prelude::*};
use financial_core::clearing::scalable::membership_update::Change;

pub fn change(ctx: &mut Context<ChangeMarginMembership>, events: &mut crate::event_cpi::Payloads,
    activate: bool, revision: u64, membership_epoch: u64, safety_epoch: u64, index_revisions: [u64; 15],
) -> Result<()> {
    let mut path = ctx.remaining_accounts()?;
    let accounts = &mut ctx.accounts;
    available(&accounts.venue, &accounts.safety, !activate)?;
    require!(accounts.safety.epoch == safety_epoch && accounts.registry.membership_epoch == membership_epoch
        && accounts.margin.revision == revision && accounts.storage.model().locked_epoch == 0,
        ClearingError::Resolution);
    members::member(&accounts.members, &accounts.registry, accounts.margin.address(), &accounts.margin)?;
    lifecycle::unbound(accounts.margin.address(), accounts.binding.account())?;
    let entering = if activate { Change::Enter } else { Change::Leave };
    let next = if activate { MEMBER_FINANCIAL } else { MEMBER_REGISTERED };
    require!(accounts.margin.lifecycle == if activate { MEMBER_REGISTERED } else { MEMBER_FINANCIAL }, ClearingError::Resolution);
    let update = index::prepare(&path, accounts.venue.address(), accounts.margin.id,
        accounts.members.financial_mask, accounts.registry.financial_count, entering, index_revisions)?;
    if activate {
        // P56B owns larger financially populated qualification. This temporary
        // local admission gate does not cap registration, IDs or the index.
        require!(update.financial_count <= MAX_MEMBERS as u64, ClearingError::Capacity);
        accounts.storage.model().admits(update.financial_count).map_err(|_| ClearingError::Capacity)?;
    }
    let epoch = membership_epoch.checked_add(1).ok_or(ClearingError::Arithmetic)?;
    lifecycle::transition(&mut accounts.margin, next)?;
    index::commit(&mut path, accounts.margin.id, update)?;
    accounts.registry.financial_count = update.financial_count;
    accounts.registry.membership_epoch = epoch;
    accounts.members.financial_mask = update.financial_mask;
    let entry = &mut accounts.members.members.entries[(accounts.margin.id % 64) as usize];
    entry.lifecycle = next;
    entry.activation_generation = accounts.margin.activation_generation;
    emit(events, accounts.event_authority.account().clone(), accounts.margin.address(), &accounts.margin,
        &accounts.registry, 0)
}

pub fn retire(ctx: &mut Context<RetireMargin>, events: &mut crate::event_cpi::Payloads,
    revision: u64, safety_epoch: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts()?.is_empty(), ClearingError::Resolution);
    let accounts = &mut ctx.accounts;
    available(&accounts.venue, &accounts.safety, true)?;
    require!(accounts.safety.epoch == safety_epoch, ClearingError::Resolution);
    let mut account = accounts.margin.account().clone();
    require!(account.owner() == &crate::ID && account.is_writable() && !account.is_signer()
        && !account.executable() && account.data_len() == 8 + MarginAccount::INIT_SPACE, ClearingError::Resolution);
    let mut root = Box::new(MarginAccount::try_deserialize(&mut &account.try_borrow()?[..])?);
    require!(root.revision == revision && root.owner == *accounts.owner.address()
        && root.portfolio == *accounts.portfolio.address(), ClearingError::Authority);
    let key = create_program_address(&[b"margin-v3", root.portfolio.as_ref(), &root.subaccount_index.to_le_bytes(), &[root.bump]],
        &crate::ID).map_err(|_| ClearingError::Resolution)?;
    require_keys_eq!(key, *account.address(), ClearingError::Resolution);
    members::member(&accounts.members, &accounts.registry, account.address(), &root)?;
    lifecycle::unbound(account.address(), accounts.binding.account())?;
    let registered = accounts.registry.registered_count.checked_sub(1).ok_or(ClearingError::Arithmetic)?;
    let children = accounts.portfolio.active_children.checked_sub(1).ok_or(ClearingError::Arithmetic)?;
    lifecycle::transition(&mut root, MEMBER_RETIRED)?;
    let tombstone = MarginTombstone { schema_version: SCHEMA_VERSION, revision: root.revision,
        venue: root.venue, portfolio: root.portfolio, owner: root.owner, child: root.subaccount_index,
        id: root.id, activation_generation: root.activation_generation, bump: root.bump };
    let retained = Rent::get()?.try_minimum_balance(8 + MarginTombstone::INIT_SPACE)?;
    let refund = account.lamports().checked_sub(retained).ok_or(ClearingError::Resolution)?;
    let mut owner = accounts.owner.account().clone();
    let owner_balance = owner.lamports().checked_add(refund).ok_or(ClearingError::Arithmetic)?;
    account.resize(8 + MarginTombstone::INIT_SPACE)?;
    crate::wire::write_account(&tombstone, &mut account.try_borrow_mut()?[..])?;
    account.set_lamports(retained);
    owner.set_lamports(owner_balance);
    accounts.members.members.entries[(root.id % 64) as usize].lifecycle = MEMBER_RETIRED;
    accounts.registry.registered_count = registered;
    accounts.portfolio.active_children = children;
    // Empty retirement has no financial effect; the financial epoch and path
    // stay untouched. The original root address and stable ID remain permanent.
    emit(events, accounts.event_authority.account().clone(), account.address(), &root, &accounts.registry, refund)
}
fn emit(events: &mut crate::event_cpi::Payloads, authority: AccountView, key: &Address,
    root: &MarginAccount, registry: &VenueRegistry, refund: u64,
) -> Result<()> {
    events.emit(&MarginMembershipChanged { venue: root.venue, slot: Clock::get()?.slot, margin: *key,
        portfolio: root.portfolio, owner: root.owner, id: root.id, lifecycle: root.lifecycle,
        activation_generation: root.activation_generation, nonce: root.nonce, state_version: root.state_version,
        delegate_epoch: root.delegate_epoch, membership_epoch: registry.membership_epoch,
        registered_count: registry.registered_count, financial_count: registry.financial_count,
        next_id: registry.next_id, refunded_lamports: refund }, authority)
}

fn available(venue: &Venue, safety: &VenueSafety, exit: bool) -> Result<()> {
    require!(TRADING_IMPLEMENTED && venue.schema_version == SCHEMA_VERSION && venue.profile_version == PROFILE_VERSION
        && safety.schema_version == SCHEMA_VERSION && !safety.paused
        && (matches!(safety.mode,CUSTODY|ACTIVE) || (exit && safety.mode == RETIRED)), ClearingError::Resolution);
    Ok(())
}
