//! Native comparison of flat, clearing-owned coverage lanes. A caller selects
//! which lane bodies to load. It never supplies balances, summaries or a verdict.
use clearing_accounting::{add, mul, scaled, sub};
use financial_core::{backing::Region, margin::Margin, Error, Result, MAX_PRICE};
use std::collections::{BTreeMap, BTreeSet};

pub const LANES: usize = 8;
const MARKETS: usize = 2;

#[derive(Clone, Copy)]
struct Row {
    cash: u64,
    lots: [i64; MARKETS],
    fixed: [i128; MARKETS],
}

impl Row {
    fn from_margin(account: &Margin) -> Result<Self> {
        account.validate()?;
        let mut fixed = [0; MARKETS];
        for (market, value) in fixed.iter_mut().enumerate() {
            let position = account.positions[market];
            *value = add(
                position.virtual_scaled,
                mul(i128::from(position.lots), position.funding_checkpoint)?,
            )?;
        }
        Ok(Self {
            cash: account.cash,
            lots: account.positions.map(|p| p.lots),
            fixed,
        })
    }

    fn covers(self, target: usize, prices: [[i128; 2]; MARKETS]) -> Result<bool> {
        let mut claims = self.fixed;
        for (market, claim) in claims.iter_mut().enumerate() {
            let lots = self.lots[market];
            let adverse = prices[market][usize::from(lots < 0)];
            *claim = add(*claim, mul(i128::from(lots), adverse)?)?;
        }
        Ok(claims[target] >= 0
            || add(add(scaled(self.cash)?, claims[0].min(0))?, claims[1].min(0))? >= 0)
    }
}

// At the two anchor prices, keep lower bounds for each claim, cash plus
// each claim, and cash plus both claims. Also enclose each position's slope.
#[derive(Clone, Copy)]
struct Bounds {
    claim: [i128; MARKETS],
    funded: [i128; MARKETS],
    funded_both: i128,
    lots: [[i64; 2]; MARKETS],
}

impl Bounds {
    fn at_anchor(row: Row, anchor: [i128; MARKETS]) -> Result<(Self, [i128; MARKETS])> {
        let cash = scaled(row.cash)?;
        let mut claim = row.fixed;
        for (market, amount) in claim.iter_mut().enumerate() {
            *amount = add(*amount, mul(i128::from(row.lots[market]), anchor[market])?)?;
        }
        let funded = [add(cash, claim[0])?, add(cash, claim[1])?];
        let funded_both = add(funded[0], claim[1])?;
        let sizes = row.lots.map(|lots| i128::from(lots.unsigned_abs()));
        // Last integer displacement for which headroom - size * distance >= 0.
        // -1 means even the anchor fails; a nonnegative constant holds everywhere.
        let through = |headroom: i128, size: i128| {
            if headroom < 0 {
                -1
            } else if size == 0 {
                i128::MAX
            } else {
                headroom / size
            }
        };
        let both_radius = through(funded_both, add(sizes[0], sizes[1])?);
        let radius = std::array::from_fn(|market| {
            through(claim[market], sizes[market])
                .max(through(funded[market], sizes[market]).min(both_radius))
        });
        Ok((
            Self {
                funded,
                funded_both,
                claim,
                lots: row.lots.map(|quantity| [quantity, quantity]),
            },
            radius,
        ))
    }

    fn include(self, next: Self) -> Self {
        Self {
            claim: std::array::from_fn(|m| self.claim[m].min(next.claim[m])),
            funded: std::array::from_fn(|m| self.funded[m].min(next.funded[m])),
            funded_both: self.funded_both.min(next.funded_both),
            lots: std::array::from_fn(|m| {
                [
                    self.lots[m][0].min(next.lots[m][0]),
                    self.lots[m][1].max(next.lots[m][1]),
                ]
            }),
        }
    }

    fn proves(self, target: usize, moves: [[i128; 2]; MARKETS]) -> Result<bool> {
        let mut worst = [i128::MAX; MARKETS];
        for market in 0..MARKETS {
            for lots in self.lots[market] {
                for change in moves[market] {
                    worst[market] = worst[market].min(mul(i128::from(lots), change)?);
                }
            }
        }
        // If a member owes the target, its gross debt is covered iff both
        // cash + target and cash + target + sibling are nonnegative.
        Ok(add(self.claim[target], worst[target])? >= 0
            || (add(self.funded[target], worst[target])? >= 0
                && add(add(self.funded_both, worst[0])?, worst[1])? >= 0))
    }
}

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
        let mut prices = [[0; 2]; MARKETS];
        let mut moves = prices;
        for (market, range) in region.markets.iter().enumerate() {
            prices[market] = [
                sub(scaled(range.price_low)?, range.funding_high)?,
                sub(scaled(range.price_high)?, range.funding_low)?,
            ];
            moves[market] = [
                sub(prices[market][0], self.anchor[market])?,
                sub(prices[market][1], self.anchor[market])?,
            ];
        }
        let [btc_move, eth_move] = moves.map(|[low, high]| low.abs().max(high.abs()));
        let distances = [0, btc_move, eth_move, btc_move.max(eth_move)];
        let mut required = 0u8;
        let mut cleared_by_radius = 0u8;
        for (index, lane) in self.lanes.iter().enumerate() {
            if let Some(bounds) = lane.bounds {
                if !bounds.proves(target, moves)? {
                    if lane
                        .radius
                        .iter()
                        .zip(distances)
                        .all(|(radius, distance)| distance <= radius[target])
                    {
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
