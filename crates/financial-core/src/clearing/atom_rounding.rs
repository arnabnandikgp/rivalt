//! Deterministic whole-atom movements on the member/market graph. Callers visit
//! nonzero transfers in market-major, stable member order, followed by cash.
//! Remainders must share an ordering and default to zero.
use crate::{Error, Result};
use std::cmp::Reverse;

struct Arc {
    to: usize,
    capacity: u64,
}
struct Network<R> {
    arcs: Vec<Arc>,
    outgoing: Vec<Vec<(u8, Reverse<R>, usize, usize)>>,
}

impl<R: Ord + Default> Network<R> {
    fn edge(&mut self, from: usize, to: usize, capacity: u64, priority: u8, remainder: R) -> usize {
        let index = self.arcs.len();
        self.arcs.push(Arc { to, capacity });
        self.arcs.push(Arc {
            to: from,
            capacity: 0,
        });
        self.outgoing[from].push((priority, Reverse(remainder), to, index));
        self.outgoing[to].push((2, Reverse(R::default()), from, index + 1));
        index
    }

    fn balance(&mut self, source: usize, sink: usize, mut required: u64) -> bool {
        for outgoing in &mut self.outgoing {
            outgoing.sort_unstable();
        }
        let mut parents = vec![usize::MAX; self.outgoing.len()];
        let mut stack = Vec::with_capacity(parents.len());
        while required > 0 {
            parents.fill(usize::MAX);
            parents[source] = self.arcs.len();
            stack.clear();
            stack.push((source, 0));
            while let Some((node, next)) = stack.last_mut() {
                if *node == sink {
                    break;
                }
                let Some(&(_, _, to, arc)) = self.outgoing[*node].get(*next) else {
                    stack.pop();
                    continue;
                };
                *next += 1;
                if self.arcs[arc].capacity > 0 && parents[to] == usize::MAX {
                    parents[to] = arc;
                    stack.push((to, 0));
                }
            }
            if parents[sink] == usize::MAX {
                return false;
            }
            // Every non-auxiliary residual edge has unit capacity.
            let mut node = sink;
            while node != source {
                let arc = parents[node];
                self.arcs[arc].capacity -= 1;
                self.arcs[arc ^ 1].capacity += 1;
                node = self.arcs[arc ^ 1].to;
            }
            required -= 1;
        }
        true
    }
}

pub struct AtomNetwork<R> {
    graph: Network<R>,
    needs: Vec<i128>,
    minimums: Vec<(usize, i128)>,
}

impl<R: Ord + Default> AtomNetwork<R> {
    pub fn new(supplies: Vec<i128>) -> Self {
        Self {
            graph: Network {
                arcs: vec![],
                outgoing: (0..supplies.len() + 2).map(|_| vec![]).collect(),
            },
            needs: supplies,
            minimums: vec![],
        }
    }

    pub fn transfer(
        &mut self,
        from: usize,
        to: usize,
        floor: i128,
        remainder: R,
        minimum: i128,
    ) -> Result<()> {
        if from >= self.needs.len()
            || to >= self.needs.len()
            || from == to
            || floor < 0
            || minimum < 0
        {
            return Err(Error::Invariant);
        }
        let upper = floor
            .checked_add(i128::from(remainder != R::default()))
            .ok_or(Error::Overflow)?;
        let lower = floor.max(minimum);
        if lower > upper {
            return Err(Error::Entitlement);
        }
        let source_need = self.needs[from].checked_sub(lower).ok_or(Error::Overflow)?;
        let destination_need = self.needs[to].checked_add(lower).ok_or(Error::Overflow)?;
        self.needs[from] = source_need;
        self.needs[to] = destination_need;
        let arc = self
            .graph
            .edge(from, to, (upper - lower) as u64, 1, remainder);
        self.minimums.push((arc, lower));
        Ok(())
    }

    pub fn finish(mut self) -> Result<Vec<i128>> {
        let source = self.needs.len();
        let sink = source + 1;
        let mut required = 0u64;
        let mut demand = 0u64;
        for (node, need) in self.needs.into_iter().enumerate() {
            let capacity = u64::try_from(need.unsigned_abs()).map_err(|_| Error::Overflow)?;
            if need > 0 {
                self.graph.edge(source, node, capacity, 0, R::default());
                required = required.checked_add(capacity).ok_or(Error::Overflow)?;
            } else if need < 0 {
                self.graph.edge(node, sink, capacity, 0, R::default());
                demand = demand.checked_add(capacity).ok_or(Error::Overflow)?;
            }
        }
        if demand != required {
            return Err(Error::Invariant);
        }
        if !self.graph.balance(source, sink, required) {
            return Err(Error::Entitlement);
        }
        Ok(self
            .minimums
            .into_iter()
            .map(|(arc, lower)| lower + i128::from(self.graph.arcs[arc ^ 1].capacity))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overflowing_destination_preserves_the_network() {
        let mut network = AtomNetwork::<u64>::new(vec![0, i128::MAX]);
        assert_eq!(network.transfer(0, 1, 1, 0, 0), Err(Error::Overflow));
        assert_eq!(network.needs, [0, i128::MAX]);
        assert!(network.graph.arcs.is_empty());
    }
}
