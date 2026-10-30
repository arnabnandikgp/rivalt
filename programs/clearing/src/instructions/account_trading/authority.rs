//! Root-local authority and durable orders; history sequence is never authorization.
use super::*;
use crate::engine::routes::{self as candidates, OrderAction};

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
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[0]], bump = btc.bump, has_one = venue,
        constraint = venue.markets[0] == btc.key() @ ClearingError::Profile)]
    pub btc: Option<Box<Account<'info, Market>>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[1]], bump = eth.bump, has_one = venue,
        constraint = venue.markets[1] == eth.key() @ ClearingError::Profile)]
    pub eth: Option<Box<Account<'info, Market>>>,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()], bump = margin.bump, has_one = venue)]
    pub margin: Box<Account<'info, MarginAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SetAccountDelegate<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, Venue>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, VenueSafety>>,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()], bump = margin.bump, has_one = venue, has_one = owner)]
    pub margin: Box<Account<'info, MarginAccount>>,
}

pub fn manage(
    ctx: &mut Context<ManageAccountOrder>,
    events: &mut crate::event_cpi::Payloads,
    guard: AccountGuard,
    market_index: u8,
    operation: OrderAction,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    if matches!(
        &operation,
        OrderAction::Cancel { .. } | OrderAction::Cleanup
    ) {
        base_identity(&accounts.venue, &accounts.safety)?;
        require!(accounts.safety.mode == ACTIVE, ClearingError::Profile);
    } else {
        activated_identity(&accounts.venue, &accounts.safety)?;
    }
    guard.check(&accounts.venue, &accounts.safety, &accounts.margin)?;
    let clock = Clock::get()?;
    let root = root_view(&accounts.margin)?;
    let delegate_epoch = if matches!(&operation, OrderAction::Cleanup) {
        0
    } else {
        crate::engine::account::trade_authority(&root, accounts.actor.key(), clock.slot)?
    };
    require!(market_index < 2, ClearingError::Profile);
    // Borrow the authenticated market states through candidate computation; no
    // duplicate two-market snapshot belongs on the 4 KiB instruction stack.
    let environment = optional_environment(
        [
            accounts.btc.as_deref().map(|market| &**market),
            accounts.eth.as_deref().map(|market| &**market),
        ],
        usize::from(market_index),
        &clock,
    )?;
    match &operation {
        OrderAction::Place { terms, .. } | OrderAction::Replace { terms, .. } => {
            environment.admit_sources(&root, &clock, !terms.reduce_only)?
        }
        OrderAction::Protect { .. } => environment.admit_sources(&root, &clock, false)?,
        OrderAction::Cancel { .. } | OrderAction::Cleanup => {}
    }
    let next = candidates::manage_candidate(&root, &environment, operation, delegate_epoch)?;
    commit_root(&mut accounts.margin, &next)?;
    materialize_optional(
        [
            accounts.btc.as_deref_mut().map(|market| &mut **market),
            accounts.eth.as_deref_mut().map(|market| &mut **market),
        ],
        &clock,
    )?;

    emit_order(events, accounts, clock.slot)
}

#[inline(never)]
fn emit_order(
    events: &mut crate::event_cpi::Payloads,
    accounts: &ManageAccountOrder,
    slot: u64,
) -> Result<()> {
    let emitted = Box::new(crate::events::AccountOrderChanged {
        venue: accounts.venue.key(),

        slot,
        margin: accounts.margin.key(),
        state: crate::events::MarginAccountSnapshot::from(&**accounts.margin),
        markets: [accounts.btc.as_deref(), accounts.eth.as_deref()]
            .into_iter()
            .flatten()
            .map(|market| crate::events::MarketSnapshot::from(&**market))
            .collect(),
    });
    events.emit(&*emitted, accounts.event_authority.to_account_info())
}

pub fn delegate(
    ctx: &mut Context<SetAccountDelegate>,
    events: &mut crate::event_cpi::Payloads,
    guard: AccountGuard,
    delegate: Pubkey,
    expiry_slot: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    // Revocation needs no source or maker, and remains available while paused.
    require!(
        cfg!(feature = "liquidity-execution-qualification")
            && accounts.venue.schema_version == SCHEMA_VERSION
            && supported_profile(&accounts.venue)
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
    commit_root(&mut accounts.margin, &next)?;

    let emitted = crate::events::AccountAuthorityChanged {
        venue: accounts.venue.key(),

        slot: Clock::get()?.slot,
        margin: accounts.margin.key(),
        state: crate::events::MarginAccountSnapshot::from(&**accounts.margin),
    };
    events.emit(&emitted, accounts.event_authority.to_account_info())
}
