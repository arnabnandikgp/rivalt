//! Whole-atom terminal balances. Start at each exact flow's floor and send
//! at most one extra atom per fractional edge. Reverse residual arcs allow a
//! later member to repair a previous choice while conserving its market.
use super::*;
use crate::clearing::atom_rounding::AtomNetwork;

pub(super) fn finalize(
    rows: &[Prepared],
    results: &mut [RowResult],
    markets: &[Market],
    spent: &[u64],
    minimums: Option<&[Vec<i128>]>,
) -> Result<()> {
    let count = rows.len();
    let width = markets.len();
    let cash_sink = count + width;
    let mut supplies: Vec<i128> = rows.iter().map(|row| i128::from(row.cash)).collect();
    supplies.extend((0..width).map(|m| i128::from(markets[m].pool) + i128::from(spent[m])));
    supplies.push(-supplies.iter().sum::<i128>());
    let mut graph = AtomNetwork::new(supplies.clone());
    let mut edges = Vec::new();
    for column in 0..=width {
        for (i, row) in results.iter().enumerate() {
            let (from, to, flow) = if column == width {
                (i, cash_sink, row.cash_entitlement.clone())
            } else if !rows[i].claims[column].is_zero() {
                (count + column, i, row.recovered[column].clone())
            } else {
                (
                    i,
                    count + column,
                    &row.collections[column] + &row.forwarded[column],
                )
            };
            let minimum = if column < width && to == i {
                minimums.map_or(0, |bounds| bounds[i][column])
            } else {
                0
            };
            if flow.is_zero() && minimum == 0 {
                continue;
            }
            if flow < Amount::zero() {
                return Err(Error::Invariant);
            }
            // Claim setoff can exceed vault cash, so store signed claim movements as i128.
            let floor = flow.to_integer().to_i128().ok_or(Error::Overflow)?;
            let remainder = flow - integer(floor);
            graph.transfer(from, to, floor, remainder, minimum)?;
            edges.push((from, to, column, i));
        }
    }
    let rounded = graph.finish().map_err(|err| {
        if err == Error::Entitlement && minimums.is_none() {
            Error::Invariant
        } else {
            err
        }
    })?;
    for ((from, to, column, i), amount) in edges.into_iter().zip(rounded) {
        supplies[from] -= amount;
        supplies[to] += amount;
        if column == width {
            results[i].cash = u64::try_from(amount).map_err(|_| Error::Overflow)?;
        } else {
            results[i].movements[column] = if to == i { amount } else { -amount };
        }
    }
    if supplies.iter().any(|v| *v != 0) {
        return Err(Error::Invariant);
    }
    for (input, output) in rows.iter().zip(results) {
        if output.cash < input.cash - whole(&output.collections.iter().sum())? {
            return Err(Error::Invariant);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protected_receipts_must_be_fundable_together() {
        let markets = [3, 8, 38].map(|id| Market {
            id,
            pool: 0,
            insurance: 0,
            fees: 0,
        });
        let rows = [-3, 1, 1, 1]
            .into_iter()
            .enumerate()
            .map(|(id, claim)| FrozenRow {
                id: id as u64,
                cash: u64::from(id == 0),
                claims: vec![0, 0, claim * SCALE],
            })
            .collect::<Vec<_>>();
        let (markets, members) = prepare(
            FrozenMarkets::new(&[3, 8, 38], markets.to_vec()).unwrap(),
            &[0, 1, 2, 3],
            &rows,
            1,
        )
        .unwrap();
        let mut ordinary = settle_prepared(&markets, &members, 1, None).unwrap();
        let mut minimums = vec![vec![0; 3]; 4];
        minimums[2][2] = 1;
        finalize(
            &members,
            &mut ordinary.rows,
            &markets,
            &[0; 3],
            Some(&minimums),
        )
        .unwrap();
        assert_eq!(ordinary.rows[2].cash, 1);
        // Each of the two minimums separately fits ceil(1/3). Together they
        // would pay two cash atoms from the only atom in the vault.
        minimums[3][2] = 1;
        assert_eq!(
            finalize(
                &members,
                &mut ordinary.rows,
                &markets,
                &[0; 3],
                Some(&minimums)
            ),
            Err(Error::Entitlement)
        );
    }
}
