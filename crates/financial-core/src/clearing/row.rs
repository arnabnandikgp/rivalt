//! Exact frozen row primitives. All numerators use the contract's common
//! denominators; a complete cohort and verified rates are enforced by the caller.
use super::wide::{self, Wide};
use crate::{Error, Result, MAX_CASH, SCALE};
use core::cmp::Ordering;

pub const MAX_CLAIM: u128 = 100_300_000_000_000_000_000_000_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Row {
    pub cash: u64,
    pub claims: [i128; 2],
}

impl Row {
    pub fn validate(&self) -> Result<()> {
        if self.cash > MAX_CASH
            || self
                .claims
                .iter()
                .any(|claim| claim.unsigned_abs() > MAX_CLAIM)
        {
            return Err(Error::Bounds);
        }
        Ok(())
    }

    pub fn debts(&self) -> [u128; 2] {
        self.claims.map(|claim| claim.min(0).unsigned_abs())
    }

    pub fn collected(&self) -> Result<u64> {
        self.validate()?;
        let debts = self.debts();
        let whole = (debts[0] + debts[1]) / SCALE as u128;
        Ok(u128::from(self.cash).min(whole) as u64)
    }

    pub fn denominator(&self, common: &mut Wide) -> Result<()> {
        let collected = self.collected()?;
        let debts = self.debts();
        if debts.iter().all(|debt| *debt != 0) && collected != 0 {
            wide::multiply_assign(common, &wide::limbs_u128(debts[0] + debts[1]))?;
        }
        Ok(())
    }

    /// Own-cash collection in scaled units, with denominator L.
    #[inline(never)]
    pub fn collection(&self, market: usize, common: &Wide, output: &mut Wide) -> Result<()> {
        if market >= 2 {
            return Err(Error::Bounds);
        }
        let collected = u128::from(self.collected()?) * SCALE as u128;
        let debts = self.debts();
        if debts[market] == 0 || collected == 0 {
            output.fill(0);
        } else if debts[1 - market] == 0 {
            wide::multiply(output, common, &wide::limbs_u128(collected))?;
        } else {
            let remainder = wide::divide_small(output, common, debts[0] + debts[1])?;
            if remainder != 0 {
                return Err(Error::Invariant);
            }
            wide::multiply_assign(output, &wide::product_small(collected, debts[market])?)?;
        }
        Ok(())
    }

    /// Absolute claim cash flow numerator over D=S*L*factor. Its direction is the
    /// original claim sign; a cross link never consumes a foreign account's cash.
    #[inline(never)]
    pub fn flow(
        &self,
        market: usize,
        common: &Wide,
        factor: &[u64; 3],
        rates: [&Wide; 2],
        rate_denominator: &Wide,
        output: &mut Wide,
        scratch: &mut Wide,
    ) -> Result<()> {
        self.validate()?;
        if market >= 2 {
            return Err(Error::Bounds);
        }
        let claim = self.claims[market];
        if claim >= 0 {
            wide::multiply(output, rates[market], &wide::limbs_u128(claim as u128))?;
            return Ok(());
        }
        self.collection(market, common, output)?;
        wide::multiply_assign(output, factor)?;
        if self.claims[1 - market] > 0 {
            let residual_debt =
                claim.unsigned_abs() - u128::from(self.collected()?) * SCALE as u128;
            wide::multiply(scratch, rate_denominator, &wide::limbs_u128(residual_debt))?;
            // output initially contains own collection. Compare the recovered
            // opposite claim against its residual debt cap using one scratch.
            let recovered_rate = rates[1 - market];
            let mut recovered = [0; wide::LIMBS];
            wide::multiply(
                &mut recovered,
                recovered_rate,
                &wide::limbs_u128(self.claims[1 - market] as u128),
            )?;
            wide::add_assign(
                output,
                if wide::compare(scratch, &recovered) == Ordering::Less {
                    scratch
                } else {
                    &recovered
                },
            )?;
        }
        Ok(())
    }

    /// Right derivative into this market. A link exactly at its cap is excluded.
    pub fn right_slope(
        &self,
        market: usize,
        rate: &Wide,
        denominator: &Wide,
        recovered: &mut Wide,
        cap: &mut Wide,
    ) -> Result<u128> {
        self.validate()?;
        if market >= 2 {
            return Err(Error::Bounds);
        }
        let debts = self.debts();
        if debts[market] == 0 || self.claims[1 - market] <= 0 {
            return Ok(0);
        }
        let residual = debts[market] - u128::from(self.collected()?) * SCALE as u128;
        let positive = self.claims[1 - market] as u128;
        wide::multiply(recovered, rate, &wide::limbs_u128(positive))?;
        wide::multiply(cap, denominator, &wide::limbs_u128(residual))?;
        Ok(if wide::compare(recovered, cap) == Ordering::Less {
            positive
        } else {
            0
        })
    }
}

/// Complete verification aggregates the incoming negative flows. This routine
/// checks the original min equation, then exact insurance use/floor for a market.
#[inline(never)]
pub fn verify_market(
    positive: u128,
    pool: u64,
    insurance: u64,
    rate: &Wide,
    rate_denominator: &Wide,
    cash_denominator: &Wide,
    incoming: &Wide,
    outgoing: &mut Wide,
    capacity: &mut Wide,
    remainder: &mut Wide,
) -> Result<(u64, bool)> {
    if positive >= 1u128 << 93
        || pool > MAX_CASH
        || insurance > MAX_CASH
        || wide::compare(rate, rate_denominator) == Ordering::Greater
    {
        return Err(Error::Bounds);
    }
    if positive == 0 && wide::compare(rate, rate_denominator) != Ordering::Equal {
        return Err(Error::Invariant);
    }
    wide::multiply(outgoing, rate, &wide::limbs_u128(positive))?;
    wide::multiply(
        capacity,
        cash_denominator,
        &wide::limbs_u128(u128::from(pool) + u128::from(insurance)),
    )?;
    wide::add_assign(capacity, incoming)?;
    wide::multiply(remainder, rate_denominator, &wide::limbs_u128(positive))?;
    let expected = if wide::compare(capacity, remainder) == Ordering::Less {
        &*capacity
    } else {
        &*remainder
    };
    if wide::compare(outgoing, expected) != Ordering::Equal {
        return Err(Error::Invariant);
    }
    wide::subtract_assign(outgoing, incoming)?;
    wide::multiply(capacity, cash_denominator, &[pool])?;
    wide::subtract_assign(outgoing, capacity)?;
    let spent = wide::divide_atoms(remainder, outgoing, cash_denominator)?;
    if spent > insurance {
        return Err(Error::Invariant);
    }
    Ok((spent, wide::bits(remainder) != 0))
}

pub fn greatest(
    rates: [&Wide; 2],
    denominator: &Wide,
    slopes: [u128; 2],
    positives: [u128; 2],
) -> Result<()> {
    if wide::bits(denominator) == 0
        || rates
            .iter()
            .any(|rate| wide::compare(rate, denominator) == Ordering::Greater)
    {
        return Err(Error::Bounds);
    }
    if rates
        .iter()
        .any(|rate| wide::compare(rate, denominator) == Ordering::Equal)
    {
        return Ok(());
    }
    let linked = wide::product_small(slopes[0], slopes[1])?;
    let total = wide::product_small(positives[0], positives[1])?;
    for index in (0..3).rev() {
        match linked[index].cmp(&total[index]) {
            Ordering::Less => return Ok(()),
            Ordering::Greater => return Err(Error::Invariant),
            Ordering::Equal => {}
        }
    }
    Err(Error::Invariant)
}
