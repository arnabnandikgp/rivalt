//! Six authenticated local sources: BTC(1,3), collateral(2,4), ETH(5,6).
use super::*;
use crate::state::OracleState;
use financial_core::oracle as policy;

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeGroupOracle<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"group-v2", &group.domain], bump = group.bump, has_one = authority)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[market.index]], bump = market.bump, has_one = group)]
    pub market: Box<Account<'info, GroupMarketV2>>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SampleGroupOracle<'info> {
    #[account(mut, seeds = [b"group-v2", &group.domain], bump = group.bump)]
    pub group: Box<Account<'info, ClearingGroupV2>>,
    #[account(mut, seeds = [b"market-v2", group.key().as_ref(), &[market.index]], bump = market.bump, has_one = group)]
    pub market: Box<Account<'info, GroupMarketV2>>,
    /// CHECK: fixed source identity/owner/schema/sequence verified before sampling policy.
    pub primary_asset: UncheckedAccount<'info>,
    /// CHECK: fixed source identity/owner/schema/sequence verified before sampling policy.
    pub primary_collateral: UncheckedAccount<'info>,
    /// CHECK: fixed source identity/owner/schema/sequence verified before sampling policy.
    pub guard_asset: UncheckedAccount<'info>,
    /// CHECK: fixed source identity/owner/schema/sequence verified before sampling policy.
    pub guard_collateral: UncheckedAccount<'info>,
    pub first_capital: Box<Account<'info, MarginAccountV2>>,
    pub first_registration: Box<Account<'info, MakerRegistrationV2>>,
    pub first_program: Program<'info>,
    pub first_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: complete registered module authentication and read-only CPI.
    pub first_config: UncheckedAccount<'info>,
    pub second_capital: Box<Account<'info, MarginAccountV2>>,
    pub second_registration: Box<Account<'info, MakerRegistrationV2>>,
    pub second_program: Program<'info>,
    pub second_program_data: Box<Account<'info, ProgramData>>,
    /// CHECK: complete registered module authentication and read-only CPI.
    pub second_config: UncheckedAccount<'info>,
}

pub(crate) fn feed_indexes(market: u8) -> Result<[usize; 4]> {
    match market {
        0 => Ok([0, 1, 2, 3]),
        1 => Ok([4, 1, 5, 3]),
        _ => err!(ClearingError::OracleSource),
    }
}

fn event(
    group: &mut Account<ClearingGroupV2>,
    market: &mut Account<GroupMarketV2>,
) -> Result<crate::events::GroupOracleChangedV2> {
    group.sequence = group
        .sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    market.observation_sequence = market
        .observation_sequence
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    Ok(crate::events::GroupOracleChangedV2 {
        group: group.key(),
        sequence: group.sequence,
        slot: Clock::get()?.slot,
        market: market.key(),
        state: crate::events::GroupMarketSnapshotV2::from(&**market),
    })
}

pub fn initialize(
    ctx: Context<InitializeGroupOracle>,
    primary: Pubkey,
    guard: Pubkey,
) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    profile(&ctx.accounts.group)?;
    let market = &mut ctx.accounts.market;
    require!(
        ctx.accounts.group.mode == 0
            && market.oracle.sources == [Pubkey::default(); 4]
            && primary != guard
            && primary != Pubkey::default()
            && guard != Pubkey::default(),
        ClearingError::OracleSource
    );
    for (position, feed) in feed_indexes(market.index)?.into_iter().enumerate() {
        let authority = if position < 2 { primary } else { guard };
        market.oracle.sources[position] = Pubkey::find_program_address(
            &[b"feed", authority.as_ref(), &[feed as u8 + 1; 32]],
            &oracle_fixture::ID,
        )
        .0;
    }
    market.config_epoch = market
        .config_epoch
        .checked_add(1)
        .ok_or(ClearingError::Arithmetic)?;
    emit_cpi!(event(&mut ctx.accounts.group, market)?);
    Ok(())
}

pub(crate) fn effective(mode: u8, market: &GroupMarketV2, clock: &Clock) -> Result<i128> {
    let observation = &market.oracle;
    if mode != 1
        || observation.held_epoch != market.config_epoch
        || observation.held_until <= observation.sampled_at
        || clock.slot >= observation.held_slot
        || clock.unix_timestamp < observation.sampled_at
        || clock.unix_timestamp - observation.sampled_at > policy::MAX_CATCHUP
    {
        return Ok(market.funding_index_scaled);
    }
    checked(policy::endpoint(
        observation.funding_base,
        observation.premium_scaled,
        observation.sampled_at,
        observation.held_until,
        clock.unix_timestamp,
    ))
}

