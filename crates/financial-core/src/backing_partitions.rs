//! Native comparison of disjoint, stable membership partitions. A caller must
//! authenticate each account's owner, PDA, market, frozen membership and region.
//! These checks validate an ordered set and its exact arithmetic.
use super::{Region, Summary};
use crate::{Error, Result};

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct ProofBinding {
    pub venue: [u8; 32],
    pub market: u8,
    pub proof_epoch: u64,
    pub financial_epoch: u64,
    pub region: Region,
}

#[derive(Debug, Clone, Copy)]
pub struct Partition {
    pub binding: ProofBinding,
    pub ordinal: usize,
    pub totals: Summary,
}

/// The caller selects the partition count from the market configuration and
/// supplies every canonical partition, including an empty one. Each processed
/// root contributes only to its immutable id's partition across all makers.
pub fn combine(binding: ProofBinding, count: usize, records: &[Partition]) -> Result<Summary> {
    if binding.market > 1 || binding.proof_epoch == 0 || count == 0 || records.len() != count {
        return Err(Error::Cohort);
    }
    binding.region.validate()?;
    let mut merged = Summary::default();
    for (ordinal, record) in records.iter().enumerate() {
        if record.ordinal != ordinal || record.binding != binding {
            return Err(Error::Cohort);
        }
        let next = record.totals;
        next.validate()?;
        let add = |a: u64, b: u64| a.checked_add(b).ok_or(Error::Overflow);
        merged.count = add(merged.count, next.count)?;
        merged.bad = add(merged.bad, next.bad)?;
        merged.quantity = crate::add(merged.quantity, next.quantity)?;
        merged.positive = merged.positive.add(next.positive)?;
        merged.negative = merged.negative.add(next.negative)?;
        for (total, additional) in merged.required.iter_mut().zip(next.required) {
            *total = add(*total, additional)?;
        }
    }
    merged.validate()?;
    Ok(merged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        backing::MarketRegion,
        margin::{Margin, Mode, Position},
        SCALE,
    };

    #[test]
    fn credit_changes_on_another_market_update_the_same_owner_partition() {
        let price = MarketRegion {
            price_low: 1,
            price_high: 2,
            funding_low: 0,
            funding_high: 0,
        };
        let region = Region {
            markets: [price; 2],
        };
        let binding = ProofBinding {
            venue: [7; 32],
            market: 0,
            proof_epoch: 9,
            financial_epoch: 11,
            region,
        };
        let mut members: Vec<_> = (0..6)
            .map(|id| Margin {
                id,
                mode: Mode::Cross,
                cash: 0,
                reserved: 0,
                positions: [Position::default(); 2],
            })
            .collect();
        members[1].positions[0].virtual_scaled = -5 * SCALE;
        members[2].positions[0].virtual_scaled = 5 * SCALE;
        members[1].positions[1].virtual_scaled = -4 * SCALE;
        members[4].positions[1].virtual_scaled = 4 * SCALE;
        members[1].cash = 8;
        let mut serial = Summary::default();
        let mut records: Vec<_> = (0..3)
            .map(|ordinal| Partition {
                binding,
                ordinal,
                totals: Summary::default(),
            })
            .collect();
        for root in &members {
            let contribution = region.contribution(root, 0).unwrap();
            serial = serial.insert(contribution).unwrap();
            let record = &mut records[root.id as usize % 3];
            record.totals = record.totals.insert(contribution).unwrap();
        }
        for (cash, ready) in [(8, false), (9, true), (8, false)] {
            let root = &mut members[1];
            let old = region.contribution(root, 0).unwrap();
            root.cash = cash;
            let new = region.contribution(root, 0).unwrap();
            serial = serial.replace(old, new).unwrap();
            records[1].totals = records[1].totals.replace(old, new).unwrap();
            let joined = combine(binding, 3, &records).unwrap();
            assert_eq!(joined.checkpoint(), serial.checkpoint());
            assert_eq!(joined.arithmetically_ready(6, 0), Ok(ready));
        }
        assert!(combine(binding, 3, &records[..2]).is_err());
        let mut malformed = records.clone();
        malformed[1] = malformed[0];
        assert!(combine(binding, 3, &malformed).is_err());
        malformed = records.clone();
        malformed[0].binding.financial_epoch += 1;
        assert!(combine(binding, 3, &malformed).is_err());
        malformed = records;
        malformed[2].binding.market = 1;
        assert!(combine(binding, 3, &malformed).is_err());
    }
}
