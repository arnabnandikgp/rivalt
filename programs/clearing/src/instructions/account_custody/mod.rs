//! Fresh account-centric custody. Trading and nonzero financial state stay gated.
use crate::{error::ClearingError, events::*, state::accounts::*};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, TransferChecked};
use financial_core::{cash_add, cash_sub};
mod contexts;
pub use contexts::*;

pub(crate) fn arithmetic<T>(result: financial_core::Result<T>) -> Result<T> {
    result.map_err(|_| error!(ClearingError::Arithmetic))
}

pub(crate) fn increment(value: &mut u64) -> Result<()> {
    *value = value.checked_add(1).ok_or(ClearingError::Arithmetic)?;
    Ok(())
}

pub(crate) fn custody_profile(
    venue: &Venue,
    custody: &Custody,
    safety: &VenueSafety,
) -> Result<()> {
    require!(
        cfg!(feature = "liquidity-execution-qualification")
            && venue.schema_version == SCHEMA_VERSION
            && venue.profile_version == PROFILE_VERSION
            && venue.insurance_fee_share_bps == 2500
            && custody.schema_version == SCHEMA_VERSION
            && safety.schema_version == SCHEMA_VERSION
            && safety.mode == CUSTODY,
        ClearingError::Profile
    );
    Ok(())
}

pub(crate) fn active(venue: &Venue, custody: &Custody, safety: &VenueSafety) -> Result<()> {
    custody_profile(venue, custody, safety)?;
    require!(!safety.paused, ClearingError::Paused);
    Ok(())
}

/// Identity admission and reserve donation may continue after candidate activation;
/// they do not authorize trading or consume a price-dependent financial path.
fn available_identity(venue: &Venue, custody: &Custody, safety: &VenueSafety) -> Result<()> {
    if safety.mode == ACTIVE {
        super::account_cash::profile(venue, custody, safety)
    } else {
        active(venue, custody, safety)
    }
}

pub(crate) fn reconciled(
    custody: &Custody,
    ledgers: [&MarketLedger; 2],
    actual: u64,
) -> Result<()> {
    let mut allocated = u128::from(custody.total_cash);
    for ledger in ledgers {
        require!(
            ledger.schema_version == SCHEMA_VERSION && ledger.insurance_fee_remainder < 4,
            ClearingError::Profile
        );
        allocated +=
            u128::from(ledger.settlement) + u128::from(ledger.insurance) + u128::from(ledger.fees);
    }
    require!(
        allocated == u128::from(custody.allocated_vault)
            && custody.allocated_vault <= financial_core::MAX_CASH
            && actual >= custody.allocated_vault,
        ClearingError::Reconciliation
    );
    Ok(())
}

fn empty_financial_state(margin: &MarginAccount) -> Result<()> {
    let mut book = Vec::with_capacity(crate::state::OrderBook::INIT_SPACE);
    margin.book.serialize(&mut book)?;
    require!(
        margin.schema_version == SCHEMA_VERSION
            && valid_identity(
                0,
                margin.subaccount_index,
                margin.mode,
                margin.isolated_market_index,
                margin.role
            )
            && margin.nonce == 0
            && margin.reserved == 0
            && margin.delegate == Pubkey::default()
            && margin.delegate_expiry_slot == 0
            && margin.delegate_epoch == 1
            && margin.positions.iter().all(|position| position.lots == 0
                && position.virtual_scaled == 0
                && position.funding_checkpoint_scaled == 0
                && position.generation == 0)
            && book.iter().all(|byte| *byte == 0),
        ClearingError::Profile
    );
    Ok(())
}

/// Completed resolution retains historical generations/nonces. Those are not
/// liabilities; custody cash access still requires every live obligation absent.
pub(crate) fn recovered_custody(safety: &VenueSafety) -> bool {
    cfg!(feature = "liquidity-execution-qualification")
        && safety.mode == CUSTODY
        && safety.resolution_epoch > 0
}

pub(crate) fn liability_free(margin: &MarginAccount) -> Result<()> {
    super::account_trading::model(margin)?;
    require!(
        margin.reserved == 0
            && margin
                .positions
                .iter()
                .all(|position| position.lots == 0 && position.virtual_scaled == 0)
            && margin
                .book
                .orders
                .iter()
                .all(|entry| !entry.order.active() && entry.order.reserve == 0),
        ClearingError::Resolution
    );
    Ok(())
}

