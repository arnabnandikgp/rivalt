//! Frozen schema-3 cohort. Storage and continuation authority are separate from
//! the untrusted rate proposer; no live account is changed by the valuation pass.
use super::*;
use account_custody::{arithmetic as checked, increment};
use financial_core::{
    self as math,
    clearing::{row::Row, wide},
};

mod application;
mod contexts;
mod freeze;
mod pages;
mod rates;
mod recovery;
pub mod retirement;
mod rounding;
pub use contexts::*;
pub use freeze::{freeze, value_sources};
pub use pages::advance;
pub use rates::{finalize, upload};
pub use recovery::{reactivate, recover};
pub use rounding::{check_order, order, round};

pub const IDLE: u8 = 0;
pub const AWAIT_VALUATION: u8 = 1;
pub const VALUE: u8 = 2;
pub const DENOMINATOR: u8 = 3;
pub const RATE_PROPOSAL: u8 = 4;
pub const VERIFY: u8 = 5;
pub const FLOW_PLAN: u8 = 6;
pub const EDGE_ORDER: u8 = 7;
pub const ROUND: u8 = 8;
pub const APPLY: u8 = 9;
pub const RECONCILE: u8 = 10;
pub const COMPLETE: u8 = 11;
pub const RECOVERED: u8 = 12;
pub const TERMINAL: u8 = 13;
const PAGE_COUNT: u16 = (MAX_MEMBERS / RESOLUTION_PAGE_ROWS) as u16;

fn profile(identity: &ResolutionIdentity) -> Result<()> {
    require!(
        cfg!(feature = "liquidity-execution-qualification")
            && identity.venue.schema_version == SCHEMA_VERSION
            && account_trading::supported_profile(&identity.venue)
            && identity.venue.market_count == 2
            && identity.venue.insurance_fee_share_bps == 2500
            && identity.custody.schema_version == SCHEMA_VERSION
            && identity.safety.schema_version == SCHEMA_VERSION,
        ClearingError::Profile
    );
    for (index, market) in [&identity.btc, &identity.eth].into_iter().enumerate() {
        require!(market.index as usize == index, ClearingError::Profile);
        account_trading::market_view(market)?;
    }
    account_custody::reconciled(
        &identity.custody,
        [&identity.btc_ledger, &identity.eth_ledger],
        identity.vault.amount,
    )
}

fn registry_hash(registry: &VenueRegistry) -> Result<[u8; 32]> {
    require!(
        registry.schema_version == SCHEMA_VERSION
            && registry.count > 0
            && usize::from(registry.count) == registry.members.len()
            && registry.members.len() <= MAX_MEMBERS,
        ClearingError::Resolution
    );
    for (index, member) in registry.members.iter().enumerate() {
        require!(
            *member != Pubkey::default() && !registry.members[..index].contains(member),
            ClearingError::Resolution
        );
    }
    // Include membership version, not merely the public-key list.
    let mut bytes = Vec::with_capacity(VenueRegistry::INIT_SPACE);
    registry.serialize(&mut bytes)?;
    Ok(solana_sha256_hasher::hash(&bytes).to_bytes())
}

fn frozen(
    identity: &ResolutionIdentity,
    registry: &VenueRegistry,
    header: &Resolution,
    epoch: u64,
) -> Result<()> {
    profile(identity)?;
    require!(
        identity.safety.mode == FROZEN
            && identity.safety.paused
            && header.schema_version == SCHEMA_VERSION
            && header.epoch == epoch
            && identity.safety.resolution_epoch == epoch
            && header.safety_epoch == identity.safety.epoch
            && header.terms_epoch == identity.venue.terms_epoch
            && header.count == registry.count
            && header.registry_hash == registry_hash(registry)?
            && (AWAIT_VALUATION..=RECONCILE).contains(&header.stage),
        ClearingError::Resolution
    );
    let markets = [&identity.btc, &identity.eth];
    require!(
        markets.map(|market| market.config_epoch) == header.config_epochs
            && markets.map(|market| market.funding_index_scaled) == header.funding
            && markets.map(|market| market.gross_lots) == header.remaining_gross,
        ClearingError::Resolution
    );
    // No collection or insurance becomes spendable before the complete plan.
    if header.stage <= APPLY {
        let ledgers = [&identity.btc_ledger, &identity.eth_ledger];
        require!(
            identity.custody.total_cash == header.cash_before
                && identity.custody.allocated_vault == header.allocated_before
                && ledgers.map(|ledger| ledger.settlement) == header.pools_before
                && ledgers.map(|ledger| ledger.insurance) == header.insurance_before
                && ledgers.map(|ledger| ledger.fees) == header.fees_before,
            ClearingError::Reconciliation
        );
    } else {
        let ledgers = [&identity.btc_ledger, &identity.eth_ledger];
        require!(
            identity.custody.total_cash == header.cash_applied
                && identity.custody.allocated_vault == header.allocated_before
                && ledgers.map(|ledger| ledger.settlement) == [0; 2]
                && ledgers.map(|ledger| ledger.fees) == header.fees_before
                && ledgers.map(|ledger| ledger.insurance)
                    == [
                        header.insurance_before[0]
                            .checked_sub(header.insurance_spent[0])
                            .ok_or(ClearingError::Arithmetic)?,
                        header.insurance_before[1]
                            .checked_sub(header.insurance_spent[1])
                            .ok_or(ClearingError::Arithmetic)?
                    ],
            ClearingError::Reconciliation
        );
    }
    Ok(())
}

pub fn initialize(ctx: Context<InitializeAccountResolution>) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty() && cfg!(feature = "liquidity-execution-qualification"),
        ClearingError::Profile
    );
    account_trading::base_profile(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
    )?;
    // Anchor has already initialized the fixed buffers. Do not allocate another
    // 8 KiB default work object on the SBF stack or bump heap.
    let header = &mut ctx.accounts.resolution;
    header.schema_version = SCHEMA_VERSION;
    header.venue = ctx.accounts.venue.key();
    header.bump = ctx.bumps.resolution;
    let work = &mut ctx.accounts.work;
    work.schema_version = SCHEMA_VERSION;
    work.venue = ctx.accounts.venue.key();
    work.bump = ctx.bumps.work;
    Ok(())
}

pub fn initialize_page(
    ctx: Context<InitializeAccountResolutionPage>,
    page_index: u16,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty() && cfg!(feature = "liquidity-execution-qualification"),
        ClearingError::Profile
    );
    account_trading::base_profile(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
    )?;
    require!(
        ctx.accounts.resolution.schema_version == SCHEMA_VERSION
            && ctx.accounts.resolution.stage == IDLE
            && ctx.accounts.resolution.epoch == 0
            && page_index < PAGE_COUNT
            && ctx.accounts.resolution.cursor == page_index,
        ClearingError::Resolution
    );
    let page = &mut ctx.accounts.page;
    page.schema_version = SCHEMA_VERSION;
    page.venue = ctx.accounts.venue.key();
    page.page_index = page_index;
    page.bump = ctx.bumps.page;
    ctx.accounts.resolution.cursor += 1;
    Ok(())
}

#[cfg(test)]
mod tests;
