//! Compact canonical residual circulation, with bounded resumable graph steps.
//! Scalar storage is O(N); wide remainders are reconstructed for order checks.
pub mod paged;

use super::{
    active::Active,
    number::{zeroed, Arithmetic, Number},
    settlement::Verified,
};
use crate::{Error, Result, MAX_CASH};
use core::cmp::Ordering;

#[derive(Clone, Copy, Debug, Default)]
struct Arc {
    start: usize,
    end: usize,
    capacity: u64,
}
#[derive(Clone, Copy, Debug, Default)]
struct Node {
    first: usize,
    end: usize,
    next: usize,
    generation: u64,
    parent: usize,
}
#[derive(Clone, Copy, Debug)]
enum Stage {
    Search,
    Minimum { node: usize, amount: u64 },
    Apply { node: usize, amount: u64 },
    AuditEdges(usize),
    AuditNodes(usize),
    Done,
}

#[derive(Clone, Debug)]
pub struct Circulation<'a, 'rows> {
    plan: &'a Verified<'rows>,
    count: usize,
    arcs: Vec<Arc>,
    adjacency: Vec<usize>,
    positions: Vec<usize>,
    nodes: Vec<Node>,
    balances: Vec<i128>,
    net: Vec<i128>,
    active: Active,
    path: Vec<usize>,
    depth: usize,
    required: u64,
    sent: u64,
    stage: Stage,
    pub augmentations: u64,
    pub arc_visits: u128,
    pub steps: u128,
}

pub struct Rounded {
    pub cash: Vec<u64>,
    pub movements: Vec<[i64; 2]>,
    pub remaining_insurance: [u64; 2],
    pub retained_fees: [u64; 2],
}

fn verify_orders(
    plan: &Verified<'_>,
    orders: [&[u64]; 2],
    arithmetic: &mut Arithmetic,
) -> Result<()> {
    let count = plan.rows.len();
    for market in 0..2 {
        if orders[market].len() != count {
            return Err(Error::Invariant);
        }
        let mut seen = zeroed::<bool>(count)?;
        let mut previous: Option<(usize, Number)> = None;
        for &identifier in orders[market] {
            let index = usize::try_from(identifier).map_err(|_| Error::Bounds)?;
            let marker = seen.get_mut(index).ok_or(Error::Invariant)?;
            if *marker {
                return Err(Error::Invariant);
            }
            *marker = true;
            if plan.rows[index].claims[market] <= 0 {
                continue;
            }
            let mut remainders = plan.remainders(index, arithmetic)?;
            let remainder = core::mem::take(&mut remainders[market]);
            if let Some((last, value)) = previous {
                match arithmetic.compare(&value, &remainder) {
                    Ordering::Less => return Err(Error::Invariant),
                    Ordering::Equal if last >= index => return Err(Error::Invariant),
                    _ => {}
                }
            }
            previous = Some((index, remainder));
        }
    }
    Ok(())
}

