//! Complete-group certificates and ordinary funded-cash/claim transitions.
use super::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

#[derive(Accounts)]
pub struct InitializeGroupSafety<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump, has_one = authority)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(init, payer = authority, space = 8 + GroupExitGuardV2::INIT_SPACE,
        seeds = [b"exit-v2", group.key().as_ref()], bump)]
    pub guard: Box<Account<'info, GroupExitGuardV2>>,
    #[account(init, payer = authority, space = 8 + GroupResolutionV2::INIT_SPACE,
        seeds = [b"resolution-v2", group.key().as_ref()], bump)]
    pub resolution: Box<Account<'info, GroupResolutionV2>>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ActivateIsolatedGroup<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump, has_one = authority, has_one = vault)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[0]], bump = btc.bump, has_one = group)]
    pub btc: Box<Account<'info, GroupMarketV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[1]], bump = eth.bump, has_one = group)]
    pub eth: Box<Account<'info, GroupMarketV2>>,
    #[account(seeds = [b"exit-v2", group.key().as_ref()], bump = guard.bump, has_one = group)]
    pub guard: Box<Account<'info, GroupExitGuardV2>>,
    #[account(seeds = [b"resolution-v2", group.key().as_ref()], bump = resolution.bump, has_one = group)]
    pub resolution: Box<Account<'info, GroupResolutionV2>>,
    #[account(seeds = [b"vault-v2", group.key().as_ref()], bump = group.vault_bump,
        constraint = vault.mint == group.quote_mint && vault.owner == group.key() @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

#[derive(Accounts)]
pub struct CheckGroupExit<'info> {
    #[account(seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump, has_one = vault)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(seeds = [b"market-v2", group.key().as_ref(), &[0]], bump = btc.bump, has_one = group)]
    pub btc: Box<Account<'info, GroupMarketV2>>,
    #[account(seeds = [b"market-v2", group.key().as_ref(), &[1]], bump = eth.bump, has_one = group)]
    pub eth: Box<Account<'info, GroupMarketV2>>,
    #[account(seeds = [b"registry-v2", group.key().as_ref()], bump = registry.bump, has_one = group)]
    pub registry: Box<Account<'info, GroupRegistryV2>>,
    #[account(mut, seeds = [b"exit-v2", group.key().as_ref()], bump = guard.bump, has_one = group)]
    pub guard: Box<Account<'info, GroupExitGuardV2>>,
    #[account(seeds = [b"vault-v2", group.key().as_ref()], bump = group.vault_bump,
        constraint = vault.mint == group.quote_mint && vault.owner == group.key() @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ChangeGroupClaim<'info> {
    #[account(mut, seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump, has_one = vault)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[0]], bump = btc.bump, has_one = group)]
    pub btc: Box<Account<'info, GroupMarketV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[1]], bump = eth.bump, has_one = group)]
    pub eth: Box<Account<'info, GroupMarketV2>>,
    #[account(mut, seeds = [b"margin-v2", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()], bump = margin.bump, has_one = group)]
    pub margin: Box<Account<'info, MarginAccountV2>>,
    #[account(seeds = [b"exit-v2", group.key().as_ref()], bump = guard.bump, has_one = group)]
    pub guard: Box<Account<'info, GroupExitGuardV2>>,
    #[account(seeds = [b"vault-v2", group.key().as_ref()], bump = group.vault_bump,
        constraint = vault.mint == group.quote_mint && vault.owner == group.key() @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

