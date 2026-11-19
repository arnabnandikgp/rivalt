//! Exact selection when the complete frozen cohort has one BTC debtor, a
//! single opposite lot, and no ETH obligations. The caller authenticates both
//! original rows and derives the winner's cap from its clearing-owned history.
use super::*;

#[derive(Clone, Copy, Debug)]
pub struct FrozenSide {
    pub lots: i64,
    pub claim: i128,
    pub cash: u64,
}

#[derive(Debug)]
pub struct PairClose {
    pub charge: u64,
    pub price: Option<u64>,
    pub debtor_claim: i128,
    pub winner_claim: i128,
}

impl SnapshotTotals {
    /// The certified transfer reduces the one debtor's obligation and the one
    /// winner's receivable by exactly the same amount. Gross funding is unchanged.
    pub fn after_single_btc_charge(mut self, charge: u64) -> Result<Self> {
        let scaled = u128::from(charge) * SCALE as u128;
        for total in [&mut self.positive[0], &mut self.negative[0]] {
            let [low, high, top] = total.words();
            if top != 0 {
                return Err(Error::Bounds);
            }
            let original = u128::from(low) | (u128::from(high) << 64);
            *total = ClaimTotal::scalar(original.checked_sub(scaled).ok_or(Error::Bounds)?);
        }
        Ok(self)
    }
}

impl SnapshotScan {
    /// Full payment of whole remaining claims proves the individual payout
    /// floors without relying on a new rounding allocation for this family.
    pub fn accept_single_pair_row(
        &mut self,
        ordinal: u64,
        id: u64,
        row: &Row,
        lots: [i64; 2],
    ) -> Result<()> {
        if row.claims.iter().any(|claim| claim % SCALE != 0) {
            return Err(Error::Cohort);
        }
        self.accept(ordinal, id, row, lots)
    }

    /// One debtor and a single opposite position exhaust verified BTC inventory.
    /// Every positive claim over the original debt is already backed by the
    /// settlement pool. No ETH edge can reallocate this debtor's cash.
    pub fn sole_btc_shortfall(&self, debtor: FrozenSide, winner: FrozenSide) -> Result<u64> {
        if debtor.lots.checked_neg() != Some(winner.lots) || winner.claim < 0 {
            return Err(Error::Cohort);
        }
        self.unique_btc_debtor_shortfall(debtor)
    }

    /// A complete conserved cohort has zero net lots. If twice this member's
    /// quantity exhausts gross, it owns its entire side of the BTC book. The
    /// negative total proves it also owns every BTC debt, including flat debt.
    pub fn unique_btc_debtor_shortfall(&self, debtor: FrozenSide) -> Result<u64> {
        let totals = self.result()?;
        let quantity = debtor.lots.unsigned_abs();
        if quantity == 0
            || quantity.checked_mul(2) != Some(self.binding.gross[0])
            || self.binding.gross[1] != 0
            || totals.negative[1] != ClaimTotal::default()
            || totals.positive[1] != ClaimTotal::default()
            || debtor.claim >= 0
            || totals.negative[0] != ClaimTotal::scalar(debtor.claim.unsigned_abs())
        {
            return Err(Error::Cohort);
        }
        // Only whole atoms can be charged. Flooring after subtracting whole
        // cash and insurance gives the same integer as flooring the debt first.
        let owed = u64::try_from(debtor.claim.unsigned_abs() / SCALE as u128)
            .map_err(|_| Error::Bounds)?;
        Ok(owed
            .saturating_sub(debtor.cash)
            .saturating_sub(self.binding.insurance[0]))
    }

