//! Constant-space valuation totals for a complete authenticated frozen cohort.
//! The program supplies whole-account accrued claims, canonical root identity and
//! immutable freeze bindings. This arithmetic cannot authenticate an account.
use crate::{clearing::row::Row, Error, Result, MAX_CASH, MAX_GROSS_LOTS, MAX_LOTS, SCALE};

pub const CHECKPOINT_BYTES: usize = 288;

/// Unsigned aggregate <2^151: u64 participants times a per-root claim <2^87.
/// Three words suffice for totals; products/rate factors use separate five-word
/// arithmetic. No u128 population sum or sign cancellation before validation.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ClaimTotal([u64; 3]);
impl ClaimTotal {
    pub fn words(self) -> [u64; 3] {
        self.0
    }
    pub fn from_words(words: [u64; 3]) -> Result<Self> {
        if words[2] >= 1 << 23 {
            return Err(Error::Bounds);
        }
        Ok(Self(words))
    }
    pub fn add(self, other: Self) -> Result<Self> {
        let mut result = [0; 3];
        let mut carry = 0u128;
        for (index, word) in result.iter_mut().enumerate() {
            let value = u128::from(self.0[index]) + u128::from(other.0[index]) + carry;
            *word = value as u64;
            carry = value >> 64;
        }
        if carry != 0 {
            return Err(Error::Overflow);
        }
        Self::from_words(result)
    }
    fn scalar(value: u128) -> Self {
        Self([value as u64, (value >> 64) as u64, 0])
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SnapshotBinding {
    pub count: u64,
    pub allocated: u64,
    pub pools: [u64; 2],
    pub insurance: [u64; 2],
    pub fees: [u64; 2],
    pub gross: [u64; 2],
}

#[derive(Clone, Debug)]
pub struct SnapshotScan {
    binding: SnapshotBinding,
    processed: u64,
    last_id: u64,
    expected_cash: u64,
    cash: u64,
    gross: [u64; 2],
    lots: [i128; 2],
    positive: [ClaimTotal; 2],
    negative: [ClaimTotal; 2],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SnapshotTotals {
    pub cash: u64,
    pub positive: [ClaimTotal; 2],
    pub negative: [ClaimTotal; 2],
}
impl SnapshotScan {
    pub fn new(binding: SnapshotBinding) -> Result<Self> {
        if binding.count == 0
            || binding.allocated > MAX_CASH
            || binding.gross.iter().any(|value| *value > MAX_GROSS_LOTS)
        {
            return Err(Error::Bounds);
        }
        let mut expected_cash = binding.allocated;
        for bucket in binding
            .pools
            .into_iter()
            .chain(binding.insurance)
            .chain(binding.fees)
        {
            expected_cash = expected_cash.checked_sub(bucket).ok_or(Error::Cohort)?;
        }
        Ok(Self {
            binding,
            processed: 0,
            last_id: 0,
            expected_cash,
            cash: 0,
            gross: [0; 2],
            lots: [0; 2],
            positive: [ClaimTotal::default(); 2],
            negative: [ClaimTotal::default(); 2],
        })
    }
    pub fn next(&self) -> Result<u64> {
        if self.processed == self.binding.count {
            return Err(Error::Bounds);
        }
        Ok(self.processed)
    }
    pub fn accept(
        &mut self,
        ordinal: u64,
        member_id: u64,
        row: &Row,
        lots: [i64; 2],
    ) -> Result<()> {
        if ordinal != self.next()?
            || (ordinal != 0 && member_id <= self.last_id)
            || lots
                .iter()
                .any(|value| value.unsigned_abs() > MAX_LOTS as u64)
        {
            return Err(Error::Bounds);
        }
        row.validate()?;
        // Commit no scalar prefix on error, including a final conservation error.
        let mut candidate = self.clone();
        candidate.cash = candidate
            .cash
            .checked_add(row.cash)
            .ok_or(Error::Overflow)?;
        if candidate.cash > self.expected_cash {
            return Err(Error::Cohort);
        }
        for market in 0..2 {
            candidate.gross[market] = candidate.gross[market]
                .checked_add(lots[market].unsigned_abs())
                .ok_or(Error::Overflow)?;
            if candidate.gross[market] > self.binding.gross[market] {
                return Err(Error::Cohort);
            }
            candidate.lots[market] = candidate.lots[market]
                .checked_add(i128::from(lots[market]))
                .ok_or(Error::Overflow)?;
            let target = if row.claims[market] >= 0 {
                &mut candidate.positive
            } else {
                &mut candidate.negative
            };
            target[market] =
                target[market].add(ClaimTotal::scalar(row.claims[market].unsigned_abs()))?;
        }
        candidate.processed += 1; // next() proved processed < count <= u64::MAX
        candidate.last_id = member_id;
        if candidate.processed == self.binding.count {
            candidate.result()?;
        }
        *self = candidate;
        Ok(())
    }
    pub fn result(&self) -> Result<SnapshotTotals> {
        if self.processed != self.binding.count
            || self.cash != self.expected_cash
            || self.gross != self.binding.gross
            || self.lots != [0; 2]
        {
            return Err(Error::Cohort);
        }
        for market in 0..2 {
            let pool = ClaimTotal::scalar(u128::from(self.binding.pools[market]) * SCALE as u128);
            if self.positive[market] != self.negative[market].add(pool)? {
                return Err(Error::Cohort);
            }
        }
        Ok(SnapshotTotals {
            cash: self.cash,
            positive: self.positive,
            negative: self.negative,
        })
    }
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[0] = 1;
        let scalars = [
            self.binding.count,
            self.processed,
            self.last_id,
            self.cash,
            self.expected_cash,
            self.binding.allocated,
            self.binding.gross[0],
            self.binding.gross[1],
            self.gross[0],
            self.gross[1],
        ];
        for (index, scalar) in scalars.into_iter().enumerate() {
            bytes[8 + index * 8..16 + index * 8].copy_from_slice(&scalar.to_le_bytes());
        }
        for (market, lots) in self.lots.into_iter().enumerate() {
            bytes[88 + market * 16..104 + market * 16].copy_from_slice(&lots.to_le_bytes());
        }
        for (index, value) in self
            .binding
            .pools
            .into_iter()
            .chain(self.binding.insurance)
            .chain(self.binding.fees)
            .enumerate()
        {
            bytes[120 + index * 8..128 + index * 8].copy_from_slice(&value.to_le_bytes());
        }
        for (index, total) in self.positive.into_iter().chain(self.negative).enumerate() {
            for (word, value) in total.0.into_iter().enumerate() {
                let offset = 168 + index * 24 + word * 8;
                bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
            }
        }
        bytes
    }
    /// Only authenticated program-owned bytes can establish historical progress.
    pub fn from_checkpoint(bytes: &[u8], binding: SnapshotBinding) -> Result<Self> {
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || bytes[1..8]
                .iter()
                .chain(&bytes[264..])
                .any(|byte| *byte != 0)
        {
            return Err(Error::Bounds);
        }
        let read = |offset| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        let mut scan = Self::new(binding)?;
        if read(8) != binding.count
            || read(40) != scan.expected_cash
            || read(48) != binding.allocated
            || [read(56), read(64)] != binding.gross
            || [read(120), read(128)] != binding.pools
            || [read(136), read(144)] != binding.insurance
            || [read(152), read(160)] != binding.fees
        {
            return Err(Error::Bounds);
        }
        scan.processed = read(16);
        scan.last_id = read(24);
        scan.cash = read(32);
        scan.gross = [read(72), read(80)];
        scan.lots = core::array::from_fn(|market| {
            i128::from_le_bytes(
                bytes[88 + market * 16..104 + market * 16]
                    .try_into()
                    .unwrap(),
            )
        });
        for (index, total) in scan
            .positive
            .iter_mut()
            .chain(scan.negative.iter_mut())
            .enumerate()
        {
            *total = ClaimTotal::from_words(core::array::from_fn(|word| {
                read(168 + index * 24 + word * 8)
            }))?;
        }
        if scan.processed > binding.count
            || scan.cash > scan.expected_cash
            || (0..2).any(|market| {
                scan.gross[market] > binding.gross[market]
                    || scan.lots[market].unsigned_abs() > u128::from(scan.gross[market])
            })
        {
            return Err(Error::Bounds);
        }
        if scan.processed == 0 && scan.checkpoint() != Self::new(binding)?.checkpoint() {
            return Err(Error::Bounds);
        }
        if scan.processed == binding.count {
            scan.result()?;
        }
        Ok(scan)
    }
}