pub(crate) fn materialize(mode: u8, market: &mut GroupMarketV2, clock: &Clock) -> Result<()> {
    market.funding_index_scaled = effective(mode, market, clock)?;
    let observation = &market.oracle;
    if mode == 1
        && observation.held_epoch == market.config_epoch
        && observation.held_until > observation.sampled_at
        && clock.slot < observation.held_slot
        && clock.unix_timestamp >= observation.sampled_at
        && clock.unix_timestamp - observation.sampled_at <= policy::MAX_CATCHUP
    {
        market.funding_time = clock.unix_timestamp.min(observation.held_until);
    }
    Ok(())
}

pub(crate) fn action(market: &GroupMarketV2, clock: &Clock, increase: bool) -> Result<()> {
    let observation = &market.oracle;
    require!(
        clock.slot >= market.valid_from
            && clock.slot < market.valid_until
            && observation.status > 0
            && clock.unix_timestamp >= observation.sampled_at
            && clock.unix_timestamp < observation.source_deadline,
        ClearingError::OraclePolicy
    );
    if increase {
        require!(
            observation.status == 2
                && observation.held_epoch == market.config_epoch
                && clock.unix_timestamp - observation.last_qualified < policy::FUNDING_OUTAGE,
            ClearingError::OraclePolicy
        );
    }
    Ok(())
}

/// Pure causal transition used by the authenticated handler and independent golden tests.
pub(crate) fn sample_candidate(
    mode: u8,
    market: &GroupMarketV2,
    clock: &Clock,
    bounds: Option<policy::Bounds>,
    sequences: [u64; 4],
    impact: Option<(u64, u64, u64, u64)>,
) -> Result<GroupMarketV2> {
    let old = market.oracle;
    let now = clock.unix_timestamp;
    require!(
        now > 0
            && (old.sampled_at == 0
                || now
                    .checked_sub(old.sampled_at)
                    .is_some_and(|age| age >= policy::SAMPLE_INTERVAL)),
        ClearingError::OraclePolicy
    );
    let gap = old.sampled_at > 0 && now - old.sampled_at > policy::MAX_CATCHUP;
    let changed = old.held_epoch != market.config_epoch;
    let qualified = bounds.is_some_and(|value| value.normal) && impact.is_some();
    let preserve = !gap && !changed && qualified;
    let funding = if preserve {
        effective(mode, market, clock)?
    } else {
        market.funding_index_scaled
    };
    let elapsed = if old.sampled_at > 0 {
        (now - old.sampled_at) as u64
    } else {
        0
    };
    let covered = if mode != 1 {
        0
    } else if preserve {
        (now.min(old.held_until) - old.sampled_at).max(0) as u64
    } else if old.held_until > old.sampled_at {
        (market.funding_time.min(old.held_until) - old.sampled_at).max(0) as u64
    } else {
        0
    };
    let mut next = market.clone();
    let mut observation = OracleState {
        sources: old.sources,
        source_sequences: sequences,
        sampled_at: now,
        source_deadline: old.source_deadline,
        funding_base: funding,
        held_epoch: market.config_epoch,
        covered_seconds: old
            .covered_seconds
            .checked_add(covered)
            .ok_or(ClearingError::Arithmetic)?,
        skipped_seconds: old
            .skipped_seconds
            .checked_add(elapsed.saturating_sub(covered))
            .ok_or(ClearingError::Arithmetic)?,
        outcome: if gap {
            3
        } else if changed && old.sampled_at > 0 {
            4
        } else if bounds.is_none() {
            1
        } else if !qualified {
            2
        } else {
            0
        },
        last_qualified: old.last_qualified,
        ..OracleState::default()
    };
    if let Some(bounds) = bounds {
        next.reference_price = bounds.reference;
        next.lower = bounds.lower;
        next.upper = bounds.upper;
        next.valid_from = clock.slot;
        next.valid_until = clock
            .slot
            .checked_add(3600)
            .ok_or(ClearingError::Arithmetic)?;
        observation.source_deadline = bounds.deadline;
        observation.status = 1;
        if let Some((quantity, bid, ask, expiry)) = impact.filter(|_| bounds.normal) {
            observation.quantity = quantity;
            observation.bid = bid;
            observation.ask = ask;
            observation.premium_scaled =
                checked(policy::premium(bounds.reference, quantity, bid, ask))?;
            observation.held_until = now
                .checked_add(policy::HOLD)
                .ok_or(ClearingError::Arithmetic)?
                .min(bounds.deadline);
            observation.held_slot = expiry;
            observation.last_qualified = now;
            observation.valid_since = if old.valid_since > 0
                && now - old.sampled_at <= policy::HOLD
                && old.held_epoch == market.config_epoch
            {
                old.valid_since
            } else {
                now
            };
            if now - observation.valid_since >= policy::RECOVERY {
                observation.status = 2;
            }
        }
    } else {
        next.valid_until = 0;
    }
    next.funding_index_scaled = funding;
    next.funding_time = now;
    next.oracle = observation;
    Ok(next)
}

