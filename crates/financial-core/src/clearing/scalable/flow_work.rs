//! Resumable per-root exact payments, retained cash and atom floors. No account
//! mutation or payout authority: the owner authenticates each frozen ordinal,
//! the completed insurance history, and all immutable rate/denominator pages.
use super::{
    atom_division::AtomDivision,
    collection::ReducedCollection,
    comparison::CompareCursor,
    normalized::{Magnitude, NumberCursor},
    rate_work::{factor, scalar, VerifiedRateValues},
    wide::{required_limbs, LimbStorage, Operation, WordAccess},
};
use crate::{clearing::row::Row, Error, Result, MAX_CASH, SCALE};
use core::cmp::Ordering;

pub const CHECKPOINT_BYTES: usize = 768;
const FIRST_REGISTER: u32 = 25;
const CASH_FIRST: u32 = 33;
const CASH_SECOND: u32 = 34;
const BASE: u8 = 0;
const SELECT_MARKET: u8 = 1;
const POSITIVE: u8 = 2;
const OWN_COEFFICIENT: u8 = 3;
const OWN_SCALED: u8 = 4;
const SELECT_LINK: u8 = 5;
const RECOVERED: u8 = 6;
const CAPACITY: u8 = 7;
const COMPARE_LINK: u8 = 8;
const COMBINE_LINK: u8 = 9;
const COPY_OWN: u8 = 10;
const NEXT_MARKET: u8 = 11;
const CASH_INITIAL: u8 = 12;
const CASH_RECEIPTS: u8 = 13;
const ADD_RECEIPT: u8 = 14;
const CASH_DEBTS: u8 = 15;
const SUBTRACT_DEBT: u8 = 16;
const RETAINED: u8 = 17;
const CHECK_RETAINED: u8 = 18;
const ATOMS: u8 = 19;
const COPY_REMAINDER: u8 = 20;
const NEXT_ATOM: u8 = 21;
const ORDER_FIRST: u8 = 22;
const ORDER_SECOND: u8 = 23;
const ORDER_THIRD: u8 = 24;
const DONE: u8 = 25;

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
pub struct FlowWork {
    binding: VerifiedRateValues,
    capacity: u64,
    ordinal: u64,
    member_id: u64,
    row: Row,
    stage: u8,
    market: usize,
    used: [u64; 16],
    remainder: Magnitude,
    order: [u8; 3],
    cash_register: u32,
    selected: u32,
    whole: [u64; 3],
    fractional: [bool; 3],
    pending: Option<Pending>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FlowResult {
    pub whole: [u64; 3],
    pub fractional: [bool; 3],
    /// BTC absolute payment, ETH absolute payment, then funded cash entitlement.
    /// All are numerators over the completed rate work's cash denominator.
    pub flows: [Magnitude; 3],
    /// Exact remainders and descending order, with kind as the stable tie-break.
    pub remainders: [Magnitude; 3],
    pub order: [u8; 3],
}
impl FlowWork {
    pub fn new(
        binding: VerifiedRateValues,
        ordinal: u64,
        member_id: u64,
        row: Row,
    ) -> Result<Self> {
        if ordinal >= binding.count {
            return Err(Error::Bounds);
        }
        row.validate()?;
        let mut work = Self {
            binding,
            capacity: required_limbs(binding.count)?,
            ordinal,
            member_id,
            row,
            stage: if row.collected()? == 0 {
                SELECT_MARKET
            } else {
                BASE
            },
            market: 0,
            used: [0; 16],
            remainder: Self::zero(),
            order: [0, 1, 2],
            cash_register: CASH_FIRST,
            selected: 0,
            whole: [0; 3],
            fractional: [false; 3],
            pending: None,
        };
        work.prepare()?;
        Ok(work)
    }
    fn value(&self, register: u32) -> Magnitude {
        Magnitude {
            register,
            used: self.used[(register - FIRST_REGISTER) as usize],
        }
    }
    fn zero() -> Magnitude {
        Magnitude {
            register: 2,
            used: 0,
        }
    }
    fn multiply(&self, value: Magnitude, coefficient: &[u64], output: u32) -> Task {
        Task::Number(factor(coefficient), value, Self::zero(), output)
    }
    fn cash_output(&self) -> u32 {
        if self.cash_register == CASH_FIRST {
            CASH_SECOND
        } else {
            CASH_FIRST
        }
    }
    fn order_pair(&self) -> (usize, usize) {
        if self.stage == ORDER_SECOND {
            (1, 2)
        } else {
            (0, 1)
        }
    }
    fn task(&self) -> Result<Option<Task>> {
        let market = self.market;
        let task = match self.stage {
            BASE => Task::Number(
                Operation::Divide {
                    divisor: ReducedCollection::for_row(&self.row)?.denominator,
                },
                self.binding.common,
                Self::zero(),
                28,
            ),
            POSITIVE => self.multiply(
                self.binding.rates[market],
                &scalar(self.row.claims[market] as u128),
                25 + market as u32,
            ),
            OWN_COEFFICIENT => self.multiply(
                self.value(28),
                &ReducedCollection::for_row(&self.row)?.numerators[market],
                29,
            ),
            OWN_SCALED => self.multiply(self.value(29), &self.binding.factor, 30),
            RECOVERED => self.multiply(
                self.binding.rates[1 - market],
                &scalar(self.row.claims[1 - market] as u128),
                31,
            ),
            CAPACITY => self.multiply(
                self.binding.rate_denominator,
                &scalar(
                    self.row.claims[market]
                        .unsigned_abs()
                        .checked_sub(u128::from(self.row.collected()?) * SCALE as u128)
                        .ok_or(Error::Invariant)?,
                ),
                32,
            ),
            COMPARE_LINK => Task::Compare(self.value(31), self.value(32)),
            COMBINE_LINK => Task::Number(
                Operation::Add,
                self.value(30),
                self.value(self.selected),
                25 + market as u32,
            ),
            COPY_OWN => self.multiply(self.value(30), &[1], 25 + market as u32),
            CASH_INITIAL => {
                self.multiply(self.binding.cash_denominator, &[self.row.cash], CASH_FIRST)
            }
            ADD_RECEIPT => Task::Number(
                Operation::Add,
                self.value(self.cash_register),
                self.value(25 + market as u32),
                self.cash_output(),
            ),
            SUBTRACT_DEBT => Task::Number(
                Operation::Subtract,
                self.value(self.cash_register),
                self.value(25 + market as u32),
                self.cash_output(),
            ),
            RETAINED => self.multiply(
                self.binding.cash_denominator,
                &[self
                    .row
                    .cash
                    .checked_sub(self.row.collected()?)
                    .ok_or(Error::Invariant)?],
                35,
            ),
            CHECK_RETAINED => Task::Compare(self.value(self.cash_register), self.value(35)),
            ATOMS => Task::Atoms(
                self.value(if market < 2 {
                    25 + market as u32
                } else {
                    self.cash_register
                }),
                self.binding.cash_denominator,
            ),
            COPY_REMAINDER => self.multiply(self.remainder, &[1], 38 + market as u32),
            ORDER_FIRST | ORDER_SECOND | ORDER_THIRD => {
                let (left, right) = self.order_pair();
                Task::Compare(
                    self.value(38 + u32::from(self.order[left])),
                    self.value(38 + u32::from(self.order[right])),
                )
            }
            _ => return Ok(None),
        };
        Ok(Some(task))
    }
    fn compared(&mut self, order: Ordering) -> Result<()> {
        match self.stage {
            COMPARE_LINK => {
                self.selected = if order == Ordering::Less { 31 } else { 32 };
                self.stage = COMBINE_LINK;
            }
            CHECK_RETAINED => {
                if order == Ordering::Less {
                    return Err(Error::Invariant);
                }
                self.market = 0;
                self.stage = ATOMS;
            }
            ORDER_FIRST | ORDER_SECOND | ORDER_THIRD => {
                let (left, right) = self.order_pair();
                if order == Ordering::Less
                    || (order == Ordering::Equal && self.order[left] > self.order[right])
                {
                    self.order.swap(left, right);
                }
                self.stage += 1;
            }
            _ => return Err(Error::Invariant),
        }
        Ok(())
    }
    fn prepare(&mut self) -> Result<()> {
        // At most three scalar selections (the two markets and cash output)
        // can cross this fixed schedule before another bounded word request.
        for _ in 0..3 * (usize::from(DONE) + 1) {
            if self.pending.is_some() || self.is_done() {
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
                        [36, 37],
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
                SELECT_MARKET => {
                    if self.market == 2 {
                        self.market = 0;
                        self.stage = CASH_INITIAL;
                    } else if self.row.claims[self.market] == 0 {
                        self.used[self.market] = 0;
                        self.market += 1;
                    } else if self.row.claims[self.market] > 0 {
                        self.stage = POSITIVE;
                    } else if self.row.collected()? == 0 {
                        self.used[(30 - FIRST_REGISTER) as usize] = 0;
                        self.stage = SELECT_LINK;
                    } else {
                        self.stage = OWN_COEFFICIENT;
                    }
                }
                SELECT_LINK => {
                    self.stage = if self.row.claims[1 - self.market] > 0 {
                        RECOVERED
                    } else {
                        COPY_OWN
                    }
                }
                NEXT_MARKET => {
                    self.market += 1;
                    self.stage = SELECT_MARKET;
                }
                CASH_RECEIPTS => {
                    if self.market == 2 {
                        self.market = 0;
                        self.stage = CASH_DEBTS;
                    } else if self.row.claims[self.market] > 0 {
                        self.stage = ADD_RECEIPT;
                    } else {
                        self.market += 1;
                    }
                }
                CASH_DEBTS => {
                    if self.market == 2 {
                        self.market = 0;
                        self.stage = RETAINED;
                    } else if self.row.claims[self.market] < 0 {
                        self.stage = SUBTRACT_DEBT;
                    } else {
                        self.market += 1;
                    }
                }
                NEXT_ATOM => {
                    self.market += 1;
                    if self.market == 3 {
                        self.market = 0;
                        self.stage = ORDER_FIRST;
                    } else {
                        self.stage = ATOMS;
                    }
                }
                _ => return Err(Error::Invariant),
            }
        }
        Err(Error::Invariant)
    }
    pub fn is_done(&self) -> bool {
        self.stage == DONE
    }
    pub fn identity(&self) -> (u64, u64) {
        (self.ordinal, self.member_id)
    }
    pub fn result(&self) -> Result<FlowResult> {
        if !self.is_done() {
            return Err(Error::Bounds);
        }
        Ok(FlowResult {
            whole: self.whole,
            fractional: self.fractional,
            remainders: core::array::from_fn(|kind| self.value(38 + kind as u32)),
            order: self.order,
            flows: [
                self.value(25),
                self.value(26),
                self.value(self.cash_register),
            ],
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
                    if self.stage == BASE && cursor.remainder()? != 0 {
                        return Err(Error::Invariant);
                    }
                    let value = cursor.result()?;
                    self.used[(value.register - FIRST_REGISTER) as usize] = value.used;
                    self.pending = None;
                    self.stage = match self.stage {
                        POSITIVE | COMBINE_LINK | COPY_OWN => NEXT_MARKET,
                        ADD_RECEIPT | SUBTRACT_DEBT => {
                            self.cash_register = value.register;
                            self.market += 1;
                            if self.stage == ADD_RECEIPT {
                                CASH_RECEIPTS
                            } else {
                                CASH_DEBTS
                            }
                        }
                        _ => self.stage + 1,
                    };
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
                    let (whole, remainder) = cursor.result()?;
                    if self.market == 2 && whole > MAX_CASH {
                        return Err(Error::Bounds);
                    }
                    self.whole[self.market] = whole;
                    self.fractional[self.market] = remainder.used != 0;
                    self.pending = None;
                    self.remainder = remainder;
                    self.stage = COPY_REMAINDER;
                }
            }
        }
        self.prepare()
    }
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[0] = 1;
        bytes[1] = self.stage;
        bytes[2] = self.market as u8;
        bytes[3] = match self.pending {
            None => 0,
            Some(Pending::Number(_)) => 1,
            Some(Pending::Compare(_)) => 2,
            Some(Pending::Atoms(_)) => 3,
        };
        bytes[4] = u8::from(self.fractional[0])
            | (u8::from(self.fractional[1]) << 1)
            | (u8::from(self.fractional[2]) << 2);
        bytes[8..16].copy_from_slice(&self.binding.count.to_le_bytes());
        bytes[16..20].copy_from_slice(&self.binding.common.register.to_le_bytes());
        for (index, value) in [
            self.binding.common.used,
            self.binding.rates[0].used,
            self.binding.rates[1].used,
            self.binding.rate_denominator.used,
            self.binding.cash_denominator.used,
        ]
        .into_iter()
        .enumerate()
        {
            bytes[24 + 8 * index..32 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        for (index, value) in self.binding.factor.into_iter().enumerate() {
            bytes[64 + 8 * index..72 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        for (index, value) in [self.ordinal, self.member_id, self.row.cash]
            .into_iter()
            .enumerate()
        {
            bytes[104 + 8 * index..112 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        for (index, value) in self.row.claims.into_iter().enumerate() {
            bytes[128 + 16 * index..144 + 16 * index].copy_from_slice(&value.to_le_bytes());
        }
        for (index, value) in self.used.into_iter().enumerate() {
            bytes[160 + 8 * index..168 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        for (index, value) in self.whole.into_iter().enumerate() {
            bytes[288 + 8 * index..296 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        bytes[312..316].copy_from_slice(&self.cash_register.to_le_bytes());
        bytes[316..320].copy_from_slice(&self.selected.to_le_bytes());
        bytes[320..324].copy_from_slice(&self.remainder.register.to_le_bytes());
        bytes[328..336].copy_from_slice(&self.remainder.used.to_le_bytes());
        bytes[336..339].copy_from_slice(&self.order);
        match &self.pending {
            None => {}
            Some(Pending::Number(cursor)) => bytes[352..544].copy_from_slice(&cursor.checkpoint()),
            Some(Pending::Compare(cursor)) => bytes[352..392].copy_from_slice(&cursor.checkpoint()),
            Some(Pending::Atoms(cursor)) => bytes[352..736].copy_from_slice(&cursor.checkpoint()),
        }
        bytes
    }
    /// Structural consistency, not proof of prior execution. Both the binding
    /// and checkpoint must be authenticated by the frozen-cohort controller.
    pub fn from_checkpoint(bytes: &[u8], binding: VerifiedRateValues) -> Result<Self> {
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || bytes[1] > DONE
            || bytes[2] > 2
            || bytes[3] > 3
            || bytes[4] > 7
            || bytes[5..8]
                .iter()
                .chain(&bytes[20..24])
                .chain(&bytes[324..328])
                .chain(&bytes[339..352])
                .chain(&bytes[736..])
                .any(|byte| *byte != 0)
        {
            return Err(Error::Bounds);
        }
        let read = |offset| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        let row = Row {
            cash: read(120),
            claims: core::array::from_fn(|index| {
                i128::from_le_bytes(
                    bytes[128 + 16 * index..144 + 16 * index]
                        .try_into()
                        .unwrap(),
                )
            }),
        };
        let mut work = Self::new(binding, read(104), read(112), row)?;
        if bytes[8..104] != work.checkpoint()[8..104] {
            return Err(Error::Bounds);
        }
        work.stage = bytes[1];
        work.market = usize::from(bytes[2]);
        work.fractional = core::array::from_fn(|index| bytes[4] & (1 << index) != 0);
        work.used = core::array::from_fn(|index| read(160 + 8 * index));
        work.whole = core::array::from_fn(|index| read(288 + 8 * index));
        work.cash_register = u32::from_le_bytes(bytes[312..316].try_into().unwrap());
        work.selected = u32::from_le_bytes(bytes[316..320].try_into().unwrap());
        work.remainder = Magnitude {
            register: u32::from_le_bytes(bytes[320..324].try_into().unwrap()),
            used: read(328),
        };
        work.order.copy_from_slice(&bytes[336..339]);
        let mut permutation = work.order;
        permutation.sort_unstable();
        if work.used.iter().any(|used| *used > work.capacity)
            || ![CASH_FIRST, CASH_SECOND].contains(&work.cash_register)
            || ![0, 31, 32].contains(&work.selected)
            || work.whole.iter().any(|whole| *whole >= 1 << 58)
            || work.whole[2] > MAX_CASH
            || (work.stage == COMBINE_LINK && ![31, 32].contains(&work.selected))
            || work.used[2] != 0
            || work.used[11] != 0
            || work.used[12] != 0
            || permutation != [0, 1, 2]
            || (work.stage < ORDER_FIRST && work.order != [0, 1, 2])
            || work.remainder.used > work.capacity
            || ![2, 25, 26, 33, 34, 36, 37].contains(&work.remainder.register)
            || (work.market == 2 && ![ATOMS, COPY_REMAINDER].contains(&work.stage))
            || (work.stage >= ORDER_FIRST && work.market != 0)
        {
            return Err(Error::Bounds);
        }
        let completed = if work.stage >= ORDER_FIRST {
            3
        } else if work.stage == COPY_REMAINDER {
            work.market + 1
        } else if work.stage == ATOMS {
            work.market
        } else {
            0
        };
        if (completed..3).any(|index| work.whole[index] != 0 || work.fractional[index]) {
            return Err(Error::Bounds);
        }
        if work.market < 2 {
            let claim = work.row.claims[work.market];
            if (matches!(work.stage, POSITIVE | ADD_RECEIPT) && claim <= 0)
                || (matches!(
                    work.stage,
                    OWN_COEFFICIENT
                        | OWN_SCALED
                        | RECOVERED
                        | CAPACITY
                        | COMPARE_LINK
                        | COMBINE_LINK
                        | COPY_OWN
                        | SUBTRACT_DEBT
                ) && claim >= 0)
                || (matches!(
                    work.stage,
                    RECOVERED | CAPACITY | COMPARE_LINK | COMBINE_LINK
                ) && work.row.claims[1 - work.market] <= 0)
                || (work.stage == COPY_OWN && work.row.claims[1 - work.market] > 0)
                || (work.stage == BASE && work.row.collected()? == 0)
            {
                return Err(Error::Bounds);
            }
        }
        work.pending = None;
        match work.task()? {
            Some(Task::Number(operation, left, right, output)) => {
                if bytes[3] != 1 || bytes[544..736].iter().any(|byte| *byte != 0) {
                    return Err(Error::Bounds);
                }
                let cursor = NumberCursor::from_checkpoint(&bytes[352..544], work.capacity)?;
                if cursor.is_done() || cursor.specification() != (operation, left, right, output) {
                    return Err(Error::Bounds);
                }
                work.pending = Some(Pending::Number(cursor));
            }
            Some(Task::Compare(left, right)) => {
                if bytes[3] != 2
                    || left.used == 0
                    || left.used != right.used
                    || bytes[392..736].iter().any(|byte| *byte != 0)
                {
                    return Err(Error::Bounds);
                }
                let cursor = CompareCursor::from_checkpoint(&bytes[352..392], work.capacity)?;
                let expected =
                    CompareCursor::new(left.used, left.register, right.register)?.checkpoint();
                if cursor.is_done() || cursor.checkpoint()[8..24] != expected[8..24] {
                    return Err(Error::Bounds);
                }
                work.pending = Some(Pending::Compare(cursor));
            }
            Some(Task::Atoms(numerator, denominator)) => {
                if bytes[3] != 3 {
                    return Err(Error::Bounds);
                }
                let cursor = AtomDivision::from_checkpoint(&bytes[352..736], work.capacity)?;
                let expected = AtomDivision::new(numerator, denominator, [36, 37], work.capacity)?
                    .checkpoint();
                if cursor.is_done() || cursor.checkpoint()[8..56] != expected[8..56] {
                    return Err(Error::Bounds);
                }
                work.pending = Some(Pending::Atoms(cursor));
            }
            None => {
                if work.stage != DONE
                    || bytes[3] != 0
                    || bytes[352..736].iter().any(|byte| *byte != 0)
                {
                    return Err(Error::Bounds);
                }
            }
        }
        Ok(work)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn flow_checkpoint_binds_verified_values_row_domain_and_nested_schedule() {
        // This is a codec fixture, not an authenticated financial cohort.
        let binding = VerifiedRateValues {
            count: 2,
            common: Magnitude {
                register: 0,
                used: 1,
            },
            rates: [
                Magnitude {
                    register: 3,
                    used: 1,
                },
                Magnitude {
                    register: 4,
                    used: 1,
                },
            ],
            rate_denominator: Magnitude {
                register: 5,
                used: 1,
            },
            cash_denominator: Magnitude {
                register: 6,
                used: 1,
            },
            factor: [1, 0, 0, 0, 0],
        };
        let row = Row {
            cash: 1,
            claims: [-SCALE, 0],
        };
        let work = FlowWork::new(binding, 1, 7, row).unwrap();
        assert!(work.result().is_err());
        assert_eq!(work.identity(), (1, 7));
        assert!(FlowWork::new(binding, 2, 7, row).is_err());
        assert!(FlowWork::new(
            binding,
            1,
            7,
            Row {
                cash: MAX_CASH + 1,
                ..row
            }
        )
        .is_err());
        let bytes = work.checkpoint();
        assert_eq!(bytes.len(), 768);
        assert_eq!(
            FlowWork::from_checkpoint(&bytes, binding)
                .unwrap()
                .checkpoint(),
            bytes
        );
        let mut different = binding;
        different.factor[0] = 2;
        assert!(FlowWork::from_checkpoint(&bytes, different).is_err());
        for (offset, value) in [
            (0, 2),
            (1, 26),
            (2, 3),
            (3, 0),
            (4, 8),
            (4, 1),
            (5, 1),
            (20, 1),
            (24, 2),
            (64, 2),
            (104, 2),
            (160, 255),
            (176, 1),
            (288, 1),
            (312, 32),
            (316, 1),
            (324, 1),
            (352, 2),
            (544, 1),
            (736, 1),
        ] {
            let mut corrupted = bytes;
            corrupted[offset] = value;
            assert!(
                FlowWork::from_checkpoint(&corrupted, binding).is_err(),
                "offset {offset}"
            );
        }
        let mut invalid_branch = bytes;
        invalid_branch[1] = COMBINE_LINK;
        assert!(FlowWork::from_checkpoint(&invalid_branch, binding).is_err());
    }
}
