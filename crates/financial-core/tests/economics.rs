use financial_core::*;

fn p(id: u16, cash: u64) -> Participant {
    Participant {
        id,
        cash,
        ..Participant::default()
    }
}

#[test]
fn v01_cross_maker_close_does_not_create_funded_profit() {
    let (mut trader, mut a, mut b) = (
        p(0, 1_000_000_000),
        p(1, 1_000_000_000),
        p(2, 1_000_000_000),
    );
    let mut pools = Pools {
        vault: 3_000_000_000,
        ..Pools::default()
    };
    (trader, a) = fill(trader, a, 1_000_000, 100_000_000, 0).unwrap();
    (trader, pools, _) = charge_fee(trader, pools, 0, 100_000_000).unwrap();
    (b, trader) = fill(b, trader, 1_000_000, 110_000_000, 0).unwrap();
    (trader, pools, _) = charge_fee(trader, pools, 0, 110_000_000).unwrap();
    assert_eq!(
        (trader.cash, a.cash, b.cash, pools.fees),
        (999_958_000, 1_000_000_000, 1_000_000_000, 42_000)
    );
    assert_eq!((trader.lots, a.lots, b.lots), (0, -1_000_000, 1_000_000));
    assert_eq!(trader.virtual_scaled, 10_000_000 * SCALE);
    assert_eq!(a.unpaid(110, 0).unwrap(), -10_000_000 * SCALE);
    assert_eq!(b.unpaid(110, 0).unwrap(), 0);
    reconcile(&[trader, a, b], pools, 110, 0).unwrap();
    assert_eq!(
        settle(trader, pools, 1, 110, 0),
        Err(Error::InsufficientCash)
    );
    (a, pools) = collect(a, pools, 10_000_000, 110, 0).unwrap();
    (trader, pools) = settle(trader, pools, 10_000_000, 110, 0).unwrap();
    assert_eq!(
        (trader.cash, a.cash, pools.settlement),
        (1_009_958_000, 990_000_000, 0)
    );
    assert_eq!(
        (trader.virtual_scaled, a.virtual_scaled),
        (0, 110_000_000 * SCALE)
    );
    reconcile(&[trader, a, b], pools, 110, 0).unwrap();
}

#[test]
fn v02_fee_prefix_survives_partial_execution() {
    let mut prefix = 0;
    let mut deltas = vec![];
    for _ in 0..3 {
        let (next, delta) = fee_increment(prefix, 2_000).unwrap();
        prefix = next;
        deltas.push(delta);
    }
    assert_eq!(deltas, [1, 0, 1]);
    assert_eq!(fee_total(6_000).unwrap(), 2);
    assert_eq!(fee_total(0).unwrap(), 0);
    assert_eq!(fee_total(5_000).unwrap(), 1);
}

#[test]
fn v03_full_cohort_default_uses_insurance_then_unpaid_gains() {
    let cohort = [
        Participant {
            virtual_scaled: -100 * SCALE,
            ..p(0, 20)
        },
        Participant {
            virtual_scaled: 60 * SCALE,
            ..p(1, 100)
        },
        Participant {
            virtual_scaled: 40 * SCALE,
            ..p(2, 100)
        },
    ];
    let pools = Pools {
        vault: 250,
        insurance: 30,
        ..Pools::default()
    };
    let out = closeout(&cohort, pools, 1, 0).unwrap();
    assert_eq!(out.collected, [20, 0, 0]);
    assert_eq!(out.insured_scaled, [30 * SCALE, 0, 0]);
    assert_eq!(out.impaired_scaled, [0, 30 * SCALE, 20 * SCALE]);
    assert_eq!(out.paid, [0, 30, 20]);
    assert_eq!(
        out.participants.iter().map(|p| p.cash).collect::<Vec<_>>(),
        [0, 130, 120]
    );
    assert_eq!(
        out.pools,
        Pools {
            vault: 250,
            ..Pools::default()
        }
    );
    let reversed = closeout(&[cohort[2], cohort[0], cohort[1]], pools, 1, 0).unwrap();
    for p in &out.participants {
        assert_eq!(
            Some(p),
            reversed.participants.iter().find(|other| other.id == p.id)
        );
    }
}

