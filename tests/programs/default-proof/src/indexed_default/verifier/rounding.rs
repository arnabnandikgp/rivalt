use super::*;
use financial_core::clearing::atom_rounding::AtomNetwork;

pub(super) struct Rounded {
    pub cash: Vec<u64>,
    pub payments: Vec<Columns>,
}

pub(super) fn rounded(rows: &[Member], flow: &Flow, floors: Option<&[Columns]>) -> Result<Rounded> {
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
