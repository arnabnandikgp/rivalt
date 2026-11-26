//! Find the greatest recovery rates without seeding a cashless cycle with tokens.
//! Each capped debtor flow is the minimum of two affine functions. Every upper
//! supporting plane of the capacity map bounds all post-fixed rates. Add a
//! violated plane, then maximize the sum of the three rates on the remaining
//! polytope. There are finitely many distinct planes; no epsilon or retry limit.
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

fn maximum(planes: &[Plane]) -> Result<Amounts> {
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
    best.ok_or(Error::Invariant)
}

pub(super) fn greatest(
    rows: &[Prepared],
    face: &Amounts,
    base: &Amounts,
    budgets: [u64; 3],
) -> Result<Amounts> {
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
            for row in rows.iter().filter(|r| !r.weights[m].is_zero()) {
                if dot(&row.claims, &rates) >= row.debt {
                    limit += &row.debt * &row.weights[m];
                } else {
                    for (coef, claim) in normal.iter_mut().zip(&row.claims) {
                        *coef -= claim * &row.weights[m];
                    }
                }
            }
            if dot(&normal, &rates) > limit {
                planes.push(Plane { normal, limit });
            }
        }
        if previous == planes.len() {
            return Ok(rates);
        }
        rates = maximum(&planes)?;
    }
}
