//! Native comparison of flat, clearing-owned coverage lanes. A caller selects
//! which lane bodies to load. It never supplies balances, summaries or a verdict.
use clearing_accounting::scaled;
use financial_core::backing::coverage::{displacements, endpoints, radius_proves, Bounds, Row};
use financial_core::{backing::Region, margin::Margin, Error, Result, MAX_PRICE};
use std::collections::{BTreeMap, BTreeSet};

pub const LANES: usize = 8;
const MARKETS: usize = 2;

struct Lane {
    // Classes: both flat, BTC lots only, ETH lots only, both open.
    radius: [[i128; MARKETS]; 4],
    bounds: Option<Bounds>,
    rows: BTreeMap<u64, Row>,
}

impl Default for Lane {
    fn default() -> Self {
        Self {
            bounds: None,
            radius: [[i128::MAX; MARKETS]; 4],
            rows: BTreeMap::new(),
        }
    }
}

pub struct Book {
    anchor: [i128; MARKETS],
    lanes: [Lane; LANES],
}

#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Covered,
    Underfunded(u64),
    MissingLanes(u8),
}

pub struct Check {
    pub verdict: Verdict,
    pub exact_rows: usize,
    pub required: u8,
    pub cleared_by_radius: u8,
}

impl Book {
    pub fn new(anchor: [u64; MARKETS]) -> Result<Self> {
        if anchor.iter().any(|price| !(1..=MAX_PRICE).contains(price)) {
            return Err(Error::Bounds);
        }
        Ok(Self {
            anchor: [scaled(anchor[0])?, scaled(anchor[1])?],
            lanes: Default::default(),
        })
    }

    fn lane(&mut self, id: u64) -> &mut Lane {
        &mut self.lanes[(id % LANES as u64) as usize]
    }

    /// Images are supplied by the modeled clearing transition. Stage all
    /// validation before applying the first half of a paired fill.
    pub fn record(&mut self, images: &[Margin]) -> Result<()> {
        let mut seen = BTreeSet::new();
        let mut staged = Vec::with_capacity(images.len());
        for account in images {
            if !seen.insert(account.id) {
                return Err(Error::Cohort);
            }
            let row = Row::from_margin(account)?;
            staged.push((account.id, row, Bounds::at_anchor(row, self.anchor)?));
        }
        for (id, row, (bounds, radius)) in staged {
            let lane = self.lane(id);
            let class = usize::from(row.lots[0] != 0) | (usize::from(row.lots[1] != 0) << 1);
            for (floor, observed) in lane.radius[class].iter_mut().zip(radius) {
                *floor = (*floor).min(observed);
            }
            lane.rows.insert(id, row);
            lane.bounds = Some(
                lane.bounds
                    .map_or(bounds, |previous| previous.include(bounds)),
            );
        }
        Ok(())
    }

    /// The financial lifecycle owns retirement authority. An empty projection
    /// may leave; any remaining cash, lots or flat claim keeps the row present.
    pub fn retire_empty(&mut self, id: u64) -> Result<()> {
        let lane = self.lane(id);
        let row = lane.rows.get(&id).ok_or(Error::Cohort)?;
        if row.cash != 0 || row.lots != [0; MARKETS] || row.fixed != [0; MARKETS] {
            return Err(Error::Entitlement);
        }
        lane.rows.remove(&id);
        if lane.rows.is_empty() {
            *lane = Lane::default();
        }
        Ok(())
    }

    /// All current headers are authoritative. Supplied bits only make the
    /// corresponding current, complete lane bodies available for this call.
    pub fn check(&self, target: usize, region: Region, supplied: u8) -> Result<Check> {
        region.validate()?;
        if target >= MARKETS {
            return Err(Error::Bounds);
        }
        let prices = endpoints(region)?;
        let moves = displacements(prices, self.anchor)?;
        let mut required = 0u8;
        let mut cleared_by_radius = 0u8;
        for (index, lane) in self.lanes.iter().enumerate() {
            if let Some(bounds) = lane.bounds {
                if !bounds.proves(target, moves)? {
                    if radius_proves(lane.radius, target, moves) {
                        cleared_by_radius |= 1 << index;
                    } else {
                        required |= 1 << index;
                    }
                }
            }
        }
        let missing = required & !supplied;
        if missing != 0 {
            return Ok(Check {
                verdict: Verdict::MissingLanes(missing),
                required,
                cleared_by_radius,
                exact_rows: 0,
            });
        }
        let mut exact_rows = 0;
        for (index, lane) in self.lanes.iter().enumerate() {
            if required & (1 << index) == 0 {
                continue;
            }
            for (&id, row) in &lane.rows {
                exact_rows += 1;
                if !row.covers(target, prices)? {
                    return Ok(Check {
                        verdict: Verdict::Underfunded(id),
                        required,
                        cleared_by_radius,
                        exact_rows,
                    });
                }
            }
        }
        Ok(Check {
            verdict: Verdict::Covered,
            required,
            cleared_by_radius,
            exact_rows,
        })
    }
}
