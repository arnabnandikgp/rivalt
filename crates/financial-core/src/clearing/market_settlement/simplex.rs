//! Exact two-phase simplex for the bounded recovery-rate programs. In the
//! dictionary each basic variable equals RHS minus its row of nonbasic terms.
//! Bland ordering prevents cycling on zero-cash and other degenerate books.
use super::*;

struct Dictionary {
    table: Vec<Amounts>,
    basic: Vec<usize>,
    nonbasic: Vec<usize>,
    artificial: usize,
    rhs: usize,
}

impl Dictionary {
    fn pivot(&mut self, leaving: usize, entering: usize) {
        let divisor = self.table[leaving][entering].clone();
        let mut pivot = self.table[leaving].clone();
        for coefficient in &mut pivot {
            *coefficient /= &divisor;
        }
        pivot[entering] = Amount::one() / divisor;
        for (i, row) in self.table.iter_mut().enumerate() {
            if i == leaving || row[entering].is_zero() {
                continue;
            }
            let factor = row[entering].clone();
            for (j, coefficient) in pivot.iter().enumerate() {
                if j != entering && !coefficient.is_zero() {
                    row[j] -= &factor * coefficient;
                }
            }
            row[entering] = -factor * &pivot[entering];
        }
        self.table[leaving] = pivot;
        std::mem::swap(&mut self.basic[leaving], &mut self.nonbasic[entering]);
    }

    fn optimize(&mut self, objective: usize) -> Result<()> {
        loop {
            let entering = (0..self.rhs)
                .filter(|&j| {
                    self.nonbasic[j] != self.artificial && self.table[objective][j] < Amount::zero()
                })
                .min_by_key(|&j| self.nonbasic[j]);
            let Some(col) = entering else {
                return Ok(());
            };
            let leaving = (0..self.basic.len())
                .filter(|&i| self.table[i][col] > Amount::zero())
                .min_by_key(|&i| {
                    (
                        &self.table[i][self.rhs] / &self.table[i][col],
                        self.basic[i],
                    )
                })
                .ok_or(Error::Invariant)?; // Both the phase-I and rate objectives are bounded.
            self.pivot(leaving, col);
        }
    }
}

/// Maximize the sum of the first `width` variables, subject to nonnegative
/// variables and rows of the form [A | b] meaning A*x <= b.
pub(super) fn maximum(
    mut constraints: Vec<Amounts>,
    variables: usize,
    width: usize,
) -> Result<Option<Amounts>> {
    let count = constraints.len();
    let rhs = variables + 1;
    let artificial = variables + count;
    for row in &mut constraints {
        row.insert(variables, -Amount::one());
    }
    let mut objective = zeros(rhs + 1);
    for coefficient in &mut objective[..width] {
        *coefficient = -Amount::one();
    }
    constraints.push(objective);
    let mut feasibility = zeros(rhs + 1);
    feasibility[variables] = Amount::one();
    constraints.push(feasibility);
    let mut dictionary = Dictionary {
        table: constraints,
        basic: (variables..artificial).collect(),
        nonbasic: (0..variables).chain([artificial]).collect(),
        artificial,
        rhs,
    };
    let lowest = (0..count)
        .min_by_key(|&i| &dictionary.table[i][rhs])
        .ok_or(Error::Invariant)?;
    if dictionary.table[lowest][rhs] < Amount::zero() {
        dictionary.pivot(lowest, variables);
        dictionary.optimize(count + 1)?;
        if !dictionary.table[count + 1][rhs].is_zero() {
            return Ok(None);
        }
        if let Some(i) = dictionary.basic.iter().position(|&id| id == artificial) {
            if let Some(j) = (0..rhs)
                .filter(|&j| !dictionary.table[i][j].is_zero())
                .min_by_key(|&j| dictionary.nonbasic[j])
            {
                dictionary.pivot(i, j);
            }
        }
    }
    dictionary.optimize(count)?;
    let mut rates = zeros(width);
    for (i, &id) in dictionary.basic.iter().enumerate() {
        if id < width {
            rates[id] = dictionary.table[i][rhs].clone();
        }
    }
    Ok(Some(rates))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capped_region_with_a_minimum_can_be_empty_or_have_a_degenerate_vertex() {
        // A later forwarding band requires one already-collected atom. An
        // upper bound of 1/2 cannot support it. At one, duplicated constraints
        // bind simultaneously and the greatest feasible rate is exactly one.
        let minimum = [-1, -1].map(integer).to_vec();
        let half = [2, 1].map(integer).to_vec();
        assert_eq!(maximum(vec![minimum.clone(), half], 1, 1).unwrap(), None);
        let cap = [1, 1].map(integer).to_vec();
        assert_eq!(
            maximum(vec![minimum.clone(), minimum, cap.clone(), cap], 1, 1).unwrap(),
            Some(vec![Amount::one()])
        );
    }
}