#[test]
fn v04_funding_fractions_survive_close_and_reopen() {
    let long = Participant {
        lots: 3,
        ..p(0, 100)
    };
    let short = Participant {
        lots: -3,
        ..p(1, 100)
    };
    let accrued = long.accrued(SCALE / 10).unwrap();
    assert_eq!(accrued.virtual_scaled, -300_000_000);
    assert_eq!(
        short.accrued(SCALE / 10).unwrap().virtual_scaled,
        300_000_000
    );
    let stepped = long
        .accrued(SCALE / 100)
        .unwrap()
        .accrued(SCALE / 20)
        .unwrap()
        .accrued(SCALE / 10)
        .unwrap();
    assert_eq!(accrued, stepped);
    let (flat, other) = fill(short, accrued, 3, 30, SCALE / 10).unwrap();
    assert_eq!((flat.lots, other.lots), (0, 0));
    assert_eq!(other.virtual_scaled % SCALE, 700_000_000);
    let reopened = other.with_lots(2).unwrap();
    assert_eq!(reopened.virtual_scaled, other.virtual_scaled);
    assert_eq!(p(2, 0).accrued(SCALE / 10).unwrap().virtual_scaled, 0);
}

#[test]
fn v05_candidates_are_atomic_and_protection_is_generation_scoped() {
    let initial = [p(0, 1_000), p(1, 1_000), p(2, 1_000)];
    let route = |states: [Participant; 3]| -> Result<[Participant; 3]> {
        let mut next = states;
        (next[0], next[1]) = fill(next[0], next[1], 2, 100, 0)?;
        (next[0], next[2]) = fill(next[0], next[2], MAX_LOTS as u64, 100, 0)?;
        Ok(next)
    };
    assert_eq!(route(initial), Err(Error::Bounds));
    assert_eq!(initial, [p(0, 1_000), p(1, 1_000), p(2, 1_000)]);
    let position = p(0, 1_000).with_lots(10).unwrap();
    let group = Protection {
        generation: position.generation,
        side: 1,
        remaining: 10,
    };
    let group = group.consume(&position, 10, 4).unwrap();
    assert_eq!(group.remaining, 6);
    assert!(group
        .consume(&position.with_lots(6).unwrap(), 10, 7)
        .is_err());
    let reopened = position.with_lots(0).unwrap().with_lots(10).unwrap();
    assert_eq!(group.consume(&reopened, 10, 1), Err(Error::Generation));
    assert!(group
        .consume(&position.with_lots(20).unwrap(), 10, 7)
        .is_err());
}

#[test]
fn fractional_closeout_has_explicit_zero_sum_subatom_transfers() {
    let cohort = [
        Participant {
            virtual_scaled: -SCALE / 10,
            ..p(0, 0)
        },
        Participant {
            virtual_scaled: 6 * SCALE / 10,
            ..p(1, 0)
        },
        Participant {
            virtual_scaled: 5 * SCALE / 10,
            ..p(2, 0)
        },
    ];
    let pools = Pools {
        vault: 2,
        settlement: 1,
        insurance: 1,
        ..Pools::default()
    };
    let out = closeout(&cohort, pools, 1, 0).unwrap();
    assert_eq!(out.pools.insurance, 1); // no overdraw to cover a fractional debt
    assert_eq!(out.paid, [0, 1, 0]);
    assert_eq!(out.rounding_scaled.iter().sum::<i128>(), 0);
    assert!(out
        .rounding_scaled
        .iter()
        .all(|v| v.unsigned_abs() < SCALE as u128));
    assert_eq!(apportion(1, &[(3, 1), (1, 1)]).unwrap(), [0, 1]);
}

#[test]
fn risk_uses_adverse_index_bound_no_positive_profit_credit_and_reservations() {
    let mut long = Participant {
        lots: 10,
        virtual_scaled: -100 * SCALE,
        ..p(0, 20)
    };
    assert_eq!(long.risk_equity(9, 11, 0).unwrap(), 10 * SCALE);
    assert_eq!(long.risk_equity(11, 12, 0).unwrap(), 20 * SCALE);
    assert!(long.admissible(9, 11, 0).is_err()); // IM 11 > equity 10
    long.virtual_scaled = 1_000 * SCALE;
    assert!(long.reserve(10, 9, 11, 0).is_err());
    let reserved = long.reserve(9, 9, 11, 0).unwrap();
    assert!(reserved.withdraw(1, 9, 11, 0).is_err());
    assert_eq!(long.margin(11, MM_BPS).unwrap(), 6);
    let short = Participant {
        lots: -10,
        virtual_scaled: 100 * SCALE,
        ..p(1, 20)
    };
    assert_eq!(short.risk_equity(9, 11, 0).unwrap(), 10 * SCALE);
}

