//! Complete market-indexed residual settlement at one freeze.
//! Native exact arithmetic. A caller supplies the independently frozen roster and vault.
use crate::{Error, Result, MAX_CASH, SCALE};
use num_rational::BigRational;
use num_traits::{One, ToPrimitive, Zero};
mod forwarding;
mod simplex;

mod rates;
pub mod reduction;
mod rounding;

pub type Amount = BigRational;
pub type Amounts = Vec<Amount>;

fn integer(value: impl Into<i128>) -> Amount {
    Amount::from_integer(value.into().into())
}
fn columns<T>(width: usize, f: impl FnMut(usize) -> T) -> Vec<T> {
    (0..width).map(f).collect()
}
fn zeros(width: usize) -> Amounts {
    vec![Amount::zero(); width]
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
/// Market snapshots must match the separately supplied frozen membership.
pub struct FrozenMarkets(Vec<Market>);

impl FrozenMarkets {
    pub fn new(expected: &[u16], snapshots: Vec<Market>) -> Result<Self> {
        let mut ids: Vec<_> = snapshots.iter().map(|market| market.id).collect();
        ids.sort_unstable();
        if ids.is_empty() || ids.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(Error::Bounds);
        }
        let mut expected = expected.to_vec();
        expected.sort_unstable();
        if ids != expected {
            return Err(Error::Cohort);
        }
        Ok(Self(snapshots))
    }
}

#[derive(Clone)]
pub struct FrozenRow {
    pub id: u64,
    pub cash: u64,
    /// Scaled signed claims, columns in the caller's market order.
    pub claims: Vec<i128>,
}

pub struct RowResult {
    pub id: u64,
    pub collections: Amounts,
    pub recovered: Amounts,
    pub forwarded: Amounts,
    pub impairment: Amounts,
    pub writeoff: Amounts,
    pub cash_entitlement: Amount,
    pub movements: Vec<i128>,
    pub cash: u64,
}
pub struct Plan {
    /// Rows and columns have canonical stable-ID order.
    pub markets: Vec<u16>,
    pub rates: Amounts,
    pub spent: Vec<u64>,
    pub insurance_left: Vec<u64>,
    pub fees: Vec<u64>,
    pub rows: Vec<RowResult>,
}

#[derive(Clone)]
struct Prepared {
    id: u64,
    cash: u64,
    claims: Amounts,
    collections: Amounts,
    remaining: Amounts,
    /// Original proportional shares of recovered proceeds, fixed at the freeze.
    weights: Amounts,
}

impl Prepared {
    fn new(row: FrozenRow, order: &[usize]) -> Result<Self> {
        if row.cash > MAX_CASH
            || row
                .claims
                .iter()
                .any(|c| c.unsigned_abs() > super::row::MAX_CLAIM)
        {
            return Err(Error::Bounds);
        }
        let width = order.len();
        let net: Amounts = columns(width, |m| integer(row.claims[order[m]]) / integer(SCALE));
        let owed: Amounts = columns(width, |m| (-&net[m]).max(Amount::zero()));
        let gross: Amount = owed.iter().sum();
        let weights = if gross.is_zero() {
            zeros(width)
        } else {
            columns(width, |m| &owed[m] / &gross)
        };
        let collection = integer(row.cash).min(gross.floor());
        let collections: Amounts = columns(width, |m| &collection * &weights[m]);
        Ok(Self {
            id: row.id,
            cash: row.cash,
            claims: net.into_iter().map(|v| v.max(Amount::zero())).collect(),
            remaining: columns(width, |m| &owed[m] - &collections[m]),
            collections,
            weights,
        })
    }
}

/// Compute the residual settlement before any candidate forced reduction.
/// The caller supplies frozen signed claims after funding and index valuation.
/// Returns whole-atom terminal balances and exact claims in ascending ID order.
pub fn settle(
    markets: FrozenMarkets,
    roster: &[u64],
    rows: &[FrozenRow],
    vault: u64,
) -> Result<Plan> {
    let (markets, members) = prepare(markets, roster, rows, vault)?;
    settle_prepared(&markets, &members, vault, None)
}

