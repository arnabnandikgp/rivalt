//! Complete three-market residual book at one freeze, before any forced reduction.
//! Native exact arithmetic. A caller supplies the independently frozen roster and vault.
use crate::{Error, Result, MAX_CASH, SCALE};
use num_rational::BigRational;
use num_traits::{One, ToPrimitive, Zero};
use std::array::from_fn;

mod rates;
mod rounding;

pub type Amount = BigRational;
pub type Amounts = [Amount; 3];

fn integer(value: impl Into<i128>) -> Amount {
    Amount::from_integer(value.into().into())
}
fn zeros() -> Amounts {
    from_fn(|_| Amount::zero())
}
fn whole(value: &Amount) -> Result<u64> {
    if !value.is_integer() {
        return Err(Error::Invariant);
    }
    value.to_integer().to_u64().ok_or(Error::Overflow)
}

#[derive(Clone, Copy)]
pub struct Market {
    pub id: u16,
    pub pool: u64,
    pub insurance: u64,
    pub fees: u64,
}
#[derive(Clone, Copy)]
pub struct FrozenRow {
    pub id: u64,
    pub cash: u64,
    /// Scaled signed claims, columns in the caller's market order.
    pub claims: [i128; 3],
}

pub struct RowResult {
    pub id: u64,
    pub collections: Amounts,
    pub recovered: Amounts,
    pub forwarded: Amounts,
    pub impairment: Amounts,
    pub writeoff: Amounts,
    pub cash_entitlement: Amount,
    pub movements: [i128; 3],
    pub cash: u64,
}
pub struct Plan {
    /// Rows and columns have canonical stable-ID order.
    pub markets: [u16; 3],
    pub rates: Amounts,
    pub spent: [u64; 3],
    pub insurance_left: [u64; 3],
    pub fees: [u64; 3],
    pub rows: Vec<RowResult>,
}

struct Prepared {
    id: u64,
    cash: u64,
    claims: Amounts,
    collections: Amounts,
    debt: Amount,
    /// Share of this debtor's total remaining debt in each destination market.
    weights: Amounts,
}

impl Prepared {
    fn new(row: FrozenRow, columns: &[usize; 3]) -> Result<Self> {
        if row.cash > MAX_CASH
            || row
                .claims
                .iter()
                .any(|c| c.unsigned_abs() > super::row::MAX_CLAIM)
        {
            return Err(Error::Bounds);
        }
        let net: Amounts = from_fn(|m| integer(row.claims[columns[m]]) / integer(SCALE));
        let owed: Amounts = from_fn(|m| (-&net[m]).max(Amount::zero()));
        let gross: Amount = owed.iter().sum();
        let weights = if gross.is_zero() {
            zeros()
        } else {
            from_fn(|m| &owed[m] / &gross)
        };
        let collection = integer(row.cash).min(gross.floor());
        Ok(Self {
            id: row.id,
            cash: row.cash,
            claims: net.map(|v| v.max(Amount::zero())),
            collections: from_fn(|m| &collection * &weights[m]),
            debt: gross - collection,
            weights,
        })
    }
}

