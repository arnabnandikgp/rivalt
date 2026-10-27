//! Bounded unsigned scratch arithmetic for schema-3 exceptional clearing.
//!
//! Callers supply fixed storage: these routines allocate no heap memory and never
//! multiply two wide numbers. Each small multiplier has at most three limbs.
//! A failed operation may alter scratch; callers must not commit failed work.
use crate::{Error, Result};
use core::cmp::Ordering;

pub const LIMBS: usize = 96;
pub const BITS: usize = LIMBS * 64;
pub type Wide = [u64; LIMBS];

pub fn bits(value: &Wide) -> usize {
    for index in (0..LIMBS).rev() {
        if value[index] != 0 {
            return index * 64 + (64 - value[index].leading_zeros() as usize);
        }
    }
    0
}

pub fn compare(left: &Wide, right: &Wide) -> Ordering {
    for index in (0..LIMBS).rev() {
        let order = left[index].cmp(&right[index]);
        if order != Ordering::Equal {
            return order;
        }
    }
    Ordering::Equal
}

pub fn set_u128(output: &mut Wide, value: u128) {
    output.fill(0);
    output[0] = value as u64;
    output[1] = (value >> 64) as u64;
}

pub fn add_assign(output: &mut Wide, value: &Wide) -> Result<()> {
    let mut carry = 0u128;
    for index in 0..LIMBS {
        let sum = u128::from(output[index]) + u128::from(value[index]) + carry;
        output[index] = sum as u64;
        carry = sum >> 64;
    }
    if carry != 0 {
        return Err(Error::Overflow);
    }
    Ok(())
}

pub fn subtract_assign(output: &mut Wide, value: &Wide) -> Result<()> {
    if compare(output, value) == Ordering::Less {
        return Err(Error::Bounds);
    }
    let mut borrow = false;
    for index in 0..LIMBS {
        let (difference, first) = output[index].overflowing_sub(value[index]);
        let (difference, second) = difference.overflowing_sub(u64::from(borrow));
        output[index] = difference;
        borrow = first || second;
    }
    debug_assert!(!borrow);
    Ok(())
}

/// Checked schoolbook wide-by-small product. The output cannot alias the input.
#[inline(never)]
pub fn multiply(output: &mut Wide, value: &Wide, factor: &[u64]) -> Result<()> {
    if factor.is_empty() || factor.len() > 3 {
        return Err(Error::Bounds);
    }
    output.fill(0);
    for (shift, multiplier) in factor.iter().copied().enumerate() {
        let mut carry = 0u128;
        for (index, word) in value.iter().copied().enumerate() {
            let destination = index + shift;
            if destination >= LIMBS {
                if word != 0 && multiplier != 0 || carry != 0 {
                    return Err(Error::Overflow);
                }
                continue;
            }
            // (2^64-1)^2 + two carries is at most 2^128-1.
            let product =
                u128::from(word) * u128::from(multiplier) + u128::from(output[destination]) + carry;
            output[destination] = product as u64;
            carry = product >> 64;
        }
        if carry != 0 {
            return Err(Error::Overflow);
        }
    }
    Ok(())
}

#[inline(never)]
pub fn multiply_assign(value: &mut Wide, factor: &[u64]) -> Result<()> {
    let mut product = [0; LIMBS];
    multiply(&mut product, value, factor)?;
    value.copy_from_slice(&product);
    Ok(())
}

pub fn limbs_u128(value: u128) -> [u64; 2] {
    [value as u64, (value >> 64) as u64]
}

/// Exact L / total-debt work. Each divisor is strictly below 2^88 by D60.
/// At most 6,144 bit steps, with a bounded u128 remainder throughout.
#[inline(never)]
pub fn divide_small(quotient: &mut Wide, value: &Wide, divisor: u128) -> Result<u128> {
    if divisor == 0 || divisor >= 1u128 << 88 {
        return Err(Error::Bounds);
    }
    quotient.fill(0);
    let mut remainder = 0u128;
    for bit in (0..bits(value)).rev() {
        remainder = (remainder << 1) | u128::from((value[bit / 64] >> (bit % 64)) & 1);
        if remainder >= divisor {
            remainder -= divisor;
            quotient[bit / 64] |= 1u64 << (bit % 64);
        }
    }
    Ok(remainder)
}

#[inline(never)]
fn shift_into(output: &mut Wide, value: &Wide, shift: usize) -> Result<()> {
    if bits(value) + shift > BITS {
        return Err(Error::Overflow);
    }
    output.fill(0);
    let words = shift / 64;
    let remaining = shift % 64;
    for index in words..LIMBS {
        output[index] = value[index - words] << remaining;
        if remaining != 0 && index > words {
            output[index] |= value[index - words - 1] >> (64 - remaining);
        }
    }
    Ok(())
}

/// Whole cash/flow quotient, strictly below 2^58. Never general wide division.
/// The fixed 58-step schedule preserves the exact remainder for atom allocation.
#[inline(never)]
pub fn divide_atoms(remainder: &mut Wide, value: &Wide, divisor: &Wide) -> Result<u64> {
    let denominator_bits = bits(divisor);
    if denominator_bits == 0 {
        return Err(Error::Bounds);
    }
    let mut shifted = [0; LIMBS];
    if denominator_bits + 58 <= BITS {
        shift_into(&mut shifted, divisor, 58)?;
        if compare(value, &shifted) != Ordering::Less {
            return Err(Error::Bounds);
        }
    }
    remainder.copy_from_slice(value);
    let mut quotient = 0u64;
    for shift in (0..58).rev() {
        if denominator_bits + shift > BITS {
            continue;
        }
        shift_into(&mut shifted, divisor, shift)?;
        if compare(remainder, &shifted) != Ordering::Less {
            subtract_assign(remainder, &shifted)?;
            quotient |= 1u64 << shift;
        }
    }
    debug_assert!(compare(remainder, divisor) == Ordering::Less);
    Ok(quotient)
}

/// A product of the <=93-bit slope/positive totals fits exactly three limbs.
pub fn product_small(left: u128, right: u128) -> Result<[u64; 3]> {
    if left >= 1u128 << 93 || right >= 1u128 << 93 {
        return Err(Error::Bounds);
    }
    let mut product = [0u64; 4];
    for (left_index, left_word) in limbs_u128(left).into_iter().enumerate() {
        let mut carry = 0u128;
        for (right_index, right_word) in limbs_u128(right).into_iter().enumerate() {
            let index = left_index + right_index;
            let sum =
                u128::from(left_word) * u128::from(right_word) + u128::from(product[index]) + carry;
            product[index] = sum as u64;
            carry = sum >> 64;
        }
        product[left_index + 2] = carry as u64;
    }
    if product[3] != 0 || product[2] >> 58 != 0 {
        return Err(Error::Overflow);
    }
    Ok([product[0], product[1], product[2]])
}