impl<'a, 'rows> Circulation<'a, 'rows> {
    /// Original edge IDs are market0 rows, market1 rows, then cash rows. Zero
    /// claims have no adjacency. Auxiliary edges follow in node order. Keeping
    /// their gaps preserves the same relative ties as the dense original graph.
    pub fn new(
        plan: &'a Verified<'rows>,
        orders: [&[u64]; 2],
        arithmetic: &mut Arithmetic,
    ) -> Result<Self> {
        verify_orders(plan, orders, arithmetic)?;
        let count = plan.rows.len();
        let node_count = count.checked_add(5).ok_or(Error::Overflow)?;
        let arc_count = count
            .checked_mul(8)
            .and_then(|value| value.checked_add(6))
            .ok_or(Error::Overflow)?;
        // The residual required amount is <=3*N, and each augmentation sends
        // at least one atom. Check representability before allocating anything.
        let maximum = u64::try_from(count)
            .map_err(|_| Error::Bounds)?
            .checked_mul(3)
            .ok_or(Error::Overflow)?;
        let mut graph = Self {
            plan,
            count,
            arcs: zeroed(arc_count)?,
            adjacency: Vec::new(),
            positions: zeroed(arc_count)?,
            nodes: zeroed(node_count)?,
            balances: zeroed(count + 3)?,
            net: zeroed(count + 3)?,
            active: Active::new(arc_count)?,
            path: zeroed(node_count)?,
            depth: 1,
            required: 0,
            sent: 0,
            stage: Stage::Search,
            augmentations: 0,
            arc_visits: 0,
            steps: 0,
        };
        graph
            .adjacency
            .try_reserve_exact(arc_count)
            .map_err(|_| Error::Bounds)?;
        graph.positions.fill(usize::MAX);
        let mut supplies = 0i128;
        for (index, row) in plan.rows.iter().enumerate() {
            graph.balances[index] = i128::from(row.cash);
            supplies = supplies
                .checked_add(i128::from(row.cash))
                .ok_or(Error::Overflow)?;
        }
        for market in 0..2 {
            let amount = plan.pools[market]
                .checked_add(plan.spent[market])
                .ok_or(Error::Overflow)?;
            graph.balances[count + market] = i128::from(amount);
            supplies = supplies
                .checked_add(i128::from(amount))
                .ok_or(Error::Overflow)?;
        }
        graph.balances[count + 2] = -supplies;
        for kind in 0..3 {
            for (index, row) in plan.rows.iter().enumerate() {
                let (start, end) = if kind == 2 {
                    (index, count + 2)
                } else if row.claims[kind] > 0 {
                    (count + kind, index)
                } else if row.claims[kind] < 0 {
                    (index, count + kind)
                } else {
                    continue;
                };
                let edge = kind * count + index;
                graph.set_arc(
                    2 * edge,
                    start,
                    end,
                    u64::from(plan.floors[index].fractional[kind]),
                );
                let whole = i128::from(plan.floors[index].whole[kind]);
                graph.balances[start] = graph.balances[start]
                    .checked_sub(whole)
                    .ok_or(Error::Overflow)?;
                graph.balances[end] = graph.balances[end]
                    .checked_add(whole)
                    .ok_or(Error::Overflow)?;
            }
        }
        if graph.balances.iter().try_fold(0i128, |sum, value| {
            sum.checked_add(*value).ok_or(Error::Overflow)
        })? != 0
        {
            return Err(Error::Invariant);
        }
        for node in 0..count + 3 {
            let balance = graph.balances[node];
            let capacity = u64::try_from(balance.unsigned_abs()).map_err(|_| Error::Bounds)?;
            if capacity > maximum {
                return Err(Error::Invariant);
            }
            let (start, end) = if balance > 0 {
                graph.required = graph
                    .required
                    .checked_add(capacity)
                    .ok_or(Error::Overflow)?;
                (graph.source(), node)
            } else {
                (node, graph.sink())
            };
            graph.set_arc(graph.auxiliary(node), start, end, capacity);
        }
        if graph.required > maximum {
            return Err(Error::Invariant);
        }
        // Adjacency is constructed from verified inputs, never an arbitrary
        // graph supplied by a keeper. Priority: auxiliary, forward remainder,
        // reverse repair by destination/stable edge ID.
        for node in 0..node_count {
            graph.nodes[node].first = graph.adjacency.len();
            if node == graph.source() {
                for target in 0..count + 3 {
                    if graph.balances[target] > 0 {
                        graph.append(node, graph.auxiliary(target))?;
                    }
                }
            } else if node == graph.sink() {
                for target in 0..count + 3 {
                    if graph.balances[target] < 0 {
                        graph.append(node, graph.auxiliary(target) + 1)?;
                    }
                }
            } else {
                if graph.balances[node] < 0 {
                    graph.append(node, graph.auxiliary(node))?;
                }
                if node < count {
                    let remainders = plan.remainders(node, arithmetic)?;
                    let mut kinds = [0usize, 1, 2];
                    kinds.sort_by(|first, second| {
                        arithmetic
                            .compare(&remainders[*second], &remainders[*first])
                            .then(first.cmp(second))
                    });
                    for kind in kinds {
                        if kind == 2 || plan.rows[node].claims[kind] < 0 {
                            graph.append(node, 2 * (kind * count + node))?;
                        }
                    }
                    for market in 0..2 {
                        if plan.rows[node].claims[market] > 0 {
                            graph.append(node, 2 * (market * count + node) + 1)?;
                        }
                    }
                } else if node < count + 2 {
                    let market = node - count;
                    for &identifier in orders[market] {
                        let index = usize::try_from(identifier).map_err(|_| Error::Bounds)?;
                        if plan.rows[index].claims[market] > 0 {
                            graph.append(node, 2 * (market * count + index))?;
                        }
                    }
                    for index in 0..count {
                        if plan.rows[index].claims[market] < 0 {
                            graph.append(node, 2 * (market * count + index) + 1)?;
                        }
                    }
                } else {
                    for index in 0..count {
                        graph.append(node, 2 * (2 * count + index) + 1)?;
                    }
                }
                if graph.balances[node] > 0 {
                    graph.append(node, graph.auxiliary(node) + 1)?;
                }
            }
            graph.nodes[node].end = graph.adjacency.len();
        }
        graph.restart();
        Ok(graph)
    }

