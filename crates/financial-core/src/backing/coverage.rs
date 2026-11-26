//! Two-market debtor coverage projections. Callers authenticate membership and row freshness.
use crate::{margin::Margin, Result};
use clearing_accounting::{add, mul, scaled, sub};

#[derive(Clone, Copy)]
pub struct Row {
    pub cash: u64,
    pub lots: [i64; 2],
    pub fixed: [i128; 2],
}

impl Row {
    pub fn from_margin(account: &Margin) -> Result<Self> {
        account.validate()?;
        let mut fixed = [0; 2];
        for (market, value) in fixed.iter_mut().enumerate() {
            let position = account.positions[market];
            *value = add(
                position.virtual_scaled,
                mul(i128::from(position.lots), position.funding_checkpoint)?,
            )?;
        }
        Ok(Self {
            cash: account.cash,
            lots: account.positions.map(|position| position.lots),
            fixed,
        })
    }

    pub fn covers(self, target: usize, prices: [[i128; 2]; 2]) -> Result<bool> {
        super::projected::covers(self.cash, self.lots, self.fixed, target, prices)
    }
}

// At the two anchor prices, keep lower bounds for each claim, cash plus
// each claim, and cash plus both claims. Also enclose each position's slope.
#[derive(Clone, Copy)]
pub struct Bounds {
    pub claim: [i128; 2],
    pub funded: [i128; 2],
    pub funded_both: i128,
    pub lots: [[i64; 2]; 2],
}

impl Bounds {
    pub fn at_anchor(row: Row, anchor: [i128; 2]) -> Result<(Self, [i128; 2])> {
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

    pub fn include(self, next: Self) -> Self {
        Self {
            claim: std::array::from_fn(|market| self.claim[market].min(next.claim[market])),
            funded: std::array::from_fn(|market| self.funded[market].min(next.funded[market])),
            funded_both: self.funded_both.min(next.funded_both),
            lots: std::array::from_fn(|market| {
                [
                    self.lots[market][0].min(next.lots[market][0]),
                    self.lots[market][1].max(next.lots[market][1]),
                ]
            }),
        }
    }

    pub fn proves(self, target: usize, moves: [[i128; 2]; 2]) -> Result<bool> {
        if target >= 2 {
            return Err(crate::Error::Bounds);
        }
        let mut worst = [i128::MAX; 2];
        for market in 0..2 {
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

/// Funding-adjusted prices at the adverse ends of the held risk window.
pub fn endpoints(region: crate::backing::Region) -> Result<[[i128; 2]; 2]> {
    region.validate()?;
    let mut prices = [[0; 2]; 2];
    for (index, market) in region.markets.iter().enumerate() {
        prices[index] = [
            sub(scaled(market.price_low)?, market.funding_high)?,
            sub(scaled(market.price_high)?, market.funding_low)?,
        ];
    }
    Ok(prices)
}

pub fn displacements(prices: [[i128; 2]; 2], anchor: [i128; 2]) -> Result<[[i128; 2]; 2]> {
    let mut moves = prices;
    for (market, range) in moves.iter_mut().enumerate() {
        for value in range {
            *value = sub(*value, anchor[market])?;
        }
    }
    Ok(moves)
}

pub fn radius_proves(radius: [[i128; 2]; 4], target: usize, moves: [[i128; 2]; 2]) -> bool {
    if target >= 2 {
        return false;
    }
    let [btc, eth] = moves.map(|[low, high]| low.unsigned_abs().max(high.unsigned_abs()));
    radius
        .iter()
        .zip([0, btc, eth, btc.max(eth)])
        .all(|(floor, distance)| floor[target] >= 0 && distance <= floor[target] as u128)
}
