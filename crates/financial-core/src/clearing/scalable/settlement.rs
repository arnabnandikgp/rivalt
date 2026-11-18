//! Complete native verification of untrusted rate proposals on frozen rows.
//! All economic equations are recomputed. No solver answer is an authority.
use super::{
    collection::ReducedCollection,
    number::{zeroed, Arithmetic, Number},
    wide::required_limbs,
};
use crate::{clearing::row::Row, Error, Result, MAX_CASH, SCALE};
use core::cmp::Ordering;

#[derive(Clone, Debug)]
pub struct Proposal {
    pub factor: Number,
    pub rates: [Number; 2],
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Floors {
    pub whole: [u64; 3],
    pub fractional: [bool; 3],
}

/// Construction is private: rounding only receives a complete verified plan.
/// The frozen slice cannot be changed while the plan is borrowed. The on-chain
/// adapter must establish the corresponding epoch/root/page authentication.
#[derive(Debug)]
pub struct Verified<'a> {
    pub(crate) rows: &'a [Row],
    pub(crate) pools: [u64; 2],
    pub(crate) common: Number,
    pub(crate) factor: Number,
    pub(crate) rates: [Number; 2],
    pub(crate) rate_denominator: Number,
    pub(crate) denominator: Number,
    pub(crate) floors: Vec<Floors>,
    pub(crate) spent: [u64; 2],
    pub(crate) budgets: [u64; 2],
    pub(crate) evaluations: u8,
    pub(crate) allocated: u64,
    pub(crate) insurance: [u64; 2],
    pub(crate) fees: [u64; 2],
    residuals: [Number; 2],
    losses: [Number; 2],
}

/// Values are exact numerators over the shared cash denominator. A debtor's
/// final writeoff is factored as residual * market_loss / market_residual / D;
/// do not expand that wide-by-wide product into an ordinary account field.
pub struct Attribution {
    pub flows: [Number; 3],
    pub collections: [Number; 2],
    pub residuals: [Number; 2],
    pub impairments: [Number; 2],
}

pub(crate) struct Flow {
    pub values: [Number; 3],
    slopes: [u128; 2],
}

struct Totals {
    positive: [Number; 2],
    negative: [Number; 2],
    allocated: u64,
}

fn totals(
    rows: &[Row],
    pools: [u64; 2],
    insurance: [u64; 2],
    fees: [u64; 2],
    arithmetic: &mut Arithmetic,
) -> Result<Totals> {
    if rows.is_empty() {
        return Err(Error::Bounds);
    }
    let mut allocated = 0u64;
    let mut positive = [Number::default(), Number::default()];
    let mut negative = positive.clone();
    for value in pools.into_iter().chain(insurance).chain(fees) {
        allocated = allocated.checked_add(value).ok_or(Error::Overflow)?;
        if value > MAX_CASH || allocated > MAX_CASH {
            return Err(Error::Bounds);
        }
    }
    for row in rows {
        row.validate()?;
        allocated = allocated.checked_add(row.cash).ok_or(Error::Overflow)?;
        if allocated > MAX_CASH {
            return Err(Error::Bounds);
        }
        for market in 0..2 {
            let target = if row.claims[market] >= 0 {
                &mut positive
            } else {
                &mut negative
            };
            target[market] = arithmetic.add(
                &target[market],
                &Number::from(row.claims[market].unsigned_abs()),
            )?;
            // A u64 population times K<2^87 fits strictly below 2^151.
            if target[market].bits() > 151 {
                return Err(Error::Bounds);
            }
        }
    }
    for market in 0..2 {
        let expected = arithmetic.add(
            &negative[market],
            &Number::from(u128::from(pools[market]) * SCALE as u128),
        )?;
        if positive[market] != expected {
            return Err(Error::Cohort);
        }
    }
    Ok(Totals {
        positive,
        negative,
        allocated,
    })
}

