//! Exactly-once application accounting over a complete authenticated plan.
//! The program must bind the real root, frozen input, terminal graph increments
//! and stored seen/applied flags. These scalar inputs are not payout authority.
use super::{
    graph_pages::FlowRecord,
    snapshot::{SnapshotBinding, SnapshotProgress, SnapshotScan},
};
use crate::{clearing::row::Row, Error, Result, MAX_CASH};

pub const CHECKPOINT_BYTES: usize = 368;
#[derive(Clone, Copy, Debug)]
pub struct ApplicationBinding {
    pub snapshot: SnapshotBinding,
    pub insurance_spent: [u64; 2],
}
impl ApplicationBinding {
    pub fn after(&self) -> Result<SnapshotBinding> {
        let mut after = self.snapshot;
        after.pools = [0; 2];
        after.gross = [0; 2];
        for market in 0..2 {
            after.insurance[market] = after.insurance[market]
                .checked_sub(self.insurance_spent[market])
                .ok_or(Error::Bounds)?;
        }
        SnapshotScan::new(after)?;
        Ok(after)
    }
    pub fn supply(&self) -> Result<[u64; 2]> {
        Ok([
            self.snapshot.pools[0]
                .checked_add(self.insurance_spent[0])
                .ok_or(Error::Overflow)?,
            self.snapshot.pools[1]
                .checked_add(self.insurance_spent[1])
                .ok_or(Error::Overflow)?,
        ])
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AppliedAmounts {
    pub cash: u64,
    pub flows: [u64; 2],
    pub movements: [i128; 2],
}
pub fn rounded_amounts(row: Row, flow: FlowRecord, increments: [u64; 3]) -> Result<AppliedAmounts> {
    row.validate()?;
    flow.words()?;
    if flow.cash != row.cash
        || flow.applied
        || flow.seen_attempt == 0
        || flow.seen_mask != 3
        || flow.directions != row.claims.map(|claim| claim.signum() as i8)
        || increments
            .iter()
            .enumerate()
            .any(|(kind, value)| *value > u64::from(flow.fractional[kind]))
    {
        return Err(Error::Bounds);
    }
    let mut amounts = [0; 3];
    for kind in 0..3 {
        amounts[kind] = flow.whole[kind]
            .checked_add(increments[kind])
            .ok_or(Error::Overflow)?;
    }
    let movements = [
        row.claims[0].signum() * i128::from(amounts[0]),
        row.claims[1].signum() * i128::from(amounts[1]),
    ];
    let conserved = i128::from(row.cash)
        .checked_add(movements[0])
        .and_then(|cash| cash.checked_add(movements[1]))
        .ok_or(Error::Overflow)?;
    if amounts[2] > MAX_CASH
        || conserved != i128::from(amounts[2])
        || amounts[2] < row.cash - row.collected()?
    {
        return Err(Error::Invariant);
    }
    Ok(AppliedAmounts {
        cash: amounts[2],
        flows: [amounts[0], amounts[1]],
        movements,
    })
}
#[derive(Clone, Debug)]
pub struct ApplicationScan {
    binding: ApplicationBinding,
    original: SnapshotScan,
    cash_applied: u64,
    movements: [i128; 2],
}
impl ApplicationScan {
    pub fn new(binding: ApplicationBinding) -> Result<Self> {
        binding.after()?;
        Ok(Self {
            binding,
            original: SnapshotScan::new(binding.snapshot)?,
            cash_applied: 0,
            movements: [0; 2],
        })
    }
    pub fn progress(&self) -> (SnapshotProgress, u64, [i128; 2]) {
        (self.original.progress(), self.cash_applied, self.movements)
    }
    pub fn accept(
        &mut self,
        ordinal: u64,
        member: u64,
        row: Row,
        lots: [i64; 2],
        flow: FlowRecord,
        increments: [u64; 3],
    ) -> Result<AppliedAmounts> {
        if flow.id != member {
            return Err(Error::Bounds);
        }
        let amounts = rounded_amounts(row, flow, increments)?;
        let mut next = self.clone();
        next.original.accept(ordinal, member, &row, lots)?;
        next.cash_applied = next
            .cash_applied
            .checked_add(amounts.cash)
            .filter(|cash| *cash <= MAX_CASH)
            .ok_or(Error::Overflow)?;
        for market in 0..2 {
            next.movements[market] = next.movements[market]
                .checked_add(amounts.movements[market])
                .ok_or(Error::Overflow)?;
        }
        if next.original.progress().processed == next.binding.snapshot.count {
            next.result()?;
        }
        *self = next;
        Ok(amounts)
    }
    pub fn result(&self) -> Result<u64> {
        let original = self.original.result()?;
        let supply = self.binding.supply()?;
        let cash = original
            .cash
            .checked_add(supply[0])
            .and_then(|cash| cash.checked_add(supply[1]))
            .ok_or(Error::Overflow)?;
        if cash != self.cash_applied || self.movements != supply.map(i128::from) {
            return Err(Error::Invariant);
        }
        Ok(cash)
    }
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[0] = 1;
        bytes[8..16].copy_from_slice(&self.binding.insurance_spent[0].to_le_bytes());
        bytes[16..24].copy_from_slice(&self.binding.insurance_spent[1].to_le_bytes());
        bytes[24..312].copy_from_slice(&self.original.checkpoint());
        bytes[312..320].copy_from_slice(&self.cash_applied.to_le_bytes());
        for market in 0..2 {
            bytes[320 + 16 * market..336 + 16 * market]
                .copy_from_slice(&self.movements[market].to_le_bytes());
        }
        bytes
    }
    pub fn from_checkpoint(bytes: &[u8], binding: ApplicationBinding) -> Result<Self> {
        let mut scan = Self::new(binding)?;
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || bytes[1..8]
                .iter()
                .chain(&bytes[352..])
                .any(|byte| *byte != 0)
            || bytes[8..24] != scan.checkpoint()[8..24]
        {
            return Err(Error::Bounds);
        }
        scan.original = SnapshotScan::from_checkpoint(&bytes[24..312], binding.snapshot)?;
        scan.cash_applied = u64::from_le_bytes(bytes[312..320].try_into().unwrap());
        scan.movements = core::array::from_fn(|market| {
            i128::from_le_bytes(
                bytes[320 + 16 * market..336 + 16 * market]
                    .try_into()
                    .unwrap(),
            )
        });
        if scan.cash_applied > MAX_CASH
            || (scan.original.progress().processed == 0
                && (scan.cash_applied != 0 || scan.movements != [0; 2]))
        {
            return Err(Error::Bounds);
        }
        if scan.original.progress().processed == binding.snapshot.count {
            scan.result()?;
        }
        Ok(scan)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SCALE;
    fn binding() -> ApplicationBinding {
        ApplicationBinding {
            snapshot: SnapshotBinding {
                count: 3,
                allocated: 1,
                pools: [0; 2],
                insurance: [0; 2],
                fees: [0; 2],
                gross: [0; 2],
            },
            insurance_spent: [0; 2],
        }
    }
    fn row(index: u64) -> (Row, FlowRecord, [u64; 3]) {
        let row = Row {
            cash: u64::from(index == 0),
            claims: [if index == 0 { -2 * SCALE } else { SCALE }, 0],
        };
        let flow = FlowRecord {
            id: index,
            cash: row.cash,
            whole: [u64::from(index == 0), 0, 0],
            directions: [if index == 0 { -1 } else { 1 }, 0],
            fractional: [index != 0, false, index != 0],
            order: [0, 1, 2],
            seen_attempt: 7,
            seen_mask: 3,
            applied: false,
        };
        (row, flow, [u64::from(index == 1), 0, u64::from(index == 1)])
    }
    #[test]
    fn exact_application_prefixes_and_complete_cohort_survive_persistence() {
        let mut scan = ApplicationScan::new(binding()).unwrap();
        for index in 0..3 {
            let (row, flow, increments) = row(index);
            let before = scan.checkpoint();
            assert!(scan
                .accept(index + 1, index, row, [0; 2], flow, increments)
                .is_err());
            assert_eq!(scan.checkpoint(), before);
            assert!(scan.result().is_err());
            let amounts = scan
                .accept(index, index, row, [0; 2], flow, increments)
                .unwrap();
            assert_eq!(amounts.cash, u64::from(index == 1));
            assert_eq!(amounts.movements, [[-1, 0], [1, 0], [0, 0]][index as usize]);
            scan = ApplicationScan::from_checkpoint(&scan.checkpoint(), binding()).unwrap();
            let (progress, paid, movements) = scan.progress();
            assert_eq!(progress.processed, index + 1);
            assert_eq!(progress.cash, 1);
            assert_eq!(paid, u64::from(index >= 1));
            assert_eq!(movements, if index == 0 { [-1, 0] } else { [0; 2] });
        }
        assert_eq!(scan.result().unwrap(), 1);
        let (row, flow, increments) = row(2);
        assert!(scan.accept(2, 2, row, [0; 2], flow, increments).is_err());
        for offset in [0, 1, 8, 16, 24, 312, 352, 367] {
            let mut bytes = scan.checkpoint();
            bytes[offset] ^= 1;
            assert!(
                ApplicationScan::from_checkpoint(&bytes, binding()).is_err(),
                "offset {offset}"
            );
        }
    }
    #[test]
    fn application_rejects_unverified_rows_fabricated_atoms_and_insurance_overdraw() {
        let (row, flow, increments) = row(0);
        for changed in [
            FlowRecord {
                applied: true,
                ..flow
            },
            FlowRecord {
                seen_mask: 1,
                ..flow
            },
            FlowRecord {
                seen_attempt: 0,
                seen_mask: 0,
                ..flow
            },
            FlowRecord { cash: 2, ..flow },
            FlowRecord {
                directions: [1, 0],
                ..flow
            },
        ] {
            assert!(rounded_amounts(row, changed, increments).is_err());
        }
        assert!(rounded_amounts(row, flow, [1, 0, 0]).is_err());
        assert!(rounded_amounts(row, flow, [0, 0, 1]).is_err());
        let (row, flow, _) = self::row(1);
        assert!(rounded_amounts(row, flow, [1, 0, 0]).is_err());
        assert!(ApplicationScan::new(ApplicationBinding {
            insurance_spent: [1, 0],
            ..binding()
        })
        .is_err());
    }
}