fn impact(
    accounts: &SampleGroupOracle,
    bounds: policy::Bounds,
    funding: i128,
    clock: &Clock,
) -> Result<(u64, u64, u64, u64)> {
    let views = [
        makers::View {
            capital: &accounts.first_capital,
            registration: &accounts.first_registration,
            program: &accounts.first_program,
            data: &accounts.first_program_data,
            config: &accounts.first_config,
        },
        makers::View {
            capital: &accounts.second_capital,
            registration: &accounts.second_registration,
            program: &accounts.second_program,
            data: &accounts.second_program_data,
            config: &accounts.second_config,
        },
    ];
    require!(
        views[0].registration.maker_id == 0
            && views[1].registration.maker_id == 1
            && views[0].capital.key() != views[1].capital.key(),
        ClearingError::MakerBinding
    );
    let states = [
        views[0].authenticate(&accounts.group, &accounts.market)?,
        views[1].authenticate(&accounts.group, &accounts.market)?,
    ];
    let quantity = policy::REFERENCE_NOTIONAL.div_ceil(bounds.reference);
    let mut pricing_market = (**accounts.market).clone();
    pricing_market.lower = bounds.lower;
    pricing_market.upper = bounds.upper;
    let risks = risk(&pricing_market, funding)?;
    let market_index = usize::from(pricing_market.index);
    let mut totals = [0; 2];
    for side in 0..2u8 {
        let requests = views.each_ref().map(|view| {
            view.request(
                &accounts.group,
                &accounts.market,
                side,
                1,
                bounds.reference,
                clock.slot,
            )
        });
        let mut models = Vec::with_capacity(2);
        let mut capacities = [0; 2];
        let mut indexes = [0; 2];
        indexes[market_index] = funding;
        for maker_index in 0..2 {
            let mut root = (**views[maker_index].capital).clone();
            book::refresh(&mut root, &pricing_market, clock.slot, true)?;
            let model = checked(model(&root)?.accrued(indexes))?;
            let first = views[maker_index].quote(&states[maker_index], &requests[maker_index])?;
            let equity = checked(model.risk_equity(risks))?;
            let initial = checked(model.requirement(risks, math::IM_BPS))?;
            let free =
                (equity / math::SCALE - i128::from(initial) - i128::from(model.reserved)).max(0);
            let (price_low, price_high) = checked(policy::execution_band(bounds.reference))?;
            let loss = price_high
                .saturating_sub(bounds.lower)
                .max(bounds.upper.saturating_sub(price_low));
            let per_lot = bounds.upper.div_ceil(10) + loss;
            let capacity = quantity
                .min(
                    u64::try_from(free / i128::from(per_lot))
                        .map_err(|_| error!(ClearingError::Arithmetic))?,
                )
                .min(first.remaining + 1);
            require!(
                capacity > 0 && (price_low..=price_high).contains(&first.gross_quote),
                ClearingError::MakerCapital
            );
            let quote = |lots: u64| -> Result<u64> {
                if lots == 0 {
                    return Ok(0);
                }
                let mut request = requests[maker_index].clone();
                request.quote.lots = lots;
                Ok(maker_interface::group_quote(
                    accounts.group.key(),
                    &states[maker_index],
                    &request,
                )
                .map_err(|_| error!(ClearingError::MakerQuote))?
                .gross_quote)
            };
            let (mut low, mut high) = (1, capacity);
            while low < high {
                let middle = (low + high).div_ceil(2);
                let marginal = quote(middle)?
                    .checked_sub(quote(middle - 1)?)
                    .ok_or(ClearingError::Arithmetic)?;
                if (price_low..=price_high).contains(&marginal) {
                    low = middle;
                } else {
                    high = middle - 1;
                }
            }
            capacities[maker_index] = low;
            models.push(model);
        }
        let priced = |maker_index: usize, lots: u64| -> Result<u64> {
            if lots == 0 {
                return Ok(0);
            }
            let mut request = requests[maker_index].clone();
            request.quote.lots = lots;
            let response =
                maker_interface::group_quote(accounts.group.key(), &states[maker_index], &request)
                    .map_err(|_| error!(ClearingError::MakerQuote))?;
            let mut candidate = models[maker_index];
            let position = &mut candidate.positions[market_index];
            position.lots = position
                .lots
                .checked_add(if side == 0 {
                    -(lots as i64)
                } else {
                    lots as i64
                })
                .ok_or(ClearingError::Arithmetic)?;
            position.virtual_scaled = position
                .virtual_scaled
                .checked_add(if side == 0 {
                    i128::from(response.gross_quote) * math::SCALE
                } else {
                    -i128::from(response.gross_quote) * math::SCALE
                })
                .ok_or(ClearingError::Arithmetic)?;
            checked(candidate.admissible(risks))?;
            Ok(response.gross_quote)
        };
        let cost = |lots: u64| -> Result<u64> {
            checked(math::cash_add(
                priced(0, lots)?,
                priced(1, quantity - lots)?,
            ))
        };
        let (mut low, mut high) = (
            quantity.saturating_sub(capacities[1]),
            quantity.min(capacities[0]),
        );
        require!(low <= high, ClearingError::MakerQuote);
        while low < high {
            let middle = (low + high) / 2;
            let current = cost(middle)?;
            let next = cost(middle + 1)?;
            if if side == 0 {
                next < current
            } else {
                next > current
            } {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        let gross = cost(low)?;
        let mut invoked = 0;
        for (maker_index, lots) in [(0, low), (1, quantity - low)] {
            if lots == 0 {
                continue;
            }
            let mut request = requests[maker_index].clone();
            request.quote.lots = lots;
            invoked = checked(math::cash_add(
                invoked,
                views[maker_index]
                    .quote(&states[maker_index], &request)?
                    .gross_quote,
            ))?;
        }
        require!(invoked == gross, ClearingError::MakerResponse);
        totals[usize::from(side)] = gross;
    }
    Ok((
        quantity,
        totals[1],
        totals[0],
        views[0]
            .registration
            .expiry_slot
            .min(views[1].registration.expiry_slot),
    ))
}

pub fn sample(ctx: Context<SampleGroupOracle>) -> Result<()> {
    require!(ctx.remaining_accounts.is_empty(), ClearingError::Profile);
    profile(&ctx.accounts.group)?;
    let accounts = &mut *ctx.accounts;
    let clock = Clock::get()?;
    let old = accounts.market.oracle;
    // Reject substituted registered accounts, even if source/quote policy would be degraded.
    require!(
        accounts.first_registration.maker_id == 0
            && accounts.second_registration.maker_id == 1
            && accounts.first_registration.market == accounts.market.key()
            && accounts.second_registration.market == accounts.market.key()
            && accounts.first_registration.capital == accounts.first_capital.key()
            && accounts.second_registration.capital == accounts.second_capital.key()
            && accounts.first_registration.config == accounts.first_config.key()
            && accounts.second_registration.config == accounts.second_config.key()
            && accounts.first_registration.pricing_program == accounts.first_program.key()
            && accounts.second_registration.pricing_program == accounts.second_program.key()
            && accounts.first_registration.program_data == accounts.first_program_data.key()
            && accounts.second_registration.program_data == accounts.second_program_data.key(),
        ClearingError::MakerBinding
    );
    let sources = [
        &accounts.primary_asset,
        &accounts.primary_collateral,
        &accounts.guard_asset,
        &accounts.guard_collateral,
    ];
    let mut values = [None; 4];
    let mut sequences = old.source_sequences;
    for (position, feed) in feed_indexes(accounts.market.index)?.into_iter().enumerate() {
        crate::instructions::oracle::binding(sources[position], old.sources[position], feed)?;
        if let Ok((price, sequence)) = crate::instructions::oracle::source(
            sources[position],
            old.sources[position],
            feed,
            sequences[position],
        ) {
            values[position] = Some(price);
            sequences[position] = sequence;
        }
    }
    let bounds = values[0].zip(values[1]).and_then(|(asset, collateral)| {
        policy::market_bounds(
            accounts.market.lots_per_unit,
            [asset, collateral],
            values[2]
                .zip(values[3])
                .map(|(asset, collateral)| [asset, collateral]),
            clock.unix_timestamp,
        )
        .ok()
    });
    let funding = effective(accounts.group.mode, &accounts.market, &clock)?;
    let prices = bounds
        .filter(|bounds| bounds.normal)
        .and_then(|bounds| impact(accounts, bounds, funding, &clock).ok());
    let next = sample_candidate(
        accounts.group.mode,
        &accounts.market,
        &clock,
        bounds,
        sequences,
        prices,
    )?;
    accounts.market.set_inner(next);
    let emitted = event(&mut accounts.group, &mut accounts.market)?;
    emit_cpi!(emitted);
    Ok(())
}