/// Compute the residual settlement before any candidate forced reduction.
/// The caller supplies frozen signed claims after funding and index valuation.
/// Returns whole-atom terminal balances and exact claims in ascending ID order.
pub fn settle(
    mut markets: [Market; 3],
    roster: &[u64],
    rows: &[FrozenRow],
    vault: u64,
) -> Result<Plan> {
    let mut columns = [0, 1, 2];
    columns.sort_by_key(|&m| markets[m].id);
    markets = columns.map(|m| markets[m]);
    if markets.windows(2).any(|m| m[0].id == m[1].id) || vault > MAX_CASH {
        return Err(Error::Bounds);
    }
    let mut roster = roster.to_vec();
    roster.sort_unstable();
    let mut rows = rows.to_vec();
    rows.sort_by_key(|row| row.id);
    if rows.is_empty()
        || roster.windows(2).any(|p| p[0] == p[1])
        || !roster.iter().copied().eq(rows.iter().map(|r| r.id))
    {
        return Err(Error::Cohort);
    }
    let mut custody = 0u128;
    for market in markets {
        custody += u128::from(market.pool) + u128::from(market.insurance) + u128::from(market.fees);
    }
    for row in &rows {
        custody += u128::from(row.cash);
    }
    if custody != u128::from(vault) {
        return Err(Error::Invariant);
    }
    for m in 0..3 {
        let net = rows
            .iter()
            .try_fold(0i128, |sum, row| sum.checked_add(row.claims[columns[m]]))
            .ok_or(Error::Overflow)?;
        if net != i128::from(markets[m].pool) * SCALE {
            return Err(Error::Invariant);
        }
    }

    let rows = rows
        .into_iter()
        .map(|r| Prepared::new(r, &columns))
        .collect::<Result<Vec<_>>>()?;
    let face: Amounts = from_fn(|m| rows.iter().map(|r| &r.claims[m]).sum());
    let base: Amounts = from_fn(|m| {
        integer(markets[m].pool) + rows.iter().map(|r| &r.collections[m]).sum::<Amount>()
    });
    let mut budgets = markets.map(|m| m.insurance);
    let mut clipped = [false; 3];
    let (rates, used) = loop {
        let rates = rates::greatest(&rows, &face, &base, budgets)?;
        let mut incoming = zeros();
        for row in &rows {
            let applied = rates::dot(&row.claims, &rates).min(row.debt.clone());
            for m in 0..3 {
                incoming[m] += &applied * &row.weights[m];
            }
        }
        let used: Amounts = from_fn(|m| &face[m] * &rates[m] - &base[m] - &incoming[m]);
        let mut repeat = false;
        for m in 0..3 {
            if used[m] < Amount::zero() || used[m] > integer(budgets[m]) {
                return Err(Error::Invariant);
            }
            if !used[m].is_integer() {
                // Fractional use means this market was paying in full. Cutting its
                // budget below that draw makes its whole new budget necessary.
                // Other cuts can only lower incoming recoveries from here on.
                if clipped[m] {
                    return Err(Error::Invariant);
                }
                budgets[m] = whole(&used[m].floor())?;
                clipped[m] = true;
                repeat = true;
            }
        }
        if !repeat {
            break (rates, used);
        }
    };
    let spent = [whole(&used[0])?, whole(&used[1])?, whole(&used[2])?];
    let mut residual = zeros();
    let mut results = Vec::with_capacity(rows.len());
    for row in &rows {
        let recovered: Amounts = from_fn(|m| &row.claims[m] * &rates[m]);
        let total: Amount = recovered.iter().sum();
        let applied = total.clone().min(row.debt.clone());
        let forwarded = from_fn(|m| &applied * &row.weights[m]);
        let writeoff = from_fn(|m| (&row.debt - &applied) * &row.weights[m]);
        for m in 0..3 {
            residual[m] += &writeoff[m];
        }
        results.push(RowResult {
            id: row.id,
            collections: row.collections.clone(),
            recovered,
            forwarded,
            impairment: from_fn(|m| &row.claims[m] * (Amount::one() - &rates[m])),
            writeoff,
            cash_entitlement: integer(row.cash) - row.collections.iter().sum::<Amount>() + total
                - applied,
            movements: [0; 3],
            cash: 0,
        });
    }
    for m in 0..3 {
        if residual[m] < used[m] {
            return Err(Error::Invariant);
        }
        if !residual[m].is_zero() {
            let uncovered = (&residual[m] - &used[m]) / &residual[m];
            for row in &mut results {
                row.writeoff[m] *= &uncovered;
            }
        }
        if results.iter().map(|r| &r.writeoff[m]).sum::<Amount>()
            != results.iter().map(|r| &r.impairment[m]).sum()
        {
            return Err(Error::Invariant);
        }
    }
    rounding::finalize(&rows, &mut results, &markets, spent)?;
    let insurance_left = from_fn(|m| markets[m].insurance - spent[m]);
    let fees = markets.map(|m| m.fees);
    let remaining: u128 = results.iter().map(|r| u128::from(r.cash)).sum::<u128>()
        + insurance_left
            .iter()
            .chain(&fees)
            .map(|&v| u128::from(v))
            .sum::<u128>();
    if remaining != u128::from(vault) {
        return Err(Error::Invariant);
    }
    Ok(Plan {
        markets: markets.map(|m| m.id),
        rates,
        spent,
        insurance_left,
        fees,
        rows: results,
    })
}