    fn source(&self) -> usize {
        self.count + 3
    }
    fn sink(&self) -> usize {
        self.count + 4
    }
    fn auxiliary(&self, node: usize) -> usize {
        2 * (3 * self.count + node)
    }
    fn set_arc(&mut self, arc: usize, start: usize, end: usize, capacity: u64) {
        self.arcs[arc] = Arc {
            start,
            end,
            capacity,
        };
        self.arcs[arc + 1] = Arc {
            start: end,
            end: start,
            capacity: 0,
        };
    }
    fn append(&mut self, node: usize, arc: usize) -> Result<()> {
        if self.arcs[arc].start != node || self.positions[arc] != usize::MAX {
            return Err(Error::Invariant);
        }
        self.positions[arc] = self.adjacency.len();
        self.active
            .set(self.adjacency.len(), self.arcs[arc].capacity != 0)?;
        self.adjacency.push(arc);
        Ok(())
    }
    fn restart(&mut self) {
        let source = self.source();
        self.nodes[source].generation = self.augmentations + 1;
        self.nodes[source].next = self.nodes[source].first;
        self.path[0] = source;
        self.depth = 1;
        self.stage = if self.sent == self.required {
            Stage::AuditEdges(0)
        } else {
            Stage::Search
        };
    }
    pub fn is_done(&self) -> bool {
        matches!(self.stage, Stage::Done)
    }
    pub fn active_words(&self) -> usize {
        self.active.words()
    }
    pub fn active_reads(&self) -> u128 {
        self.active.reads
    }
    pub fn active_writes(&self) -> u128 {
        self.active.writes
    }
    /// Native scalar payload only; excludes allocator metadata/capacity slack.
    /// The account encoding/rent must be measured separately in P54B/P54C.
    pub fn payload_bytes(&self) -> usize {
        self.arcs.len() * core::mem::size_of::<Arc>()
            + (self.adjacency.len() + self.positions.len() + self.path.len())
                * core::mem::size_of::<usize>()
            + self.nodes.len() * core::mem::size_of::<Node>()
            + (self.balances.len() + self.net.len()) * core::mem::size_of::<i128>()
            + self.active.words() * 8
    }

    /// One DFS transition, one path edge, or one audit item. Search does at most
    /// one hierarchical successor query; apply updates two paths of <=11 words.
    /// No operation clears or walks the whole cohort. Generation marks retain
    /// the canonical visited set without an O(N) reset per augmentation.
    pub fn step(&mut self) -> Result<()> {
        if self.is_done() {
            return Err(Error::Bounds);
        }
        self.steps = self.steps.checked_add(1).ok_or(Error::Overflow)?;
        match self.stage {
            Stage::Search => {
                if self.depth == 0 {
                    return Err(Error::Invariant);
                }
                let node = self.path[self.depth - 1];
                let Some(position) = self
                    .active
                    .next(self.nodes[node].next, self.nodes[node].end)?
                else {
                    self.depth -= 1;
                    return Ok(());
                };
                self.nodes[node].next = position + 1;
                let identifier = self.adjacency[position];
                let arc = self.arcs[identifier];
                self.arc_visits += 1;
                if arc.capacity == 0 || arc.start != node {
                    return Err(Error::Invariant);
                }
                if self.nodes[arc.end].generation == self.augmentations + 1 {
                    return Ok(());
                }
                self.nodes[arc.end].generation = self.augmentations + 1;
                self.nodes[arc.end].parent = identifier;
                self.nodes[arc.end].next = self.nodes[arc.end].first;
                if arc.end == self.sink() {
                    self.stage = Stage::Minimum {
                        node: arc.end,
                        amount: self.required - self.sent,
                    };
                } else {
                    *self.path.get_mut(self.depth).ok_or(Error::Invariant)? = arc.end;
                    self.depth += 1;
                }
            }
            Stage::Minimum { node, amount } => {
                if node == self.source() {
                    if amount == 0 {
                        return Err(Error::Invariant);
                    }
                    self.stage = Stage::Apply {
                        node: self.sink(),
                        amount,
                    };
                } else {
                    let arc = self.arcs[self.nodes[node].parent];
                    self.stage = Stage::Minimum {
                        node: arc.start,
                        amount: amount.min(arc.capacity),
                    };
                }
            }
            Stage::Apply { node, amount } => {
                if node == self.source() {
                    self.sent = self.sent.checked_add(amount).ok_or(Error::Overflow)?;
                    self.augmentations =
                        self.augmentations.checked_add(1).ok_or(Error::Overflow)?;
                    if self.sent > self.required || self.augmentations > self.required {
                        return Err(Error::Invariant);
                    }
                    self.restart();
                } else {
                    let identifier = self.nodes[node].parent;
                    let previous = self.arcs[identifier].start;
                    self.arcs[identifier].capacity = self.arcs[identifier]
                        .capacity
                        .checked_sub(amount)
                        .ok_or(Error::Invariant)?;
                    self.arcs[identifier ^ 1].capacity = self.arcs[identifier ^ 1]
                        .capacity
                        .checked_add(amount)
                        .ok_or(Error::Overflow)?;
                    for arc in [identifier, identifier ^ 1] {
                        self.active
                            .set(self.positions[arc], self.arcs[arc].capacity != 0)?;
                    }
                    self.stage = Stage::Apply {
                        node: previous,
                        amount,
                    };
                }
            }
            Stage::AuditEdges(edge) => {
                if edge == 3 * self.count {
                    self.stage = Stage::AuditNodes(0);
                } else {
                    let forward = self.arcs[2 * edge];
                    let increment = self.arcs[2 * edge + 1].capacity;
                    let fractional =
                        self.plan.floors[edge % self.count].fractional[edge / self.count];
                    if increment + forward.capacity != u64::from(fractional) {
                        return Err(Error::Invariant);
                    }
                    if increment != 0 {
                        self.net[forward.start] = self.net[forward.start]
                            .checked_add(i128::from(increment))
                            .ok_or(Error::Overflow)?;
                        self.net[forward.end] = self.net[forward.end]
                            .checked_sub(i128::from(increment))
                            .ok_or(Error::Overflow)?;
                    }
                    self.stage = Stage::AuditEdges(edge + 1);
                }
            }
            Stage::AuditNodes(node) => {
                if node == self.count + 3 {
                    self.stage = Stage::Done;
                } else {
                    if self.net[node] != self.balances[node]
                        || self.arcs[self.auxiliary(node)].capacity != 0
                    {
                        return Err(Error::Invariant);
                    }
                    self.stage = Stage::AuditNodes(node + 1);
                }
            }
            Stage::Done => return Err(Error::Bounds),
        }
        Ok(())
    }

