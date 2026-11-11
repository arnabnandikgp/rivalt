//! Maintained ordinary-payment arithmetic. This module grants no payment authority.
//!
//! The caller authenticates complete Financial membership and each processed root,
//! maintains every economic mutation atomically, and separately admits current
//! oracle/held funding, safety/terms, available pool and recipient health. Region
//! membership is an arithmetic fact, never source freshness or margin credit.
use crate::{clearing::scalable::snapshot::ClaimTotal, margin::Margin, Error, Result,
    MAX_CASH, MAX_FUNDING, MAX_LOTS, MAX_PRICE, MAX_SCALED};

/// |v + q*checkpoint| < 2^87. At most u64::MAX contributors sum to < 2^151.
pub const MAX_FIXED: u128 = MAX_SCALED as u128 + MAX_LOTS as u128 * MAX_FUNDING as u128;
pub const CHECKPOINT_BYTES: usize = 104;
const CHECKPOINT_DOMAIN: &[u8; 8] = b"RVBACK01";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MarketRegion {
    pub price_low: u64,
    pub price_high: u64,
    pub funding_low: i128,
    pub funding_high: i128,
}
impl MarketRegion {
    fn validate(&self) -> Result<()> {
        if self.price_low == 0 || self.price_low > self.price_high || self.price_high > MAX_PRICE
            || self.funding_low > self.funding_high
            || self.funding_low.unsigned_abs() > MAX_FUNDING as u128
            || self.funding_high.unsigned_abs() > MAX_FUNDING as u128 {
            return Err(Error::Bounds);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Region {
    pub markets: [MarketRegion; 2],
}
impl Region {
    pub fn validate(&self) -> Result<()> {
        for market in self.markets { market.validate()?; }
        Ok(())
    }

    /// Cover all supplied current risk prices and held funding endpoints for
    /// each required market. Callers must authenticate the mask and those inputs.
    pub fn contains(&self, required: u8, prices: [[u64; 2]; 2], funding: [[i128; 2]; 2]) -> Result<bool> {
        self.validate()?;
        if required > 3 { return Err(Error::Bounds); }
        let mut inside = true;
        for index in 0..2 {
            if required & (1 << index) == 0 { continue; }
            let range = self.markets[index];
            let [price_low, price_high] = prices[index];
            let [funding_low, funding_high] = funding[index];
            if price_low == 0 || price_low > price_high || price_high > MAX_PRICE
                || funding_low > funding_high
                || funding_low.unsigned_abs() > MAX_FUNDING as u128
                || funding_high.unsigned_abs() > MAX_FUNDING as u128 {
                return Err(Error::Bounds);
            }
            inside &= range.price_low <= price_low && price_high <= range.price_high
                && range.funding_low <= funding_low && funding_high <= range.funding_high;
        }
        Ok(inside)
    }

    pub fn contribution(&self, root: &Margin, selected: usize) -> Result<Contribution> {
        self.validate()?;
        root.validate()?;
        if selected >= 2 { return Err(Error::Bounds); }
        let mut fixed = [0i128; 2];
        let mut minimum = [0i128; 2];
        for index in 0..2 {
            let position = root.positions[index];
            let quantity = i128::from(position.lots);
            fixed[index] = crate::add(position.virtual_scaled,
                crate::mul(quantity, position.funding_checkpoint)?)?;
            let range = self.markets[index];
            let (price, funding) = if quantity >= 0 {
                (range.price_low, range.funding_high)
            } else {
                (range.price_high, range.funding_low)
            };
            minimum[index] = crate::add(fixed[index], crate::mul(quantity,
                crate::sub(crate::scaled(price)?, funding)?)?)?;
        }
        let gross_debt = minimum.into_iter().try_fold(0i128, |sum, claim|
            crate::add(sum, crate::sub(0, claim.min(0))?))?;
        let may_owe = minimum[selected] < 0;
        let mut required = 0;
        for index in 0..2 {
            if root.positions[index].lots != 0 && (index == selected || may_owe) {
                required |= 1 << index;
            }
        }
        Ok(Contribution { quantity: root.positions[selected].lots, fixed: fixed[selected],
            bad: may_owe && crate::scaled(root.cash)? < gross_debt, required })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Contribution {
    pub quantity: i64,
    pub fixed: i128,
    pub bad: bool,
    pub required: u8,
}
impl Contribution {
    fn validate(&self) -> Result<()> {
        if self.quantity.unsigned_abs() > MAX_LOTS as u64
            || self.fixed.unsigned_abs() > MAX_FIXED || self.required > 3 {
            return Err(Error::Bounds);
        }
        Ok(())
    }
}

/// Constant-size summary. No bitmap/count here proves membership by itself.
/// Private fields and checked decoding protect arithmetic, not account authority.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Summary {
    count: u64,
    bad: u64,
    quantity: i128,
    positive: ClaimTotal,
    negative: ClaimTotal,
    required: [u64; 2],
}
impl Summary {
    pub fn count(&self) -> u64 { self.count }
    pub fn bad(&self) -> u64 { self.bad }
    pub fn required_mask(&self) -> u8 {
        u8::from(self.required[0] != 0) | (u8::from(self.required[1] != 0) << 1)
    }
    fn validate(&self) -> Result<()> {
        let bound = product(MAX_FIXED, self.count)?;
        if self.bad > self.count || self.required.iter().any(|count| *count > self.count)
            || self.quantity.unsigned_abs() > u128::from(self.count) * MAX_LOTS as u128
            || compare(self.positive.add(self.negative)?, bound).is_gt() {
            return Err(Error::Bounds);
        }
        Ok(())
    }
    /// Return a candidate; failure cannot leave a partially changed summary.
    pub fn insert(self, contribution: Contribution) -> Result<Self> {
        self.validate()?;
        let mut candidate = self;
        candidate.adjust(contribution, true)?;
        candidate.validate()?;
        Ok(candidate)
    }
    /// Only a caller-authenticated processed contribution may be removed.
    pub fn remove(self, contribution: Contribution) -> Result<Self> {
        self.validate()?;
        let mut candidate = self;
        candidate.adjust(contribution, false)?;
        candidate.validate()?;
        Ok(candidate)
    }
    /// The runtime must commit this candidate in the same instruction as the
    /// root's economic mutation. It must not trust caller-supplied old values.
    pub fn replace(self, before: Contribution, after: Contribution) -> Result<Self> {
        self.validate()?;
        let mut candidate = self;
        candidate.adjust(before, false)?;
        candidate.adjust(after, true)?;
        candidate.validate()?;
        Ok(candidate)
    }
    fn adjust(&mut self, contribution: Contribution, add: bool) -> Result<()> {
        contribution.validate()?;
        let count_change = |count: u64, change: u64| if add {
            count.checked_add(change).ok_or(Error::Overflow)
        } else { count.checked_sub(change).ok_or(Error::Cohort) };
        self.count = count_change(self.count, 1)?;
        self.bad = count_change(self.bad, u64::from(contribution.bad))?;
        for index in 0..2 {
            self.required[index] = count_change(self.required[index],
                u64::from(contribution.required & (1 << index) != 0))?;
        }
        self.quantity = if add { crate::add(self.quantity, i128::from(contribution.quantity))? }
            else { crate::sub(self.quantity, i128::from(contribution.quantity))? };
        let total = if contribution.fixed >= 0 { &mut self.positive } else { &mut self.negative };
        let magnitude = scalar(contribution.fixed.unsigned_abs())?;
        *total = if add { total.add(magnitude)? } else { subtract(*total, magnitude)? };
        Ok(())
    }
    /// ONLY the arithmetic half of eligibility. The program must also prove
    /// complete canonical coverage, fresh sources/held endpoints, epochs, pool
    /// availability, recipient health and all existing signed authority rules.
    pub fn arithmetically_ready(&self, expected_count: u64, pool: u64) -> Result<bool> {
        self.validate()?;
        if expected_count == 0 || pool > MAX_CASH { return Err(Error::Bounds); }
        Ok(self.count == expected_count && self.bad == 0 && self.quantity == 0
            && self.positive == self.negative.add(scalar(crate::scaled(pool)? as u128)?)?)
    }
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[..8].copy_from_slice(CHECKPOINT_DOMAIN);
        bytes[8..16].copy_from_slice(&self.count.to_le_bytes());
        bytes[16..24].copy_from_slice(&self.bad.to_le_bytes());
        bytes[24..40].copy_from_slice(&self.quantity.to_le_bytes());
        for (offset, total) in [(40, self.positive), (64, self.negative)] {
            for (index, word) in total.words().iter().enumerate() {
                bytes[offset + index * 8..offset + (index + 1) * 8].copy_from_slice(&word.to_le_bytes());
            }
        }
        bytes[88..96].copy_from_slice(&self.required[0].to_le_bytes());
        bytes[96..104].copy_from_slice(&self.required[1].to_le_bytes());
        bytes
    }
    pub fn from_checkpoint(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != CHECKPOINT_BYTES || &bytes[..8] != CHECKPOINT_DOMAIN { return Err(Error::Bounds); }
        let word = |offset| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        let total = |offset| ClaimTotal::from_words([word(offset), word(offset + 8), word(offset + 16)]);
        let summary = Self { count: word(8), bad: word(16),
            quantity: i128::from_le_bytes(bytes[24..40].try_into().unwrap()),
            positive: total(40)?, negative: total(64)?, required: [word(88), word(96)] };
        summary.validate()?;
        Ok(summary)
    }
}

fn scalar(value: u128) -> Result<ClaimTotal> {
    ClaimTotal::from_words([value as u64, (value >> 64) as u64, 0])
}
fn compare(left: ClaimTotal, right: ClaimTotal) -> core::cmp::Ordering {
    left.words().iter().rev().cmp(right.words().iter().rev())
}
fn subtract(left: ClaimTotal, right: ClaimTotal) -> Result<ClaimTotal> {
    let mut words = left.words();
    let mut borrow = false;
    for (index, word) in words.iter_mut().enumerate() {
        let (difference, first) = word.overflowing_sub(right.words()[index]);
        let (difference, second) = difference.overflowing_sub(u64::from(borrow));
        *word = difference;
        borrow = first || second;
    }
    if borrow { return Err(Error::Cohort); }
    ClaimTotal::from_words(words)
}
fn product(value: u128, count: u64) -> Result<ClaimTotal> {
    let mut words = [0; 3];
    let mut carry = 0u128;
    for (index, word) in [value as u64, (value >> 64) as u64].into_iter().enumerate() {
        let result = u128::from(word) * u128::from(count) + carry;
        words[index] = result as u64;
        carry = result >> 64;
    }
    words[2] = carry as u64;
    ClaimTotal::from_words(words)
}
