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

impl SnapshotScan {
    pub fn select_single_btc_pair(
        &self,
        debtor: FrozenSide,
        winner: FrozenSide,
        mark: u64,
        history_cap: u64,
    ) -> Result<PairClose> {
        let totals = self.result()?;
        if self.binding.gross != [2, 0]
            || totals.negative[1] != ClaimTotal::default()
            || totals.positive[1] != ClaimTotal::default()
            || !matches!(debtor.lots, -1 | 1)
            || winner.lots != -debtor.lots
            || debtor.claim >= 0
            || debtor.claim % SCALE != 0
            || winner.claim <= 0
            || totals.negative[0] != ClaimTotal::scalar(debtor.claim.unsigned_abs())
            || mark == 0
            || mark > crate::MAX_PRICE
        {
            return Err(Error::Cohort);
        }
        let owed = u64::try_from(debtor.claim.unsigned_abs() / SCALE as u128)
            .map_err(|_| Error::Bounds)?;
        let shortfall = owed
            .saturating_sub(debtor.cash)
            .saturating_sub(self.binding.insurance[0]);
        let winner_atoms = u64::try_from(winner.claim / SCALE).map_err(|_| Error::Bounds)?;
        let price_room = if winner.lots > 0 {
            mark - 1
        } else {
            crate::MAX_PRICE - mark
        };
        let charge = shortfall.min(history_cap).min(winner_atoms).min(price_room);
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
        for (cap, charge, price) in [
            (9_002, 1_500, Some(68_500)),
            (125, 125, Some(69_875)),
            (0, 0, None),
        ] {
            let result = snapshot
                .clone()
                .select_single_btc_pair(debtor, winner, 70_000, cap)
                .unwrap();
            assert_eq!((result.charge, result.price), (charge, price));
            assert_eq!(result.debtor_claim, (-9_998 + i128::from(charge)) * SCALE);
            assert_eq!(result.winner_claim, (9_002 - i128::from(charge)) * SCALE);
        }
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