#[derive(Accounts)]
pub struct GroupCashIdentity<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump, has_one = quote_mint, has_one = vault)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"margin-v2", margin.portfolio.as_ref(), &margin.subaccount_index.to_le_bytes()], bump = margin.bump, has_one = group, has_one = owner)]
    pub margin: Box<Account<'info, MarginAccountV2>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [b"vault-v2", group.key().as_ref()], bump = group.vault_bump,
        token::mint = quote_mint, token::authority = group)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = user_token.key() != vault.key() @ ClearingError::Alias,
        token::mint = quote_mint, token::authority = owner)]
    pub user_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct GroupTradingCash<'info> {
    pub cash: GroupCashIdentity<'info>,
    #[account(mut, seeds = [b"market-v2", cash.group.key().as_ref(), &[0]], bump = btc.bump, constraint = btc.group == cash.group.key() @ ClearingError::Profile)]
    pub btc: Box<Account<'info, GroupMarketV2>>,
    #[account(mut, seeds = [b"market-v2", cash.group.key().as_ref(), &[1]], bump = eth.bump, constraint = eth.group == cash.group.key() @ ClearingError::Profile)]
    pub eth: Box<Account<'info, GroupMarketV2>>,
    #[account(seeds = [b"exit-v2", cash.group.key().as_ref()], bump = guard.bump, constraint = guard.group == cash.group.key() @ ClearingError::Profile)]
    pub guard: Box<Account<'info, GroupExitGuardV2>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct TransferTradingCash<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", group.domain.as_ref()], bump = group.bump, has_one = vault)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[0]], bump = btc.bump, has_one = group)]
    pub btc: Box<Account<'info, GroupMarketV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[1]], bump = eth.bump, has_one = group)]
    pub eth: Box<Account<'info, GroupMarketV2>>,
    #[account(mut, seeds = [b"margin-v2", donor.portfolio.as_ref(), &donor.subaccount_index.to_le_bytes()], bump = donor.bump, has_one = group, has_one = owner)]
    pub donor: Box<Account<'info, MarginAccountV2>>,
    #[account(mut, seeds = [b"margin-v2", recipient.portfolio.as_ref(), &recipient.subaccount_index.to_le_bytes()], bump = recipient.bump,
        has_one = group, has_one = owner, constraint = recipient.key() != donor.key() @ ClearingError::Alias)]
    pub recipient: Box<Account<'info, MarginAccountV2>>,
    #[account(seeds = [b"exit-v2", group.key().as_ref()], bump = guard.bump, has_one = group)]
    pub guard: Box<Account<'info, GroupExitGuardV2>>,
    #[account(seeds = [b"vault-v2", group.key().as_ref()], bump = group.vault_bump,
        constraint = vault.mint == group.quote_mint && vault.owner == group.key() @ ClearingError::Mint)]
    pub vault: Box<Account<'info, TokenAccount>>,
}

pub fn initialize(ctx: Context<InitializeGroupSafety>) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty() && ctx.accounts.group.mode == 0,
        ClearingError::Profile
    );
    group_trading::profile(&ctx.accounts.group)?;
    ctx.accounts.guard.set_inner(GroupExitGuardV2 {
        schema_version: SCHEMA_VERSION,
        group: ctx.accounts.group.key(),
        bump: ctx.bumps.guard,
        ..Default::default()
    });
    ctx.accounts.resolution.set_inner(GroupResolutionV2 {
        schema_version: SCHEMA_VERSION,
        group: ctx.accounts.group.key(),
        bump: ctx.bumps.resolution,
        ..Default::default()
    });
    Ok(())
}

pub fn activate(ctx: Context<ActivateIsolatedGroup>) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty() && ISOLATED_TRADING_IMPLEMENTED,
        ClearingError::Profile
    );
    let accounts = &mut *ctx.accounts;
    group_trading::profile(&accounts.group)?;
    markets(
        &accounts.group,
        accounts.group.key(),
        [&accounts.btc, &accounts.eth],
    )?;
    group_custody::reconciled(&accounts.group, accounts.vault.amount)?;
    require!(
        accounts.group.mode == 0
            && accounts.group.settlement == 0
            && accounts.group.fees == 0
            && accounts.guard.schema_version == SCHEMA_VERSION
            && accounts.resolution.schema_version == SCHEMA_VERSION
            && accounts.resolution.header.stage == crate::constants::resolution::IDLE
            && accounts.btc.gross_lots == 0
            && accounts.eth.gross_lots == 0
            && accounts.btc.funding_index_scaled == 0
            && accounts.eth.funding_index_scaled == 0,
        ClearingError::Profile
    );
    let clock = Clock::get()?;
    oracle::action(&accounts.btc, &clock, true)?;
    oracle::action(&accounts.eth, &clock, true)?;
    // Custody observations qualify availability, never a pre-activation charge.
    for market in [&mut accounts.btc, &mut accounts.eth] {
        reset_oracle(market, clock.unix_timestamp, 0)?;
    }
    accounts.group.mode = 1;
    accounts.group.sequence = next(accounts.group.sequence)?;
    let emitted = event(
        &accounts.group,
        [&accounts.btc, &accounts.eth],
        0,
        0,
        vec![],
        accounts.vault.amount,
        &clock,
    );
    crate::event_cpi::emit(&emitted, ctx.accounts.event_authority.to_account_info())?;
    Ok(())
}

