//! Complete-rate equation schedule over authenticated frozen rows and paged words.
//! Proposed numerators are untrusted. The owning controller authenticates the
//! common denominator, normalized input lengths, totals, epoch and insurance budget.
use super::{
    atom_division::AtomDivision,
    collection::ReducedCollection,
    comparison::CompareCursor,
    normalized::{Magnitude, NumberCursor},
    snapshot::ClaimTotal,
    wide::{required_limbs, LimbStorage, Operation, WordAccess},
};
use crate::{clearing::row::Row, Error, Result, MAX_CASH, SCALE};
use core::cmp::Ordering;

const REGISTERS: usize = 25;
const RATE_DENOMINATOR: u8 = 0;
const CASH_DENOMINATOR: u8 = 1;
const FIRST_RATE_BOUND: u8 = 2;
const SECOND_RATE_BOUND: u8 = 3;
const ROW: u8 = 4;
const ROW_BASE: u8 = 5;
const SELECT_DEBT: u8 = 6;
const OWN_COEFFICIENT: u8 = 7;
const OWN_COLLECTION: u8 = 8;
const SELECT_LINK: u8 = 9;
const LINK_RECOVERY: u8 = 10;
const LINK_CAPACITY: u8 = 11;
const COMPARE_LINK: u8 = 12;
const ROW_FLOW: u8 = 13;
const ACCUMULATE: u8 = 14;
const NEXT_DEBT: u8 = 15;
const GREATESTNESS: u8 = 16;
const OUTGOING: u8 = 17;
const BASE_CAPACITY: u8 = 18;
const TOTAL_CAPACITY: u8 = 19;
const FACE_VALUE: u8 = 20;
const SELECT_CAPACITY: u8 = 21;
const CHECK_EQUATION: u8 = 22;
const NET_OUTGOING: u8 = 23;
const FUNDED_POOL: u8 = 24;
const INSURANCE_USE: u8 = 25;
const GROSS_DEBT: u8 = 26;
const RESIDUAL: u8 = 27;
const CREDITOR_LOSS: u8 = 28;
const IMPAIRMENT: u8 = 29;
const CHECK_ATTRIBUTION: u8 = 30;
const INSURANCE_ATOMS: u8 = 31;
const NEXT_MARKET: u8 = 32;
const DONE: u8 = 33;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RateInput {
    pub count: u64,
    pub common: Magnitude,
    pub rate_lengths: [u64; 2],
    pub factor: [u64; 5],
    pub positive: [ClaimTotal; 2],
    pub negative: [ClaimTotal; 2],
    pub pools: [u64; 2],
    pub budgets: [u64; 2],
}
#[derive(Clone, Debug)]
enum Pending {
    Number(NumberCursor),
    Compare(CompareCursor),
    Atoms(AtomDivision),
}
#[derive(Clone, Copy, Debug)]
enum Task {
    Number(Operation, Magnitude, Magnitude, u32),
    Compare(Magnitude, Magnitude),
    Atoms(Magnitude, Magnitude),
}
#[derive(Clone, Debug)]
pub struct RateWork {
    input: RateInput,
    capacity: u64,
    stage: u8,
    market: usize,
    below: u8,
    incoming: u8,
    flow: u32,
    selected: u32,
    processed: u64,
    last_id: u64,
    row: Row,
    slopes: [ClaimTotal; 2],
    used: [u64; REGISTERS],
    spent: [u64; 2],
    fractional: [bool; 2],
    pending: Option<Pending>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RateResult {
    pub spent: [u64; 2],
    pub fractional: [bool; 2],
    pub residuals: [Magnitude; 2],
    pub losses: [Magnitude; 2],
}
/// Exact values exposed only after a complete integral insurance evaluation.
/// The program still authenticates the original-budget round history and pages.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VerifiedRateValues {
    pub(crate) count: u64,
    pub(crate) common: Magnitude,
    pub(crate) rates: [Magnitude; 2],
    pub(crate) rate_denominator: Magnitude,
    pub(crate) cash_denominator: Magnitude,
    pub(crate) factor: [u64; 5],
}
pub(super) fn factor(words: &[u64]) -> Operation {
    let mut values = [0; 5];
    values[..words.len()].copy_from_slice(words);
    let length = words
        .iter()
        .rposition(|word| *word != 0)
        .map_or(1, |index| index + 1) as u8;
    Operation::Multiply {
        factor: values,
        length,
    }
}
pub(super) fn scalar(value: u128) -> [u64; 2] {
    [value as u64, (value >> 64) as u64]
}
fn product(left: ClaimTotal, right: ClaimTotal) -> Result<[u64; 6]> {
    let mut words = [0u64; 6];
    for (column, second) in right.words().into_iter().enumerate() {
        let mut carry = 0u128;
        for (index, first) in left.words().into_iter().enumerate() {
            let value =
                u128::from(first) * u128::from(second) + u128::from(words[column + index]) + carry;
            words[column + index] = value as u64;
            carry = value >> 64;
        }
        words[column + 3] = u64::try_from(carry).map_err(|_| Error::Overflow)?;
    }
    if words[5] != 0 || words[4] >= 1 << 46 {
        return Err(Error::Bounds);
    }
    Ok(words)
}
impl RateWork {
    pub fn new(input: RateInput) -> Result<Self> {
        let capacity = required_limbs(input.count)?;
        let factor_bits = input
            .factor
            .iter()
            .rposition(|word| *word != 0)
            .map_or(0, |index| {
                index as u64 * 64 + u64::from(64 - input.factor[index].leading_zeros())
            });
        let aggregate_bits = 87 + u64::from(64 - (input.count - 1).leading_zeros());
        if input.common.register > 1
            || input.common.used == 0
            || input.common.used > capacity
            || input.rate_lengths.iter().any(|used| *used > capacity)
            || factor_bits == 0
            || factor_bits > 2 * aggregate_bits
            || input
                .pools
                .into_iter()
                .chain(input.budgets)
                .any(|cash| cash > MAX_CASH)
        {
            return Err(Error::Bounds);
        }
        for market in 0..2 {
            let pool = u128::from(input.pools[market]) * SCALE as u128;
            let expected = input.negative[market].add(ClaimTotal::from_words([
                pool as u64,
                (pool >> 64) as u64,
                0,
            ])?)?;
            if expected != input.positive[market]
                || input.pools[market]
                    .checked_add(input.budgets[market])
                    .ok_or(Error::Overflow)?
                    > MAX_CASH
            {
                return Err(Error::Cohort);
            }
        }
        let mut used = [0; REGISTERS];
        used[input.common.register as usize] = input.common.used;
        used[3] = input.rate_lengths[0];
        used[4] = input.rate_lengths[1];
        let mut work = Self {
            input,
            capacity,
            stage: RATE_DENOMINATOR,
            market: 0,
            below: 0,
            incoming: 0,
            flow: 11,
            selected: 0,
            processed: 0,
            last_id: 0,
            row: Row::default(),
            slopes: [ClaimTotal::default(); 2],
            used,
            spent: [0; 2],
            fractional: [false; 2],
            pending: None,
        };
        work.prepare()?;
        Ok(work)
    }
    fn value(&self, register: u32) -> Magnitude {
        Magnitude {
            register,
            used: self.used[register as usize],
        }
    }
    fn incoming_register(&self) -> u32 {
        if self.incoming & (1 << self.market) == 0 {
            7 + self.market as u32
        } else {
            15 + self.market as u32
        }
    }
    fn incoming_output(&self) -> u32 {
        if self.incoming & (1 << self.market) == 0 {
            15 + self.market as u32
        } else {
            7 + self.market as u32
        }
    }
    fn multiply(&self, left: u32, words: &[u64], output: u32) -> Task {
        Task::Number(
            factor(words),
            self.value(left),
            Magnitude {
                register: 2,
                used: 0,
            },
            output,
        )
    }
    fn binary(&self, operation: Operation, left: u32, right: u32, output: u32) -> Task {
        Task::Number(operation, self.value(left), self.value(right), output)
    }
    fn task(&self) -> Result<Option<Task>> {
        let market = self.market;
        let incoming = self.incoming_register();
        let task = match self.stage {
            RATE_DENOMINATOR => self.multiply(self.input.common.register, &self.input.factor, 5),
            CASH_DENOMINATOR => self.multiply(5, &[SCALE as u64], 6),
            FIRST_RATE_BOUND | SECOND_RATE_BOUND => Task::Compare(
                self.value(3 + u32::from(self.stage - FIRST_RATE_BOUND)),
                self.value(5),
            ),
            ROW_BASE => Task::Number(
                Operation::Divide {
                    divisor: ReducedCollection::for_row(&self.row)?.denominator,
                },
                self.input.common,
                Magnitude {
                    register: 2,
                    used: 0,
                },
                9,
            ),
            OWN_COEFFICIENT => self.multiply(
                9,
                &ReducedCollection::for_row(&self.row)?.numerators[market],
                10,
            ),
            OWN_COLLECTION => self.multiply(10, &self.input.factor, 11),
            LINK_RECOVERY => self.multiply(
                3 + (1 - market) as u32,
                &scalar(self.row.claims[1 - market] as u128),
                12,
            ),
            LINK_CAPACITY => {
                let residual = self.row.claims[market]
                    .unsigned_abs()
                    .checked_sub(u128::from(self.row.collected()?) * SCALE as u128)
                    .ok_or(Error::Invariant)?;
                self.multiply(5, &scalar(residual), 13)
            }
            COMPARE_LINK => Task::Compare(self.value(12), self.value(13)),
            ROW_FLOW => self.binary(Operation::Add, 11, self.selected, 14),
            ACCUMULATE => self.binary(Operation::Add, incoming, self.flow, self.incoming_output()),
            OUTGOING => self.multiply(3 + market as u32, &self.input.positive[market].words(), 9),
            BASE_CAPACITY => self.multiply(
                6,
                &[self.input.pools[market] + self.input.budgets[market]],
                10,
            ),
            TOTAL_CAPACITY => self.binary(Operation::Add, 10, incoming, 11),
            FACE_VALUE => self.multiply(5, &self.input.positive[market].words(), 12),
            SELECT_CAPACITY => Task::Compare(self.value(11), self.value(12)),
            CHECK_EQUATION => Task::Compare(self.value(9), self.value(self.selected)),
            NET_OUTGOING => self.binary(Operation::Subtract, 9, incoming, 13),
            FUNDED_POOL => self.multiply(6, &[self.input.pools[market]], 14),
            INSURANCE_USE => self.binary(Operation::Subtract, 13, 14, 17),
            GROSS_DEBT => self.multiply(5, &self.input.negative[market].words(), 18),
            RESIDUAL => self.binary(Operation::Subtract, 18, incoming, 19 + market as u32),
            CREDITOR_LOSS => self.binary(
                Operation::Subtract,
                19 + market as u32,
                17,
                21 + market as u32,
            ),
            IMPAIRMENT => self.binary(Operation::Subtract, 12, 9, 10),
            CHECK_ATTRIBUTION => Task::Compare(self.value(10), self.value(21 + market as u32)),
            INSURANCE_ATOMS => Task::Atoms(self.value(17), self.value(6)),
            _ => return Ok(None),
        };
        Ok(Some(task))
    }
    fn compared(&mut self, order: Ordering) -> Result<()> {
        match self.stage {
            FIRST_RATE_BOUND | SECOND_RATE_BOUND => {
                let market = usize::from(self.stage - FIRST_RATE_BOUND);
                if order == Ordering::Greater
                    || (self.input.positive[market] == ClaimTotal::default()
                        && order != Ordering::Equal)
                {
                    return Err(Error::Invariant);
                }
                if order == Ordering::Less {
                    self.below |= 1 << market;
                }
            }
            COMPARE_LINK => {
                self.selected = if order == Ordering::Less { 12 } else { 13 };
                if order == Ordering::Less {
                    let claim = self.row.claims[1 - self.market] as u128;
                    self.slopes[self.market] =
                        self.slopes[self.market].add(ClaimTotal::from_words([
                            claim as u64,
                            (claim >> 64) as u64,
                            0,
                        ])?)?;
                }
            }
            SELECT_CAPACITY => self.selected = if order == Ordering::Less { 11 } else { 12 },
            CHECK_EQUATION | CHECK_ATTRIBUTION => {
                if order != Ordering::Equal {
                    return Err(Error::Invariant);
                }
            }
            _ => return Err(Error::Invariant),
        }
        self.stage += 1;
        Ok(())
    }
    /// Resolve scalar branches before exposing the next I/O request. The bound
    /// follows the 34-stage, two-market schedule; it is not a population limit.
    fn prepare(&mut self) -> Result<()> {
        for _ in 0..2 * (usize::from(DONE) + 1) {
            if self.pending.is_some() || self.stage == DONE {
                return Ok(());
            }
            if let Some(task) = self.task()? {
                self.pending = Some(match task {
                    Task::Number(operation, left, right, output) => Pending::Number(
                        NumberCursor::new(operation, left, right, output, self.capacity)?,
                    ),
                    Task::Atoms(numerator, denominator) => Pending::Atoms(AtomDivision::new(
                        numerator,
                        denominator,
                        [23, 24],
                        self.capacity,
                    )?),
                    Task::Compare(left, right) => {
                        if left.used != right.used || left.used == 0 {
                            self.compared(left.used.cmp(&right.used))?;
                            continue;
                        }
                        Pending::Compare(CompareCursor::new(
                            left.used,
                            left.register,
                            right.register,
                        )?)
                    }
                });
                return Ok(());
            }
            match self.stage {
                ROW => {
                    if self.processed < self.input.count {
                        return Ok(());
                    }
                    self.stage = GREATESTNESS;
                }
                SELECT_DEBT => {
                    if self.market == 2 {
                        self.processed = self.processed.checked_add(1).ok_or(Error::Overflow)?;
                        self.stage = ROW;
                        self.market = 0;
                        self.row = Row::default();
                    } else if self.row.claims[self.market] >= 0 {
                        self.market += 1;
                    } else if self.row.collected()? == 0 {
                        self.used[11] = 0;
                        self.stage = SELECT_LINK;
                    } else {
                        self.stage = OWN_COEFFICIENT;
                    }
                }
                SELECT_LINK => {
                    if self.row.claims[1 - self.market] > 0 {
                        self.stage = LINK_RECOVERY;
                    } else {
                        self.flow = 11;
                        self.stage = ACCUMULATE;
                    }
                }
                NEXT_DEBT => {
                    self.market += 1;
                    self.stage = SELECT_DEBT;
                }
                GREATESTNESS => {
                    if self.below == 3 {
                        let linked = product(self.slopes[0], self.slopes[1])?;
                        let total = product(self.input.positive[0], self.input.positive[1])?;
                        if linked.iter().rev().cmp(total.iter().rev()) != Ordering::Less {
                            return Err(Error::Invariant);
                        }
                    }
                    self.market = 0;
                    self.stage = OUTGOING;
                }
                NEXT_MARKET => {
                    self.market += 1;
                    if self.market == 2 {
                        self.market = 0;
                        self.stage = DONE;
                    } else {
                        self.stage = OUTGOING;
                    }
                }
                _ => return Err(Error::Invariant),
            }
        }
        Err(Error::Invariant)
    }
    pub fn row_index(&self) -> Result<u64> {
        if self.stage != ROW || self.processed >= self.input.count || self.pending.is_some() {
            return Err(Error::Bounds);
        }
        Ok(self.processed)
    }
    pub fn accept(&mut self, ordinal: u64, id: u64, row: Row) -> Result<()> {
        if ordinal != self.row_index()? || (ordinal != 0 && id <= self.last_id) {
            return Err(Error::Bounds);
        }
        row.validate()?;
        self.row = row;
        self.last_id = id;
        self.market = 0;
        self.stage = if row.collected()? == 0 {
            SELECT_DEBT
        } else {
            ROW_BASE
        };
        self.prepare()
    }
    pub fn is_done(&self) -> bool {
        self.stage == DONE
    }
    pub fn result(&self) -> Result<RateResult> {
        if !self.is_done() {
            return Err(Error::Bounds);
        }
        Ok(RateResult {
            spent: self.spent,
            fractional: self.fractional,
            residuals: [self.value(19), self.value(20)],
            losses: [self.value(21), self.value(22)],
        })
    }
    pub fn verified_values(&self) -> Result<VerifiedRateValues> {
        if !self.is_done() || self.fractional.iter().any(|fraction| *fraction) {
            return Err(Error::Bounds);
        }
        Ok(VerifiedRateValues {
            count: self.input.count,
            common: self.input.common,
            rates: [self.value(3), self.value(4)],
            rate_denominator: self.value(5),
            cash_denominator: self.value(6),
            factor: self.input.factor,
        })
    }
    pub fn accesses(&self) -> Result<[Option<WordAccess>; 3]> {
        match self.pending.as_ref().ok_or(Error::Bounds)? {
            Pending::Number(cursor) => cursor.accesses(),
            Pending::Compare(cursor) => cursor.accesses(),
            Pending::Atoms(cursor) => cursor.accesses(),
        }
    }
    pub fn step(&mut self, store: &mut impl LimbStorage) -> Result<()> {
        match self.pending.as_mut().ok_or(Error::Bounds)? {
            Pending::Number(cursor) => {
                cursor.step(store)?;
                if cursor.is_done() {
                    let result = cursor.result()?;
                    if self.stage == ROW_BASE && cursor.remainder()? != 0 {
                        return Err(Error::Invariant);
                    }
                    self.used[result.register as usize] = result.used;
                    if self.stage == ROW_FLOW {
                        self.flow = 14;
                    }
                    if self.stage == ACCUMULATE {
                        self.incoming ^= 1 << self.market;
                    }
                    self.stage += 1;
                    self.pending = None;
                }
            }
            Pending::Compare(cursor) => {
                cursor.step(store)?;
                if cursor.is_done() {
                    let order = cursor.result()?;
                    self.pending = None;
                    self.compared(order)?;
                }
            }
            Pending::Atoms(cursor) => {
                cursor.step(store)?;
                if cursor.is_done() {
                    let (spent, remainder) = cursor.result()?;
                    if spent > self.input.budgets[self.market] {
                        return Err(Error::Invariant);
                    }
                    self.spent[self.market] = spent;
                    self.fractional[self.market] = remainder.used != 0;
                    self.stage += 1;
                    self.pending = None;
                }
            }
        }
        self.prepare()
    }
}