    pub fn result(&self) -> Result<Rounded> {
        let plan = self.plan;
        if !self.is_done() {
            return Err(Error::Invariant);
        }
        let mut cash = zeroed(self.count)?;
        let mut movements = zeroed::<[i64; 2]>(self.count)?;
        let mut totals = [0i128; 2];
        let mut total_cash = 0u64;
        let mut expected_cash = 0u64;
        for (index, row) in plan.rows.iter().enumerate() {
            for kind in 0..3 {
                let increment = self.arcs[2 * (kind * self.count + index) + 1].capacity;
                if increment > u64::from(plan.floors[index].fractional[kind]) {
                    return Err(Error::Invariant);
                }
                let amount = plan.floors[index].whole[kind]
                    .checked_add(increment)
                    .ok_or(Error::Overflow)?;
                if kind == 2 {
                    cash[index] = amount;
                } else {
                    movements[index][kind] = i64::try_from(amount).map_err(|_| Error::Overflow)?
                        * row.claims[kind].signum() as i64;
                    totals[kind] = totals[kind]
                        .checked_add(i128::from(movements[index][kind]))
                        .ok_or(Error::Overflow)?;
                }
            }
            if cash[index] > MAX_CASH
                || cash[index] < row.cash - row.collected()?
                || i128::from(cash[index])
                    != i128::from(row.cash)
                        + i128::from(movements[index][0])
                        + i128::from(movements[index][1])
            {
                return Err(Error::Invariant);
            }
            total_cash = total_cash.checked_add(cash[index]).ok_or(Error::Overflow)?;
            expected_cash = expected_cash.checked_add(row.cash).ok_or(Error::Overflow)?;
        }
        for market in 0..2 {
            let budget = plan.pools[market] + plan.spent[market];
            if totals[market] != i128::from(budget) {
                return Err(Error::Invariant);
            }
            expected_cash = expected_cash.checked_add(budget).ok_or(Error::Overflow)?;
        }
        let mut remaining_insurance = [0; 2];
        let mut reconciled = total_cash;
        for market in 0..2 {
            remaining_insurance[market] = plan.insurance[market]
                .checked_sub(plan.spent[market])
                .ok_or(Error::Invariant)?;
            reconciled = reconciled
                .checked_add(remaining_insurance[market])
                .ok_or(Error::Overflow)?
                .checked_add(plan.fees[market])
                .ok_or(Error::Overflow)?;
        }
        if total_cash != expected_cash || reconciled != plan.allocated {
            return Err(Error::Invariant);
        }
        Ok(Rounded {
            cash,
            movements,
            remaining_insurance,
            retained_fees: plan.fees,
        })
    }
}