pub(crate) fn reset_oracle(market: &mut GroupMarketV2, now: i64, skipped: u64) -> Result<()> {
    let previous = market.oracle;
    market.oracle = crate::state::OracleState {
        sources: previous.sources,
        source_sequences: previous.source_sequences,
        funding_base: market.funding_index_scaled,
        covered_seconds: previous.covered_seconds,
        skipped_seconds: previous
            .skipped_seconds
            .checked_add(skipped)
            .ok_or(ClearingError::Arithmetic)?,
        ..Default::default()
    };
    market.valid_until = 0;
    market.funding_time = now;
    Ok(())
}

pub(crate) fn live(
    group: &ClearingGroupV2,
    markets: [&GroupMarketV2; 2],
    sequence: u64,
    observations: [u64; 2],
) -> Result<()> {
    group_trading::activated(group)?;
    require!(
        group.sequence == sequence
            && markets.map(|market| market.observation_sequence) == observations,
        ClearingError::FinancialSequence
    );
    Ok(())
}

fn funding_bounds(mode: u8, market: &GroupMarketV2, clock: &Clock) -> Result<[i128; 2]> {
    let current = oracle::effective(mode, market, clock)?;
    let mut end = current;
    let observation = &market.oracle;
    if mode == 1
        && observation.held_epoch == market.config_epoch
        && observation.held_until > observation.sampled_at
        && clock.slot < observation.held_slot
        && clock.unix_timestamp >= observation.sampled_at
        && clock.unix_timestamp - observation.sampled_at <= math::oracle::MAX_CATCHUP
    {
        end = checked(math::oracle::endpoint(
            observation.funding_base,
            observation.premium_scaled,
            observation.sampled_at,
            observation.held_until,
            observation.held_until,
        ))?;
    }
    Ok([current.min(end), current.max(end)])
}

pub(crate) fn certified(
    guard: &GroupExitGuardV2,
    group: &ClearingGroupV2,
    markets: [&GroupMarketV2; 2],
    clock: &Clock,
) -> Result<()> {
    require!(
        guard.schema_version == SCHEMA_VERSION
            && guard.sequence == group.sequence
            && guard.observations == markets.map(|market| market.observation_sequence)
            && guard.count > 0
            && guard.count <= MAX_MEMBERS as u16
            && guard.next == guard.count,
        ClearingError::ExitCohort
    );
    for (index, market) in markets.into_iter().enumerate() {
        if guard.gross_lots != [0; 2] {
            oracle::action(market, clock, false)?;
            require!(
                clock.unix_timestamp < guard.source_deadlines[index],
                ClearingError::ExitCohort
            );
        }
        let funding = oracle::effective(group.mode, market, clock)?;
        require!(
            guard.funding_bounds[index][0] <= funding && funding <= guard.funding_bounds[index][1],
            ClearingError::ExitCohort
        );
    }
    Ok(())
}

