//! Reduced own-cash collections. These per-row scalar products fit three limbs;
//! population-wide sums/rate factors must use the successor wide primitives.
use crate::{
    clearing::{row::Row, wide::product_small},
    Error, Result, SCALE,
};

pub fn gcd(mut left: u128, mut right: u128) -> Result<u128> {
    if left >= 1u128 << 88 || right >= 1u128 << 88 {
        return Err(Error::Bounds);
    }
    // Euclid on <88-bit operands takes fewer than 176 divisions.
    for _ in 0..176 {
        if right == 0 {
            return Ok(left);
        }
        (left, right) = (right, left % right);
    }
    Err(Error::Invariant)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReducedCollection {
    pub collected: u64,
    /// Both collection numerators use the SAME reduced denominator.
    pub denominator: u128,
    pub numerators: [[u64; 3]; 2],
}
impl ReducedCollection {
    pub fn for_row(row: &Row) -> Result<Self> {
        let collected = row.collected()?;
        let debts = row.debts();
        let scaled = u128::from(collected) * SCALE as u128;
        if collected == 0 || debts[0] == 0 || debts[1] == 0 {
            let whole = [scaled as u64, (scaled >> 64) as u64, 0];
            return Ok(Self {
                collected,
                denominator: 1,
                numerators: debts.map(|debt| if debt == 0 { [0; 3] } else { whole }),
            });
        }
        let total = debts[0] + debts[1];
        // Cancel before multiplying: scaled*debt can exceed u128. Only these
        // bounded factors use the retained scalar product helper, never totals
        // over the cohort (which can exceed that helper's 93-bit input domain).
        let common = gcd(total, scaled)?;
        let denominator = total / common;
        let remaining = gcd(denominator, debts[0])?;
        let denominator = denominator / remaining;
        let first = product_small(scaled / common, debts[0] / remaining)?;
        let mut second = product_small(scaled, denominator)?;
        let mut borrow = false;
        for index in 0..3 {
            let (difference, first_borrow) = second[index].overflowing_sub(first[index]);
            let (difference, second_borrow) = difference.overflowing_sub(u64::from(borrow));
            second[index] = difference;
            borrow = first_borrow || second_borrow;
        }
        if borrow {
            return Err(Error::Invariant);
        }
        Ok(Self {
            collected,
            denominator,
            numerators: [first, second],
        })
    }
}

/// Validate one authenticated original/effective row pair before using the
/// original debt proportions. The caller proves cohort identity and selection.
pub fn validate_reduction(before: &Row, after: &Row) -> Result<()> {
    after.validate()?;
    if before.cash != after.cash {
        return Err(Error::Cohort);
    }
    let allocation = ReducedCollection::for_row(before)?;
    for market in 0..2 {
        let from = before.claims[market];
        let to = after.claims[market];
        if (to != 0 && from.signum() != to.signum())
            || to.unsigned_abs() > from.unsigned_abs()
            || from.abs_diff(to) % SCALE as u128 != 0
        {
            return Err(Error::Cohort);
        }
        // Compare exact rationals before any whole-atom division. An
        // account cannot erase debt already assigned its funded cash.
        let face =
            crate::clearing::wide::product_small(to.min(0).unsigned_abs(), allocation.denominator)?;
        if allocation.numerators[market]
            .iter()
            .rev()
            .cmp(face.iter().rev())
            .is_gt()
        {
            return Err(Error::Cohort);
        }
    }
    Ok(())
}

/// Old work uses version one with an empty tail. Only a changed row needs
/// version two, which binds both original claim numerators through a restart.
pub(super) fn encode_basis(effective: Row, original: Row, tail: &mut [u8]) -> u8 {
    if effective == original {
        return 1;
    }
    for (target, claim) in tail.chunks_exact_mut(16).zip(original.claims) {
        target.copy_from_slice(&claim.to_le_bytes());
    }
    2
}

pub(super) fn decode_basis(version: u8, effective: Row, tail: &[u8]) -> Result<Row> {
    if tail.len() != 32 {
        return Err(Error::Bounds);
    }
    match version {
        1 if tail.iter().all(|byte| *byte == 0) => Ok(effective),
        2 => {
            let original = Row {
                cash: effective.cash,
                claims: [
                    i128::from_le_bytes(tail[..16].try_into().unwrap()),
                    i128::from_le_bytes(tail[16..].try_into().unwrap()),
                ],
            };
            if original == effective {
                return Err(Error::Bounds);
            }
            validate_reduction(&original, &effective)?;
            Ok(original)
        }
        _ => Err(Error::Bounds),
    }
}