fn member(account: &Account<MarginAccount>) -> AccountCashSnapshot {
    AccountCashSnapshot {
        margin: account.key(),
        portfolio: account.portfolio,
        owner: account.owner,
        subaccount_index: account.subaccount_index,
        id: account.id,
        mode: account.mode,
        isolated_market_index: account.isolated_market_index,
        role: account.role,
        cash: account.cash,
        state_version: account.state_version,
    }
}

fn ledger_snapshot(account: &Account<MarketLedger>) -> MarketLedgerSnapshot {
    MarketLedgerSnapshot {
        ledger: account.key(),
        market: account.market,
        market_index: account.market_index,
        settlement: account.settlement,
        insurance: account.insurance,
        fees: account.fees,
        insurance_fee_remainder: account.insurance_fee_remainder,
        version: account.version,
    }
}

fn event(
    venue: &Account<Venue>,
    custody: &Account<Custody>,
    safety: &Account<VenueSafety>,
    kind: u8,
    actor: Pubkey,
    subject: Pubkey,
    index: u16,
    amount: u64,
    actual_vault: Option<u64>,
    members: Vec<AccountCashSnapshot>,
    ledgers: Vec<MarketLedgerSnapshot>,
    registry: Option<&Account<VenueRegistry>>,
) -> Result<AccountCustodyChanged> {
    Ok(AccountCustodyChanged {
        schema_version: SCHEMA_VERSION,
        profile_version: venue.profile_version,
        domain: venue.domain,
        venue: venue.key(),

        slot: Clock::get()?.slot,
        kind,
        actor,
        subject,
        index,
        amount,
        members,
        ledgers,
        authority: venue.authority,
        fee_authority: venue.fee_authority,
        reserve_authority: venue.reserve_authority,
        reserve_destination_owner: venue.reserve_destination_owner,
        quote_mint: venue.quote_mint,
        vault: venue.vault,
        markets: venue.markets,
        market_count: venue.market_count,
        insurance_fee_share_bps: venue.insurance_fee_share_bps,
        mode: safety.mode,
        paused: safety.paused,
        safety_epoch: safety.epoch,
        terms_epoch: venue.terms_epoch,
        config_epoch: venue.config_epoch,
        total_cash: custody.total_cash,
        allocated_vault: custody.allocated_vault,
        liability_versions: custody.liability_versions,
        membership_version: registry.map(|value| value.membership_version),
        member_count: registry.map(|value| value.count),
        actual_vault,
    })
}

pub fn initialize_liquidity(
    ctx: &mut Context<InitializeVenue>,
    events: &mut crate::event_cpi::Payloads,
    domain: [u8; 32],
    fee_authority: Pubkey,
    reserve_authority: Pubkey,
    reserve_destination_owner: Pubkey,
) -> Result<()> {
    require!(
        cfg!(feature = "liquidity-execution-qualification"),
        ClearingError::Profile
    );
    initialize_profile(
        ctx,
        events,
        domain,
        fee_authority,
        reserve_authority,
        reserve_destination_owner,
        4,
    )
}

fn initialize_profile(
    ctx: &mut Context<InitializeVenue>,
    events: &mut crate::event_cpi::Payloads,
    domain: [u8; 32],
    fee_authority: Pubkey,
    reserve_authority: Pubkey,
    reserve_destination_owner: Pubkey,
    profile_version: u16,
) -> Result<()> {
    require!(
        cfg!(feature = "liquidity-execution-qualification") && ctx.remaining_accounts.is_empty(),
        ClearingError::Profile
    );
    require!(domain != [0; 32], ClearingError::Domain);
    require!(
        [fee_authority, reserve_authority, reserve_destination_owner]
            .iter()
            .all(|key| *key != Pubkey::default()),
        ClearingError::Authority
    );
    let venue = &mut ctx.accounts.venue;
    venue.set_inner(Venue {
        schema_version: SCHEMA_VERSION,
        profile_version,
        domain,
        authority: ctx.accounts.authority.key(),
        fee_authority,
        reserve_authority,
        reserve_destination_owner,
        quote_mint: ctx.accounts.quote_mint.key(),
        vault: ctx.accounts.vault.key(),
        terms_epoch: 1,
        config_epoch: 1,
        insurance_fee_share_bps: 2500,
        bump: ctx.bumps.venue,
        vault_bump: ctx.bumps.vault,
        ..Default::default()
    });
    ctx.accounts.custody.set_inner(Custody {
        schema_version: SCHEMA_VERSION,
        venue: venue.key(),
        bump: ctx.bumps.custody,
        ..Default::default()
    });
    ctx.accounts.safety.set_inner(VenueSafety {
        schema_version: SCHEMA_VERSION,
        venue: venue.key(),
        epoch: 1,
        bump: ctx.bumps.safety,
        ..Default::default()
    });
    events.emit(
        &(event(
            venue,
            &ctx.accounts.custody,
            &ctx.accounts.safety,
            0,
            ctx.accounts.authority.key(),
            venue.key(),
            0,
            0,
            Some(0),
            vec![],
            vec![],
            None,
        )?),
        ctx.accounts.event_authority.to_account_info(),
    )?;
    Ok(())
}