pub fn check(
    ctx: Context<CheckGroupExit>,
    sequence: u64,
    observations: [u64; 2],
    start: u16,
) -> Result<()> {
    let accounts = &mut *ctx.accounts;
    let market_refs = [&**accounts.btc, &**accounts.eth];
    live(&accounts.group, market_refs, sequence, observations)?;
    markets(
        &accounts.group,
        accounts.group.key(),
        [&accounts.btc, &accounts.eth],
    )?;
    registry_hash(&accounts.registry)?;
    group_custody::reconciled(&accounts.group, accounts.vault.amount)?;
    let clock = Clock::get()?;
    let credible = market_refs
        .iter()
        .all(|market| oracle::action(market, &clock, false).is_ok());
    let bounds = [
        funding_bounds(accounts.group.mode, market_refs[0], &clock)?,
        funding_bounds(accounts.group.mode, market_refs[1], &clock)?,
    ];
    let guard = &mut accounts.guard;
    if start == 0 {
        require!(
            guard.sequence != sequence
                || guard.observations != observations
                || guard.count != accounts.registry.count
                || guard.next == 0,
            ClearingError::ExitCohort
        );
        guard.sequence = sequence;
        guard.observations = observations;
        guard.count = accounts.registry.count;
        guard.next = 0;
        guard.funding_bounds = bounds;
        guard.source_deadlines = market_refs.map(|market| market.oracle.source_deadline);
        guard.cash = 0;
        guard.lots = [0; 2];
        guard.gross_lots = [0; 2];
        guard.unpaid_scaled = 0;
    }
    require!(
        guard.sequence == sequence
            && guard.observations == observations
            && guard.count == accounts.registry.count
            && guard.next == start,
        ClearingError::ExitCohort
    );
    let page_len = ctx.remaining_accounts.len();
    require!(
        (1..=8).contains(&page_len) && usize::from(start) + page_len <= usize::from(guard.count),
        ClearingError::ExitCohort
    );
    for (offset, info) in ctx.remaining_accounts.iter().enumerate() {
        let root = member(
            info,
            accounts.group.key(),
            &accounts.registry,
            usize::from(start) + offset,
            false,
        )?;
        let model = account_model(&root)?;
        require!(
            credible || root.positions.iter().all(|position| position.lots == 0),
            ClearingError::ExitCohort
        );
        let mut risk = risks(accounts.group.mode, market_refs, &clock)?;
        for first in guard.funding_bounds[0] {
            for second in guard.funding_bounds[1] {
                risk[0].funding = first;
                risk[1].funding = second;
                require!(
                    checked(model.risk_equity(risk))? >= 0,
                    ClearingError::ExitCohort
                );
            }
        }
        guard.cash = checked(math::cash_add(guard.cash, root.cash))?;
        for index in 0..2 {
            guard.lots[index] = guard.lots[index]
                .checked_add(i128::from(root.positions[index].lots))
                .ok_or(ClearingError::Arithmetic)?;
            guard.gross_lots[index] = guard.gross_lots[index]
                .checked_add(root.positions[index].lots.unsigned_abs())
                .ok_or(ClearingError::Arithmetic)?;
        }
        for claim in checked(model.claims(
            market_refs.map(|market| market.reference_price.max(1)),
            [0; 2],
        ))? {
            guard.unpaid_scaled = guard
                .unpaid_scaled
                .checked_add(claim)
                .ok_or(ClearingError::Arithmetic)?;
        }
    }
    guard.next += page_len as u16;
    if guard.next == guard.count {
        require!(
            guard.cash == accounts.group.total_cash
                && guard.lots == [0; 2]
                && guard.gross_lots == market_refs.map(|market| market.gross_lots)
                && guard.unpaid_scaled == checked(math::scaled(accounts.group.settlement))?,
            ClearingError::Reconciliation
        );
        certified(guard, &accounts.group, market_refs, &clock)?;
    }
    Ok(())
}

#[inline(never)]
pub(crate) fn event(
    group: &Account<ClearingGroupV2>,
    markets: [&GroupMarketV2; 2],
    kind: u8,
    amount: u64,
    roots: Vec<crate::events::MarginAccountSnapshotV2>,
    actual: u64,
    clock: &Clock,
) -> crate::events::GroupSafetyChangedV2 {
    crate::events::GroupSafetyChangedV2 {
        group: group.key(),
        sequence: group.sequence,
        slot: clock.slot,
        mode: group.mode,
        paused: group.paused,
        terms_epoch: group.terms_epoch,
        config_epoch: group.config_epoch,
        kind,
        amount,
        roots,
        markets: markets.map(crate::events::GroupMarketSnapshotV2::from),
        total_cash: group.total_cash,
        settlement: group.settlement,
        insurance: group.insurance,
        fees: group.fees,
        allocated_vault: group.allocated_vault,
        actual_vault: actual,
    }
}

