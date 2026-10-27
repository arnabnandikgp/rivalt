//! Deterministic integral remainder circulation. All storage is caller-owned.
//! The caller proves exact flows, floors, remainders and the market permutations
//! before entering this engine. No caller-selected path or arbitrary graph exists.
use super::wide::Wide;
use crate::{Error, Result};

pub const MAX_ROOTS: usize = 64;
pub const MAX_ARCS: usize = 518;
pub const MAX_NODES: usize = 69;
const UNVISITED: u16 = u16::MAX;
const SOURCE_MARK: u16 = u16::MAX - 1;

/// Fixed original edges: market0 rows, market1 rows, cash rows. A zero-claim
/// placeholder has zero capacity and no adjacency, preserving stable edge ties.
/// Auxiliary edge 3*N+node points source->node for positive residual balance,
/// node->sink for negative. Reverse arcs always have the adjacent odd ID.
pub struct Graph<'a> {
    pub count: usize,
    /// [positive0, negative0, positive1, negative1].
    pub signs: [u64; 4],
    /// Three 2-bit slots per root: claim0, claim1, cash, in decreasing remainder
    /// order (then destination). Non-outgoing claim slots are ignored.
    pub root_orders: &'a Wide,
    /// Signed i64 two's-complement balances in the first N+3 limbs.
    pub balances: &'a Wide,
    pub market_orders: &'a [[u16; MAX_ROOTS]; 2],
    pub capacities: &'a mut [u16; MAX_ARCS],
    pub parents: &'a mut [u16; MAX_NODES],
    pub next: &'a mut [u16; MAX_NODES],
    pub path: &'a mut [u16; MAX_NODES],
    pub depth: &'a mut u16,
    pub augmentations: &'a mut u16,
    pub sent: &'a mut u64,
}

