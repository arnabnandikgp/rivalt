//! Root-local authority and durable orders; history sequence is never authorization.
use crate::engine::routes::{self as candidates, GroupOrderAction};
use super::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AccountGuard {
    pub safety_epoch: u64,
    pub venue_terms_epoch: u64,
    pub nonce: u64,
    pub state_version: u64,
}
impl AccountGuard {
    pub(crate) fn check(
        &self,
        venue: &Venue,
        safety: &VenueSafety,
        root: &MarginAccount,
    ) -> Result<()> {
        require!(
            self.safety_epoch == safety.epoch
                && self.venue_terms_epoch == venue.terms_epoch
                && self.nonce == root.nonce
                && self.state_version == root.state_version,
            ClearingError::FinancialSequence
        );
        Ok(())
    }
}

#[event_cpi]
#[derive(Accounts)]
pub struct ManageAccountOrder<'info> {
    pub actor: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, Custody>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[0]], bump = btc.bump, has_one = venue,
        constraint = venue.markets[0] == btc.key() @ ClearingError::Profile)]
    pub btc: Box<Account<'info, Market>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[1]], bump = eth.bump, has_one = venue,
        constraint = venue.markets[1] == eth.key() @ ClearingError::Profile)]
    pub eth: Box<Account<'info, Market>>,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()], bump = margin.bump, has_one = venue)]
    pub margin: Box<Account<'info, MarginAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SetAccountDelegate<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, Custody>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()], bump = margin.bump, has_one = venue, has_one = owner)]
    pub margin: Box<Account<'info, MarginAccount>>,
}

pub fn manage(
    ctx: Context<ManageAccountOrder>,
    guard: AccountGuard,
    market_index: u8,
    operation: GroupOrderAction,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    if matches!(
        &operation,
        GroupOrderAction::Cancel { .. } | GroupOrderAction::Cleanup
    ) {
        financial_base_profile(&accounts.venue, &accounts.custody, &accounts.safety)?;
        require!(accounts.safety.mode == ACTIVE, ClearingError::Profile);
    } else {
        financial_activated(&accounts.venue, &accounts.custody, &accounts.safety)?;
    }
    guard.check(&accounts.venue, &accounts.safety, &accounts.margin)?;
    let clock = Clock::get()?;
    let root = root_view(&accounts.margin)?;
    let delegate_epoch = if matches!(&operation, GroupOrderAction::Cleanup) {
        0
    } else {
        crate::engine::account::trade_authority(&root, accounts.actor.key(), clock.slot)?
    };
    let market_views = [market_view(&accounts.btc)?, market_view(&accounts.eth)?];
    let environment = environment(&market_views, usize::from(market_index), &clock)?;
    match &operation {
        GroupOrderAction::Place { terms, .. } | GroupOrderAction::Replace { terms, .. } => {
            environment.admit_sources(&root, &clock, !terms.reduce_only)?
        }
        GroupOrderAction::Protect { .. } => environment.admit_sources(&root, &clock, false)?,
        GroupOrderAction::Cancel { .. } | GroupOrderAction::Cleanup => {}
    }
    let next = candidates::manage_candidate(&root, &environment, operation, delegate_epoch)?;
    let previous = accounts.margin.positions;
    commit_root(&mut accounts.margin, &next)?;
    invalidate(&mut accounts.custody, previous, accounts.margin.positions)?;
    materialize([&mut accounts.btc, &mut accounts.eth], &clock)?;
    increment(&mut accounts.custody.sequence)?;
    emit_order(accounts, clock.slot)
}

#[inline(never)]
fn emit_order(accounts: &ManageAccountOrder, slot: u64) -> Result<()> {
    let emitted = Box::new(crate::events::AccountOrderChanged {
        venue: accounts.venue.key(),
        sequence: accounts.custody.sequence,
        slot,
        margin: accounts.margin.key(),
        state: crate::events::MarginAccountSnapshot::from(&**accounts.margin),
        markets: [
            crate::events::MarketSnapshot::from(&**accounts.btc),
            crate::events::MarketSnapshot::from(&**accounts.eth),
        ],
        liability_versions: accounts.custody.liability_versions,
    });
    crate::event_cpi::emit(&*emitted, accounts.event_authority.to_account_info())
}

pub fn delegate(
    ctx: Context<SetAccountDelegate>,
    guard: AccountGuard,
    delegate: Pubkey,
    expiry_slot: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    // Revocation needs no source or maker, and remains available while paused.
    require!(
        cfg!(feature = "account-trading-qualification")
            && accounts.venue.schema_version == SCHEMA_VERSION
            && financial_profile_version(&accounts.venue)
            && accounts.custody.schema_version == SCHEMA_VERSION
            && accounts.safety.schema_version == SCHEMA_VERSION
            && matches!(accounts.safety.mode, CUSTODY | ACTIVE),
        ClearingError::Profile
    );
    guard.check(&accounts.venue, &accounts.safety, &accounts.margin)?;
    let next = crate::engine::authority::candidate(
        &*root_view(&accounts.margin)?,
        accounts.owner.key(),
        delegate,
        expiry_slot,
        Clock::get()?.slot,
    )?;
    let previous = accounts.margin.positions;
    commit_root(&mut accounts.margin, &next)?;
    invalidate(&mut accounts.custody, previous, accounts.margin.positions)?;
    increment(&mut accounts.custody.sequence)?;
    let emitted = crate::events::AccountAuthorityChanged {
        venue: accounts.venue.key(),
        sequence: accounts.custody.sequence,
        slot: Clock::get()?.slot,
        margin: accounts.margin.key(),
        state: crate::events::MarginAccountSnapshot::from(&**accounts.margin),
        liability_versions: accounts.custody.liability_versions,
    };
    crate::event_cpi::emit(&emitted, accounts.event_authority.to_account_info())
}