pub fn change(
    ctx: Context<ChangeGroupClaim>,
    sequence: u64,
    observations: [u64; 2],
    market_index: u8,
    amount: u64,
    gain: bool,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty() && market_index < 2,
        ClearingError::Profile
    );
    let accounts = &mut *ctx.accounts;
    markets(
        &accounts.group,
        accounts.group.key(),
        [&accounts.btc, &accounts.eth],
    )?;
    let market_refs = [&**accounts.btc, &**accounts.eth];
    live(&accounts.group, market_refs, sequence, observations)?;
    let clock = Clock::get()?;
    group_custody::reconciled(&accounts.group, accounts.vault.amount)?;
    if gain {
        certified(&accounts.guard, &accounts.group, market_refs, &clock)?;
    }
    require!(
        accounts.margin.mode == MODE_ISOLATED
            && accounts.margin.isolated_market_index == market_index,
        ClearingError::Profile
    );
    require!(
        accounts.margin.positions[usize::from(market_index)].lots == 0
            || oracle::action(market_refs[usize::from(market_index)], &clock, false).is_ok(),
        ClearingError::OraclePolicy
    );
    refresh(&mut accounts.margin, market_refs, &clock)?;
    let risk = risks(accounts.group.mode, market_refs, &clock)?;
    let (candidate, pools) = checked(account_model(&accounts.margin)?.settle_claim(
        math::Pools {
            vault: accounts.group.allocated_vault,
            settlement: accounts.group.settlement,
            insurance: accounts.group.insurance,
            fees: accounts.group.fees,
        },
        usize::from(market_index),
        amount,
        market_refs.map(|market| market.reference_price.max(1)),
        risk,
        gain,
    ))?;
    commit(&mut accounts.margin, candidate)?;
    accounts.group.total_cash = checked(if gain {
        math::cash_add(accounts.group.total_cash, amount)
    } else {
        math::cash_sub(accounts.group.total_cash, amount)
    })?;
    accounts.group.settlement = pools.settlement;
    finish(
        &mut accounts.group,
        &mut accounts.btc,
        &mut accounts.eth,
        accounts.vault.amount,
        &clock,
    )?;
    let emitted = event(
        &accounts.group,
        [&accounts.btc, &accounts.eth],
        if gain { 2 } else { 1 },
        amount,
        vec![crate::events::MarginAccountSnapshotV2::from(
            &**accounts.margin,
        )],
        accounts.vault.amount,
        &clock,
    );
    crate::event_cpi::emit(&emitted, ctx.accounts.event_authority.to_account_info())?;
    Ok(())
}

fn finish(
    group: &mut ClearingGroupV2,
    btc: &mut GroupMarketV2,
    eth: &mut GroupMarketV2,
    actual: u64,
    clock: &Clock,
) -> Result<()> {
    oracle::materialize(group.mode, btc, clock)?;
    oracle::materialize(group.mode, eth, clock)?;
    group.sequence = next(group.sequence)?;
    group_custody::reconciled(group, actual)
}

