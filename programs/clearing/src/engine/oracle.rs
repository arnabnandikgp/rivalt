//! Causal funding, source bounds and held-window transitions.
use super::*;
use crate::state::OracleState;
use financial_core::oracle as policy;

pub(crate) fn feed_indexes(market: u8) -> Result<[usize; 4]> {
    match market {
        0 => Ok([0, 1, 2, 3]),
        1 => Ok([4, 1, 5, 3]),
        _ => err!(ClearingError::OracleSource),
    }
}

pub(crate) fn effective(mode: u8, market: &GroupMarketV2, clock: &Clock) -> Result<i128> {
    let observation = &market.oracle;
    if !matches!(mode, 1 | 2)
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
    if matches!(mode, 1 | 2)
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
    let covered = if !matches!(mode, 1 | 2) {
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

pub(crate) fn funding_bounds(mode: u8, market: &GroupMarketV2, clock: &Clock) -> Result<[i128; 2]> {
    let current = effective(mode, market, clock)?;
    let mut end = current;
    let observation = &market.oracle;
    if matches!(mode, 1 | 2)
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
fn source(
    market: &mut GroupMarketV2,
    infos: [&AccountInfo; 4],
    now: i64,
) -> Result<Option<policy::Bounds>> {
    let mut values = [None; 4];
    for (position, feed) in feed_indexes(market.index)?.into_iter().enumerate() {
        crate::instructions::oracle::binding(
            infos[position],
            market.oracle.sources[position],
            feed,
        )?;
        if let Ok((value, sequence)) = crate::instructions::oracle::source(
            infos[position],
            market.oracle.sources[position],
            feed,
            market.oracle.source_sequences[position],
        ) {
            values[position] = Some(value);
            market.oracle.source_sequences[position] = sequence;
        }
    }
    Ok(values[0].zip(values[1]).and_then(|(asset, collateral)| {
        policy::market_bounds(
            market.lots_per_unit,
            [asset, collateral],
            values[2]
                .zip(values[3])
                .map(|(asset, collateral)| [asset, collateral]),
            now,
        )
        .ok()
    }))
}

pub(crate) fn sources(
    btc: &mut GroupMarketV2,
    eth: &mut GroupMarketV2,
    infos: [&AccountInfo; 6],
    now: i64,
) -> Result<[Option<policy::Bounds>; 2]> {
    Ok([
        source(btc, [infos[0], infos[1], infos[2], infos[3]], now)?,
        source(eth, [infos[4], infos[1], infos[5], infos[3]], now)?,
    ])
}

pub(crate) fn freeze_coverage(market: &mut GroupMarketV2, now: i64) -> Result<()> {
    let observation = &mut market.oracle;
    if observation.sampled_at == 0 {
        return Ok(());
    }
    let elapsed = u64::try_from(
        now.checked_sub(observation.sampled_at)
            .ok_or(ClearingError::Arithmetic)?,
    )
    .map_err(|_| error!(ClearingError::Resolution))?;
    let covered = if observation.held_until > observation.sampled_at {
        (market.funding_time.min(observation.held_until) - observation.sampled_at).max(0) as u64
    } else {
        0
    };
    require!(covered <= elapsed, ClearingError::Resolution);
    observation.covered_seconds = observation
        .covered_seconds
        .checked_add(covered)
        .ok_or(ClearingError::Arithmetic)?;
    observation.skipped_seconds = observation
        .skipped_seconds
        .checked_add(elapsed - covered)
        .ok_or(ClearingError::Arithmetic)?;
    Ok(())
}
