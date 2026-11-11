//! Exact adjacent market-remainder verification. The owning controller must also
//! authenticate a complete permutation with per-root attempt/seen markers. This
//! cursor checks numeric ordering; its count is not a membership proof by itself.
use super::{
    atom_division::AtomDivision,
    comparison::CompareCursor,
    normalized::{Magnitude, NumberCursor},
    rate_work::{factor, scalar, VerifiedRateValues},
    wide::{required_limbs, LimbStorage, Operation, WordAccess},
};
use crate::{clearing::row::MAX_CLAIM, Error, Result};
use core::cmp::Ordering;
pub const CHECKPOINT_BYTES: usize = 576;
const AWAIT: u8 = 0;
const PRODUCT: u8 = 1;
const DIVIDE: u8 = 2;
const COPY: u8 = 3;
const COMPARE: u8 = 4;
const REJECTED: u8 = 5;
const DONE: u8 = 6;
#[derive(Clone, Debug)]
enum Pending {
    Number(NumberCursor),
    Atoms(AtomDivision),
    Compare(CompareCursor),
}
#[derive(Clone, Debug)]
pub struct OrderWork {
    binding: VerifiedRateValues,
    market: usize,
    stage: u8,
    position: u64,
    ordinal: u64,
    member: u64,
    claim: i128,
    previous_member: Option<u64>,
    previous: Magnitude,
    current: Magnitude,
    remainder: Magnitude,
    pending: Option<Pending>,
}
impl OrderWork {
    pub fn new(binding: VerifiedRateValues, market: usize) -> Result<Self> {
        if market > 1 {
            return Err(Error::Bounds);
        }
        Ok(Self {
            binding,
            market,
            stage: AWAIT,
            position: 0,
            ordinal: 0,
            member: 0,
            claim: 0,
            previous_member: None,
            previous: Magnitude {
                register: 44,
                used: 0,
            },
            current: Magnitude {
                register: 41,
                used: 0,
            },
            remainder: Magnitude {
                register: 41,
                used: 0,
            },
            pending: None,
        })
    }
    fn capacity(&self) -> Result<u64> {
        required_limbs(self.binding.count)
    }
    fn next_register(&self) -> u32 {
        if self.previous.register == 44 {
            45
        } else {
            44
        }
    }
    fn next_value(&self) -> Magnitude {
        Magnitude {
            register: self.next_register(),
            used: self.current.used,
        }
    }
    pub fn position(&self) -> Result<u64> {
        if self.stage != AWAIT {
            return Err(Error::Bounds);
        }
        Ok(self.position)
    }
    pub fn is_done(&self) -> bool {
        self.stage == DONE
    }
    pub fn is_rejected(&self) -> bool {
        self.stage == REJECTED
    }
    pub fn accept(&mut self, ordinal: u64, member: u64, claim: i128) -> Result<()> {
        if self.stage != AWAIT
            || self.position >= self.binding.count
            || ordinal >= self.binding.count
            || claim.unsigned_abs() > MAX_CLAIM
        {
            return Err(Error::Bounds);
        }
        self.ordinal = ordinal;
        self.member = member;
        self.claim = claim;
        if claim <= 0 {
            self.advance();
            return Ok(());
        }
        self.current = Magnitude {
            register: 41,
            used: 0,
        };
        self.stage = PRODUCT;
        self.prepare()
    }
    fn advance(&mut self) {
        self.position += 1;
        self.stage = if self.position == self.binding.count {
            DONE
        } else {
            AWAIT
        };
    }
    fn compared(&mut self, order: Ordering) {
        if order == Ordering::Less
            || (order == Ordering::Equal
                && self
                    .previous_member
                    .is_none_or(|previous| previous >= self.member))
        {
            self.stage = REJECTED;
        } else {
            self.previous = self.next_value();
            self.previous_member = Some(self.member);
            self.advance();
        }
    }
    fn number_specification(&self) -> Result<(Operation, Magnitude, Magnitude, u32)> {
        let zero = Magnitude {
            register: 2,
            used: 0,
        };
        match self.stage {
            PRODUCT => Ok((
                factor(&scalar(self.claim as u128)),
                self.binding.rates[self.market],
                zero,
                41,
            )),
            COPY => Ok((factor(&[1]), self.remainder, zero, self.next_register())),
            _ => Err(Error::Bounds),
        }
    }
    fn prepare(&mut self) -> Result<()> {
        self.pending = match self.stage {
            PRODUCT | COPY => {
                let (operation, left, right, output) = self.number_specification()?;
                Some(Pending::Number(NumberCursor::new(
                    operation,
                    left,
                    right,
                    output,
                    self.capacity()?,
                )?))
            }
            DIVIDE => Some(Pending::Atoms(AtomDivision::new(
                self.current,
                self.binding.cash_denominator,
                [42, 43],
                self.capacity()?,
            )?)),
            COMPARE => {
                if self.previous_member.is_none() {
                    self.previous = self.next_value();
                    self.previous_member = Some(self.member);
                    self.advance();
                    None
                } else if self.previous.used != self.current.used || self.previous.used == 0 {
                    self.compared(self.previous.used.cmp(&self.current.used));
                    None
                } else {
                    Some(Pending::Compare(CompareCursor::new(
                        self.previous.used,
                        self.previous.register,
                        self.next_register(),
                    )?))
                }
            }
            _ => None,
        };
        Ok(())
    }
    pub fn accesses(&self) -> Result<[Option<WordAccess>; 3]> {
        match self.pending.as_ref().ok_or(Error::Bounds)? {
            Pending::Number(work) => work.accesses(),
            Pending::Atoms(work) => work.accesses(),
            Pending::Compare(work) => work.accesses(),
        }
    }
    pub fn step(&mut self, store: &mut impl LimbStorage) -> Result<()> {
        match self.pending.as_mut().ok_or(Error::Bounds)? {
            Pending::Number(work) => {
                work.step(store)?;
                if !work.is_done() {
                    return Ok(());
                }
                self.current = work.result()?;
                self.stage = if self.stage == PRODUCT {
                    DIVIDE
                } else {
                    COMPARE
                };
            }
            Pending::Atoms(work) => {
                work.step(store)?;
                if !work.is_done() {
                    return Ok(());
                }
                self.remainder = work.result()?.1;
                self.stage = COPY;
            }
            Pending::Compare(work) => {
                work.step(store)?;
                if !work.is_done() {
                    return Ok(());
                }
                let order = work.result()?;
                self.compared(order);
            }
        }
        self.prepare()
    }
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[0] = 1;
        bytes[1] = self.stage;
        bytes[2] = self.market as u8;
        bytes[3] = u8::from(self.previous_member.is_some());
        bytes[4] = match self.pending {
            None => 0,
            Some(Pending::Number(_)) => 1,
            Some(Pending::Atoms(_)) => 2,
            Some(Pending::Compare(_)) => 3,
        };
        for (index, value) in [
            self.binding.count,
            self.binding.rates[self.market].used,
            self.binding.cash_denominator.used,
            self.position,
            self.ordinal,
            self.member,
            self.previous_member.unwrap_or(0),
            self.previous.used,
            self.current.used,
            self.remainder.used,
        ]
        .into_iter()
        .enumerate()
        {
            bytes[8 + 8 * index..16 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        bytes[88..92].copy_from_slice(&self.remainder.register.to_le_bytes());
        bytes[92..96].copy_from_slice(&self.previous.register.to_le_bytes());
        bytes[96..112].copy_from_slice(&self.claim.to_le_bytes());
        bytes[112..116].copy_from_slice(&self.current.register.to_le_bytes());
        match &self.pending {
            None => {}
            Some(Pending::Number(work)) => bytes[160..352].copy_from_slice(&work.checkpoint()),
            Some(Pending::Atoms(work)) => bytes[160..544].copy_from_slice(&work.checkpoint()),
            Some(Pending::Compare(work)) => bytes[160..200].copy_from_slice(&work.checkpoint()),
        }
        bytes
    }
    pub fn from_checkpoint(
        bytes: &[u8],
        binding: VerifiedRateValues,
        market: usize,
    ) -> Result<Self> {
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || bytes[1] > DONE
            || usize::from(bytes[2]) != market
            || bytes[3] > 1
            || bytes[4] > 3
            || bytes[5..8]
                .iter()
                .chain(&bytes[116..160])
                .chain(&bytes[544..])
                .any(|byte| *byte != 0)
        {
            return Err(Error::Bounds);
        }
        let mut work = Self::new(binding, market)?;
        let read = |offset| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        if [read(8), read(16), read(24)]
            != [
                binding.count,
                binding.rates[market].used,
                binding.cash_denominator.used,
            ]
        {
            return Err(Error::Bounds);
        }
        work.stage = bytes[1];
        work.position = read(32);
        work.ordinal = read(40);
        work.member = read(48);
        work.previous_member = (bytes[3] != 0).then_some(read(56));
        work.previous = Magnitude {
            register: u32::from_le_bytes(bytes[92..96].try_into().unwrap()),
            used: read(64),
        };
        work.current = Magnitude {
            register: u32::from_le_bytes(bytes[112..116].try_into().unwrap()),
            used: read(72),
        };
        work.remainder = Magnitude {
            register: u32::from_le_bytes(bytes[88..92].try_into().unwrap()),
            used: read(80),
        };
        work.claim = i128::from_le_bytes(bytes[96..112].try_into().unwrap());
        let capacity = work.capacity()?;
        if work.position > binding.count
            || work.ordinal >= binding.count
            || ((work.stage == DONE) != (work.position == binding.count))
            || work.claim.unsigned_abs() > MAX_CLAIM
            || (matches!(work.stage, PRODUCT | DIVIDE | COPY | COMPARE | REJECTED)
                && work.claim <= 0)
            || ![44, 45].contains(&work.previous.register)
            || ![41, 44, 45].contains(&work.current.register)
            || ![41, 42, 43].contains(&work.remainder.register)
            || [work.previous.used, work.current.used, work.remainder.used]
                .iter()
                .any(|used| *used > capacity)
            || (work.previous_member.is_none()
                && (read(56) != 0 || work.previous.used != 0 || work.previous.register != 44))
            || (work.stage == DIVIDE && work.current.register != 41)
            || (work.stage == COMPARE && work.current.register != work.next_register())
        {
            return Err(Error::Bounds);
        }
        work.pending = match work.stage {
            PRODUCT | COPY => {
                if bytes[4] != 1 || bytes[352..544].iter().any(|byte| *byte != 0) {
                    return Err(Error::Bounds);
                }
                let pending = NumberCursor::from_checkpoint(&bytes[160..352], capacity)?;
                if pending.is_done() || pending.specification() != work.number_specification()? {
                    return Err(Error::Bounds);
                }
                Some(Pending::Number(pending))
            }
            DIVIDE => {
                if bytes[4] != 2 {
                    return Err(Error::Bounds);
                }
                let pending = AtomDivision::from_checkpoint(&bytes[160..544], capacity)?;
                let expected =
                    AtomDivision::new(work.current, binding.cash_denominator, [42, 43], capacity)?
                        .checkpoint();
                if pending.is_done() || pending.checkpoint()[8..56] != expected[8..56] {
                    return Err(Error::Bounds);
                }
                Some(Pending::Atoms(pending))
            }
            COMPARE => {
                if bytes[4] != 3
                    || work.previous_member.is_none()
                    || work.previous.used == 0
                    || work.previous.used != work.current.used
                    || bytes[200..544].iter().any(|byte| *byte != 0)
                {
                    return Err(Error::Bounds);
                }
                let pending = CompareCursor::from_checkpoint(&bytes[160..200], capacity)?;
                let expected = CompareCursor::new(
                    work.previous.used,
                    work.previous.register,
                    work.next_register(),
                )?
                .checkpoint();
                if pending.is_done() || pending.checkpoint()[8..24] != expected[8..24] {
                    return Err(Error::Bounds);
                }
                Some(Pending::Compare(pending))
            }
            _ => {
                if bytes[4] != 0 || bytes[160..544].iter().any(|byte| *byte != 0) {
                    return Err(Error::Bounds);
                }
                None
            }
        };
        Ok(work)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn order_checkpoint_refuses_binding_schedule_and_domain_corruption() {
        // Codec fixture only, not a verified financial cohort.
        let binding = VerifiedRateValues {
            count: 3,
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
        assert!(OrderWork::new(binding, 2).is_err());
        let mut work = OrderWork::new(binding, 0).unwrap();
        let before = work.checkpoint();
        assert!(work.accept(3, 0, 1).is_err());
        assert!(work.accept(0, 0, (MAX_CLAIM + 1) as i128).is_err());
        assert_eq!(work.checkpoint(), before);
        work.accept(0, 7, 1_000_000_000).unwrap();
        let bytes = work.checkpoint();
        assert_eq!(
            OrderWork::from_checkpoint(&bytes, binding, 0)
                .unwrap()
                .checkpoint(),
            bytes
        );
        for (offset, value) in [
            (0, 2),
            (1, 7),
            (2, 1),
            (3, 2),
            (4, 0),
            (5, 1),
            (8, 4),
            (16, 2),
            (24, 2),
            (32, 3),
            (40, 3),
            (64, 255),
            (88, 40),
            (92, 43),
            (111, 128),
            (112, 0),
            (116, 1),
            (160, 2),
            (352, 1),
            (544, 1),
        ] {
            let mut corrupt = bytes;
            corrupt[offset] = value;
            assert!(
                OrderWork::from_checkpoint(&corrupt, binding, 0).is_err(),
                "offset {offset}"
            );
        }
    }
}