pub fn initialize_registry(
    ctx: &mut Context<InitializeVenueRegistry>,
    events: &mut crate::event_cpi::Payloads,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    active(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
    )?;
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.venue.authority,
        ClearingError::Authority
    );
    ctx.accounts.registry.set_inner(VenueRegistry {
        schema_version: SCHEMA_VERSION,
        venue: ctx.accounts.venue.key(),
        membership_version: 1,
        bump: ctx.bumps.registry,
        ..Default::default()
    });
    events.emit(
        &(event(
            &ctx.accounts.venue,
            &ctx.accounts.custody,
            &ctx.accounts.safety,
            10,
            ctx.accounts.authority.key(),
            ctx.accounts.registry.key(),
            0,
            0,
            None,
            vec![],
            vec![],
            Some(&ctx.accounts.registry),
        )?),
        ctx.accounts.event_authority.to_account_info(),
    )?;
    Ok(())
}

pub fn initialize_market(
    ctx: &mut Context<InitializeMarket>,
    events: &mut crate::event_cpi::Payloads,
    index: u8,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    active(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
    )?;
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.venue.authority,
        ClearingError::Authority
    );
    require!(
        usize::from(index) < MARKET_COUNT && index == ctx.accounts.venue.market_count,
        ClearingError::Profile
    );
    ctx.accounts.market.set_inner(Market {
        schema_version: SCHEMA_VERSION,
        venue: ctx.accounts.venue.key(),
        index,
        symbol: if index == 0 {
            *b"BTC\0\0\0\0\0"
        } else {
            *b"ETH\0\0\0\0\0"
        },
        lots_per_unit: if index == 0 { 1_000_000 } else { 100_000 },
        cross_eligible: true,
        terms_epoch: 1,
        config_epoch: 1,
        bump: ctx.bumps.market,
        ..Default::default()
    });
    ctx.accounts.ledger.set_inner(MarketLedger {
        schema_version: SCHEMA_VERSION,
        venue: ctx.accounts.venue.key(),
        market: ctx.accounts.market.key(),
        market_index: index,
        bump: ctx.bumps.ledger,
        ..Default::default()
    });
    ctx.accounts.venue.markets[usize::from(index)] = ctx.accounts.market.key();
    ctx.accounts.venue.market_count += 1;
    events.emit(
        &(event(
            &ctx.accounts.venue,
            &ctx.accounts.custody,
            &ctx.accounts.safety,
            1,
            ctx.accounts.authority.key(),
            ctx.accounts.market.key(),
            u16::from(index),
            0,
            None,
            vec![],
            vec![ledger_snapshot(&ctx.accounts.ledger)],
            None,
        )?),
        ctx.accounts.event_authority.to_account_info(),
    )?;
    Ok(())
}

pub fn create_portfolio(
    ctx: &mut Context<CreatePortfolio>,
    events: &mut crate::event_cpi::Payloads,
    index: u16,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    available_identity(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
    )?;
    require!(
        index < MAX_PORTFOLIOS && usize::from(ctx.accounts.venue.market_count) == MARKET_COUNT,
        ClearingError::Profile
    );
    ctx.accounts.portfolio.set_inner(Portfolio {
        revision: 0,
        schema_version: SCHEMA_VERSION,
        venue: ctx.accounts.venue.key(),
        owner: ctx.accounts.owner.key(),
        index,
        children: 0,
        bump: ctx.bumps.portfolio,
    });
    events.emit(
        &(event(
            &ctx.accounts.venue,
            &ctx.accounts.custody,
            &ctx.accounts.safety,
            2,
            ctx.accounts.owner.key(),
            ctx.accounts.portfolio.key(),
            index,
            0,
            None,
            vec![],
            vec![],
            None,
        )?),
        ctx.accounts.event_authority.to_account_info(),
    )?;
    Ok(())
}

