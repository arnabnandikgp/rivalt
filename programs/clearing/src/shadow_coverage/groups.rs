//! A group stores the intersection of sufficient debtor solvency intervals.
//! Prices are collateral-scaled and funding-adjusted. Every row owns its own cash.
//! A point outside the interval needs the ordinary exact per-debtor predicate.
use super::*;

pub(super) const WIDTH: usize = 16;
pub(super) const COUNT: usize = ROWS_PER_LANE.div_ceil(WIDTH);
pub(super) const SPACE: usize = COUNT * Group::INIT_SPACE;

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy)]
pub(super) struct Interval {
    low: i128,
    high: i128,
}

impl Interval {
    const ANY: Self = Self {
        low: i128::MIN,
        high: i128::MAX,
    };

    pub fn contains(self, endpoints: [i128; 2]) -> bool {
        self.low <= endpoints[0] && endpoints[1] <= self.high
    }

    // Solve intercept + lots * price >= 0 over integer prices.
    fn constrain(&mut self, lots: i64, intercept: i128) -> Result<()> {
        if lots > 0 {
            // ceil(-intercept / lots) = -floor(intercept / lots).
            let limit = intercept
                .div_euclid(i128::from(lots))
                .checked_neg()
                .ok_or(ClearingError::Arithmetic)?;
            self.low = self.low.max(limit);
        } else if lots < 0 {
            self.high = self.high.min(intercept.div_euclid(-i128::from(lots)));
        }
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace)]
pub(super) struct Group {
    revision: u64,
    count: u8,
    funded: bool,
    solvent: [Interval; 2],
    // For members with both positions open, exactly when all target claims are >= 0.
    // Used to preserve the original sibling-oracle dependency even on a bound hit.
    pub cross_credit: [Interval; 2],
}

impl Group {
    fn rebuild(rows: &[CoverageMember], revision: u64) -> Result<Self> {
        let mut group = Self {
            revision,
            count: rows.len() as u8,
            funded: true,
            solvent: [Interval::ANY; 2],
            cross_credit: [Interval::ANY; 2],
        };
        for row in rows {
            let mut remaining = engine::checked(financial_core::scaled(row.cash))?;
            for market in 0..2 {
                if row.lots[market] == 0 {
                    remaining = remaining
                        .checked_add(row.fixed[market].min(0))
                        .ok_or(ClearingError::Arithmetic)?;
                }
            }
            group.funded &= remaining >= 0;
            let both_open = !row.lots.contains(&0);
            for market in 0..2 {
                if row.lots[market] == 0 {
                    continue;
                }
                let budget = if both_open {
                    group.cross_credit[market].constrain(row.lots[market], row.fixed[market])?;
                    let half = remaining / 2;
                    if market == 0 {
                        half
                    } else {
                        remaining - half
                    }
                } else {
                    remaining
                };
                let intercept = row.fixed[market]
                    .checked_add(budget)
                    .ok_or(ClearingError::Arithmetic)?;
                group.solvent[market].constrain(row.lots[market], intercept)?;
            }
        }
        Ok(group)
    }

    pub fn covers(&self, prices: [[i128; 2]; 2]) -> bool {
        self.funded && (0..2).all(|market| self.solvent[market].contains(prices[market]))
    }
}

fn record(index: usize) -> std::ops::Range<usize> {
    let start = CoverageLane::ROW_SPACE + backing::Totals::INIT_SPACE + index * Group::INIT_SPACE;
    start..start + Group::INIT_SPACE
}

pub(super) fn read(bytes: &[u8], index: usize, count: usize) -> Result<Group> {
    let group: Group = crate::wire::read(&bytes[record(index)])?;
    require!(
        group.revision != 0 && usize::from(group.count) == count,
        ClearingError::ExitCohort
    );
    Ok(group)
}

