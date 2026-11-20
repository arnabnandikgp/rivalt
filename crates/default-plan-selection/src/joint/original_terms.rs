//! Per-member D117 debtor budgets from the original verified market ratios.
//! A caller supplies the same two market rates and loss fractions on every page.
use super::{integer, BigUint};
use financial_core::{
    clearing::{
        row::Row,
        scalable::{collection::ReducedCollection, settlement::Verified},
    },
    Error, Result, SCALE,
};
use num_integer::Integer;
use num_traits::{One, ToPrimitive, Zero};

#[derive(Clone, Debug, PartialEq, Eq)]
struct Fraction {
    numerator: BigUint,
    denominator: BigUint,
}
impl Fraction {
    fn unit_interval(numerator: BigUint, denominator: BigUint) -> Result<Self> {
        if denominator.is_zero() || numerator > denominator {
            return Err(Error::Invariant);
        }
        if numerator.is_zero() {
            return Ok(Self {
                numerator,
                denominator: BigUint::one(),
            });
        }
        let divisor = numerator.gcd(&denominator);
        Ok(Self {
            numerator: numerator / &divisor,
            denominator: denominator / divisor,
        })
    }
}

pub struct OriginalTerms {
    payment: [Fraction; 2],
    loss: [Fraction; 2],
}

impl OriginalTerms {
    pub fn from_verified(plan: &Verified<'_>) -> Result<Self> {
        let (rates, denominator) = plan.market_rates();
        Self::from_market_totals(
            rates.each_ref().map(integer),
            integer(denominator),
            plan.market_losses().each_ref().map(integer),
            plan.market_residuals().each_ref().map(integer),
        )
    }

    /// Numerators and their common rate denominator must be authenticated by
    /// the completed original rate pass. Loss and residual share its cash unit.
    pub fn from_market_totals(
        rates: [BigUint; 2],
        denominator: BigUint,
        losses: [BigUint; 2],
        residuals: [BigUint; 2],
    ) -> Result<Self> {
        let [btc, eth] = rates;
        let payment = [
            Fraction::unit_interval(btc, denominator.clone())?,
            Fraction::unit_interval(eth, denominator)?,
        ];
        let loss_fraction = |loss: BigUint, residual: BigUint| {
            if residual.is_zero() && loss.is_zero() {
                Fraction::unit_interval(loss, BigUint::one())
            } else {
                Fraction::unit_interval(loss, residual)
            }
        };
        let [btc_loss, eth_loss] = losses;
        let [btc_residual, eth_residual] = residuals;
        Ok(Self {
            payment,
            loss: [
                loss_fraction(btc_loss, btc_residual)?,
                loss_fraction(eth_loss, eth_residual)?,
            ],
        })
    }

    /// Frozen funded cash is allocated first. In a cross account only the
    /// foreign positive claim's actual payment can further reduce this debt.
    /// Round once, after applying the market loss fraction to the residual.
    pub fn debtor_budgets(&self, row: &Row) -> Result<[u64; 2]> {
        let own = ReducedCollection::for_row(row)?;
        let mut budgets = [0; 2];
        for (market, budget) in budgets.iter_mut().enumerate() {
            let claim = row.claims[market];
            if claim >= 0 || self.loss[market].numerator.is_zero() {
                continue;
            }
            let other = 1 - market;
            let rate = &self.payment[other];
            let allocation = BigUint::new(
                own.numerators[market]
                    .iter()
                    .flat_map(|&word| [word as u32, (word >> 32) as u32])
                    .collect(),
            );
            let face = BigUint::from(claim.unsigned_abs()) * own.denominator;
            if allocation > face {
                return Err(Error::Invariant);
            }
            let after_cash = (face - allocation) * &rate.denominator;
            let foreign =
                BigUint::from(row.claims[other].max(0) as u128) * &rate.numerator * own.denominator;
            if foreign >= after_cash {
                continue;
            }
            let divisor = BigUint::from(own.denominator)
                * &rate.denominator
                * &self.loss[market].denominator
                * (SCALE as u128);
            *budget = (((after_cash - foreign) * &self.loss[market].numerator) / divisor)
                .to_u64()
                .ok_or(Error::Overflow)?;
        }
        Ok(budgets)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_own_cash_split_and_floors_only_the_final_budget() {
        let terms = OriginalTerms::from_market_totals(
            [2u8.into(), 3u8.into()],
            4u8.into(),
            [3u8.into(), 2u8.into()],
            [4u8.into(), 3u8.into()],
        )
        .unwrap();
        // One cash atom split 2/5 and 3/5. The two remaining debts
        // are 3.6 and 5.4. Applying 3/4 and 2/3 yields floors 2 and 3.
        assert_eq!(
            terms.debtor_budgets(&Row {
                cash: 1,
                claims: [-4 * SCALE, -6 * SCALE]
            }),
            Ok([2, 3])
        );
        // One own atom plus 3/4 of seven foreign atoms leaves 3.75
        // unpaid on the ten-atom debt. The BTC charge budget is floor(2.8125).
        assert_eq!(
            terms.debtor_budgets(&Row {
                cash: 1,
                claims: [-10 * SCALE, 7 * SCALE]
            }),
            Ok([2, 0])
        );
        assert_eq!(
            terms.debtor_budgets(&Row {
                cash: 1,
                claims: [-3 * SCALE, 7 * SCALE]
            }),
            Ok([0, 0])
        );
    }

    #[test]
    fn validates_zero_residual_and_rejects_invalid_ratios() {
        let terms = |den: u8, loss: u8, residual: u8| {
            OriginalTerms::from_market_totals(
                [1u8.into(), 0u8.into()],
                den.into(),
                [loss.into(), 0u8.into()],
                [residual.into(), 0u8.into()],
            )
        };
        assert!(terms(0, 0, 0).is_err());
        assert!(terms(1, 1, 0).is_err());
        assert!(terms(1, 3, 2).is_err());
        assert_eq!(
            terms(1, 0, 0).unwrap().debtor_budgets(&Row {
                cash: 0,
                claims: [-100 * SCALE, 0]
            }),
            Ok([0, 0])
        );
    }
}