pub fn register(
    ctx: &mut Context<RegisterMargin>,
    events: &mut crate::event_cpi::Payloads,
    subaccount_index: u16,
    mode: u8,
    isolated_market_index: u8,
    role: u8,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    available_identity(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
    )?;
    require!(
        ctx.accounts.portfolio.schema_version == SCHEMA_VERSION
            && ctx.accounts.registry.schema_version == SCHEMA_VERSION
            && usize::from(ctx.accounts.venue.market_count) == MARKET_COUNT
            && valid_identity(
                ctx.accounts.portfolio.index,
                subaccount_index,
                mode,
                isolated_market_index,
                role
            ),
        ClearingError::Profile
    );
    let child_mask = 1u16
        .checked_shl(u32::from(subaccount_index))
        .ok_or(ClearingError::Profile)?;
    require!(
        ctx.accounts.portfolio.children & child_mask == 0,
        ClearingError::Profile
    );
    let registry = &mut ctx.accounts.registry;
    require!(
        usize::from(registry.count) == registry.members.len(),
        ClearingError::Profile
    );
    require!(
        registry.members.len() < MAX_MEMBERS,
        ClearingError::Capacity
    );
    ctx.accounts.margin.set_inner(MarginAccount {
        schema_version: SCHEMA_VERSION,
        venue: ctx.accounts.venue.key(),
        portfolio: ctx.accounts.portfolio.key(),
        owner: ctx.accounts.owner.key(),
        subaccount_index,
        id: registry.count,
        mode,
        isolated_market_index,
        role,
        delegate_epoch: 1,
        bump: ctx.bumps.margin,
        ..Default::default()
    });
    ctx.accounts.portfolio.children |= child_mask;
    registry.members.push(ctx.accounts.margin.key());
    registry.count += 1;
    increment(&mut registry.membership_version)?;
    events.emit(
        &(event(
            &ctx.accounts.venue,
            &ctx.accounts.custody,
            &ctx.accounts.safety,
            3,
            ctx.accounts.owner.key(),
            ctx.accounts.margin.key(),
            subaccount_index,
            0,
            None,
            vec![member(&ctx.accounts.margin)],
            vec![],
            Some(registry),
        )?),
        ctx.accounts.event_authority.to_account_info(),
    )?;
    Ok(())
}

pub fn cash(
    ctx: &mut Context<AccountCash>,
    events: &mut crate::event_cpi::Payloads,
    amount: u64,
    withdraw: bool,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    if !withdraw && ctx.accounts.safety.mode == ACTIVE {
        super::account_cash::profile(
            &ctx.accounts.venue,
            &ctx.accounts.custody,
            &ctx.accounts.safety,
        )?;
        super::account_trading::model(&ctx.accounts.margin)?;
        let positions = ctx.accounts.margin.positions;
        super::account_trading::invalidate(&mut ctx.accounts.custody, positions, positions)?;
    } else {
        active(
            &ctx.accounts.venue,
            &ctx.accounts.custody,
            &ctx.accounts.safety,
        )?;
        if recovered_custody(&ctx.accounts.safety) {
            liability_free(&ctx.accounts.margin)?;
        } else {
            empty_financial_state(&ctx.accounts.margin)?;
        }
    }
    require!(amount > 0, ClearingError::Amount);
    reconciled(
        &ctx.accounts.custody,
        [&ctx.accounts.btc_ledger, &ctx.accounts.eth_ledger],
        ctx.accounts.vault.amount,
    )?;
    let operation = if withdraw { cash_sub } else { cash_add };
    ctx.accounts.margin.cash = arithmetic(operation(ctx.accounts.margin.cash, amount))?;
    ctx.accounts.custody.total_cash =
        arithmetic(operation(ctx.accounts.custody.total_cash, amount))?;
    ctx.accounts.custody.allocated_vault =
        arithmetic(operation(ctx.accounts.custody.allocated_vault, amount))?;
    increment(&mut ctx.accounts.margin.state_version)?;
    if withdraw {
        let bump = [ctx.accounts.venue.bump];
        let seeds: &[&[u8]] = &[b"venue-v3", ctx.accounts.venue.domain.as_ref(), &bump];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.user_token.to_account_info(),
                    authority: ctx.accounts.venue.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            6,
        )?;
    } else {
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.user_token.to_account_info(),
                    mint: ctx.accounts.quote_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
            6,
        )?;
    }
    ctx.accounts.vault.reload()?;
    reconciled(
        &ctx.accounts.custody,
        [&ctx.accounts.btc_ledger, &ctx.accounts.eth_ledger],
        ctx.accounts.vault.amount,
    )?;
    events.emit(
        &(event(
            &ctx.accounts.venue,
            &ctx.accounts.custody,
            &ctx.accounts.safety,
            if withdraw { 5 } else { 4 },
            ctx.accounts.owner.key(),
            ctx.accounts.margin.key(),
            ctx.accounts.margin.subaccount_index,
            amount,
            Some(ctx.accounts.vault.amount),
            vec![member(&ctx.accounts.margin)],
            vec![
                ledger_snapshot(&ctx.accounts.btc_ledger),
                ledger_snapshot(&ctx.accounts.eth_ledger),
            ],
            None,
        )?),
        ctx.accounts.event_authority.to_account_info(),
    )?;
    Ok(())
}

