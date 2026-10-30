//! Causal profile-4 observations. Retain already-earned funding even when the
//! next sample fails; structural controls close and account for the old interval.
use super::{impact::Impact, *};
use crate::instructions::account_trading;
use crate::engine::oracle;
use financial_core::oracle as policy;

/// Seconds actually materialized in this observation, not merely seconds for
/// which the next observation happens to qualify. Existing slot/catchup gates
/// still decide whether an unmaterialized old interval can accrue.
fn coverage(mode: u8, materialized: &crate::state::v2::GroupMarketV2, now: i64) -> u64 {
    let old = materialized.oracle;
    if mode != ACTIVE || old.sampled_at == 0 || old.held_until <= old.sampled_at {
        return 0;
    }
    (materialized.funding_time.min(now).min(old.held_until) - old.sampled_at).max(0) as u64
}

pub(crate) fn sample_candidate(
    mode: u8,
    market: &Market,
    clock: &Clock,
    bounds: Option<policy::Bounds>,
    sequences: [u64; 4],
    impact: Option<&Impact>,
) -> Result<Market> {
    let mut materialized = account_trading::market_view(market)?;
    let old = materialized.oracle;
    require!(
        matches!(mode, CUSTODY | ACTIVE)
            && clock.unix_timestamp > 0
            && clock.unix_timestamp >= old.sampled_at,
        ClearingError::OraclePolicy
    );
    if let Some(impact) = impact {
        require!(
            impact.expiry_time > clock.unix_timestamp && impact.expiry_slot > clock.slot,
            ClearingError::MakerQuote
        );
    }
    let engine_mode = if mode == ACTIVE { 2 } else { 0 };
    oracle::materialize(engine_mode, &mut materialized, clock)?;
    let covered = coverage(mode, &materialized, clock.unix_timestamp);
    let mut candidate = oracle::sample_candidate(
        engine_mode,
        &materialized,
        clock,
        bounds,
        sequences,
        impact.map(|value| (value.quantity, value.bid, value.ask, value.expiry_slot)),
    )?;
    let elapsed = if old.sampled_at > 0 {
        (clock.unix_timestamp - old.sampled_at) as u64
    } else {
        0
    };
    candidate.oracle.covered_seconds = old
        .covered_seconds
        .checked_add(covered)
        .ok_or(ClearingError::Arithmetic)?;
    candidate.oracle.skipped_seconds = old
        .skipped_seconds
        .checked_add(elapsed.saturating_sub(covered))
        .ok_or(ClearingError::Arithmetic)?;
    if candidate.oracle.quantity > 0 {
        let impact = impact.ok_or(ClearingError::MakerQuote)?;
        candidate.oracle.held_until = candidate.oracle.held_until.min(impact.expiry_time);
        // A still-fresh new publication does not retroactively cover a gap in
        // the preceding publication. Six seconds of continuous recovery remain.
        if clock.unix_timestamp > old.held_until || clock.slot >= old.held_slot {
            candidate.oracle.valid_since = clock.unix_timestamp;
            candidate.oracle.status = 1;
        }
    }
    let mut next = market.clone();
    account_trading::commit_market(&mut next, &candidate)?;
    Ok(next)
}