    pub fn select_single_btc_pair(
        &self,
        debtor: FrozenSide,
        winner: FrozenSide,
        mark: u64,
        history_cap: u64,
    ) -> Result<PairClose> {
        if debtor.lots.unsigned_abs() != 1
            || debtor.claim % SCALE != 0
            || winner.claim <= 0
            || mark == 0
            || mark > crate::MAX_PRICE
        {
            return Err(Error::Cohort);
        }
        let shortfall = self.sole_btc_shortfall(debtor, winner)?;
        let winner_atoms = u64::try_from(winner.claim / SCALE).map_err(|_| Error::Bounds)?;
        let price_room = if winner.lots > 0 {
            mark - 1
        } else {
            crate::MAX_PRICE - mark
        };
        let charge = shortfall.min(history_cap).min(winner_atoms).min(price_room);
        if charge != shortfall {
            // Partial recovery requires the general per-creditor floor proof.
            return Err(Error::Cohort);
        }
        let scaled = i128::from(charge) * SCALE;
        let mut price = None;
        if charge > 0 {
            price = Some(if winner.lots > 0 {
                mark - charge
            } else {
                mark + charge
            });
        }
        Ok(PairClose {
            charge,
            price,
            debtor_claim: debtor.claim + scaled,
            winner_claim: winner.claim - scaled,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (SnapshotScan, FrozenSide, FrozenSide) {
        let mut scan = SnapshotScan::new(SnapshotBinding {
            count: 3,
            allocated: 8_498,
            pools: [0, 0],
            insurance: [498, 0],
            fees: [0, 0],
            gross: [2, 0],
        })
        .unwrap();
        for (ordinal, (cash, claim, lots)) in [(8_000, -9_998, -1), (0, 9_002, 1), (0, 996, 0)]
            .into_iter()
            .enumerate()
        {
            scan.accept(
                ordinal as u64,
                ordinal as u64,
                &Row {
                    cash,
                    claims: [claim * SCALE, 0],
                },
                [lots, 0],
            )
            .unwrap();
        }
        (
            scan,
            FrozenSide {
                lots: -1,
                claim: -9_998 * SCALE,
                cash: 8_000,
            },
            FrozenSide {
                lots: 1,
                claim: 9_002 * SCALE,
                cash: 0,
            },
        )
    }

    #[test]
    fn unique_pair_reaches_the_same_exact_claims_as_an_independent_trade() {
        let (snapshot, debtor, winner) = setup();
        let result = snapshot
            .select_single_btc_pair(debtor, winner, 70_000, 9_002)
            .unwrap();
        assert_eq!((result.charge, result.price), (1_500, Some(68_500)));
        assert_eq!(result.debtor_claim, -8_498 * SCALE);
        assert_eq!(result.winner_claim, 7_502 * SCALE);
        let effective = snapshot
            .result()
            .unwrap()
            .after_single_btc_charge(result.charge)
            .unwrap();
        assert_eq!(
            effective.positive[0],
            ClaimTotal::scalar(8_498 * SCALE as u128)
        );
        assert_eq!(effective.negative, effective.positive);
        assert_eq!(effective.cash, 8_000);
        for cap in [0, 125, 1_499] {
            assert!(snapshot
                .select_single_btc_pair(debtor, winner, 70_000, cap)
                .is_err());
        }
    }

    #[test]
    fn a_fractional_credit_cannot_enter_the_full_whole_payout_proof() {
        let (snapshot, _, _) = setup();
        let mut scan = SnapshotScan::new(snapshot.binding).unwrap();
        assert!(scan
            .accept_single_pair_row(
                0,
                0,
                &Row {
                    cash: 0,
                    claims: [SCALE / 2, 0]
                },
                [0, 0]
            )
            .is_err());
        assert_eq!(scan.next(), Ok(0));
    }

    #[test]
    fn fractional_single_market_shortfall_preserves_preexisting_pool_backing() {
        let mut scan = SnapshotScan::new(SnapshotBinding {
            count: 3,
            allocated: 7,
            pools: [1, 0],
            insurance: [2, 0],
            fees: [0, 0],
            gross: [6, 0],
        })
        .unwrap();
        for (ordinal, (cash, claim, lots)) in [
            (4, -50 * SCALE / 4, 3),
            (0, 11 * SCALE / 4, -3),
            (0, 43 * SCALE / 4, 0),
        ]
        .into_iter()
        .enumerate()
        {
            scan.accept(
                ordinal as u64,
                50 + ordinal as u64,
                &Row {
                    cash,
                    claims: [claim, 0],
                },
                [lots, 0],
            )
            .unwrap();
        }
        let debtor = FrozenSide {
            cash: 4,
            claim: -50 * SCALE / 4,
            lots: 3,
        };
        let winner = FrozenSide {
            cash: 0,
            claim: 11 * SCALE / 4,
            lots: -3,
        };
        assert_eq!(scan.sole_btc_shortfall(debtor, winner), Ok(6));
        assert!(scan
            .sole_btc_shortfall(debtor, FrozenSide { lots: -2, ..winner })
            .is_err());
        assert!(scan
            .sole_btc_shortfall(
                FrozenSide {
                    claim: -12 * SCALE,
                    ..debtor
                },
                winner
            )
            .is_err());
    }

    #[test]
    fn another_debtor_or_foreign_claims_require_a_different_proof() {
        let (mut scan, debtor, winner) = setup();
        let wrong = FrozenSide {
            claim: -9_000 * SCALE,
            ..debtor
        };
        assert!(scan
            .clone()
            .select_single_btc_pair(wrong, winner, 70_000, 9_002)
            .is_err());
        scan.positive[1] = ClaimTotal::scalar(1);
        scan.negative[1] = ClaimTotal::scalar(1);
        assert!(scan
            .select_single_btc_pair(debtor, winner, 70_000, 9_002)
            .is_err());
    }
}