pub fn transfer(
    ctx: &mut Context<TransferAccountCustody>,
    events: &mut crate::event_cpi::Payloads,
    amount: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    active(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
    )?;
    if recovered_custody(&ctx.accounts.safety) {
        liability_free(&ctx.accounts.donor)?;
        liability_free(&ctx.accounts.recipient)?;
    } else {
        empty_financial_state(&ctx.accounts.donor)?;
        empty_financial_state(&ctx.accounts.recipient)?;
    }
    require!(amount > 0, ClearingError::Amount);
    reconciled(
        &ctx.accounts.custody,
        [&ctx.accounts.btc_ledger, &ctx.accounts.eth_ledger],
        ctx.accounts.vault.amount,
    )?;
    ctx.accounts.donor.cash = arithmetic(cash_sub(ctx.accounts.donor.cash, amount))?;
    ctx.accounts.recipient.cash = arithmetic(cash_add(ctx.accounts.recipient.cash, amount))?;
    increment(&mut ctx.accounts.donor.state_version)?;
    increment(&mut ctx.accounts.recipient.state_version)?;
    events.emit(
        &(event(
            &ctx.accounts.venue,
            &ctx.accounts.custody,
            &ctx.accounts.safety,
            6,
            ctx.accounts.owner.key(),
            ctx.accounts.donor.key(),
            0,
            amount,
            Some(ctx.accounts.vault.amount),
            vec![member(&ctx.accounts.donor), member(&ctx.accounts.recipient)],
            vec![
                ledger_snapshot(&ctx.accounts.btc_ledger),
                ledger_snapshot(&ctx.accounts.eth_ledger),
            ],
            None,
        )?),
        ctx.accounts.event_authority.to_account_info(),
    )?;
    Ok(())
}

pub fn pause(
    ctx: &mut Context<PauseVenue>,
    events: &mut crate::event_cpi::Payloads,
    paused: bool,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    if ctx.accounts.safety.mode == ACTIVE {
        super::account_trading::base_profile(
            &ctx.accounts.venue,
            &ctx.accounts.custody,
            &ctx.accounts.safety,
        )?;
    } else {
        custody_profile(
            &ctx.accounts.venue,
            &ctx.accounts.custody,
            &ctx.accounts.safety,
        )?;
    }
    require_keys_eq!(
        ctx.accounts.authority.key(),
        ctx.accounts.venue.authority,
        ClearingError::Authority
    );
    reconciled(
        &ctx.accounts.custody,
        [&ctx.accounts.btc_ledger, &ctx.accounts.eth_ledger],
        ctx.accounts.vault.amount,
    )?;
    ctx.accounts.safety.paused = paused;
    increment(&mut ctx.accounts.safety.epoch)?;
    events.emit(
        &(event(
            &ctx.accounts.venue,
            &ctx.accounts.custody,
            &ctx.accounts.safety,
            7,
            ctx.accounts.authority.key(),
            ctx.accounts.safety.key(),
            0,
            0,
            Some(ctx.accounts.vault.amount),
            vec![],
            vec![
                ledger_snapshot(&ctx.accounts.btc_ledger),
                ledger_snapshot(&ctx.accounts.eth_ledger),
            ],
            None,
        )?),
        ctx.accounts.event_authority.to_account_info(),
    )?;
    Ok(())
}

