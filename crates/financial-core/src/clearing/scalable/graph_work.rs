//! Bounded canonical residual circulation over owner-authenticated graph pages.
//! The controller must build every node/arc/adjacency from verified flow floors
//! and complete canonical order before constructing this cursor. This module
//! confers no financial authority and accepts no keeper-selected graph topology.
use super::{
    active_work::{ActiveWork, Hierarchy},
    wide::LimbStorage,
};
use crate::{Error, Result};

pub const CHECKPOINT_BYTES: usize = 352;
pub const ACTIVE_REGISTER: u32 = 0;
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Node {
    pub first: u64,
    pub end: u64,
    pub next: u64,
    pub generation: u64,
    pub parent: u64,
    pub balance: i128,
    pub net: i128,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Arc {
    pub start: u64,
    pub end: u64,
    pub capacity: u64,
    pub position: u64,
}
#[derive(Clone, Copy, Debug)]
pub struct Root {
    pub cash: u64,
    pub whole: [u64; 3],
    pub order: [u8; 3],
    pub directions: [i8; 2],
    pub fractional: [bool; 3],
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Record {
    Node(u64),
    Arc(u64),
    Adjacency(u64),
    Root(u64),
    Active(u64),
    Order { market: u8, position: u64 },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Access {
    pub record: Record,
    pub writable: bool,
}
pub trait GraphStorage: LimbStorage {
    fn node(&self, index: u64) -> Result<Node>;
    fn write_node(&mut self, index: u64, value: Node) -> Result<()>;
    fn arc(&self, index: u64) -> Result<Arc>;
    fn write_arc(&mut self, index: u64, value: Arc) -> Result<()>;
    fn adjacency(&self, index: u64) -> Result<u64>;
    fn root(&self, index: u64) -> Result<Root>;
}
const INITIAL: u8 = 0;
const SEARCH: u8 = 1;
const FIND: u8 = 2;
const LOCATED: u8 = 3;
const ADJACENCY: u8 = 4;
const EDGE: u8 = 5;
const VISIT: u8 = 6;
const BACKTRACK: u8 = 7;
const MINIMUM_NODE: u8 = 8;
const MINIMUM_EDGE: u8 = 9;
const APPLY_NODE: u8 = 10;
const APPLY_EDGE: u8 = 11;
const FORWARD_INDEX: u8 = 12;
const REVERSE_INDEX: u8 = 13;
const AUDIT_EDGE: u8 = 14;
const AUDIT_START: u8 = 15;
const AUDIT_END: u8 = 16;
const AUDIT_NODE: u8 = 17;
const DONE: u8 = 18;

#[derive(Clone, Debug)]
pub struct GraphWork {
    count: u64,
    adjacency_length: u64,
    required: u64,
    sent: u64,
    augmentations: u64,
    stage: u8,
    current: u64,
    identifier: u64,
    position: u64,
    amount: u64,
    audit: u64,
    node: Node,
    arc: Arc,
    reverse: Arc,
    active: Option<ActiveWork>,
}
impl GraphWork {
    /// Arguments are authenticated completed-construction totals, not a
    /// transaction caller's assertion that an arbitrary graph is a valid plan.
    pub fn new(count: u64, adjacency_length: u64, required: u64) -> Result<Self> {
        let arcs = count
            .checked_mul(8)
            .and_then(|value| value.checked_add(6))
            .ok_or(Error::Overflow)?;
        if count == 0
            || adjacency_length == 0
            || adjacency_length > arcs
            || required > count.checked_mul(3).ok_or(Error::Overflow)?
        {
            return Err(Error::Bounds);
        }
        Ok(Self {
            count,
            adjacency_length,
            required,
            sent: 0,
            augmentations: 0,
            stage: if required == 0 { AUDIT_EDGE } else { INITIAL },
            current: count + 3,
            identifier: 0,
            position: 0,
            amount: 0,
            audit: 0,
            node: Node::default(),
            arc: Arc::default(),
            reverse: Arc::default(),
            active: None,
        })
    }
    fn source(&self) -> u64 {
        self.count + 3
    }
    fn sink(&self) -> u64 {
        self.count + 4
    }
    fn arcs(&self) -> u64 {
        self.count * 8 + 6
    }
    fn auxiliary(&self, node: u64) -> u64 {
        2 * (3 * self.count + node)
    }
    fn hierarchy(&self) -> Result<Hierarchy> {
        Hierarchy::new(self.adjacency_length, ACTIVE_REGISTER)
    }
    pub fn is_done(&self) -> bool {
        self.stage == DONE
    }
    pub fn augmentations(&self) -> u64 {
        self.augmentations
    }
    fn checked_node(&self, value: Node) -> Result<Node> {
        if (value.generation != 0 && value.first > value.next)
            || value.first > value.end
            || value.next > value.end
            || value.end > self.adjacency_length
            || value.parent >= self.arcs()
            || value.generation > self.required + 1
        {
            return Err(Error::Invariant);
        }
        Ok(value)
    }
    fn checked_arc(&self, value: Arc) -> Result<Arc> {
        if value.start > self.sink()
            || value.end > self.sink()
            || value.position >= self.adjacency_length
            || value.capacity > self.required.max(1)
        {
            return Err(Error::Invariant);
        }
        Ok(value)
    }
    pub fn accesses(&self) -> Result<[Option<Access>; 3]> {
        use Record::*;
        let read = |record| {
            Some(Access {
                record,
                writable: false,
            })
        };
        let write = |record| {
            Some(Access {
                record,
                writable: true,
            })
        };
        Ok(match self.stage {
            INITIAL => [write(Node(self.source())), None, None],
            SEARCH | MINIMUM_NODE | APPLY_NODE => [read(Node(self.current)), None, None],
            FIND | FORWARD_INDEX | REVERSE_INDEX => {
                let word = self.active.as_ref().ok_or(Error::Invariant)?.accesses()?[0]
                    .ok_or(Error::Invariant)?;
                [
                    Some(Access {
                        record: Active(word.limb),
                        writable: word.writable,
                    }),
                    None,
                    None,
                ]
            }
            LOCATED => [write(Node(self.current)), None, None],
            ADJACENCY => [read(Adjacency(self.position)), None, None],
            EDGE | MINIMUM_EDGE => [read(Arc(self.identifier)), None, None],
            VISIT => [write(Node(self.arc.end)), None, None],
            BACKTRACK => [read(Arc(self.node.parent)), None, None],
            APPLY_EDGE => [
                write(Arc(self.identifier)),
                write(Arc(self.identifier ^ 1)),
                None,
            ],
            AUDIT_EDGE => [
                read(Arc(2 * self.audit)),
                read(Arc(2 * self.audit + 1)),
                read(Root(self.audit % self.count)),
            ],
            AUDIT_START => [write(Node(self.arc.start)), None, None],
            AUDIT_END => [write(Node(self.arc.end)), None, None],
            AUDIT_NODE => [
                read(Node(self.audit)),
                read(Arc(self.auxiliary(self.audit))),
                read(Arc(self.auxiliary(self.audit) + 1)),
            ],
            _ => return Err(Error::Bounds),
        })
    }
    fn next_audit(&mut self) {
        self.audit += 1;
        if self.audit == 3 * self.count {
            self.audit = 0;
            self.stage = AUDIT_NODE;
        } else {
            self.stage = AUDIT_EDGE;
        }
    }
    fn finish_active(&mut self) -> Result<()> {
        let active = self.active.as_ref().ok_or(Error::Invariant)?;
        if !active.is_done() {
            return Ok(());
        }
        let found = active.result()?;
        self.active = None;
        match self.stage {
            FIND => {
                if let Some(position) = found {
                    if position < self.node.next || position >= self.node.end {
                        return Err(Error::Invariant);
                    }
                    self.position = position;
                    self.node.next = position + 1;
                    self.stage = LOCATED;
                } else {
                    if self.current == self.source() {
                        return Err(Error::Invariant);
                    }
                    self.stage = BACKTRACK;
                }
            }
            FORWARD_INDEX => {
                self.active = Some(
                    self.hierarchy()?
                        .set(self.reverse.position, self.reverse.capacity != 0)?,
                );
                self.stage = REVERSE_INDEX;
            }
            REVERSE_INDEX => {
                self.current = self.arc.start;
                if self.current == self.source() {
                    self.sent = self.sent.checked_add(self.amount).ok_or(Error::Overflow)?;
                    self.augmentations =
                        self.augmentations.checked_add(1).ok_or(Error::Overflow)?;
                    if self.sent > self.required || self.augmentations > self.required {
                        return Err(Error::Invariant);
                    }
                    self.stage = if self.sent == self.required {
                        self.audit = 0;
                        AUDIT_EDGE
                    } else {
                        INITIAL
                    };
                } else {
                    self.stage = APPLY_NODE;
                }
            }
            _ => return Err(Error::Invariant),
        }
        Ok(())
    }
    /// One node/edge transition, or one active-hierarchy word. The adapter must
    /// commit record changes and this checkpoint together, rolling back errors.
    pub fn step(&mut self, store: &mut impl GraphStorage) -> Result<()> {
        match self.stage {
            INITIAL => {
                self.current = self.source();
                let mut node = self.checked_node(store.node(self.current)?)?;
                node.generation = self.augmentations + 1;
                node.next = node.first;
                store.write_node(self.current, node)?;
                self.stage = SEARCH;
            }
            SEARCH => {
                self.node = self.checked_node(store.node(self.current)?)?;
                if self.node.generation != self.augmentations + 1 {
                    return Err(Error::Invariant);
                }
                self.active = Some(self.hierarchy()?.next(self.node.next, self.node.end)?);
                self.stage = FIND;
                self.finish_active()?;
            }
            FIND | FORWARD_INDEX | REVERSE_INDEX => {
                self.active.as_mut().ok_or(Error::Invariant)?.step(store)?;
                self.finish_active()?;
            }
            LOCATED => {
                store.write_node(self.current, self.node)?;
                self.stage = ADJACENCY;
            }
            ADJACENCY => {
                self.identifier = store.adjacency(self.position)?;
                if self.identifier >= self.arcs() {
                    return Err(Error::Invariant);
                }
                self.stage = EDGE;
            }
            EDGE => {
                self.arc = self.checked_arc(store.arc(self.identifier)?)?;
                if self.arc.start != self.current
                    || self.arc.capacity == 0
                    || self.arc.position != self.position
                {
                    return Err(Error::Invariant);
                }
                self.stage = VISIT;
            }
            VISIT => {
                let mut target = self.checked_node(store.node(self.arc.end)?)?;
                if target.generation == self.augmentations + 1 {
                    self.stage = SEARCH;
                    return Ok(());
                }
                target.generation = self.augmentations + 1;
                target.parent = self.identifier;
                target.next = target.first;
                store.write_node(self.arc.end, target)?;
                self.current = self.arc.end;
                if self.current == self.sink() {
                    self.amount = self.required - self.sent;
                    self.stage = MINIMUM_NODE;
                } else {
                    self.stage = SEARCH;
                }
            }
            BACKTRACK => {
                let parent = self.checked_arc(store.arc(self.node.parent)?)?;
                if parent.end != self.current {
                    return Err(Error::Invariant);
                }
                self.current = parent.start;
                self.stage = SEARCH;
            }
            MINIMUM_NODE | APPLY_NODE => {
                self.node = self.checked_node(store.node(self.current)?)?;
                if self.current == self.source() || self.node.generation != self.augmentations + 1 {
                    return Err(Error::Invariant);
                }
                self.identifier = self.node.parent;
                self.stage = if self.stage == MINIMUM_NODE {
                    MINIMUM_EDGE
                } else {
                    APPLY_EDGE
                };
            }
            MINIMUM_EDGE => {
                let arc = self.checked_arc(store.arc(self.identifier)?)?;
                if arc.end != self.current || arc.capacity == 0 {
                    return Err(Error::Invariant);
                }
                self.amount = self.amount.min(arc.capacity);
                self.current = arc.start;
                if self.current == self.source() {
                    self.current = self.sink();
                    self.stage = APPLY_NODE;
                } else {
                    self.stage = MINIMUM_NODE;
                }
            }
            APPLY_EDGE => {
                self.arc = self.checked_arc(store.arc(self.identifier)?)?;
                self.reverse = self.checked_arc(store.arc(self.identifier ^ 1)?)?;
                if self.arc.end != self.current
                    || self.arc.start != self.reverse.end
                    || self.arc.end != self.reverse.start
                    || self.amount == 0
                    || self.amount > self.arc.capacity
                {
                    return Err(Error::Invariant);
                }
                self.arc.capacity -= self.amount;
                self.reverse.capacity = self
                    .reverse
                    .capacity
                    .checked_add(self.amount)
                    .ok_or(Error::Overflow)?;
                store.write_arc(self.identifier, self.arc)?;
                store.write_arc(self.identifier ^ 1, self.reverse)?;
                self.active = Some(
                    self.hierarchy()?
                        .set(self.arc.position, self.arc.capacity != 0)?,
                );
                self.stage = FORWARD_INDEX;
            }
            AUDIT_EDGE => {
                self.arc = store.arc(2 * self.audit)?;
                self.reverse = store.arc(2 * self.audit + 1)?;
                let root = store.root(self.audit % self.count)?;
                let kind = (self.audit / self.count) as usize;
                if root
                    .directions
                    .iter()
                    .any(|direction| !(-1..=1).contains(direction))
                    || self
                        .arc
                        .capacity
                        .checked_add(self.reverse.capacity)
                        .ok_or(Error::Overflow)?
                        != u64::from(root.fractional[kind])
                {
                    return Err(Error::Invariant);
                }
                let row = self.audit % self.count;
                let endpoints = if kind == 2 {
                    Some((row, self.count + 2))
                } else if root.directions[kind] > 0 {
                    Some((self.count + kind as u64, row))
                } else if root.directions[kind] < 0 {
                    Some((row, self.count + kind as u64))
                } else {
                    None
                };
                if let Some((start, end)) = endpoints {
                    self.checked_arc(self.arc)?;
                    self.checked_arc(self.reverse)?;
                    if (
                        self.arc.start,
                        self.arc.end,
                        self.reverse.start,
                        self.reverse.end,
                    ) != (start, end, end, start)
                    {
                        return Err(Error::Invariant);
                    }
                } else if root.fractional[kind] || self.reverse.capacity != 0 {
                    return Err(Error::Invariant);
                }
                if self.reverse.capacity != 0 {
                    self.stage = AUDIT_START;
                } else {
                    self.next_audit();
                }
            }
            AUDIT_START => {
                let mut node = self.checked_node(store.node(self.arc.start)?)?;
                node.net = node
                    .net
                    .checked_add(i128::from(self.reverse.capacity))
                    .ok_or(Error::Overflow)?;
                store.write_node(self.arc.start, node)?;
                self.stage = AUDIT_END;
            }
            AUDIT_END => {
                let mut node = self.checked_node(store.node(self.arc.end)?)?;
                node.net = node
                    .net
                    .checked_sub(i128::from(self.reverse.capacity))
                    .ok_or(Error::Overflow)?;
                store.write_node(self.arc.end, node)?;
                self.next_audit();
            }
            AUDIT_NODE => {
                let node = self.checked_node(store.node(self.audit)?)?;
                let arc = store.arc(self.auxiliary(self.audit))?;
                let reverse = store.arc(self.auxiliary(self.audit) + 1)?;
                let (start, end) = if node.balance > 0 {
                    (self.source(), self.audit)
                } else {
                    (self.audit, self.sink())
                };
                if node.net != node.balance
                    || arc.capacity != 0
                    || u128::from(reverse.capacity) != node.balance.unsigned_abs()
                    || (arc.start, arc.end, reverse.start, reverse.end) != (start, end, end, start)
                {
                    return Err(Error::Invariant);
                }
                self.audit += 1;
                if self.audit == self.count + 3 {
                    self.stage = DONE;
                }
            }
            _ => return Err(Error::Bounds),
        }
        Ok(())
    }
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[0] = 1;
        bytes[1] = self.stage;
        bytes[2] = u8::from(self.active.is_some());
        for (index, value) in [
            self.count,
            self.adjacency_length,
            self.required,
            self.sent,
            self.augmentations,
            self.current,
            self.identifier,
            self.position,
            self.amount,
            self.audit,
        ]
        .into_iter()
        .enumerate()
        {
            bytes[8 + 8 * index..16 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        for (index, value) in [
            self.node.first,
            self.node.end,
            self.node.next,
            self.node.generation,
            self.node.parent,
        ]
        .into_iter()
        .enumerate()
        {
            bytes[104 + 8 * index..112 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        bytes[144..160].copy_from_slice(&self.node.balance.to_le_bytes());
        bytes[160..176].copy_from_slice(&self.node.net.to_le_bytes());
        for (offset, arc) in [(176, self.arc), (208, self.reverse)] {
            for (index, value) in [arc.start, arc.end, arc.capacity, arc.position]
                .into_iter()
                .enumerate()
            {
                bytes[offset + 8 * index..offset + 8 * index + 8]
                    .copy_from_slice(&value.to_le_bytes());
            }
        }
        if let Some(active) = &self.active {
            bytes[256..320].copy_from_slice(&active.checkpoint());
        }
        bytes
    }
    pub fn from_checkpoint(
        bytes: &[u8],
        count: u64,
        adjacency_length: u64,
        required: u64,
    ) -> Result<Self> {
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || bytes[1] > DONE
            || bytes[2] > 1
            || bytes[3..8]
                .iter()
                .chain(&bytes[88..104])
                .chain(&bytes[240..256])
                .chain(&bytes[320..])
                .any(|byte| *byte != 0)
        {
            return Err(Error::Bounds);
        }
        let read = |offset| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        let mut work = Self::new(count, adjacency_length, required)?;
        if [read(8), read(16), read(24)] != [count, adjacency_length, required] {
            return Err(Error::Bounds);
        }
        work.stage = bytes[1];
        work.sent = read(32);
        work.augmentations = read(40);
        work.current = read(48);
        work.identifier = read(56);
        work.position = read(64);
        work.amount = read(72);
        work.audit = read(80);
        work.node = Node {
            first: read(104),
            end: read(112),
            next: read(120),
            generation: read(128),
            parent: read(136),
            balance: i128::from_le_bytes(bytes[144..160].try_into().unwrap()),
            net: i128::from_le_bytes(bytes[160..176].try_into().unwrap()),
        };
        let arc = |offset| Arc {
            start: read(offset),
            end: read(offset + 8),
            capacity: read(offset + 16),
            position: read(offset + 24),
        };
        work.arc = arc(176);
        work.reverse = arc(208);
        if work.sent > required
            || work.augmentations > work.sent
            || work.current > work.sink()
            || work.identifier >= work.arcs()
            || work.position >= adjacency_length
            || work.amount > required
            || work.audit > (3 * count).max(count + 3)
            || ((work.stage >= AUDIT_EDGE) != (work.sent == required))
            || (work.stage == DONE && work.audit != count + 3)
            || (work.stage == AUDIT_NODE && work.audit >= count + 3)
            || (matches!(work.stage, AUDIT_EDGE | AUDIT_START | AUDIT_END)
                && work.audit >= 3 * count)
        {
            return Err(Error::Bounds);
        }
        work.checked_node(work.node)?;
        if matches!(
            work.stage,
            MINIMUM_NODE | MINIMUM_EDGE | APPLY_NODE | APPLY_EDGE | FORWARD_INDEX | REVERSE_INDEX
        ) && work.amount == 0
        {
            return Err(Error::Bounds);
        }
        if bytes[2] != 0 {
            if !matches!(work.stage, FIND | FORWARD_INDEX | REVERSE_INDEX) {
                return Err(Error::Bounds);
            }
            let active = ActiveWork::from_checkpoint(&bytes[256..320], work.hierarchy()?)?;
            if active.is_done() {
                return Err(Error::Bounds);
            }
            let matches = match work.stage {
                FIND => active.matches_next(work.node.end),
                FORWARD_INDEX => active.matches_set(work.arc.position, work.arc.capacity != 0),
                REVERSE_INDEX => {
                    active.matches_set(work.reverse.position, work.reverse.capacity != 0)
                }
                _ => false,
            };
            if !matches {
                return Err(Error::Bounds);
            }
            work.active = Some(active);
        } else if matches!(work.stage, FIND | FORWARD_INDEX | REVERSE_INDEX)
            || bytes[256..320].iter().any(|byte| *byte != 0)
        {
            return Err(Error::Bounds);
        }
        Ok(work)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn graph_checkpoint_binds_totals_and_nested_operation() {
        let mut work = GraphWork::new(3, 20, 2).unwrap();
        let bytes = work.checkpoint();
        for (offset, value) in [
            (0, 2),
            (1, 19),
            (2, 2),
            (3, 1),
            (8, 4),
            (16, 21),
            (24, 3),
            (32, 3),
            (40, 1),
            (48, 9),
            (56, 30),
            (64, 20),
            (72, 3),
            (80, 10),
            (88, 1),
            (104, 21),
            (128, 4),
            (136, 30),
            (240, 1),
            (256, 1),
            (320, 1),
        ] {
            let mut corrupt = bytes;
            corrupt[offset] = value;
            assert!(
                GraphWork::from_checkpoint(&corrupt, 3, 20, 2).is_err(),
                "offset {offset}"
            );
        }
        work.stage = FIND;
        work.node = Node {
            first: 2,
            end: 7,
            next: 3,
            generation: 1,
            ..Default::default()
        };
        work.active = Some(work.hierarchy().unwrap().next(3, 7).unwrap());
        let bytes = work.checkpoint();
        assert_eq!(
            GraphWork::from_checkpoint(&bytes, 3, 20, 2)
                .unwrap()
                .checkpoint(),
            bytes
        );
        let mut corrupt = bytes;
        corrupt[256 + 1] = 0; // A set cursor cannot substitute for a successor read.
        corrupt[256 + 32] = 0;
        assert!(GraphWork::from_checkpoint(&corrupt, 3, 20, 2).is_err());
        let mut corrupt = bytes;
        corrupt[256 + 32] = 8;
        assert!(GraphWork::from_checkpoint(&corrupt, 3, 20, 2).is_err());
        work.stage = FORWARD_INDEX;
        work.amount = 1;
        work.arc.position = 9;
        work.active = Some(work.hierarchy().unwrap().set(9, false).unwrap());
        let bytes = work.checkpoint();
        assert!(GraphWork::from_checkpoint(&bytes, 3, 20, 2).is_ok());
        for offset in [256 + 24, 256 + 3] {
            let mut corrupt = bytes;
            corrupt[offset] ^= 1;
            assert!(GraphWork::from_checkpoint(&corrupt, 3, 20, 2).is_err());
        }
        assert!(GraphWork::new(0, 1, 0).is_err());
        assert!(GraphWork::new(3, 31, 0).is_err());
        assert!(GraphWork::new(3, 20, 10).is_err());
        assert!(GraphWork::new(u64::MAX, 1, 0).is_err());
    }
}
