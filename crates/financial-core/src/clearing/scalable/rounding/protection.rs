//! D117/D118. A foreign reduction may not increase market losses or insurance
//! use, impair an individual exact entitlement, or take away a prior cash atom.
//! A direct charge on that same claim is the only permitted allowance.
use super::*;
use crate::SCALE;

impl<'a, 'rows> Circulation<'a, 'rows> {
    /// Derive mandatory receipts from a *completed* unadjusted baseline.
    /// Callers provide no replacement creditor amounts or rounding priority.
    pub fn after_reduction(
        plan: &'a Verified<'rows>,
        baseline: &Circulation<'_, '_>,
        orders: [&[u64]; 2],
        arithmetic: &mut Arithmetic,
    ) -> Result<Self> {
        let original = baseline.plan;
        if baseline.protected.is_some()
            || original.rows != original.collection_rows
            || plan.collection_rows != original.rows
            || plan.insurance != original.insurance
            || plan.fees != original.fees
            || plan.pools != original.pools
            || plan.common != original.common
        {
            return Err(Error::Cohort);
        }
        let previous = baseline.result()?;
        let mut changed = [false; 2];
        for (before, after) in original.rows.iter().zip(plan.rows) {
            for market in 0..2 {
                changed[market] |= before.claims[market] != after.claims[market];
            }
        }
        // The two denominators share the same frozen collection LCM and SCALE.
        // The remaining factor of either rate uses at most five words.
        let extra = arithmetic.capacity.checked_add(6).ok_or(Error::Overflow)?;
        let mut comparison = Arithmetic::new(extra, arithmetic.resume_budget)?;
        let mut required = zeroed::<u8>(plan.rows.len())?;
        for market in 0..2 {
            if !changed[1 - market] {
                continue;
            }
            let loss_after =
                comparison.multiply(&plan.market_losses()[market], &original.factor)?;
            let loss_before =
                comparison.multiply(&original.market_losses()[market], &plan.factor)?;
            if comparison.compare(&loss_after, &loss_before).is_gt()
                || plan.spent[market] > original.spent[market]
            {
                return Err(Error::Entitlement);
            }
            for (index, (before, after)) in original.rows.iter().zip(plan.rows).enumerate() {
                if before.claims[market] <= 0 {
                    continue;
                }
                let charge = (before.claims[market] - after.claims[market]) / SCALE;
                let charge = u64::try_from(charge).map_err(|_| Error::Cohort)?;
                let allowance =
                    comparison.multiply(&plan.denominator, &Number::from(u128::from(charge)))?;
                let effective = comparison.multiply(
                    &plan.rates[market],
                    &Number::from(after.claims[market] as u128),
                )?;
                let total = comparison.add(&effective, &allowance)?;
                let left = comparison.multiply(&total, &original.factor)?;
                let previous_claim = comparison.multiply(
                    &original.rates[market],
                    &Number::from(before.claims[market] as u128),
                )?;
                let right = comparison.multiply(&previous_claim, &plan.factor)?;
                if comparison.compare(&left, &right).is_lt() {
                    return Err(Error::Entitlement);
                }
                let paid = u64::try_from(previous.movements[index][market])
                    .map_err(|_| Error::Invariant)?;
                let minimum = paid.saturating_sub(charge);
                let floor = plan.floors[index].whole[market];
                if minimum > floor {
                    if !plan.floors[index].fractional[market] || minimum - floor != 1 {
                        return Err(Error::Entitlement);
                    }
                    required[index] |= 1 << market;
                }
            }
        }
        let ordinary = Self::new(plan, orders, arithmetic)?;
        if required.iter().any(|mask| *mask != 0) {
            // D118 retains the ordinary deterministic allocation whenever it
            // already pays every minimum. Constraining even satisfied edges
            // can otherwise change unrelated receipts in a non-unique flow.
            let mut check = ordinary.clone();
            while !check.is_done() {
                check.step()?;
            }
            let movements = check.result()?.movements;
            for (index, mask) in required.iter().enumerate() {
                for market in 0..2 {
                    if mask & (1 << market) != 0
                        && i128::from(movements[index][market])
                            <= i128::from(plan.floors[index].whole[market])
                    {
                        return Self::build(plan, orders, arithmetic, Some(required));
                    }
                }
            }
        }
        Ok(ordinary)
    }
}
