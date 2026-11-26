//! Find the greatest recovery rates without seeding a cashless cycle with tokens.
//! Within each allocation regime a capped debtor flow is the minimum of two
//! affine functions. Its upper supporting planes bound the post-fixed rates in
//! that regime. Add a violated plane, then maximize the sum of the three rates
//! on the remaining polytope. There are finitely many distinct planes.
//! The monotone capacity map has a greatest fixed point which dominates every
//! post-fixed point. Once a maximizer passes all capacity checks, it must be
//! that point: any strictly smaller coordinate would reduce the sum.
use super::*;

pub(super) fn dot(a: &Amounts, b: &Amounts) -> Amount {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}
struct Plane {
    normal: Amounts,
    limit: Amount,
}

fn cross(a: &Amounts, b: &Amounts) -> Amounts {
    from_fn(|m| &a[(m + 1) % 3] * &b[(m + 2) % 3] - &a[(m + 2) % 3] * &b[(m + 1) % 3])
}

fn maximum(planes: &[Plane]) -> Option<Amounts> {
    let mut best = None;
    let mut score = -Amount::one();
    for (i, a) in planes.iter().enumerate() {
        for (j, b) in planes[..i].iter().enumerate() {
            let ab = cross(&a.normal, &b.normal);
            for c in &planes[..j] {
                let det = dot(&ab, &c.normal);
                if det.is_zero() {
                    continue;
                }
                let bc = cross(&b.normal, &c.normal);
                let ca = cross(&c.normal, &a.normal);
                let rates =
                    from_fn(|m| (&a.limit * &bc[m] + &b.limit * &ca[m] + &c.limit * &ab[m]) / &det);
                let sum: Amount = rates.iter().sum();
                if sum > score && planes.iter().all(|p| dot(&p.normal, &rates) <= p.limit) {
                    score = sum;
                    best = Some(rates);
                }
            }
        }
    }
    best
}

pub(super) fn greatest(
    rows: &[Prepared],
    face: &Amounts,
    base: &Amounts,
    budgets: [u64; 3],
) -> Result<Amounts> {
    let mut spill = None;
    for (member, row) in rows.iter().enumerate() {
        if let Some((first, second)) = row.uneven_caps() {
            // One proposed pair can lower the unpaid debt of only one member.
            if spill.replace((member, first, second)).is_some() {
                return Err(Error::Invariant);
            }
        }
    }

    let shared = rate_region(rows, face, base, budgets, None);
    let Some(spill) = spill else {
        return shared.ok_or(Error::Invariant);
    };
    // The second destination receives the larger of its frozen share and what
    // is left once the first debt is paid, up to its own remaining debt.
    // Its maximum is the union of two post-fixed polytopes. Each affine choice
    // underestimates the true capacity everywhere, and one attains it at the
    // greatest fixed point. Compare their exact maxima; either may be empty.
    shared
        .into_iter()
        .chain(rate_region(rows, face, base, budgets, Some(spill)))
        .max_by_key(|rates| rates.iter().sum::<Amount>())
        .ok_or(Error::Invariant)
}

fn rate_region(
    rows: &[Prepared],
    face: &Amounts,
    base: &Amounts,
    budgets: [u64; 3],
    spill: Option<(usize, usize, usize)>,
) -> Option<Amounts> {
    let mut planes = Vec::new();
    for m in 0..3 {
        let mut unit = zeros();
        unit[m] = Amount::one();
        planes.push(Plane {
            normal: unit.clone(),
            limit: Amount::one(),
        });
        planes.push(Plane {
            normal: unit.map(|v| -v),
            limit: Amount::zero(),
        });
    }
    let mut rates = from_fn(|_| Amount::one());
    loop {
        let previous = planes.len();
        for m in 0..3 {
            if face[m].is_zero() {
                continue;
            }
            let mut normal = zeros();
            normal[m] = face[m].clone();
            let mut limit = &base[m] + integer(budgets[m]);
            for (member, row) in rows.iter().enumerate() {
                if row.weights[m].is_zero() {
                    continue;
                }
                let (weight, offset) = match spill {
                    Some((debtor, first, second)) if debtor == member && second == m => {
                        (Amount::one(), -&row.remaining[first])
                    }
                    _ => (row.weights[m].clone(), Amount::zero()),
                };
                if dot(&row.claims, &rates) * &weight + &offset >= row.remaining[m] {
                    limit += &row.remaining[m];
                } else {
                    limit += offset;
                    for (coef, claim) in normal.iter_mut().zip(&row.claims) {
                        *coef -= claim * &weight;
                    }
                }
            }
            if dot(&normal, &rates) > limit {
                planes.push(Plane { normal, limit });
            }
        }
        if previous == planes.len() {
            return Some(rates);
        }
        rates = maximum(&planes)?;
    }
}