pub const CHECKPOINT_BYTES: usize = 960;
impl RateWork {
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[..8].copy_from_slice(&[
            1,
            self.stage,
            self.market as u8,
            self.below,
            self.incoming,
            self.flow as u8,
            self.selected as u8,
            match self.pending {
                None => 0,
                Some(Pending::Number(_)) => 1,
                Some(Pending::Compare(_)) => 2,
                Some(Pending::Atoms(_)) => 3,
            },
        ]);
        bytes[8..16].copy_from_slice(&self.input.count.to_le_bytes());
        bytes[16..20].copy_from_slice(&self.input.common.register.to_le_bytes());
        bytes[24..32].copy_from_slice(&self.input.common.used.to_le_bytes());
        for (index, value) in self.input.rate_lengths.into_iter().enumerate() {
            bytes[32 + 8 * index..40 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        for (index, value) in self.input.factor.into_iter().enumerate() {
            bytes[48 + 8 * index..56 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        for (index, total) in self
            .input
            .positive
            .into_iter()
            .chain(self.input.negative)
            .enumerate()
        {
            for (word, value) in total.words().into_iter().enumerate() {
                let offset = 88 + 24 * index + 8 * word;
                bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
            }
        }
        for (index, value) in self
            .input
            .pools
            .into_iter()
            .chain(self.input.budgets)
            .enumerate()
        {
            let offset = 184 + 8 * index;
            bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
        }
        for (index, value) in [self.processed, self.last_id, self.row.cash]
            .into_iter()
            .enumerate()
        {
            let offset = 216 + 8 * index;
            bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
        }
        for (index, value) in self.row.claims.into_iter().enumerate() {
            bytes[240 + 16 * index..256 + 16 * index].copy_from_slice(&value.to_le_bytes());
        }
        for (index, total) in self.slopes.into_iter().enumerate() {
            for (word, value) in total.words().into_iter().enumerate() {
                let offset = 272 + 24 * index + 8 * word;
                bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
            }
        }
        for (index, value) in self.used.into_iter().enumerate() {
            bytes[320 + 8 * index..328 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        for (index, value) in self.spent.into_iter().enumerate() {
            bytes[520 + 8 * index..528 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        bytes[536] = u8::from(self.fractional[0]) | (u8::from(self.fractional[1]) << 1);
        match &self.pending {
            None => {}
            Some(Pending::Number(cursor)) => bytes[544..736].copy_from_slice(&cursor.checkpoint()),
            Some(Pending::Compare(cursor)) => bytes[544..584].copy_from_slice(&cursor.checkpoint()),
            Some(Pending::Atoms(cursor)) => bytes[544..928].copy_from_slice(&cursor.checkpoint()),
        }
        bytes
    }
    /// Byte structure does not prove historical execution. The owning program
    /// supplies the exact immutable frozen binding and reads only its own work.
    pub fn from_checkpoint(bytes: &[u8], input: RateInput) -> Result<Self> {
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || bytes[1] > DONE
            || bytes[2] > 1
            || bytes[3] > 3
            || bytes[4] > 3
            || ![11, 14].contains(&bytes[5])
            || ![0, 11, 12, 13].contains(&bytes[6])
            || bytes[7] > 3
            || bytes[536] > 3
            || bytes[20..24]
                .iter()
                .chain(&bytes[537..544])
                .chain(&bytes[928..])
                .any(|byte| *byte != 0)
        {
            return Err(Error::Bounds);
        }
        let read = |offset| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        let mut work = Self::new(input)?;
        if bytes[8..216] != work.checkpoint()[8..216] {
            return Err(Error::Bounds);
        }
        work.stage = bytes[1];
        work.market = usize::from(bytes[2]);
        work.below = bytes[3];
        work.incoming = bytes[4];
        work.flow = u32::from(bytes[5]);
        work.selected = u32::from(bytes[6]);
        work.processed = read(216);
        work.last_id = read(224);
        work.row = Row {
            cash: read(232),
            claims: core::array::from_fn(|index| {
                i128::from_le_bytes(
                    bytes[240 + 16 * index..256 + 16 * index]
                        .try_into()
                        .unwrap(),
                )
            }),
        };
        work.row.validate()?;
        for market in 0..2 {
            work.slopes[market] = ClaimTotal::from_words(core::array::from_fn(|word| {
                read(272 + 24 * market + 8 * word)
            }))?;
            if work.slopes[market]
                .words()
                .iter()
                .rev()
                .cmp(input.positive[1 - market].words().iter().rev())
                == Ordering::Greater
            {
                return Err(Error::Bounds);
            }
        }
        work.used = core::array::from_fn(|index| read(320 + 8 * index));
        work.spent = [read(520), read(528)];
        work.fractional = [bytes[536] & 1 != 0, bytes[536] & 2 != 0];
        if work.processed > input.count
            || work.used.iter().any(|used| *used > work.capacity)
            || work.used[input.common.register as usize] != input.common.used
            || work.used[1 - input.common.register as usize] != 0
            || work.used[2] != 0
            || work.used[3..5] != input.rate_lengths
            || (0..2).any(|market| work.spent[market] > input.budgets[market])
        {
            return Err(Error::Bounds);
        }
        if ((ROW_BASE..=NEXT_DEBT).contains(&work.stage) && work.processed >= input.count)
            || (work.stage >= GREATESTNESS && work.processed != input.count)
            || (!(ROW_BASE..=NEXT_DEBT).contains(&work.stage) && work.row != Row::default())
        {
            return Err(Error::Bounds);
        }
        work.pending = None;
        match work.task()? {
            Some(Task::Number(operation, left, right, output)) => {
                if bytes[7] != 1 || bytes[736..928].iter().any(|byte| *byte != 0) {
                    return Err(Error::Bounds);
                }
                let cursor = NumberCursor::from_checkpoint(&bytes[544..736], work.capacity)?;
                if cursor.is_done() || cursor.specification() != (operation, left, right, output) {
                    return Err(Error::Bounds);
                }
                work.pending = Some(Pending::Number(cursor));
            }
            Some(Task::Compare(left, right)) => {
                if bytes[7] != 2
                    || left.used == 0
                    || left.used != right.used
                    || bytes[584..928].iter().any(|byte| *byte != 0)
                {
                    return Err(Error::Bounds);
                }
                let cursor = CompareCursor::from_checkpoint(&bytes[544..584], work.capacity)?;
                let expected =
                    CompareCursor::new(left.used, left.register, right.register)?.checkpoint();
                if cursor.is_done() || cursor.checkpoint()[8..24] != expected[8..24] {
                    return Err(Error::Bounds);
                }
                work.pending = Some(Pending::Compare(cursor));
            }
            Some(Task::Atoms(numerator, denominator)) => {
                if bytes[7] != 3 {
                    return Err(Error::Bounds);
                }
                let cursor = AtomDivision::from_checkpoint(&bytes[544..928], work.capacity)?;
                let expected = AtomDivision::new(numerator, denominator, [23, 24], work.capacity)?
                    .checkpoint();
                if cursor.is_done() || cursor.checkpoint()[8..56] != expected[8..56] {
                    return Err(Error::Bounds);
                }
                work.pending = Some(Pending::Atoms(cursor));
            }
            None => {
                if bytes[7] != 0
                    || ![ROW, DONE].contains(&work.stage)
                    || (work.stage == ROW && work.processed == input.count)
                    || bytes[544..928].iter().any(|byte| *byte != 0)
                {
                    return Err(Error::Bounds);
                }
            }
        }
        Ok(work)
    }
}
