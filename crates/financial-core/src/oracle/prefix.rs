//! Fold materializations from one target market's fixed execution lanes.
//! The caller authenticates the market and each lane PDA, including empty ones.
//! A lane records the chain Clock used by a real financial action. It never
//! supplies a funding price or a caller-selected index.

use super::{endpoint, Error, Result, HOLD, MAX_CATCHUP};

#[derive(Clone, Copy, Debug)]
pub struct FundingWindow {
    pub market: u8,
    pub config: u64,
    pub observation: u64,
    pub sample_slot: u64,
    pub sampled_at: i64,
    pub held_until: i64,
    pub held_slot: u64,
    pub base: i128,
    pub premium: i128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Materialization {
    pub market: u8,
    pub config: u64,
    pub observation: u64,
    pub slot: u64,
    pub timestamp: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FundingPrefix {
    pub through: i64,
    pub index: i128,
}

impl FundingWindow {
    fn validate(self) -> Result<()> {
        if self.market > 1
            || self.config == 0
            || self.observation == 0
            || self.held_slot <= self.sample_slot
            || !(1..=HOLD).contains(
                &self
                    .held_until
                    .checked_sub(self.sampled_at)
                    .ok_or(Error::Overflow)?,
            )
        {
            return Err(Error::Bounds);
        }
        endpoint(
            self.base,
            self.premium,
            self.sampled_at,
            self.held_until,
            self.sampled_at,
        )?;
        Ok(())
    }

    /// Use only for an action admitted in the same active configuration and
    /// held observation. Actions after the fence leave the preceding stamp intact.
    pub fn observe(self, slot: u64, timestamp: i64) -> Result<Option<Materialization>> {
        self.validate()?;
        let elapsed = timestamp
            .checked_sub(self.sampled_at)
            .ok_or(Error::Overflow)?;
        if slot < self.sample_slot
            || slot >= self.held_slot
            || !(0..=MAX_CATCHUP).contains(&elapsed)
        {
            return Ok(None);
        }
        Ok(Some(Materialization {
            market: self.market,
            config: self.config,
            observation: self.observation,
            slot,
            timestamp,
        }))
    }

    /// The canonical entry covers materializing actions outside the three route
    /// lanes. Compare by chain slot, even if the clock went backward. Multiple
    /// materializations in a slot must have the identical clock for that window.
    pub fn resolve(
        self,
        canonical: Option<Materialization>,
        lanes: [Option<Materialization>; 3],
        read_slot: u64,
    ) -> Result<FundingPrefix> {
        self.validate()?;
        let mut latest: Option<Materialization> = None;
        let stamps = [canonical, lanes[0], lanes[1], lanes[2]];
        for (ordinal, entry) in stamps.iter().enumerate() {
            let Some(stamp) = *entry else { continue };
            if stamp.market != self.market
                || stamp.slot > read_slot
                || stamp.config > self.config
                || stamp.observation > self.observation
            {
                return Err(Error::Invariant);
            }
            if stamp.config != self.config || stamp.observation != self.observation {
                continue;
            }
            if self.observe(stamp.slot, stamp.timestamp)? != Some(stamp) {
                return Err(Error::Invariant);
            }
            if stamps[..ordinal].iter().flatten().any(|other| {
                other.config == self.config
                    && other.observation == self.observation
                    && other.slot == stamp.slot
                    && other.timestamp != stamp.timestamp
            }) {
                return Err(Error::Invariant);
            }
            if latest.is_none_or(|previous| stamp.slot > previous.slot) {
                latest = Some(stamp);
            }
        }
        let through = latest.map_or(self.sampled_at, |stamp| {
            stamp.timestamp.min(self.held_until)
        });
        Ok(FundingPrefix {
            through,
            index: endpoint(
                self.base,
                self.premium,
                self.sampled_at,
                self.held_until,
                through,
            )?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn window(premium: i128) -> FundingWindow {
        FundingWindow {
            market: 1,
            config: 2,
            observation: 8,
            sample_slot: 25,
            sampled_at: 100,
            held_until: 106,
            held_slot: 1000,
            base: 7,
            premium,
        }
    }
    #[test]
    fn newer_slot_can_have_a_lower_time_or_lower_index() {
        for premium in [-3_600_000, 3_600_000] {
            let source = window(premium);
            let early = source.observe(30, 105).unwrap();
            let later = source.observe(31, 102).unwrap();
            let expected = FundingPrefix {
                through: 102,
                index: 7 + premium / 1800,
            };
            for (canonical, lanes) in [
                (None, [early, later, None]),
                (later, [None, early, later]),
                (early, [later, None, None]),
            ] {
                assert_eq!(source.resolve(canonical, lanes, 1001), Ok(expected));
            }
            assert_eq!(source.observe(24, 102), Ok(None));
            assert_eq!(source.observe(1000, 103), Ok(None));
            assert_eq!(source.observe(35, 131), Ok(None));
            assert_eq!(source.observe(35, 99), Ok(None));
            let last = source.observe(32, 115).unwrap();
            assert_eq!(
                source
                    .resolve(None, [early, later, last], 1001)
                    .unwrap()
                    .through,
                106
            );
        }
    }
    #[test]
    fn old_windows_are_inert_and_inconsistent_clocks_fail() {
        let source = window(3_600_000);
        let stamp = source.observe(40, 102).unwrap().unwrap();
        let stale = Materialization {
            observation: 7,
            ..stamp
        };
        assert_eq!(
            source.resolve(Some(stale), [None; 3], 50),
            Ok(FundingPrefix {
                through: 100,
                index: 7
            })
        );
        for bad in [
            Materialization { market: 0, ..stamp },
            Materialization { config: 3, ..stamp },
            Materialization {
                observation: 9,
                ..stamp
            },
            Materialization { slot: 51, ..stamp },
            Materialization {
                timestamp: 131,
                ..stamp
            },
            Materialization {
                timestamp: 103,
                ..stamp
            },
        ] {
            assert!(source
                .resolve(Some(stamp), [Some(bad), None, None], 50)
                .is_err());
        }
    }
}