pub fn cash(
    ctx: Context<GroupTradingCash>,
    sequence: u64,
    observations: [u64; 2],
    amount: u64,
    withdraw: bool,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty() && amount > 0,
        ClearingError::Profile
    );
    let accounts = &mut *ctx.accounts;
    markets(
        &accounts.cash.group,
        accounts.cash.group.key(),
        [&accounts.btc, &accounts.eth],
    )?;
    let market_refs = [&**accounts.btc, &**accounts.eth];
    live(&accounts.cash.group, market_refs, sequence, observations)?;
    group_custody::reconciled(&accounts.cash.group, accounts.cash.vault.amount)?;
    let clock = Clock::get()?;
    let candidate = if withdraw {
        certified(&accounts.guard, &accounts.cash.group, market_refs, &clock)?;
        refresh(&mut accounts.cash.margin, market_refs, &clock)?;
        checked(account_model(&accounts.cash.margin)?.withdraw(
            amount,
            risks(accounts.cash.group.mode, market_refs, &clock)?,
        ))?
    } else {
        let mut candidate = account_model(&accounts.cash.margin)?;
        candidate.cash = checked(math::cash_add(candidate.cash, amount))?;
        candidate
    };
    let bump = [accounts.cash.group.bump];
    let seeds: &[&[u8]] = &[b"group-v2", accounts.cash.group.domain.as_ref(), &bump];
    let transfer = TransferChecked {
        from: if withdraw {
            accounts.cash.vault.to_account_info()
        } else {
            accounts.cash.user_token.to_account_info()
        },
        mint: accounts.cash.quote_mint.to_account_info(),
        to: if withdraw {
            accounts.cash.user_token.to_account_info()
        } else {
            accounts.cash.vault.to_account_info()
        },
        authority: if withdraw {
            accounts.cash.group.to_account_info()
        } else {
            accounts.cash.owner.to_account_info()
        },
    };
    let signer_seeds = [seeds];
    token::transfer_checked(
        CpiContext::new_with_signer(
            accounts.cash.token_program.key(),
            transfer,
            if withdraw { &signer_seeds } else { &[] },
        ),
        amount,
        6,
    )?;
    commit(&mut accounts.cash.margin, candidate)?;
    let change = if withdraw {
        math::cash_sub
    } else {
        math::cash_add
    };
    accounts.cash.group.total_cash = checked(change(accounts.cash.group.total_cash, amount))?;
    accounts.cash.group.allocated_vault =
        checked(change(accounts.cash.group.allocated_vault, amount))?;
    accounts.cash.vault.reload()?;
    finish(
        &mut accounts.cash.group,
        &mut accounts.btc,
        &mut accounts.eth,
        accounts.cash.vault.amount,
        &clock,
    )?;
    let emitted = event(
        &accounts.cash.group,
        [&accounts.btc, &accounts.eth],
        if withdraw { 4 } else { 3 },
        amount,
        vec![crate::events::MarginAccountSnapshotV2::from(
            &**accounts.cash.margin,
        )],
        accounts.cash.vault.amount,
        &clock,
    );
    crate::event_cpi::emit(&emitted, ctx.accounts.event_authority.to_account_info())?;
    Ok(())
}

pub fn transfer(
    ctx: Context<TransferTradingCash>,
    sequence: u64,
    observations: [u64; 2],
    amount: u64,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    let accounts = &mut *ctx.accounts;
    markets(
        &accounts.group,
        accounts.group.key(),
        [&accounts.btc, &accounts.eth],
    )?;
    let market_refs = [&**accounts.btc, &**accounts.eth];
    live(&accounts.group, market_refs, sequence, observations)?;
    let clock = Clock::get()?;
    group_custody::reconciled(&accounts.group, accounts.vault.amount)?;
    certified(&accounts.guard, &accounts.group, market_refs, &clock)?;
    refresh(&mut accounts.donor, market_refs, &clock)?;
    refresh(&mut accounts.recipient, market_refs, &clock)?;
    let (donor, recipient) = checked(math::margin::transfer_candidate(
        account_model(&accounts.donor)?,
        account_model(&accounts.recipient)?,
        amount,
        risks(accounts.group.mode, market_refs, &clock)?,
    ))?;
    commit(&mut accounts.donor, donor)?;
    commit(&mut accounts.recipient, recipient)?;
    finish(
        &mut accounts.group,
        &mut accounts.btc,
        &mut accounts.eth,
        accounts.vault.amount,
        &clock,
    )?;
    let emitted = event(
        &accounts.group,
        [&accounts.btc, &accounts.eth],
        5,
        amount,
        vec![
            crate::events::MarginAccountSnapshotV2::from(&**accounts.donor),
            crate::events::MarginAccountSnapshotV2::from(&**accounts.recipient),
        ],
        accounts.vault.amount,
        &clock,
    );
    crate::event_cpi::emit(&emitted, ctx.accounts.event_authority.to_account_info())?;
    Ok(())
}
