//! Whole-atom terminal balances. Start at each exact flow's floor and send
//! at most one extra atom per fractional edge. Reverse residual arcs allow a
//! later member to repair a previous choice while conserving its market.
use super::*;
use std::cmp::Reverse;

struct Arc {
    to: usize,
    capacity: u64,
}
struct Network {
    arcs: Vec<Arc>,
    outgoing: Vec<Vec<(u8, Reverse<Amount>, usize, usize)>>,
}

impl Network {
    fn edge(
        &mut self,
        from: usize,
        to: usize,
        capacity: u64,
        priority: u8,
        remainder: Amount,
    ) -> usize {
        let index = self.arcs.len();
        self.arcs.push(Arc { to, capacity });
        self.arcs.push(Arc {
            to: from,
            capacity: 0,
        });
        self.outgoing[from].push((priority, Reverse(remainder), to, index));
        self.outgoing[to].push((2, Reverse(Amount::zero()), from, index + 1));
        index
    }

    fn balance(&mut self, source: usize, sink: usize, mut required: u64) -> bool {
        for outgoing in &mut self.outgoing {
            outgoing.sort();
        }
        while required > 0 {
            let mut parents = vec![usize::MAX; self.outgoing.len()];
            parents[source] = self.arcs.len();
            let mut stack = vec![(source, 0)];
            while let Some((node, next)) = stack.last_mut() {
                if *node == sink {
                    break;
                }
                let Some(&(_, _, to, arc)) = self.outgoing[*node].get(*next) else {
                    stack.pop();
                    continue;
                };
                *next += 1;
                if self.arcs[arc].capacity > 0 && parents[to] == usize::MAX {
                    parents[to] = arc;
                    stack.push((to, 0));
                }
            }
            if parents[sink] == usize::MAX {
                return false;
            }
            // Every non-auxiliary residual edge has unit capacity.
            let mut node = sink;
            while node != source {
                let arc = parents[node];
                self.arcs[arc].capacity -= 1;
                self.arcs[arc ^ 1].capacity += 1;
                node = self.arcs[arc ^ 1].to;
            }
            required -= 1;
        }
        true
    }
}

pub(super) fn finalize(
    rows: &[Prepared],
    results: &mut [RowResult],
    markets: &[Market; 3],
    spent: [u64; 3],
    minimums: Option<&[[i128; 3]]>,
) -> Result<()> {
    let count = rows.len();
    let cash_sink = count + 3;
    let source = cash_sink + 1;
    let sink = source + 1;
    let mut graph = Network {
        arcs: vec![],
        outgoing: vec![vec![]; sink + 1],
    };
    let mut supplies: Vec<i128> = rows.iter().map(|row| i128::from(row.cash)).collect();
    supplies.extend((0..3).map(|m| i128::from(markets[m].pool) + i128::from(spent[m])));
    supplies.push(-supplies.iter().sum::<i128>());
    let mut needs = supplies.clone();
    let mut edges = Vec::new();
    for column in 0..4 {
        for (i, row) in results.iter().enumerate() {
            let (from, to, flow) = if column == 3 {
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
            let minimum = if column < 3 && to == i {
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
            let upper = floor + i128::from(!remainder.is_zero());
            let lower = floor.max(minimum);
            if lower > upper {
                return Err(Error::Entitlement);
            }
            needs[from] -= lower;
            needs[to] += lower;
            let arc = graph.edge(from, to, (upper - lower) as u64, 1, remainder);
            edges.push((arc, from, to, lower, column, i));
        }
    }
    let mut required = 0u64;
    for (node, residual) in needs.into_iter().enumerate() {
        let capacity = u64::try_from(residual.unsigned_abs()).map_err(|_| Error::Overflow)?;
        if residual > 0 {
            graph.edge(source, node, capacity, 0, Amount::zero());
            required = required.checked_add(capacity).ok_or(Error::Overflow)?;
        } else if residual < 0 {
            graph.edge(node, sink, capacity, 0, Amount::zero());
        }
    }
    if !graph.balance(source, sink, required) {
        return Err(if minimums.is_some() {
            Error::Entitlement
        } else {
            Error::Invariant
        });
    }
    for (arc, from, to, floor, column, i) in edges {
        let amount = floor + i128::from(graph.arcs[arc ^ 1].capacity);
        supplies[from] -= amount;
        supplies[to] += amount;
        if column == 3 {
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
                claims: [0, 0, claim * SCALE],
            })
            .collect::<Vec<_>>();
        let (markets, members) = prepare(markets, &[0, 1, 2, 3], &rows, 1).unwrap();
        let mut ordinary = settle_prepared(&markets, &members, 1, None).unwrap();
        let mut minimums = [[0; 3]; 4];
        minimums[2][2] = 1;
        finalize(
            &members,
            &mut ordinary.rows,
            &markets,
            [0; 3],
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
                [0; 3],
                Some(&minimums)
            ),
            Err(Error::Entitlement)
        );
    }
}