fn prepare(
    FrozenMarkets(mut markets): FrozenMarkets,
    roster: &[u64],
    rows: &[FrozenRow],
    vault: u64,
) -> Result<(Vec<Market>, Vec<Prepared>)> {
    let width = markets.len();
    if vault > MAX_CASH || rows.iter().any(|r| r.claims.len() != width) {
        return Err(Error::Bounds);
    }
    let mut order: Vec<_> = (0..width).collect();
    order.sort_by_key(|&m| markets[m].id);
    markets.sort_by_key(|m| m.id);
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
    for market in &markets {
        custody += u128::from(market.pool) + u128::from(market.insurance) + u128::from(market.fees);
    }
    for row in &rows {
        custody += u128::from(row.cash);
    }
    if custody != u128::from(vault) {
        return Err(Error::Invariant);
    }
    for m in 0..width {
        let net = rows
            .iter()
            .try_fold(0i128, |sum, row| sum.checked_add(row.claims[order[m]]))
            .ok_or(Error::Overflow)?;
        if net != i128::from(markets[m].pool) * SCALE {
            return Err(Error::Invariant);
        }
    }

    let rows = rows
        .into_iter()
        .map(|r| Prepared::new(r, &order))
        .collect::<Result<Vec<_>>>()?;
    Ok((markets, rows))
}

fn settle_prepared(
    markets: &[Market],
    rows: &[Prepared],
    vault: u64,
    protection: Option<(&Plan, &[usize])>,
) -> Result<Plan> {
    let width = markets.len();
    let flows: Vec<_> = rows.iter().map(forwarding::Forwarding::new).collect();
    let face: Amounts = columns(width, |m| rows.iter().map(|r| &r.claims[m]).sum());
    let base: Amounts = columns(width, |m| {
        integer(markets[m].pool) + rows.iter().map(|r| &r.collections[m]).sum::<Amount>()
    });
    let mut budgets = columns(width, |m| markets[m].insurance);
    let mut clipped = vec![false; width];
    let (rates, used) = loop {
        let rates = rates::greatest(rows, &flows, &face, &base, &budgets)?;
        let mut incoming = zeros(width);
        for (row, flow) in rows.iter().zip(&flows) {
            let forwarded = flow.pay(&rates::dot(&row.claims, &rates));
            for m in 0..width {
                incoming[m] += &forwarded[m];
            }
        }
        let used: Amounts = columns(width, |m| &face[m] * &rates[m] - &base[m] - &incoming[m]);
        let mut repeat = false;
        for m in 0..width {
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
    let spent = used.iter().map(whole).collect::<Result<Vec<_>>>()?;
    let mut residual = zeros(width);
    let mut results = Vec::with_capacity(rows.len());
    for (row, flow) in rows.iter().zip(&flows) {
        let recovered: Amounts = columns(width, |m| &row.claims[m] * &rates[m]);
        let total: Amount = recovered.iter().sum();
        let forwarded = flow.pay(&total);
        let applied: Amount = forwarded.iter().sum();
        if applied != total.clone().min(row.remaining.iter().sum()) {
            return Err(Error::Invariant);
        }
        let writeoff = columns(width, |m| &row.remaining[m] - &forwarded[m]);
        for m in 0..width {
            residual[m] += &writeoff[m];
        }
        results.push(RowResult {
            id: row.id,
            collections: row.collections.clone(),
            recovered,
            forwarded,
            impairment: columns(width, |m| &row.claims[m] * (Amount::one() - &rates[m])),
            writeoff,
            cash_entitlement: integer(row.cash) - row.collections.iter().sum::<Amount>() + total
                - applied,
            movements: vec![0; width],
            cash: 0,
        });
    }
    for m in 0..width {
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
    rounding::finalize(rows, &mut results, markets, &spent, None)?;
    if let Some((baseline, targets)) = protection {
        reduction::protect(rows, &mut results, markets, &spent, baseline, targets)?;
    }
    let insurance_left = columns(width, |m| markets[m].insurance - spent[m]);
    let fees = columns(width, |m| markets[m].fees);
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
        markets: columns(width, |m| markets[m].id),
        rates,
        spent,
        insurance_left,
        fees,
        rows: results,
    })
}
