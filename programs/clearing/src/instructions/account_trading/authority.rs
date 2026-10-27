//! Root-local authority and durable orders; history sequence is never authorization.
use super::super::group_trading::routes::{self as candidates, GroupOrderAction};
use super::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AccountGuardV3 {
    pub safety_epoch: u64,
    pub venue_terms_epoch: u64,
    pub nonce: u64,
    pub state_version: u64,
}
impl AccountGuardV3 {
    pub(crate) fn check(
        &self,
        venue: &VenueV3,
        safety: &SafetyV3,
        root: &MarginAccountV3,
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
pub struct ManageAccountOrderV3<'info> {
    pub actor: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[0]], bump = btc.bump, has_one = venue,
        constraint = venue.markets[0] == btc.key() @ ClearingError::Profile)]
    pub btc: Box<Account<'info, MarketV3>>,
    #[account(mut, seeds = [b"market-v3", venue.key().as_ref(), &[1]], bump = eth.bump, has_one = venue,
        constraint = venue.markets[1] == eth.key() @ ClearingError::Profile)]
    pub eth: Box<Account<'info, MarketV3>>,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()], bump = margin.bump, has_one = venue)]
    pub margin: Box<Account<'info, MarginAccountV3>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SetAccountDelegateV3<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"venue-v3", &venue.domain], bump = venue.bump)]
    pub venue: Box<Account<'info, VenueV3>>,
    #[account(mut, seeds = [b"custody-v3", venue.key().as_ref()], bump = custody.bump, has_one = venue)]
    pub custody: Box<Account<'info, CustodyV3>>,
    #[account(seeds = [b"safety-v3", venue.key().as_ref()], bump = safety.bump, has_one = venue)]
    pub safety: Box<Account<'info, SafetyV3>>,
    #[account(mut, seeds = [b"margin-v3", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()], bump = margin.bump, has_one = venue, has_one = owner)]
    pub margin: Box<Account<'info, MarginAccountV3>>,
}

pub fn manage(
    ctx: Context<ManageAccountOrderV3>,
    guard: AccountGuardV3,
    market_index: u8,
    operation: GroupOrderAction,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    if matches!(
        &operation,
        GroupOrderAction::Cancel { .. } | GroupOrderAction::Cleanup
    ) {
        base_profile(&accounts.venue, &accounts.custody, &accounts.safety)?;
        require!(accounts.safety.mode == ACTIVE, ClearingError::Profile);
    } else {
        activated(&accounts.venue, &accounts.custody, &accounts.safety)?;
    }
    guard.check(&accounts.venue, &accounts.safety, &accounts.margin)?;
    let clock = Clock::get()?;
    let root = root_view(&accounts.margin)?;
    let delegate_epoch = if matches!(&operation, GroupOrderAction::Cleanup) {
        0
    } else {
        super::super::group_margin::trade_authority(&root, accounts.actor.key(), clock.slot)?
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
fn emit_order(accounts: &ManageAccountOrderV3, slot: u64) -> Result<()> {
    let emitted = Box::new(crate::events::AccountOrderChangedV3 {
        venue: accounts.venue.key(),
        sequence: accounts.custody.sequence,
        slot,
        margin: accounts.margin.key(),
        state: crate::events::MarginAccountSnapshotV3::from(&**accounts.margin),
        markets: [
            crate::events::MarketSnapshotV3::from(&**accounts.btc),
            crate::events::MarketSnapshotV3::from(&**accounts.eth),
        ],
        liability_versions: accounts.custody.liability_versions,
    });
    crate::event_cpi::emit(&*emitted, accounts.event_authority.to_account_info())
}

pub fn delegate(
    ctx: Context<SetAccountDelegateV3>,
    guard: AccountGuardV3,
    delegate: Pubkey,
    expiry_slot: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    // Revocation needs no source or maker, and remains available while paused.
    require!(
        cfg!(feature = "account-trading-qualification")
            && accounts.venue.schema_version == SCHEMA_VERSION
            && accounts.venue.profile_version == PROFILE_VERSION
            && accounts.custody.schema_version == SCHEMA_VERSION
            && accounts.safety.schema_version == SCHEMA_VERSION
            && matches!(accounts.safety.mode, CUSTODY | ACTIVE),
        ClearingError::Profile
    );
    guard.check(&accounts.venue, &accounts.safety, &accounts.margin)?;
    let next = super::super::group_margin::authority::candidate(
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
    let emitted = crate::events::AccountAuthorityChangedV3 {
        venue: accounts.venue.key(),
        sequence: accounts.custody.sequence,
        slot: Clock::get()?.slot,
        margin: accounts.margin.key(),
        state: crate::events::MarginAccountSnapshotV3::from(&**accounts.margin),
        liability_versions: accounts.custody.liability_versions,
    };
    crate::event_cpi::emit(&emitted, accounts.event_authority.to_account_info())
}