pub(super) fn refresh(
    bytes: &mut [u8],
    rows: &[CoverageMember],
    dirty: [bool; COUNT],
) -> Result<()> {
    for (index, changed) in dirty.into_iter().enumerate() {
        if !changed {
            continue;
        }
        let target = &mut bytes[record(index)];
        let revision = u64::from_le_bytes(target[..8].try_into().unwrap())
            .checked_add(1)
            .ok_or(ClearingError::Arithmetic)?;
        let start = (index * WIDTH).min(rows.len());
        let end = (start + WIDTH).min(rows.len());
        crate::wire::write(&Group::rebuild(&rows[start..end], revision)?, target)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const UNIT: i128 = 1_000_000_000;

    #[test]
    fn interval_rounding_matches_signed_claim_at_adverse_endpoint() {
        for lots in [-7i64, -2, -1, 1, 2, 7] {
            for intercept in -18..=18 {
                let mut range = Interval::ANY;
                range.constrain(lots, intercept).unwrap();
                for low in -10..=10 {
                    let high = low + 3;
                    let adverse = if lots > 0 { low } else { high };
                    assert_eq!(
                        range.contains([low, high]),
                        intercept + i128::from(lots) * adverse >= 0
                    );
                }
            }
        }
    }

    #[test]
    fn hit_covers_both_markets_and_sibling_source_decision_is_exact() {
        let mut hits = 0;
        for first in -2i64..=2 {
            for second in -2i64..=2 {
                for fixed in [[-21, 13], [-20, -7], [3, -18], [2, 15]] {
                    for cash in [0, 7, 23, 60] {
                        let row = CoverageMember {
                            id: 4,
                            cash,
                            lots: [first, second],
                            fixed: fixed.map(|value| value * UNIT),
                        };
                        let group = Group::rebuild(&[row], 1).unwrap();
                        for low in 0..=15 {
                            let prices = [
                                [low * UNIT, (low + 3) * UNIT],
                                [(15 - low) * UNIT, (16 - low) * UNIT],
                            ];
                            let claims = std::array::from_fn::<_, 2, _>(|m| {
                                row.fixed[m]
                                    + i128::from(row.lots[m])
                                        * prices[m][usize::from(row.lots[m] < 0)]
                            });
                            if group.covers(prices) {
                                hits += 1;
                                assert!(
                                    i128::from(cash) * UNIT
                                        >= claims.iter().map(|claim| (-claim).max(0)).sum()
                                );
                            }
                            for market in 0..2 {
                                assert_eq!(
                                    group.cross_credit[market].contains(prices[market]),
                                    row.lots.contains(&0) || claims[market] >= 0
                                );
                            }
                        }
                    }
                }
            }
        }
        assert!(hits > 1000);
    }

    #[test]
    fn thousand_open_rows_and_rebuild_after_swap_removal() {
        let mut bytes = vec![0u8; CoverageLane::SPACE];
        for lane in 0..LANES {
            let mut rows: Vec<_> = (0..ROWS_PER_LANE)
                .map(|offset| {
                    let id = (offset * LANES + lane) as u64;
                    let lots = if id % 3 == 0 { 1 } else { -2 };
                    CoverageMember {
                        id,
                        cash: 50,
                        lots: [0, lots],
                        fixed: [0, -100 * i128::from(lots) * UNIT],
                    }
                })
                .collect();
            refresh(&mut bytes, &rows, [true; COUNT]).unwrap();
            let prices = [[0, 0], [95 * UNIT, 106 * UNIT]];
            for (index, section) in rows.chunks(WIDTH).enumerate() {
                assert!(read(&bytes, index, section.len()).unwrap().covers(prices));
            }
            let prior = bytes.clone();
            rows[0].cash = 0;
            let mut dirty = [false; COUNT];
            dirty[0] = true;
            refresh(&mut bytes, &rows, dirty).unwrap();
            assert!(!read(&bytes, 0, WIDTH).unwrap().covers(prices));
            assert_eq!(&prior[record(1).start..], &bytes[record(1).start..]);
            rows.swap_remove(0);
            dirty[COUNT - 1] = true;
            refresh(&mut bytes, &rows, dirty).unwrap();
            assert!(read(&bytes, 0, WIDTH).unwrap().covers(prices));
            assert!(read(&bytes, COUNT - 1, 12).is_ok());
            assert!(read(&bytes, COUNT - 1, 13).is_err());
        }
    }
}
