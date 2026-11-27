use super::*;
use financial_core::clearing::atom_rounding::AtomNetwork;

struct Rounded {
    pub cash: Vec<u64>,
    pub payments: Vec<Columns>,
}

fn rounded(rows: &[Member], flow: &Flow, floors: Option<&[Columns]>) -> Result<Rounded> {
    let count = rows.len();
    let width = rows[0].cells.len();
    let sink = count + width;
    let mut supplies: Vec<i128> = rows.iter().map(|row| i128::from(row.cash)).collect();
    supplies.extend(flow.spent[..width].iter().copied().map(i128::from));
    supplies.push(-supplies.iter().sum::<i128>());
    let mut graph = AtomNetwork::new(supplies);
    let mut edges = Vec::new();
    for m in 0..=width {
        for (i, row) in rows.iter().enumerate() {
            let (from, to, amount, minimum) = if m == width {
                (i, sink, flow.cash[i], 0)
            } else if row.cells[m].claim > 0 {
                (
                    count + m,
                    i,
                    flow.payments[i][m],
                    floors.map_or(0, |f| f[i][m]),
                )
            } else {
                (i, count + m, flow.payments[i][m], 0)
            };
            if amount == 0 && minimum == 0 {
                continue;
            }
            checked(graph.transfer(
                from,
                to,
                (amount / flow.unit).into(),
                amount % flow.unit,
                minimum.into(),
            ))?;
            edges.push((i, m));
        }
    }
    let mut result = Rounded {
        cash: vec![0; count],
        payments: vec![[0; WIDTH]; count],
    };
    for ((i, m), amount) in edges.into_iter().zip(checked(graph.finish())?) {
        let atoms = u64::try_from(amount).map_err(|_| ProofError::UnsupportedBook)?;
        if m == width {
            result.cash[i] = atoms;
        } else {
            result.payments[i][m] = atoms;
        }
    }
    Ok(result)
}

fn integral_cash(flow: &Flow, count: usize, width: usize) -> Option<Vec<u64>> {
    let cash = &flow.cash[..count];
    if cash.iter().all(|v| v % flow.unit == 0)
        && flow
            .payments
            .iter()
            .all(|r| r[..width].iter().all(|v| v % flow.unit == 0))
    {
        return Some(cash.iter().map(|v| v / flow.unit).collect());
    }
    None
}

pub(super) fn baseline_cash(rows: &[Member], baseline: &Flow) -> Result<Vec<u64>> {
    if let Some(cash) = integral_cash(baseline, rows.len(), rows[0].cells.len()) {
        return Ok(cash);
    }
    Ok(rounded(rows, baseline, None)?.cash)
}

pub(super) fn protected_cash(
    rows: &[Member],
    baseline: &Flow,
    terminal: &Flow,
    pairs: &[Pair],
    charges: &Columns,
) -> Result<(Vec<u64>, bool)> {
    let width = rows[0].cells.len();
    // A whole winning receipt that passes exact protection already covers the
    // ceiling of the protected baseline less its whole direct charge. There is
    // only one rounding when all market movements and cash are already integral.
    if let Some(cash) = integral_cash(terminal, rows.len(), width) {
        return Ok((cash, false));
    }
    let base = rounded(rows, baseline, None)?;
    let mut result = rounded(rows, terminal, None)?;
    let mut floors = vec![[0; WIDTH]; rows.len()];
    let targets = charges.iter().filter(|&&c| c != 0).count();
    let mut repaired = false;
    for m in (0..width).filter(|&m| targets > usize::from(charges[m] != 0)) {
        for (i, _) in rows
            .iter()
            .enumerate()
            .filter(|(_, r)| r.cells[m].claim > 0)
        {
            let direct = pairs[m].charge_of(i, charges[m]);
            floors[i][m] = base.payments[i][m].saturating_sub(direct);
            repaired |= result.payments[i][m] < floors[i][m];
        }
    }
    if repaired {
        result = rounded(rows, terminal, Some(&floors))?;
    }
    Ok((result.cash, repaired))
}