impl Verified<'_> {
    /// Absolute claim flows and cash entitlement, all over the common cash
    /// denominator. Only a constant number of wide registers is live per row.
    pub(crate) fn flow(&self, index: usize, arithmetic: &mut Arithmetic) -> Result<Flow> {
        let row = self.rows.get(index).ok_or(Error::Bounds)?;
        let collection = ReducedCollection::for_row(row)?;
        let (base, remainder) = arithmetic.divide_small(&self.common, collection.denominator)?;
        if remainder != 0 {
            return Err(Error::Invariant);
        }
        let mut values = [Number::default(), Number::default(), Number::default()];
        let mut slopes = [0; 2];
        for market in 0..2 {
            let claim = row.claims[market];
            if claim >= 0 {
                values[market] =
                    arithmetic.multiply(&self.rates[market], &Number::from(claim as u128))?;
            } else {
                let collected = arithmetic.multiply(
                    &base,
                    &Number::from_words(collection.numerators[market].to_vec()),
                )?;
                values[market] = arithmetic.multiply(&collected, &self.factor)?;
                if row.claims[1 - market] > 0 {
                    let residual = claim
                        .unsigned_abs()
                        .checked_sub(u128::from(collection.collected) * SCALE as u128)
                        .ok_or(Error::Invariant)?;
                    let recovered = arithmetic.multiply(
                        &self.rates[1 - market],
                        &Number::from(row.claims[1 - market] as u128),
                    )?;
                    let cap =
                        arithmetic.multiply(&self.rate_denominator, &Number::from(residual))?;
                    // Strict right slope: a link at its cap no longer grows.
                    let linked = if arithmetic.compare(&recovered, &cap) == Ordering::Less {
                        slopes[market] = row.claims[1 - market] as u128;
                        &recovered
                    } else {
                        &cap
                    };
                    values[market] = arithmetic.add(&values[market], linked)?;
                }
            }
        }
        let mut cash =
            arithmetic.multiply(&self.denominator, &Number::from(u128::from(row.cash)))?;
        // Add all receipts before subtracting debts, including cross links.
        for market in 0..2 {
            if row.claims[market] > 0 {
                cash = arithmetic.add(&cash, &values[market])?;
            }
        }
        for market in 0..2 {
            if row.claims[market] < 0 {
                cash = arithmetic.subtract(&cash, &values[market])?;
            }
        }
        let retained = arithmetic.multiply(
            &self.denominator,
            &Number::from(u128::from(row.cash - collection.collected)),
        )?;
        if arithmetic.compare(&cash, &retained) == Ordering::Less {
            return Err(Error::Invariant);
        }
        values[2] = cash;
        Ok(Flow { values, slopes })
    }

    pub fn common(&self) -> &Number {
        &self.common
    }
    pub fn denominator(&self) -> &Number {
        &self.denominator
    }
    pub fn insurance_spent(&self) -> [u64; 2] {
        self.spent
    }
    pub fn effective_budgets(&self) -> [u64; 2] {
        self.budgets
    }
    pub fn evaluations(&self) -> u8 {
        self.evaluations
    }
    pub fn floors(&self) -> &[Floors] {
        &self.floors
    }
    pub fn market_residuals(&self) -> &[Number; 2] {
        &self.residuals
    }
    pub fn market_losses(&self) -> &[Number; 2] {
        &self.losses
    }

    pub fn attribution(&self, index: usize, arithmetic: &mut Arithmetic) -> Result<Attribution> {
        let flows = self.flow(index, arithmetic)?.values;
        let row = &self.rows[index];
        let reduced = ReducedCollection::for_row(row)?;
        let (base, remainder) = arithmetic.divide_small(&self.common, reduced.denominator)?;
        if remainder != 0 {
            return Err(Error::Invariant);
        }
        let mut collections = [Number::default(), Number::default()];
        let mut residuals = collections.clone();
        let mut impairments = collections.clone();
        for market in 0..2 {
            let own = arithmetic.multiply(
                &base,
                &Number::from_words(reduced.numerators[market].to_vec()),
            )?;
            collections[market] = arithmetic.multiply(&own, &self.factor)?;
            let face = arithmetic.multiply(
                &self.rate_denominator,
                &Number::from(row.claims[market].unsigned_abs()),
            )?;
            if row.claims[market] < 0 {
                residuals[market] = arithmetic.subtract(&face, &flows[market])?;
            } else {
                impairments[market] = arithmetic.subtract(&face, &flows[market])?;
            }
        }
        Ok(Attribution {
            flows,
            collections,
            residuals,
            impairments,
        })
    }

    pub(crate) fn remainders(
        &self,
        index: usize,
        arithmetic: &mut Arithmetic,
    ) -> Result<[Number; 3]> {
        let mut values = self.flow(index, arithmetic)?.values;
        let floors = self.floors.get(index).ok_or(Error::Bounds)?;
        for kind in 0..3 {
            let floor = arithmetic.multiply(
                &self.denominator,
                &Number::from(u128::from(floors.whole[kind])),
            )?;
            values[kind] = arithmetic.subtract(&values[kind], &floor)?;
            if arithmetic.compare(&values[kind], &self.denominator) != Ordering::Less
                || values[kind].is_zero() == floors.fractional[kind]
            {
                return Err(Error::Invariant);
            }
        }
        Ok(values)
    }
}