impl Graph<'_> {
    fn source(&self) -> usize {
        self.count + 3
    }
    fn sink(&self) -> usize {
        self.count + 4
    }
    fn sign(&self, market: usize, row: usize, negative: bool) -> bool {
        self.signs[2 * market + usize::from(negative)] & (1u64 << row) != 0
    }
    fn balance(&self, node: usize) -> i64 {
        self.balances[node] as i64
    }
    fn auxiliary(&self, node: usize) -> usize {
        2 * (3 * self.count + node)
    }

    pub fn required(&self) -> Result<u64> {
        if self.count == 0 || self.count > MAX_ROOTS {
            return Err(Error::Bounds);
        }
        let mut sum = 0i64;
        let mut required = 0u64;
        for node in 0..self.count + 3 {
            let balance = self.balance(node);
            if balance.unsigned_abs() > 192 {
                return Err(Error::Bounds);
            }
            sum += balance;
            required += balance.max(0) as u64;
        }
        if sum != 0 || required > 192 {
            return Err(Error::Invariant);
        }
        Ok(required)
    }

    /// Called once after all floors and both sorted complete permutations qualify.
    pub fn initialize(&mut self) -> Result<()> {
        self.required()?;
        let membership = if self.count == 64 {
            u64::MAX
        } else {
            (1u64 << self.count) - 1
        };
        for market in 0..2 {
            if (self.signs[market * 2] | self.signs[market * 2 + 1]) & !membership != 0
                || self.signs[market * 2] & self.signs[market * 2 + 1] != 0
            {
                return Err(Error::Invariant);
            }
            let mut seen = 0u64;
            for row in &self.market_orders[market][..self.count] {
                if usize::from(*row) >= self.count || seen & (1u64 << row) != 0 {
                    return Err(Error::Invariant);
                }
                seen |= 1u64 << row;
            }
        }
        for row in 0..self.count {
            let order = self.root_orders[row];
            let values = [order & 3, (order >> 2) & 3, (order >> 4) & 3];
            if order >= 64
                || values.iter().any(|value| *value >= 3)
                || values[0] == values[1]
                || values[0] == values[2]
                || values[1] == values[2]
            {
                return Err(Error::Invariant);
            }
        }
        for edge in 0..3 * self.count {
            if self.capacities[2 * edge] > 1 || self.capacities[2 * edge + 1] != 0 {
                return Err(Error::Invariant);
            }
            if edge < 2 * self.count {
                let market = edge / self.count;
                let row = edge % self.count;
                if !self.sign(market, row, false)
                    && !self.sign(market, row, true)
                    && self.capacities[2 * edge] != 0
                {
                    return Err(Error::Invariant);
                }
            }
        }
        for node in 0..self.count + 3 {
            let arc = self.auxiliary(node);
            self.capacities[arc] = self.balance(node).unsigned_abs() as u16;
            self.capacities[arc + 1] = 0;
        }
        *self.sent = 0;
        *self.augmentations = 0;
        self.restart();
        Ok(())
    }

    fn restart(&mut self) {
        self.parents.fill(UNVISITED);
        self.next.fill(0);
        self.parents[self.source()] = SOURCE_MARK;
        self.path[0] = self.source() as u16;
        *self.depth = 1;
    }

    fn endpoints(&self, arc: usize) -> Result<(usize, usize)> {
        let edge = arc / 2;
        let (start, end) = if edge < 2 * self.count {
            let market = edge / self.count;
            let row = edge % self.count;
            if self.sign(market, row, false) {
                (self.count + market, row)
            } else if self.sign(market, row, true) {
                (row, self.count + market)
            } else {
                return Err(Error::Invariant);
            }
        } else if edge < 3 * self.count {
            (edge - 2 * self.count, self.count + 2)
        } else {
            let node = edge - 3 * self.count;
            if node >= self.count + 3 {
                return Err(Error::Bounds);
            }
            if self.balance(node) > 0 {
                (self.source(), node)
            } else if self.balance(node) < 0 {
                (node, self.sink())
            } else {
                return Err(Error::Invariant);
            }
        };
        Ok(if arc % 2 == 0 {
            (start, end)
        } else {
            (end, start)
        })
    }

    /// Outer None ends this node's adjacency; inner None is a fixed empty slot.
    /// Order is auxiliary forward, remainder-priority original forward, then
    /// reverse repair arcs by destination/stable edge ID, exactly as D59.
    fn candidate(&self, node: usize, cursor: usize) -> Option<Option<usize>> {
        if node == self.source() {
            return (cursor < self.count + 3)
                .then(|| (self.balance(cursor) > 0).then(|| self.auxiliary(cursor)));
        }
        if node > self.count + 2 {
            return None;
        }
        if cursor == 0 {
            return Some((self.balance(node) < 0).then(|| self.auxiliary(node)));
        }
        let position = cursor - 1;
        if node < self.count {
            if position < 3 {
                let kind = ((self.root_orders[node] >> (2 * position)) & 3) as usize;
                return Some(if kind == 2 {
                    Some(2 * (2 * self.count + node))
                } else if self.sign(kind, node, true) {
                    Some(2 * (kind * self.count + node))
                } else {
                    None
                });
            }
            if position < 5 {
                let market = position - 3;
                return Some(
                    self.sign(market, node, false)
                        .then(|| 2 * (market * self.count + node) + 1),
                );
            }
            if position == 5 {
                return Some((self.balance(node) > 0).then(|| self.auxiliary(node) + 1));
            }
        } else if node < self.count + 2 {
            let market = node - self.count;
            if position < self.count {
                let row = self.market_orders[market][position] as usize;
                return Some(
                    self.sign(market, row, false)
                        .then(|| 2 * (market * self.count + row)),
                );
            }
            if position < 2 * self.count {
                let row = position - self.count;
                return Some(
                    self.sign(market, row, true)
                        .then(|| 2 * (market * self.count + row) + 1),
                );
            }
            if position == 2 * self.count {
                return Some((self.balance(node) > 0).then(|| self.auxiliary(node) + 1));
            }
        } else {
            if position < self.count {
                return Some(Some(2 * (2 * self.count + position) + 1));
            }
            if position == self.count {
                return Some((self.balance(node) > 0).then(|| self.auxiliary(node) + 1));
            }
        }
        None
    }

    fn augment(&mut self, required: u64) -> Result<()> {
        let mut node = self.sink();
        let mut amount = u16::try_from(required.checked_sub(*self.sent).ok_or(Error::Invariant)?)
            .map_err(|_| Error::Bounds)?;
        for _ in 0..MAX_NODES {
            if node == self.source() {
                break;
            }
            let arc = usize::from(self.parents[node]);
            if arc >= MAX_ARCS {
                return Err(Error::Invariant);
            }
            let (previous, end) = self.endpoints(arc)?;
            if end != node {
                return Err(Error::Invariant);
            }
            amount = amount.min(self.capacities[arc]);
            node = previous;
        }
        if node != self.source() || amount == 0 {
            return Err(Error::Invariant);
        }
        node = self.sink();
        for _ in 0..MAX_NODES {
            if node == self.source() {
                break;
            }
            let arc = usize::from(self.parents[node]);
            let previous = self.endpoints(arc)?.0;
            self.capacities[arc] = self.capacities[arc]
                .checked_sub(amount)
                .ok_or(Error::Invariant)?;
            self.capacities[arc ^ 1] = self.capacities[arc ^ 1]
                .checked_add(amount)
                .ok_or(Error::Overflow)?;
            node = previous;
        }
        *self.sent += u64::from(amount);
        *self.augmentations += 1;
        if *self.augmentations > 192 {
            return Err(Error::Bounds);
        }
        Ok(())
    }

    /// A fixed caller budget limits adjacency examinations, not numerical accuracy.
    /// Cursor/parents/path/capacities retain exact continuation after every return.
    pub fn step(&mut self, budget: u16) -> Result<bool> {
        let required = self.required()?;
        if budget == 0 || budget > 128 || *self.sent > required {
            return Err(Error::Bounds);
        }
        for _ in 0..budget {
            if *self.sent == required {
                self.audit()?;
                return Ok(true);
            }
            if *self.depth == 0 || usize::from(*self.depth) > MAX_NODES {
                return Err(Error::Invariant);
            }
            let node = usize::from(self.path[usize::from(*self.depth) - 1]);
            if node > self.source() {
                return Err(Error::Invariant);
            }
            let cursor = usize::from(self.next[node]);
            self.next[node] = self.next[node].checked_add(1).ok_or(Error::Overflow)?;
            let Some(candidate) = self.candidate(node, cursor) else {
                *self.depth -= 1;
                continue;
            };
            let Some(arc) = candidate else {
                continue;
            };
            if self.capacities[arc] == 0 {
                continue;
            }
            let (start, end) = self.endpoints(arc)?;
            if start != node {
                return Err(Error::Invariant);
            }
            if self.parents[end] != UNVISITED {
                continue;
            }
            self.parents[end] = arc as u16;
            if end == self.sink() {
                self.augment(required)?;
                self.restart();
            } else {
                if usize::from(*self.depth) >= MAX_NODES {
                    return Err(Error::Bounds);
                }
                self.path[usize::from(*self.depth)] = end as u16;
                *self.depth += 1;
            }
        }
        if *self.sent == required {
            self.audit()?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Independently recheck every node's required rounding increment. Saturating
    /// an aggregate amount alone is insufficient evidence of market conservation.
    pub fn audit(&self) -> Result<()> {
        if *self.sent != self.required()? {
            return Err(Error::Invariant);
        }
        let mut net = [0i32; MAX_NODES];
        for edge in 0..3 * self.count {
            let increment = self.capacities[2 * edge + 1];
            if increment > 1
                || self.capacities[2 * edge] > 1
                || increment + self.capacities[2 * edge] > 1
            {
                return Err(Error::Invariant);
            }
            if increment == 0 {
                continue;
            }
            let (start, end) = self.endpoints(2 * edge)?;
            net[start] += i32::from(increment);
            net[end] -= i32::from(increment);
        }
        for node in 0..self.count + 3 {
            if i64::from(net[node]) != self.balance(node)
                || self.capacities[self.auxiliary(node)] != 0
            {
                return Err(Error::Invariant);
            }
        }
        Ok(())
    }
}