/// Called before the control mutation and before a safety mode transition. A
/// control is an unqualified observation at its actual Clock, not a source
/// update. Source identities/sequences/deadline and risk bounds stay unchanged.
pub(crate) fn control_candidate(mode: u8, market: &Market, clock: &Clock) -> Result<Market> {
    let mut candidate = account_trading::market_view(market)?;
    let old = candidate.oracle;
    require!(
        matches!(mode, CUSTODY | ACTIVE)
            && clock.unix_timestamp > 0
            && clock.unix_timestamp >= old.sampled_at,
        ClearingError::OraclePolicy
    );
    oracle::materialize(if mode == ACTIVE { 2 } else { 0 }, &mut candidate, clock)?;
    if old.sampled_at > 0 {
        let elapsed = (clock.unix_timestamp - old.sampled_at) as u64;
        let covered = coverage(mode, &candidate, clock.unix_timestamp);
        candidate.oracle.covered_seconds = old
            .covered_seconds
            .checked_add(covered)
            .ok_or(ClearingError::Arithmetic)?;
        candidate.oracle.skipped_seconds = old
            .skipped_seconds
            .checked_add(elapsed.saturating_sub(covered))
            .ok_or(ClearingError::Arithmetic)?;
        candidate.oracle.sampled_at = clock.unix_timestamp;
    }
    candidate.oracle.funding_base = candidate.funding_index_scaled;
    candidate.oracle.held_until = candidate.oracle.sampled_at;
    candidate.oracle.held_slot = 0;
    candidate.oracle.valid_since = 0;
    candidate.oracle.status = u8::from(old.status > 0);
    candidate.oracle.outcome = 2;
    candidate.oracle.premium_scaled = 0;
    candidate.oracle.quantity = 0;
    candidate.oracle.bid = 0;
    candidate.oracle.ask = 0;
    let mut next = market.clone();
    account_trading::commit_market(&mut next, &candidate)?;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::OracleState;
    use financial_core::SCALE;

    fn market() -> Market {
        Market {
            schema_version: 3,
            venue: Pubkey::new_unique(),
            cross_eligible: true,
            lots_per_unit: 1_000_000,
            terms_epoch: 1,
            config_epoch: 1,
            reference_price: 60_000,
            lower: 59_400,
            upper: 60_600,
            valid_from: 1000,
            valid_until: 4600,
            funding_time: 100,
            oracle: OracleState {
                sources: [Pubkey::new_unique(); 4],
                source_sequences: [10; 4],
                sampled_at: 100,
                source_deadline: 130,
                status: 2,
                valid_since: 90,
                last_qualified: 100,
                held_until: 106,
                held_slot: 2000,
                held_epoch: 1,
                premium_scaled: 36 * SCALE,
                quantity: 100,
                bid: 6_000_000,
                ask: 6_007_200,
                ..OracleState::default()
            },
            ..Market::default()
        }
    }

    fn clock(now: i64) -> Clock {
        Clock {
            unix_timestamp: now,
            slot: now as u64 * 10,
            ..Clock::default()
        }
    }

    fn bounds() -> policy::Bounds {
        policy::Bounds {
            reference: 60_000,
            lower: 59_400,
            upper: 60_600,
            normal: true,
            deadline: 130,
        }
    }

    fn impact(expiry_time: i64) -> Impact {
        Impact {
            quantity: 100,
            bid: 6_000_000,
            ask: 6_006_000,
            expiry_slot: 2000,
            expiry_time,
            bid_legs: vec![],
            ask_legs: vec![],
        }
    }

    #[test]
    fn failed_new_sample_keeps_old_earned_funding_and_exact_coverage() {
        for next_bounds in [None, Some(bounds())] {
            let next =
                sample_candidate(1, &market(), &clock(103), next_bounds, [11; 4], None).unwrap();
            // 36 scaled atoms/hour * 3 seconds / 3600 = 0.03 atom.
            assert_eq!(next.funding_index_scaled, 30_000_000);
            assert_eq!(next.oracle.funding_base, 30_000_000);
            assert_eq!(
                (next.oracle.covered_seconds, next.oracle.skipped_seconds),
                (3, 0)
            );
            assert_eq!(next.oracle.valid_since, 0);
            assert_eq!(next.oracle.quantity, 0);
        }
    }

    #[test]
    fn control_materializes_once_truncates_and_preserves_authenticated_sources() {
        let original = market();
        let next = control_candidate(1, &original, &clock(103)).unwrap();
        assert_eq!(next.funding_index_scaled, 30_000_000);
        assert_eq!(next.oracle.funding_base, 30_000_000);
        assert_eq!((next.oracle.sampled_at, next.oracle.held_until), (103, 103));
        assert_eq!(
            (next.oracle.covered_seconds, next.oracle.skipped_seconds),
            (3, 0)
        );
        assert_eq!(
            (
                next.oracle.valid_since,
                next.oracle.status,
                next.oracle.outcome
            ),
            (0, 1, 2)
        );
        assert_eq!(next.oracle.sources, original.oracle.sources);
        assert_eq!(next.oracle.source_sequences, [10; 4]);
        assert_eq!(
            (next.oracle.source_deadline, next.oracle.last_qualified),
            (130, 100)
        );
        assert_eq!(
            (
                next.valid_from,
                next.valid_until,
                next.reference_price,
                next.lower,
                next.upper
            ),
            (1000, 4600, 60000, 59400, 60600)
        );
        let repeated = control_candidate(1, &next, &clock(105)).unwrap();
        assert_eq!(repeated.funding_index_scaled, 30_000_000);
        assert_eq!(
            (
                repeated.oracle.covered_seconds,
                repeated.oracle.skipped_seconds
            ),
            (3, 2)
        );
        let recovered = sample_candidate(
            1,
            &repeated,
            &clock(107),
            Some(bounds()),
            [11; 4],
            Some(&impact(113)),
        )
        .unwrap();
        assert_eq!(recovered.funding_index_scaled, 30_000_000);
        assert_eq!(
            (
                recovered.oracle.covered_seconds,
                recovered.oracle.skipped_seconds
            ),
            (3, 4)
        );
        assert_eq!(
            (recovered.oracle.valid_since, recovered.oracle.status),
            (107, 1)
        );
        assert!(sample_candidate(
            1,
            &repeated,
            &clock(106),
            Some(bounds()),
            [11; 4],
            Some(&impact(112))
        )
        .is_err());
    }

    #[test]
    fn publication_deadline_bounds_funding_and_restarts_recovery_after_a_gap() {
        let short = sample_candidate(
            1,
            &market(),
            &clock(103),
            Some(bounds()),
            [11; 4],
            Some(&impact(104)),
        )
        .unwrap();
        assert_eq!(short.oracle.held_until, 104);
        assert_eq!(short.oracle.premium_scaled, 30 * SCALE);
        assert_eq!(short.oracle.status, 2);
        let next = sample_candidate(
            1,
            &short,
            &clock(105),
            Some(bounds()),
            [12; 4],
            Some(&impact(111)),
        )
        .unwrap();
        // Only one further second was covered: 30e9 / 3600 truncates to 8,333,333.
        assert_eq!(next.funding_index_scaled, 38_333_333);
        assert_eq!(
            (next.oracle.covered_seconds, next.oracle.skipped_seconds),
            (4, 1)
        );
        assert_eq!((next.oracle.valid_since, next.oracle.status), (105, 1));
        let mut recovery = next;
        for now in [107, 109, 111] {
            recovery = sample_candidate(
                1,
                &recovery,
                &clock(now),
                Some(bounds()),
                [now as u64; 4],
                Some(&impact(now + 6)),
            )
            .unwrap();
            assert_eq!(recovery.oracle.status, if now == 111 { 2 } else { 1 });
        }
    }

    #[test]
    fn expired_slot_catchup_and_inactive_mode_do_not_create_funding() {
        let mut expired = market();
        expired.oracle.held_slot = 1030;
        // A trade already materialized one second, before slot expiry.
        expired.funding_index_scaled = 10_000_000;
        expired.funding_time = 101;
        let next = sample_candidate(
            1,
            &expired,
            &clock(103),
            Some(bounds()),
            [11; 4],
            Some(&impact(109)),
        )
        .unwrap();
        assert_eq!(next.funding_index_scaled, 10_000_000);
        assert_eq!(
            (next.oracle.covered_seconds, next.oracle.skipped_seconds),
            (1, 2)
        );
        assert_eq!((next.oracle.valid_since, next.oracle.status), (103, 1));
        let gap = control_candidate(1, &market(), &clock(131)).unwrap();
        assert_eq!(gap.funding_index_scaled, 0);
        assert_eq!(
            (gap.oracle.covered_seconds, gap.oracle.skipped_seconds),
            (0, 31)
        );
        let inactive = control_candidate(0, &market(), &clock(103)).unwrap();
        assert_eq!(inactive.funding_index_scaled, 0);
        assert_eq!(
            (
                inactive.oracle.covered_seconds,
                inactive.oracle.skipped_seconds
            ),
            (0, 3)
        );
        let mut fresh = market();
        fresh.oracle = OracleState::default();
        let fresh_control = control_candidate(0, &fresh, &clock(103)).unwrap();
        assert_eq!(
            (
                fresh_control.oracle.sampled_at,
                fresh_control.oracle.held_until
            ),
            (0, 0)
        );
        assert_eq!(
            (
                fresh_control.oracle.covered_seconds,
                fresh_control.oracle.skipped_seconds
            ),
            (0, 0)
        );
        assert!(sample_candidate(1, &market(), &clock(99), None, [10; 4], None).is_err());
        assert!(control_candidate(1, &market(), &clock(99)).is_err());
        assert!(control_candidate(FROZEN, &market(), &clock(103)).is_err());
        assert!(sample_candidate(FROZEN, &market(), &clock(103), None, [10; 4], None).is_err());
    }
}