/// At most three proposals: original budgets, then at most one exact clipping
/// per market. Caller-supplied lower insurance budgets are never accepted.
pub fn verify<'a>(
    rows: &'a [Row],
    pools: [u64; 2],
    insurance: [u64; 2],
    fees: [u64; 2],
    proposals: &[Proposal],
    arithmetic: &mut Arithmetic,
) -> Result<Verified<'a>> {
    let count = u64::try_from(rows.len()).map_err(|_| Error::Bounds)?;
    if proposals.is_empty() || proposals.len() > 3 || arithmetic.capacity != required_limbs(count)?
    {
        return Err(Error::Bounds);
    }
    let totals = totals(rows, pools, insurance, fees, arithmetic)?;
    let mut common = Number::from(1);
    for row in rows {
        common = arithmetic.lcm(&common, ReducedCollection::for_row(row)?.denominator)?;
    }
    let aggregate_bits = 87 + u64::from(64 - (count - 1).leading_zeros());
    let mut budgets = insurance;
    let mut clipped = [false; 2];
    for (evaluation, proposal) in proposals.iter().enumerate() {
        if proposal.factor.is_zero()
            || proposal.factor.bits() > 2 * aggregate_bits
            || proposal
                .rates
                .iter()
                .any(|rate| rate.words().len() as u64 > arithmetic.capacity)
        {
            return Err(Error::Bounds);
        }
        let rate_denominator = arithmetic.multiply(&common, &proposal.factor)?;
        let denominator = arithmetic.multiply(&rate_denominator, &Number::from(SCALE as u128))?;
        for market in 0..2 {
            if arithmetic.compare(&proposal.rates[market], &rate_denominator) == Ordering::Greater
                || (totals.positive[market].is_zero() && proposal.rates[market] != rate_denominator)
            {
                return Err(Error::Invariant);
            }
        }
        let mut plan = Verified {
            rows,
            pools,
            common: common.clone(),
            factor: proposal.factor.clone(),
            rates: proposal.rates.clone(),
            rate_denominator,
            denominator,
            floors: Vec::new(),
            spent: [0; 2],
            budgets,
            evaluations: (evaluation + 1) as u8,
            allocated: totals.allocated,
            insurance,
            fees,
            residuals: [Number::default(), Number::default()],
            losses: [Number::default(), Number::default()],
        };
        let mut incoming = [Number::default(), Number::default()];
        let mut slopes = incoming.clone();
        for (index, row) in rows.iter().enumerate() {
            let flow = plan.flow(index, arithmetic)?;
            for market in 0..2 {
                if row.claims[market] < 0 {
                    incoming[market] = arithmetic.add(&incoming[market], &flow.values[market])?;
                }
                slopes[market] =
                    arithmetic.add(&slopes[market], &Number::from(flow.slopes[market]))?;
            }
        }
        if plan.rates.iter().all(|rate| rate != &plan.rate_denominator) {
            let linked = arithmetic.multiply(&slopes[0], &slopes[1])?;
            let total = arithmetic.multiply(&totals.positive[0], &totals.positive[1])?;
            if arithmetic.compare(&linked, &total) != Ordering::Less {
                return Err(Error::Invariant);
            }
        }
        let mut fractional = [false; 2];
        for market in 0..2 {
            let outgoing = arithmetic.multiply(&plan.rates[market], &totals.positive[market])?;
            let capacity_cash = arithmetic.multiply(
                &plan.denominator,
                &Number::from(u128::from(pools[market]) + u128::from(budgets[market])),
            )?;
            let capacity = arithmetic.add(&capacity_cash, &incoming[market])?;
            let face = arithmetic.multiply(&plan.rate_denominator, &totals.positive[market])?;
            let expected = if arithmetic.compare(&capacity, &face) == Ordering::Less {
                &capacity
            } else {
                &face
            };
            if &outgoing != expected {
                return Err(Error::Invariant);
            }
            let net = arithmetic.subtract(&outgoing, &incoming[market])?;
            let funded =
                arithmetic.multiply(&plan.denominator, &Number::from(u128::from(pools[market])))?;
            let use_numerator = arithmetic.subtract(&net, &funded)?;
            let gross_debt =
                arithmetic.multiply(&plan.rate_denominator, &totals.negative[market])?;
            plan.residuals[market] = arithmetic.subtract(&gross_debt, &incoming[market])?;
            plan.losses[market] = arithmetic.subtract(&plan.residuals[market], &use_numerator)?;
            // Debtor writeoffs and creditor impairments must match per market,
            // before any whole-atom rounding, without sweeping foreign reserves.
            let impairment = arithmetic.subtract(&face, &outgoing)?;
            if impairment != plan.losses[market] {
                return Err(Error::Invariant);
            }
            let (spent, remainder) = arithmetic.divide_atoms(&use_numerator, &plan.denominator)?;
            if spent > budgets[market] {
                return Err(Error::Invariant);
            }
            plan.spent[market] = spent;
            fractional[market] = !remainder.is_zero();
        }
        if fractional.iter().any(|value| *value) {
            for market in 0..2 {
                if fractional[market] {
                    if clipped[market] || plan.spent[market] >= budgets[market] {
                        return Err(Error::Invariant);
                    }
                    clipped[market] = true;
                    budgets[market] = plan.spent[market];
                }
            }
        } else {
            if evaluation + 1 != proposals.len() {
                return Err(Error::Invariant);
            }
            plan.floors = zeroed(rows.len())?;
            for index in 0..rows.len() {
                let flow = plan.flow(index, arithmetic)?;
                for kind in 0..3 {
                    let (whole, remainder) =
                        arithmetic.divide_atoms(&flow.values[kind], &plan.denominator)?;
                    plan.floors[index].whole[kind] = whole;
                    plan.floors[index].fractional[kind] = !remainder.is_zero();
                }
            }
            return Ok(plan);
        }
    }
    Err(Error::Invariant)
}
