//! A feasible vector can pay no more than each market's available resources.
//! True forwarding is monotone, so its greatest fixed point dominates every
//! feasible vector. Maximizing the sum of rates finds exactly that point.
use super::forwarding::{Band, Forwarding};
use super::*;

pub(super) fn dot(a: &[Amount], b: &[Amount]) -> Amount {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn capacity(
    rows: &[Prepared],
    flows: &[Forwarding],
    face: &[Amount],
    funding: &[Amount],
    rates: &[Amount],
) -> Amounts {
    let mut cash = funding.to_vec();
    for (row, flow) in rows.iter().zip(flows) {
        for (total, payment) in cash.iter_mut().zip(flow.pay(&dot(&row.claims, rates))) {
            *total += payment;
        }
    }
    cash.into_iter()
        .zip(face)
        .map(|(cash, owed)| {
            if owed.is_zero() {
                Amount::one()
            } else {
                (cash / owed).min(Amount::one())
            }
        })
        .collect()
}

// One variable per linked debtor permits it to forward at most its receipts
// after its earlier bands have been funded, and at most the current band's size.
// In this region every resulting payment is bounded above by true forwarding.
fn region(
    face: &[Amount],
    funding: &[Amount],
    links: &[(&Prepared, &[Band])],
    choices: &[usize],
) -> Result<Option<Amounts>> {
    let width = face.len();
    let variables = width + links.len();
    let mut market_rows = columns(width, |m| {
        let mut row = zeros(variables + 1);
        row[m] = face[m].clone();
        row[variables] = funding[m].clone();
        row
    });
    let mut constraints = columns(width, |m| {
        let mut row = zeros(variables + 1);
        row[m] = Amount::one();
        row[variables] = Amount::one();
        row
    });
    for (i, ((debtor, bands), &choice)) in links.iter().zip(choices).enumerate() {
        let band = &bands[choice];
        let variable = width + i;
        let mut receipts = zeros(variables + 1);
        let mut cap = zeros(variables + 1);
        receipts[variable] = Amount::one();
        receipts[variables] = -&band.start;
        cap[variable] = Amount::one();
        cap[variables] = band.length.clone();
        for m in 0..width {
            receipts[m] = -&debtor.claims[m];
            market_rows[m][variable] = -&band.shares[m];
            market_rows[m][variables] += &band.paid[m];
        }
        constraints.extend([receipts, cap]);
    }
    constraints.extend(market_rows);
    simplex::maximum(constraints, variables, width)
}

pub(super) fn greatest(
    rows: &[Prepared],
    flows: &[Forwarding],
    face: &[Amount],
    base: &[Amount],
    budgets: &[u64],
) -> Result<Amounts> {
    let width = face.len();
    let funding = columns(width, |m| &base[m] + integer(budgets[m]));
    let full = vec![Amount::one(); width];
    let upper = capacity(rows, flows, face, &funding, &full);
    // Iterating downward from full produces certified upper bounds. Any exact
    // fixed point reached on this descent is therefore the greatest one.
    if upper == full || capacity(rows, flows, face, &funding, &upper) == upper {
        return Ok(upper);
    }
    let links: Vec<_> = rows
        .iter()
        .zip(flows)
        .filter_map(|(row, flow)| {
            let available = dot(&row.claims, &upper);
            let end = flow.bands.partition_point(|band| band.start < available);
            (end > 0).then(|| (row, &flow.bands[..end]))
        })
        .collect();
    // Before reductions, remaining debts all have their original proportions:
    // each linked debtor has just one band. Unequal caps can introduce choices.
    // One combination contains the true forwarding of the greatest fixed point;
    // every feasible result from any other combination is bounded by that point.
    let mut choices = vec![0; links.len()];
    let mut best = None;
    let mut best_score = None;
    loop {
        if let Some(rates) = region(face, &funding, &links, &choices)? {
            let score: Amount = rates.iter().sum();
            if best_score.as_ref().is_none_or(|old| score > *old) {
                best_score = Some(score);
                best = Some(rates);
            }
        }
        let next = (0..links.len())
            .rev()
            .find(|&i| choices[i] + 1 < links[i].1.len());
        let Some(next) = next else { break };
        choices[next] += 1;
        choices[next + 1..].fill(0);
    }
    let result = best.ok_or(Error::Invariant)?;
    if capacity(rows, flows, face, &funding, &result) != result {
        return Err(Error::Invariant);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_linked_debtors_exhaust_different_frozen_destinations() {
        // Exercise the rate solver after unequal changes to debt caps. Position
        // and charge admission belong to the proposal comparison.
        let frozen = FrozenRow {
            id: 0,
            cash: 0,
            claims: vec![-10 * SCALE, -10 * SCALE, -10 * SCALE, 30 * SCALE],
        };
        let mut first = Prepared::new(frozen, &[0, 1, 2, 3]).unwrap();
        let mut second = first.clone();
        first.remaining = [1, 3, 9, 0].map(integer).to_vec();
        second.remaining = [8, 2, 9, 0].map(integer).to_vec();
        let rows = [first, second];
        let flows: Vec<_> = rows.iter().map(Forwarding::new).collect();
        let face = [20, 20, 20, 60].map(integer);
        // Each debtor recovers ten: (1,3,6) and (4,2,4). Market balances
        // must include all three destinations under their original equal weights.
        let rates = greatest(&rows, &flows, &face, &[0, 0, 0, 20].map(integer), &[0; 4]).unwrap();
        assert_eq!(
            rates,
            [
                integer(5) / integer(20),
                integer(5) / integer(20),
                integer(10) / integer(20),
                integer(20) / integer(60)
            ]
        );
    }
}