#[test]
fn invalid_extremes_and_aliases_reject_without_wrap() {
    assert!(p(0, u64::MAX).validate().is_err());
    assert!(Participant {
        lots: i64::MIN,
        ..p(0, 0)
    }
    .validate()
    .is_err());
    assert!(Participant {
        virtual_scaled: i128::MIN,
        ..p(0, 0)
    }
    .validate()
    .is_err());
    assert!(p(0, 0).accrued(i128::MIN).is_err());
    assert!(fee_increment(MAX_CASH, 1).is_err());
    assert!(fill(p(0, 0), p(0, 0), 1, 1, 0).is_err());
    assert!(apportion(1, &[(1, 1), (1, 1)]).is_err());
    assert!(Participant {
        generation: u64::MAX,
        ..p(0, 0)
    }
    .with_lots(1)
    .is_err());
    let dust = Participant {
        virtual_scaled: SCALE - 1,
        ..p(0, 0)
    };
    assert_eq!(
        settle(
            dust,
            Pools {
                settlement: 1,
                ..Pools::default()
            },
            1,
            1,
            0
        ),
        Err(Error::Entitlement)
    );
    let a = MAX_SCALED as u128;
    let d = a * 64;
    assert_eq!(mul_div_rem(a, a, d).unwrap(), (a / 64, 0));
    assert!(mul_div_rem(1, u128::MAX, u128::MAX).is_err());
}

#[test]
fn market_capacity_is_separate_from_reconciliation() {
    let cohort = [
        Participant {
            lots: MAX_LOTS,
            ..p(0, 0)
        },
        Participant {
            lots: -MAX_LOTS,
            ..p(1, 0)
        },
        Participant { lots: 1, ..p(2, 0) },
        Participant {
            lots: -1,
            ..p(3, 0)
        },
    ];
    reconcile(&cohort, Pools::default(), 1, 0).unwrap();
    assert_eq!(exposure_capacity(&cohort), Err(Error::Bounds));
    exposure_capacity(&cohort[..2]).unwrap();
    assert!(cash_sub(u64::MAX, 1).is_err());
}

#[test]
fn fee_splits_and_zero_subfills_do_not_invent_extra_atoms() {
    // Expected fee uses independent mathematical ceiling, not fee_total.
    for seed in 1..=1000u64 {
        let amounts = [seed * 7, seed * 13, 0, seed * 101, seed * 501];
        let mut prefix = 0;
        let mut charged = 0;
        for amount in amounts {
            let (next, fee) = fee_increment(prefix, amount).unwrap();
            prefix = next;
            charged += fee;
        }
        assert_eq!(charged, 1 + (amounts.iter().sum::<u64>() - 1) / 5000);
    }
}

#[test]
fn default_has_valuation_headroom_and_generation_exhaustion_can_close() {
    let winner = Participant {
        lots: MAX_LOTS,
        virtual_scaled: MAX_SCALED,
        funding_checkpoint: MAX_FUNDING,
        generation: u64::MAX - 1,
        ..p(0, 0)
    };
    let debtor = Participant {
        lots: -MAX_LOTS,
        virtual_scaled: -MAX_SCALED,
        funding_checkpoint: MAX_FUNDING,
        generation: u64::MAX - 1,
        ..p(1, 0)
    };
    assert_eq!(winner.accrued(-MAX_FUNDING), Err(Error::Bounds));
    assert_eq!(
        winner.unpaid(MAX_PRICE, -MAX_FUNDING).unwrap(),
        100_300_000_000_000_000_000_000_000
    );
    let out = closeout(&[winner, debtor], Pools::default(), MAX_PRICE, -MAX_FUNDING).unwrap();
    assert_eq!(
        out.impaired_scaled,
        [100_300_000_000_000_000_000_000_000, 0]
    );
    for participant in out.participants {
        assert_eq!(participant.generation, u64::MAX);
        assert_eq!(participant.virtual_scaled, 0);
        assert!(participant.with_lots(1).is_err());
    }
    assert!(Participant {
        generation: u64::MAX - 1,
        ..p(0, 0)
    }
    .with_lots(1)
    .is_err());
}
