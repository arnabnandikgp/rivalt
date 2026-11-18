//! Scalar record layout inside the existing 256-word authenticated limb pages.
//! No record crosses a page. These codecs/addresses are not account authority;
//! the program adapter authenticates epoch, attempt, revision, owner and PDA.
use super::{
    active_work::Hierarchy,
    graph_build::BuildStorage,
    graph_work::{Access, Arc, GraphStorage, Node, Record, Root, ACTIVE_REGISTER},
    pages::{PagePlan, PAGE_WORDS},
    wide::{required_limbs, LimbStorage, WordAccess},
};
use crate::{Error, Result, MAX_CASH};
pub const FLOWS: u32 = 64;
pub const NODES: u32 = 65;
pub const ARCS: u32 = 66;
pub const ADJACENCY: u32 = 67;
pub const ACTIVE: u32 = 68;
pub const ORDER_BTC: u32 = 69;
pub const ORDER_ETH: u32 = 70;
pub const FLOW_WORDS: u64 = 7;
pub const NODE_WORDS: u64 = 9;
pub const ARC_WORDS: u64 = 4;
#[derive(Clone, Copy, Debug)]
pub struct Layout {
    pub count: u64,
    arcs: u64,
}
fn packed_address(index: u64, words: u64) -> Result<u64> {
    let records = PAGE_WORDS / words;
    (index / records)
        .checked_mul(PAGE_WORDS)
        .and_then(|base| base.checked_add(index % records * words))
        .ok_or(Error::Overflow)
}
fn packed_capacity(count: u64, words: u64) -> Result<u64> {
    if count == 0 {
        return Err(Error::Bounds);
    }
    packed_address(count - 1, words)?
        .checked_add(words)
        .ok_or(Error::Overflow)
}
impl Layout {
    pub fn new(count: u64) -> Result<Self> {
        if count == 0 {
            return Err(Error::Bounds);
        }
        let arcs = count
            .checked_mul(8)
            .and_then(|value| value.checked_add(6))
            .ok_or(Error::Overflow)?;
        packed_capacity(arcs, ARC_WORDS)?;
        packed_capacity(count + 5, NODE_WORDS)?;
        packed_capacity(count, FLOW_WORDS)?;
        Ok(Self { count, arcs })
    }
    pub fn capacity(&self, register: u32) -> Result<u64> {
        match register {
            0..=45 => required_limbs(self.count),
            FLOWS => packed_capacity(self.count, FLOW_WORDS),
            NODES => packed_capacity(self.count + 5, NODE_WORDS),
            ARCS => packed_capacity(self.arcs, ARC_WORDS),
            ADJACENCY => Ok(self.arcs),
            ACTIVE => Ok(Hierarchy::new(self.arcs, 0)?.words()),
            ORDER_BTC | ORDER_ETH => Ok(self.count),
            _ => Err(Error::Bounds),
        }
    }
    pub fn maximum_capacity(&self) -> Result<u64> {
        Ok(self.capacity(ARCS)?.max(self.capacity(0)?))
    }
    pub fn location(&self, record: Record) -> Result<(u32, u64)> {
        let (register, index, count, words) = match record {
            Record::Root(index) => (FLOWS, index, self.count, FLOW_WORDS),
            Record::Node(index) => (NODES, index, self.count + 5, NODE_WORDS),
            Record::Arc(index) => (ARCS, index, self.arcs, ARC_WORDS),
            Record::Adjacency(index) => (ADJACENCY, index, self.arcs, 1),
            Record::Active(index) => (ACTIVE, index, self.capacity(ACTIVE)?, 1),
            Record::Order { market, position } => {
                if market > 1 {
                    return Err(Error::Bounds);
                }
                (ORDER_BTC + u32::from(market), position, self.count, 1)
            }
        };
        if index >= count {
            return Err(Error::Bounds);
        }
        Ok((register, packed_address(index, words)?))
    }
    pub fn accesses(&self, records: [Option<Access>; 3]) -> Result<[Option<WordAccess>; 3]> {
        let mut result = [None; 3];
        for (index, access) in records.into_iter().enumerate() {
            if let Some(access) = access {
                let (register, limb) = self.location(access.record)?;
                result[index] = Some(WordAccess {
                    register,
                    limb,
                    writable: access.writable,
                });
            }
        }
        Ok(result)
    }
    pub fn plan(&self, records: [Option<Access>; 3]) -> Result<PagePlan> {
        PagePlan::next(self.accesses(records)?, self.maximum_capacity()?)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FlowRecord {
    pub id: u64,
    pub cash: u64,
    pub whole: [u64; 3],
    pub directions: [i8; 2],
    pub fractional: [bool; 3],
    pub order: [u8; 3],
    pub seen_attempt: u64,
    pub seen_mask: u8,
    pub applied: bool,
}
impl FlowRecord {
    fn validate(&self) -> Result<()> {
        let mut order = self.order;
        order.sort_unstable();
        if self.cash > MAX_CASH
            || self.whole[2] > MAX_CASH
            || self.whole.iter().any(|value| *value >= 1 << 58)
            || self
                .directions
                .iter()
                .any(|value| !(-1..=1).contains(value))
            || order != [0, 1, 2]
            || self.seen_mask > 3
            || (self.seen_attempt == 0 && self.seen_mask != 0)
            || (self.applied && self.seen_mask != 3)
            || (0..2).any(|market| {
                self.directions[market] == 0 && (self.whole[market] != 0 || self.fractional[market])
            })
        {
            return Err(Error::Bounds);
        }
        Ok(())
    }
    pub fn root(&self) -> Root {
        Root {
            cash: self.cash,
            whole: self.whole,
            directions: self.directions,
            fractional: self.fractional,
            order: self.order,
        }
    }
    pub fn words(&self) -> Result<[u64; 7]> {
        self.validate()?;
        let mut bytes = [0u8; 56];
        for (index, value) in [
            self.id,
            self.cash,
            self.whole[0],
            self.whole[1],
            self.whole[2],
        ]
        .into_iter()
        .enumerate()
        {
            bytes[index * 8..index * 8 + 8].copy_from_slice(&value.to_le_bytes());
        }
        bytes[40] = self.directions[0] as u8;
        bytes[41] = self.directions[1] as u8;
        bytes[42] = u8::from(self.fractional[0])
            | (u8::from(self.fractional[1]) << 1)
            | (u8::from(self.fractional[2]) << 2);
        bytes[43..46].copy_from_slice(&self.order);
        bytes[46..54].copy_from_slice(&self.seen_attempt.to_le_bytes());
        bytes[54] = self.seen_mask;
        bytes[55] = u8::from(self.applied);
        Ok(core::array::from_fn(|index| {
            u64::from_le_bytes(bytes[index * 8..index * 8 + 8].try_into().unwrap())
        }))
    }
    pub fn from_words(words: [u64; 7]) -> Result<Self> {
        let mut bytes = [0u8; 56];
        for (index, word) in words.into_iter().enumerate() {
            bytes[index * 8..index * 8 + 8].copy_from_slice(&word.to_le_bytes());
        }
        if bytes[42] > 7 || bytes[55] > 1 {
            return Err(Error::Bounds);
        }
        let row = Self {
            id: words[0],
            cash: words[1],
            whole: [words[2], words[3], words[4]],
            directions: [bytes[40] as i8, bytes[41] as i8],
            fractional: core::array::from_fn(|index| bytes[42] & (1 << index) != 0),
            order: bytes[43..46].try_into().unwrap(),
            seen_attempt: u64::from_le_bytes(bytes[46..54].try_into().unwrap()),
            seen_mask: bytes[54],
            applied: bytes[55] != 0,
        };
        row.validate()?;
        Ok(row)
    }
}
pub struct GraphPages<'a, S: LimbStorage> {
    pub layout: Layout,
    pub store: &'a mut S,
}
impl<S: LimbStorage> GraphPages<'_, S> {
    fn read<const N: usize>(&self, record: Record) -> Result<[u64; N]> {
        let (register, start) = self.layout.location(record)?;
        if start % PAGE_WORDS + N as u64 > PAGE_WORDS {
            return Err(Error::Bounds);
        }
        let mut words = [0; N];
        for (index, word) in words.iter_mut().enumerate() {
            *word = self.store.read(register, start + index as u64)?;
        }
        Ok(words)
    }
    fn write<const N: usize>(&mut self, record: Record, words: [u64; N]) -> Result<()> {
        let (register, start) = self.layout.location(record)?;
        if start % PAGE_WORDS + N as u64 > PAGE_WORDS {
            return Err(Error::Bounds);
        }
        for (index, word) in words.into_iter().enumerate() {
            self.store.write(register, start + index as u64, word)?;
        }
        Ok(())
    }
    pub fn flow(&self, ordinal: u64) -> Result<FlowRecord> {
        FlowRecord::from_words(self.read(Record::Root(ordinal))?)
    }
    pub fn write_flow(&mut self, ordinal: u64, row: FlowRecord) -> Result<()> {
        self.write(Record::Root(ordinal), row.words()?)
    }
    pub fn write_order(&mut self, market: u8, position: u64, ordinal: u64) -> Result<()> {
        if ordinal >= self.layout.count {
            return Err(Error::Bounds);
        }
        self.write(Record::Order { market, position }, [ordinal])
    }
}
fn signed(low: u64, high: u64) -> i128 {
    (u128::from(low) | (u128::from(high) << 64)) as i128
}
impl<S: LimbStorage> GraphStorage for GraphPages<'_, S> {
    fn node(&self, index: u64) -> Result<Node> {
        let words = self.read::<9>(Record::Node(index))?;
        Ok(Node {
            first: words[0],
            end: words[1],
            next: words[2],
            generation: words[3],
            parent: words[4],
            balance: signed(words[5], words[6]),
            net: signed(words[7], words[8]),
        })
    }
    fn write_node(&mut self, index: u64, node: Node) -> Result<()> {
        self.write(
            Record::Node(index),
            [
                node.first,
                node.end,
                node.next,
                node.generation,
                node.parent,
                node.balance as u64,
                (node.balance as u128 >> 64) as u64,
                node.net as u64,
                (node.net as u128 >> 64) as u64,
            ],
        )
    }
    fn arc(&self, index: u64) -> Result<Arc> {
        let words = self.read::<4>(Record::Arc(index))?;
        Ok(Arc {
            start: words[0],
            end: words[1],
            capacity: words[2],
            position: words[3],
        })
    }
    fn write_arc(&mut self, index: u64, arc: Arc) -> Result<()> {
        self.write(
            Record::Arc(index),
            [arc.start, arc.end, arc.capacity, arc.position],
        )
    }
    fn adjacency(&self, index: u64) -> Result<u64> {
        Ok(self.read::<1>(Record::Adjacency(index))?[0])
    }
    fn root(&self, index: u64) -> Result<Root> {
        Ok(self.flow(index)?.root())
    }
}
impl<S: LimbStorage> BuildStorage for GraphPages<'_, S> {
    fn order(&self, market: u8, position: u64) -> Result<u64> {
        Ok(self.read::<1>(Record::Order { market, position })?[0])
    }
    fn write_adjacency(&mut self, position: u64, arc: u64) -> Result<()> {
        if arc >= self.layout.arcs {
            return Err(Error::Bounds);
        }
        self.write(Record::Adjacency(position), [arc])
    }
}
impl<S: LimbStorage> LimbStorage for GraphPages<'_, S> {
    fn read(&self, register: u32, limb: u64) -> Result<u64> {
        if register != ACTIVE_REGISTER {
            return Err(Error::Bounds);
        }
        Ok(self.read::<1>(Record::Active(limb))?[0])
    }
    fn write(&mut self, register: u32, limb: u64, value: u64) -> Result<()> {
        if register != ACTIVE_REGISTER {
            return Err(Error::Bounds);
        }
        self.write(Record::Active(limb), [value])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    struct Store {
        words: BTreeMap<(u32, u64), u64>,
        plan: PagePlan,
    }
    impl LimbStorage for Store {
        fn read(&self, register: u32, limb: u64) -> Result<u64> {
            if !self.plan.permits(register, limb, false) {
                return Err(Error::Bounds);
            }
            Ok(*self.words.get(&(register, limb)).unwrap_or(&u64::MAX))
        }
        fn write(&mut self, register: u32, limb: u64, value: u64) -> Result<()> {
            if !self.plan.permits(register, limb, true) {
                return Err(Error::Bounds);
            }
            self.words.insert((register, limb), value);
            Ok(())
        }
    }
    #[test]
    fn scalar_layout_packs_records_without_crossing_pages_or_adding_population_limits() {
        let layout = Layout::new(65).unwrap();
        assert_eq!(
            [
                layout.capacity(FLOWS).unwrap(),
                layout.capacity(NODES).unwrap(),
                layout.capacity(ARCS).unwrap(),
                layout.capacity(ADJACENCY).unwrap(),
                layout.capacity(ACTIVE).unwrap(),
                layout.capacity(ORDER_BTC).unwrap()
            ],
            [459, 638, 2104, 526, 10, 65]
        );
        for (record, expected) in [
            (Record::Root(35), (FLOWS, 245)),
            (Record::Root(36), (FLOWS, 256)),
            (Record::Node(27), (NODES, 243)),
            (Record::Node(28), (NODES, 256)),
            (Record::Arc(63), (ARCS, 252)),
            (Record::Arc(64), (ARCS, 256)),
        ] {
            assert_eq!(layout.location(record).unwrap(), expected);
        }
        for count in [1, 65, 128, 1024, 10_000, 1_000_000] {
            Layout::new(count).unwrap();
            for (index, words) in [
                (count - 1, FLOW_WORDS),
                (count + 4, NODE_WORDS),
                (8 * count + 5, ARC_WORDS),
            ] {
                let start = packed_address(index, words).unwrap();
                assert!(start % PAGE_WORDS + words <= PAGE_WORDS);
            }
        }
        assert!(Layout::new(0).is_err());
        assert!(Layout::new(u64::MAX).is_err());
        assert!(layout.location(Record::Root(65)).is_err());
        assert!(layout
            .location(Record::Order {
                market: 2,
                position: 0
            })
            .is_err());
        assert!(layout.capacity(63).is_err());
    }
    #[test]
    fn flow_bytes_and_signed_node_words_have_literal_offsets_and_exact_privileges() {
        let flow = FlowRecord {
            id: 7,
            cash: 10,
            whole: [3, 5, 8],
            directions: [-1, 1],
            fractional: [true, false, true],
            order: [2, 0, 1],
            seen_attempt: 0x0102030405060708,
            seen_mask: 3,
            applied: true,
        };
        let words = flow.words().unwrap();
        let bytes: Vec<_> = words.into_iter().flat_map(u64::to_le_bytes).collect();
        assert_eq!(
            &bytes[40..],
            &[255, 1, 5, 2, 0, 1, 8, 7, 6, 5, 4, 3, 2, 1, 3, 1]
        );
        assert_eq!(FlowRecord::from_words(words).unwrap(), flow);
        assert!(FlowRecord::from_words([0; 7]).is_err());
        for (offset, value) in [(40, 2), (42, 8), (43, 1), (54, 4), (55, 2)] {
            let mut corrupt = bytes.clone();
            corrupt[offset] = value;
            let words = core::array::from_fn(|index| {
                u64::from_le_bytes(corrupt[index * 8..index * 8 + 8].try_into().unwrap())
            });
            assert!(FlowRecord::from_words(words).is_err());
        }
        let layout = Layout::new(65).unwrap();
        let plan = layout
            .plan([
                Some(Access {
                    record: Record::Root(36),
                    writable: true,
                }),
                Some(Access {
                    record: Record::Node(28),
                    writable: true,
                }),
                None,
            ])
            .unwrap();
        let mut store = Store {
            words: BTreeMap::new(),
            plan,
        };
        let node = Node {
            first: 2,
            end: 7,
            next: 4,
            generation: 3,
            parent: 9,
            balance: -5,
            net: 7,
        };
        {
            let mut pages = GraphPages {
                layout,
                store: &mut store,
            };
            pages.write_flow(36, flow).unwrap();
            pages.write_node(28, node).unwrap();
            assert_eq!(pages.flow(36).unwrap(), flow);
            assert_eq!(pages.node(28).unwrap(), node);
            assert!(pages.flow(35).is_err());
        }
        assert_eq!(store.words[&(NODES, 261)], u64::MAX - 4);
        assert_eq!(store.words[&(NODES, 262)], u64::MAX);
        assert_eq!(store.words[&(NODES, 263)], 7);
        assert_eq!(store.words[&(NODES, 264)], 0);
        store.plan = layout
            .plan([
                Some(Access {
                    record: Record::Root(36),
                    writable: false,
                }),
                None,
                None,
            ])
            .unwrap();
        let mut pages = GraphPages {
            layout,
            store: &mut store,
        };
        assert_eq!(pages.flow(36).unwrap(), flow);
        assert!(pages.write_flow(36, flow).is_err());
    }
}