pub fn classify_surplus(
    ctx: &mut Context<ClassifyMarketSurplus>,
    events: &mut crate::event_cpi::Payloads,
    market_index: u8,
    amount: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    available_identity(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
    )?;
    require_keys_eq!(
        ctx.accounts.reserve_authority.key(),
        ctx.accounts.venue.reserve_authority,
        ClearingError::Authority
    );
    require!(market_index < 2 && amount > 0, ClearingError::Amount);
    reconciled(
        &ctx.accounts.custody,
        [&ctx.accounts.btc_ledger, &ctx.accounts.eth_ledger],
        ctx.accounts.vault.amount,
    )?;
    require!(
        amount <= ctx.accounts.vault.amount - ctx.accounts.custody.allocated_vault,
        ClearingError::Amount
    );
    let ledger = if market_index == 0 {
        &mut ctx.accounts.btc_ledger
    } else {
        &mut ctx.accounts.eth_ledger
    };
    ledger.insurance = arithmetic(cash_add(ledger.insurance, amount))?;
    increment(&mut ledger.version)?;
    ctx.accounts.custody.allocated_vault =
        arithmetic(cash_add(ctx.accounts.custody.allocated_vault, amount))?;
    reconciled(
        &ctx.accounts.custody,
        [&ctx.accounts.btc_ledger, &ctx.accounts.eth_ledger],
        ctx.accounts.vault.amount,
    )?;
    events.emit(
        &(event(
            &ctx.accounts.venue,
            &ctx.accounts.custody,
            &ctx.accounts.safety,
            8,
            ctx.accounts.reserve_authority.key(),
            ctx.accounts.venue.markets[usize::from(market_index)],
            u16::from(market_index),
            amount,
            Some(ctx.accounts.vault.amount),
            vec![],
            vec![
                ledger_snapshot(&ctx.accounts.btc_ledger),
                ledger_snapshot(&ctx.accounts.eth_ledger),
            ],
            None,
        )?),
        ctx.accounts.event_authority.to_account_info(),
    )?;
    Ok(())
}

pub fn seed_insurance(
    ctx: &mut Context<SeedMarketInsurance>,
    events: &mut crate::event_cpi::Payloads,
    market_index: u8,
    amount: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    available_identity(
        &ctx.accounts.venue,
        &ctx.accounts.custody,
        &ctx.accounts.safety,
    )?;
    require_keys_eq!(
        ctx.accounts.reserve_authority.key(),
        ctx.accounts.venue.reserve_authority,
        ClearingError::Authority
    );
    require!(market_index < 2 && amount > 0, ClearingError::Amount);
    reconciled(
        &ctx.accounts.custody,
        [&ctx.accounts.btc_ledger, &ctx.accounts.eth_ledger],
        ctx.accounts.vault.amount,
    )?;
    let ledger = if market_index == 0 {
        &mut ctx.accounts.btc_ledger
    } else {
        &mut ctx.accounts.eth_ledger
    };
    ledger.insurance = arithmetic(cash_add(ledger.insurance, amount))?;
    increment(&mut ledger.version)?;
    ctx.accounts.custody.allocated_vault =
        arithmetic(cash_add(ctx.accounts.custody.allocated_vault, amount))?;
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.donor_token.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.donor.to_account_info(),
            },
        ),
        amount,
        6,
    )?;
    ctx.accounts.vault.reload()?;
    reconciled(
        &ctx.accounts.custody,
        [&ctx.accounts.btc_ledger, &ctx.accounts.eth_ledger],
        ctx.accounts.vault.amount,
    )?;
    events.emit(
        &(event(
            &ctx.accounts.venue,
            &ctx.accounts.custody,
            &ctx.accounts.safety,
            9,
            ctx.accounts.donor.key(),
            ctx.accounts.venue.markets[usize::from(market_index)],
            u16::from(market_index),
            amount,
            Some(ctx.accounts.vault.amount),
            vec![],
            vec![
                ledger_snapshot(&ctx.accounts.btc_ledger),
                ledger_snapshot(&ctx.accounts.eth_ledger),
            ],
            None,
        )?),
        ctx.accounts.event_authority.to_account_info(),
    )?;
    Ok(())
}
