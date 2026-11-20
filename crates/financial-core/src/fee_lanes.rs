//! Market-local fee collection. Routes can append the full fee to one
//! clearing-owned lane. A consumer authenticates the complete lane set before
//! it can classify or spend those funds.
use crate::{cash_add, cash_sub, Error, Result, MAX_CASH};

/// Cumulative collected atoms. Never reset when fees are withdrawn, insurance
/// pays, or the market changes mode. Each lifetime total fits in u128 even
/// with MAX_CASH per fill and every representable u64 journal revision.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FeeLane {
    pub collected: u128,
}

impl FeeLane {
    pub fn record(self, fee: u64) -> Result<Self> {
        if fee > MAX_CASH {
            return Err(Error::Bounds);
        }
        Ok(Self {
            collected: self
                .collected
                .checked_add(u128::from(fee))
                .ok_or(Error::Overflow)?,
        })
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FeeCheckpoint {
    pub classified: u128,
    pub carry: u8,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MarketFunds {
    pub insurance: u64,
    pub retained: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct ClassifiedFees {
    pub checkpoint: FeeCheckpoint,
    pub funds: MarketFunds,
    pub new_fees: u64,
    pub insurance_credit: u64,
}

/// The caller proves a canonical, complete set of distinct lane addresses for
/// this market. Their balances may be read-only. The checkpoint and the two
/// funded buckets must commit together. An unchanged set is safe to reread.
pub fn classify(
    previous: FeeCheckpoint,
    funds: MarketFunds,
    lanes: &[FeeLane],
) -> Result<ClassifiedFees> {
    if lanes.is_empty() || previous.carry >= 4 {
        return Err(Error::Bounds);
    }
    let total = lanes.iter().try_fold(0u128, |sum, lane| {
        sum.checked_add(lane.collected).ok_or(Error::Overflow)
    })?;
    let delta = total
        .checked_sub(previous.classified)
        .ok_or(Error::Invariant)?;
    let new_fees = u64::try_from(delta).map_err(|_| Error::Bounds)?;
    if new_fees > MAX_CASH {
        return Err(Error::Bounds);
    }
    let numerator = delta + u128::from(previous.carry);
    let insurance_credit = (numerator / 4) as u64;
    let retained = cash_add(funds.retained, new_fees - insurance_credit)?;
    let insurance = cash_add(funds.insurance, insurance_credit)?;
    cash_add(insurance, retained)?;
    Ok(ClassifiedFees {
        checkpoint: FeeCheckpoint {
            classified: total,
            carry: (numerator % 4) as u8,
        },
        funds: MarketFunds {
            insurance,
            retained,
        },
        new_fees,
        insurance_credit,
    })
}

impl ClassifiedFees {
    /// The caller supplies a verified checkpoint to the existing authorized spend.
    pub fn spend_insurance(self, amount: u64) -> Result<MarketFunds> {
        Ok(MarketFunds {
            insurance: cash_sub(self.funds.insurance, amount)?,
            ..self.funds
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_partition_and_collection_boundary_matches_a_serial_market() {
        for opening_carry in 0..4u8 {
            for boundaries in 0..32 {
                for distribution in 0..81u32 {
                    let mut lanes = [FeeLane::default(); 3];
                    let mut checkpoint = FeeCheckpoint {
                        classified: 0,
                        carry: opening_carry,
                    };
                    let mut funds = MarketFunds {
                        insurance: 7,
                        retained: 11,
                    };
                    let mut total = 0u64;
                    let mut who = distribution;
                    for (index, fee) in [13, 13, 1, 2, 12].into_iter().enumerate() {
                        let lane = &mut lanes[(who % 3) as usize];
                        who /= 3;
                        *lane = lane.record(fee).unwrap();
                        total += fee;
                        if boundaries & (1 << index) != 0 || index == 4 {
                            let result = classify(checkpoint, funds, &lanes).unwrap();
                            let earned = (total + u64::from(opening_carry)) / 4;
                            assert_eq!(result.funds.insurance, 7 + earned);
                            assert_eq!(result.funds.retained, 11 + total - earned);
                            assert_eq!(
                                u64::from(result.checkpoint.carry),
                                (total + u64::from(opening_carry)) % 4
                            );
                            let repeat = classify(result.checkpoint, result.funds, &lanes).unwrap();
                            assert_eq!((repeat.funds, repeat.new_fees), (result.funds, 0));
                            funds = result.funds;
                            checkpoint = result.checkpoint;
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn spending_seeding_and_retained_withdrawals_preserve_the_earned_share() {
        let mut lanes = [FeeLane::default(); 3];
        lanes[0] = lanes[0].record(13).unwrap();
        let first = classify(FeeCheckpoint::default(), MarketFunds::default(), &lanes).unwrap();
        assert_eq!(
            (
                first.funds.insurance,
                first.funds.retained,
                first.checkpoint.carry
            ),
            (3, 10, 1)
        );
        assert_eq!(first.spend_insurance(4), Err(Error::InsufficientCash));
        let mut funds = first.spend_insurance(2).unwrap();
        funds.insurance += 9;
        funds.retained -= 6;
        lanes[2] = lanes[2].record(13).unwrap();
        let second = classify(first.checkpoint, funds, &lanes).unwrap();
        assert_eq!(
            (
                second.funds.insurance,
                second.funds.retained,
                second.checkpoint.carry
            ),
            (13, 14, 2)
        );
        assert_eq!(second.spend_insurance(13).unwrap().insurance, 0);
    }

    #[test]
    fn invalid_checkpoint_carry_capacity_and_cumulative_overflow_are_refused() {
        let funds = MarketFunds::default();
        let first = FeeCheckpoint::default();
        assert!(classify(first, funds, &[]).is_err());
        assert!(classify(
            FeeCheckpoint {
                classified: 2,
                carry: 0
            },
            funds,
            &[FeeLane { collected: 1 }]
        )
        .is_err());
        assert!(classify(
            FeeCheckpoint {
                classified: 0,
                carry: 4
            },
            funds,
            &[FeeLane::default()]
        )
        .is_err());
        assert!(classify(
            first,
            funds,
            &[FeeLane {
                collected: u128::from(MAX_CASH) + 1
            }]
        )
        .is_err());
        assert!(classify(
            first,
            MarketFunds {
                insurance: MAX_CASH,
                retained: 0
            },
            &[FeeLane { collected: 1 }]
        )
        .is_err());
        assert!(FeeLane {
            collected: u128::MAX
        }
        .record(1)
        .is_err());
        assert!(classify(
            first,
            funds,
            &[
                FeeLane {
                    collected: u128::MAX
                },
                FeeLane { collected: 1 }
            ]
        )
        .is_err());
        let near = FeeCheckpoint {
            classified: u128::MAX - 10,
            carry: 2,
        };
        assert_eq!(
            classify(
                near,
                funds,
                &[FeeLane {
                    collected: u128::MAX
                }]
            )
            .unwrap()
            .insurance_credit,
            3
        );
    }
}
