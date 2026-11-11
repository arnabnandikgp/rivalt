//! Native transport for the actual persisted graph cursor. Construction still
//! derives topology from verified scalar flows and orders in bounded steps. This is explicitly
//! not the future authenticated program construction/financial controller.
use super::*;
use crate::clearing::scalable::{
    active_work::Hierarchy,
    graph_build::{BuildStorage, GraphBuild},
    graph_work::{self as paged, Access, GraphStorage, GraphWork, Record},
    wide::LimbStorage,
};
struct Store {
    nodes: Vec<paged::Node>,
    arcs: Vec<paged::Arc>,
    adjacency: Vec<u64>,
    roots: Vec<paged::Root>,
    orders: [Vec<u64>; 2],
    active: Vec<u64>,
    allowed: [Option<Access>; 3],
    reads: core::cell::Cell<u64>,
    writes: u64,
}
impl Store {
    fn permit(&self, record: Record, writable: bool) -> Result<()> {
        if !self
            .allowed
            .iter()
            .flatten()
            .any(|access| access.record == record && (!writable || access.writable))
        {
            return Err(Error::Invariant);
        }
        Ok(())
    }
    fn read(&self, record: Record) -> Result<()> {
        self.permit(record, false)?;
        self.reads.set(self.reads.get() + 1);
        Ok(())
    }
    fn write(&mut self, record: Record) -> Result<()> {
        self.permit(record, true)?;
        self.writes += 1;
        Ok(())
    }
}
impl GraphStorage for Store {
    fn node(&self, index: u64) -> Result<paged::Node> {
        self.read(Record::Node(index))?;
        self.nodes.get(index as usize).copied().ok_or(Error::Bounds)
    }
    fn write_node(&mut self, index: u64, value: paged::Node) -> Result<()> {
        self.write(Record::Node(index))?;
        *self.nodes.get_mut(index as usize).ok_or(Error::Bounds)? = value;
        Ok(())
    }
    fn arc(&self, index: u64) -> Result<paged::Arc> {
        self.read(Record::Arc(index))?;
        self.arcs.get(index as usize).copied().ok_or(Error::Bounds)
    }
    fn write_arc(&mut self, index: u64, value: paged::Arc) -> Result<()> {
        self.write(Record::Arc(index))?;
        *self.arcs.get_mut(index as usize).ok_or(Error::Bounds)? = value;
        Ok(())
    }
    fn adjacency(&self, index: u64) -> Result<u64> {
        self.read(Record::Adjacency(index))?;
        self.adjacency
            .get(index as usize)
            .copied()
            .ok_or(Error::Bounds)
    }
    fn root(&self, index: u64) -> Result<paged::Root> {
        self.read(Record::Root(index))?;
        self.roots.get(index as usize).copied().ok_or(Error::Bounds)
    }
}
impl BuildStorage for Store {
    fn order(&self, market: u8, position: u64) -> Result<u64> {
        self.read(Record::Order { market, position })?;
        self.orders
            .get(usize::from(market))
            .and_then(|order| order.get(position as usize))
            .copied()
            .ok_or(Error::Bounds)
    }
    fn write_adjacency(&mut self, position: u64, arc: u64) -> Result<()> {
        self.write(Record::Adjacency(position))?;
        *self
            .adjacency
            .get_mut(position as usize)
            .ok_or(Error::Bounds)? = arc;
        Ok(())
    }
}
impl LimbStorage for Store {
    fn read(&self, register: u32, limb: u64) -> Result<u64> {
        if register != paged::ACTIVE_REGISTER {
            return Err(Error::Bounds);
        }
        self.read(Record::Active(limb))?;
        self.active.get(limb as usize).copied().ok_or(Error::Bounds)
    }
    fn write(&mut self, register: u32, limb: u64, value: u64) -> Result<()> {
        if register != paged::ACTIVE_REGISTER {
            return Err(Error::Bounds);
        }
        self.write(Record::Active(limb))?;
        *self.active.get_mut(limb as usize).ok_or(Error::Bounds)? = value;
        Ok(())
    }
}
pub struct Outcome {
    pub rounded: Rounded,
    pub steps: u64,
    pub reads: u64,
    pub writes: u64,
    pub augmentations: u64,
    pub build_metrics: [u64; 3],
}
impl Circulation<'_, '_> {
    pub fn run_paged(
        &self,
        budget: u64,
        orders: [&[u64]; 2],
        arithmetic: &mut Arithmetic,
    ) -> Result<Outcome> {
        if self.steps != 0 || budget == 0 || budget > 128 {
            return Err(Error::Bounds);
        }
        let length = self.adjacency.len() as u64;
        let hierarchy = Hierarchy::new(length, paged::ACTIVE_REGISTER)?;
        let mut store = Store {
            nodes: self
                .nodes
                .iter()
                .enumerate()
                .map(|(index, node)| paged::Node {
                    first: node.first as u64,
                    end: node.end as u64,
                    balance: self.balances.get(index).copied().unwrap_or(0),
                    ..Default::default()
                })
                .collect(),
            arcs: self
                .arcs
                .iter()
                .enumerate()
                .map(|(index, arc)| paged::Arc {
                    start: arc.start as u64,
                    end: arc.end as u64,
                    capacity: arc.capacity,
                    position: self.positions[index] as u64,
                })
                .collect(),
            adjacency: self.adjacency.iter().map(|value| *value as u64).collect(),
            roots: self
                .plan
                .rows
                .iter()
                .enumerate()
                .map(|(index, row)| paged::Root {
                    cash: row.cash,
                    whole: self.plan.floors[index].whole,
                    order: [0, 1, 2], // Replaced by exact verified root order below before construction.
                    directions: row.claims.map(|claim| claim.signum() as i8),
                    fractional: self.plan.floors[index].fractional,
                })
                .collect(),
            active: vec![u64::MAX; hierarchy.words() as usize],
            orders: orders.map(|order| order.to_vec()),
            allowed: [None; 3],
            reads: core::cell::Cell::new(0),
            writes: 0,
        };
        for (index, root) in store.roots.iter_mut().enumerate() {
            let remainders = self.plan.remainders(index, arithmetic)?;
            root.order.sort_by(|left, right| {
                arithmetic
                    .compare(
                        &remainders[usize::from(*right)],
                        &remainders[usize::from(*left)],
                    )
                    .then(left.cmp(right))
            });
        }
        let expected_nodes = store.nodes.clone();
        let expected_arcs = store.arcs.clone();
        let expected_adjacency = store.adjacency.clone();
        // Poison old graph records. Construction must overwrite every readable
        // record and initialize the entire active hierarchy before circulation.
        store.nodes.fill(paged::Node {
            first: u64::MAX,
            ..Default::default()
        });
        store.arcs.fill(paged::Arc {
            capacity: u64::MAX,
            ..Default::default()
        });
        store.adjacency = vec![u64::MAX; store.arcs.len()];
        let cash_before = self.plan.rows.iter().try_fold(0u64, |sum, row| {
            sum.checked_add(row.cash).ok_or(Error::Overflow)
        })?;
        let budgets = [
            self.plan.pools[0] + self.plan.spent[0],
            self.plan.pools[1] + self.plan.spent[1],
        ];
        let mut build = GraphBuild::new(self.count as u64, cash_before, budgets)?;
        let mut build_steps = 0;
        while !build.is_done() {
            for _ in 0..budget {
                if build.is_done() {
                    break;
                }
                store.allowed = build.accesses()?;
                let before = store.reads.get() + store.writes;
                build.step(&mut store)?;
                if store.reads.get() + store.writes - before > 3 {
                    return Err(Error::Invariant);
                }
                build_steps += 1;
            }
            build = GraphBuild::from_checkpoint(
                &build.checkpoint(),
                self.count as u64,
                cash_before,
                budgets,
            )?;
        }
        if build.result()? != (length, self.required)
            || store.nodes != expected_nodes
            || store.arcs != expected_arcs
            || store.adjacency[..length as usize] != expected_adjacency
            || build.step(&mut store).is_ok()
        {
            return Err(Error::Invariant);
        }
        let build_metrics = [build_steps, store.reads.get(), store.writes];
        store.reads.set(0);
        store.writes = 0;
        let mut work = GraphWork::new(self.count as u64, length, self.required)?;
        let mut steps = 0;
        while !work.is_done() {
            for _ in 0..budget {
                if work.is_done() {
                    break;
                }
                store.allowed = work.accesses()?;
                let before = store.reads.get() + store.writes;
                work.step(&mut store)?;
                if store.reads.get() + store.writes - before > 4 {
                    return Err(Error::Invariant);
                }
                steps += 1;
            }
            work = GraphWork::from_checkpoint(
                &work.checkpoint(),
                self.count as u64,
                length,
                self.required,
            )?;
        }
        if work.step(&mut store).is_ok() || work.accesses().is_ok() {
            return Err(Error::Invariant);
        }
        let mut cash = zeroed::<u64>(self.count)?;
        let mut movements = zeroed::<[i64; 2]>(self.count)?;
        for (index, row) in self.plan.rows.iter().enumerate() {
            for kind in 0..3 {
                let increment = store.arcs[2 * (kind * self.count + index) + 1].capacity;
                let amount = self.plan.floors[index].whole[kind]
                    .checked_add(increment)
                    .ok_or(Error::Overflow)?;
                if kind == 2 {
                    cash[index] = amount;
                } else {
                    movements[index][kind] = i64::try_from(amount).map_err(|_| Error::Bounds)?
                        * row.claims[kind].signum() as i64;
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
        }
        Ok(Outcome {
            rounded: Rounded {
                cash,
                movements,
                remaining_insurance: [
                    self.plan.insurance[0] - self.plan.spent[0],
                    self.plan.insurance[1] - self.plan.spent[1],
                ],
                retained_fees: self.plan.fees,
            },
            steps,
            build_metrics,
            reads: store.reads.get(),
            writes: store.writes,
            augmentations: work.augmentations(),
        })
    }
}
