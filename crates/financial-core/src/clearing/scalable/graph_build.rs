//! Canonical graph construction over bounded authenticated scalar records.
//! Inputs must be complete verified flow rows and checked market permutations.
//! No uploaded edge, auxiliary balance or adjacency position is accepted.
use super::{
    active_work::{ActiveWork, Hierarchy},
    graph_work::{Access, Arc, GraphStorage, Node, Record, Root, ACTIVE_REGISTER},
};
use crate::{Error, Result, MAX_CASH};
pub const CHECKPOINT_BYTES: usize = 384;
pub trait BuildStorage: GraphStorage {
    fn order(&self, market: u8, position: u64) -> Result<u64>;
    fn write_adjacency(&mut self, position: u64, arc: u64) -> Result<()>;
}
const ROOT: u8 = 0;
const ROOT_NODE: u8 = 1;
const ROOT_ARC: u8 = 2;
const SPECIAL: u8 = 3;
const AUX_NODE: u8 = 4;
const AUX_ARC: u8 = 5;
const ENTER: u8 = 6;
const SELECT: u8 = 7;
const TARGET: u8 = 8;
const ORDER: u8 = 9;
const MARKET_ROOT: u8 = 10;
const APPEND: u8 = 11;
const FINISH_NODE: u8 = 12;
const CLEAR_ACTIVE: u8 = 13;
const ACTIVE_ADJ: u8 = 14;
const ACTIVE_ARC: u8 = 15;
const SET_ACTIVE: u8 = 16;
const DONE: u8 = 17;
#[derive(Clone, Debug)]
pub struct GraphBuild {
    count: u64,
    cash_before: u64,
    budgets: [u64; 2],
    stage: u8,
    lane: u8,
    kind: u8,
    cursor: u64,
    scan: u64,
    current: u64,
    ordinal: u64,
    identifier: u64,
    length: u64,
    required: u64,
    seen_cash: u64,
    cash_floors: u64,
    market_balances: [i128; 2],
    balance_sum: i128,
    node: Node,
    root: Root,
    active: Option<ActiveWork>,
}
impl GraphBuild {
    pub fn new(count: u64, cash_before: u64, budgets: [u64; 2]) -> Result<Self> {
        count
            .checked_mul(8)
            .and_then(|value| value.checked_add(6))
            .ok_or(Error::Overflow)?;
        let total = budgets.iter().try_fold(cash_before, |total, value| {
            total.checked_add(*value).ok_or(Error::Overflow)
        })?;
        if count == 0 || total > MAX_CASH {
            return Err(Error::Bounds);
        }
        Ok(Self {
            count,
            cash_before,
            budgets,
            stage: ROOT,
            lane: 0,
            kind: 0,
            cursor: 0,
            scan: 0,
            current: 0,
            ordinal: 0,
            identifier: 0,
            length: 0,
            required: 0,
            seen_cash: 0,
            cash_floors: 0,
            market_balances: budgets.map(i128::from),
            balance_sum: 0,
            node: Node::default(),
            root: Root {
                cash: 0,
                whole: [0; 3],
                order: [0, 1, 2],
                directions: [0; 2],
                fractional: [false; 3],
            },
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
        8 * self.count + 6
    }
    fn auxiliary(&self, node: u64) -> u64 {
        2 * (3 * self.count + node)
    }
    fn hierarchy(&self) -> Result<Hierarchy> {
        Hierarchy::new(self.length, ACTIVE_REGISTER)
    }
    pub fn is_done(&self) -> bool {
        self.stage == DONE
    }
    pub fn result(&self) -> Result<(u64, u64)> {
        if !self.is_done() {
            return Err(Error::Bounds);
        }
        Ok((self.length, self.required))
    }
    fn validate_root(root: Root) -> Result<Root> {
        let mut order = root.order;
        order.sort_unstable();
        if root.cash > MAX_CASH
            || root.whole[2] > MAX_CASH
            || root.whole.iter().any(|value| *value >= 1 << 58)
            || root
                .directions
                .iter()
                .any(|value| !(-1..=1).contains(value))
            || order != [0, 1, 2]
            || (0..2).any(|market| {
                root.directions[market] == 0 && (root.whole[market] != 0 || root.fractional[market])
            })
        {
            return Err(Error::Invariant);
        }
        Ok(root)
    }
    fn append(&mut self, identifier: u64) -> Result<()> {
        if identifier >= self.arcs() || self.length >= self.arcs() {
            return Err(Error::Bounds);
        }
        self.identifier = identifier;
        self.stage = APPEND;
        Ok(())
    }
    fn select(&mut self) -> Result<()> {
        // Only the fixed local lanes/kinds may be skipped without storage I/O.
        for _ in 0..16 {
            if self.stage != SELECT {
                return Ok(());
            }
            if self.current == self.source() || self.current == self.sink() {
                self.stage = if self.scan < self.count + 3 {
                    TARGET
                } else {
                    FINISH_NODE
                };
                return Ok(());
            }
            match self.lane {
                0 => {
                    self.lane = 1;
                    if self.node.balance < 0 {
                        return self.append(self.auxiliary(self.current));
                    }
                }
                1 => {
                    if self.current < self.count {
                        if self.scan == 3 {
                            self.lane = 2;
                            self.scan = 0;
                            continue;
                        }
                        let kind = usize::from(self.root.order[self.scan as usize]);
                        self.scan += 1;
                        if kind == 2 || self.root.directions[kind] < 0 {
                            return self.append(2 * (kind as u64 * self.count + self.current));
                        }
                    } else if self.current < self.count + 2 {
                        if self.scan == self.count {
                            self.lane = 2;
                            self.scan = 0;
                            continue;
                        }
                        self.stage = ORDER;
                        return Ok(());
                    } else {
                        if self.scan == self.count {
                            self.lane = 3;
                            self.scan = 0;
                            continue;
                        }
                        let ordinal = self.scan;
                        self.scan += 1;
                        return self.append(2 * (2 * self.count + ordinal) + 1);
                    }
                }
                2 => {
                    if self.current < self.count {
                        if self.scan == 2 {
                            self.lane = 3;
                            self.scan = 0;
                            continue;
                        }
                        let market = self.scan as usize;
                        self.scan += 1;
                        if self.root.directions[market] > 0 {
                            return self
                                .append(2 * (market as u64 * self.count + self.current) + 1);
                        }
                    } else {
                        if self.scan == self.count {
                            self.lane = 3;
                            self.scan = 0;
                            continue;
                        }
                        self.ordinal = self.scan;
                        self.stage = MARKET_ROOT;
                        return Ok(());
                    }
                }
                3 => {
                    self.lane = 4;
                    if self.node.balance > 0 {
                        return self.append(self.auxiliary(self.current) + 1);
                    }
                }
                4 => {
                    self.stage = FINISH_NODE;
                    return Ok(());
                }
                _ => return Err(Error::Invariant),
            }
        }
        Err(Error::Invariant)
    }
    pub fn accesses(&self) -> Result<[Option<Access>; 3]> {
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
            ROOT => [read(Record::Root(self.cursor)), None, None],
            ROOT_NODE | SPECIAL => [write(Record::Node(self.cursor)), None, None],
            ROOT_ARC => {
                let edge = 2 * (u64::from(self.kind) * self.count + self.cursor);
                [write(Record::Arc(edge)), write(Record::Arc(edge + 1)), None]
            }
            AUX_NODE => [read(Record::Node(self.cursor)), None, None],
            AUX_ARC => [
                write(Record::Arc(self.auxiliary(self.cursor))),
                write(Record::Arc(self.auxiliary(self.cursor) + 1)),
                None,
            ],
            ENTER => [
                read(Record::Node(self.current)),
                if self.current < self.count {
                    read(Record::Root(self.current))
                } else {
                    None
                },
                None,
            ],
            TARGET => [read(Record::Node(self.scan)), None, None],
            ORDER => [
                read(Record::Order {
                    market: (self.current - self.count) as u8,
                    position: self.scan,
                }),
                None,
                None,
            ],
            MARKET_ROOT => [read(Record::Root(self.ordinal)), None, None],
            APPEND => [
                write(Record::Arc(self.identifier)),
                write(Record::Adjacency(self.length)),
                None,
            ],
            FINISH_NODE => [write(Record::Node(self.current)), None, None],
            CLEAR_ACTIVE => [write(Record::Active(self.scan)), None, None],
            ACTIVE_ADJ => [read(Record::Adjacency(self.scan)), None, None],
            ACTIVE_ARC => [read(Record::Arc(self.identifier)), None, None],
            SET_ACTIVE => {
                let word = self.active.as_ref().ok_or(Error::Invariant)?.accesses()?[0]
                    .ok_or(Error::Invariant)?;
                [
                    Some(Access {
                        record: Record::Active(word.limb),
                        writable: word.writable,
                    }),
                    None,
                    None,
                ]
            }
            _ => return Err(Error::Bounds),
        })
    }
    fn next_active(&mut self) {
        self.scan += 1;
        self.stage = if self.scan == self.length {
            DONE
        } else {
            ACTIVE_ADJ
        };
    }
    pub fn step(&mut self, store: &mut impl BuildStorage) -> Result<()> {
        match self.stage {
            ROOT => {
                self.root = Self::validate_root(store.root(self.cursor)?)?;
                self.seen_cash = self
                    .seen_cash
                    .checked_add(self.root.cash)
                    .ok_or(Error::Overflow)?;
                self.cash_floors = self
                    .cash_floors
                    .checked_add(self.root.whole[2])
                    .ok_or(Error::Overflow)?;
                let mut balance = i128::from(self.root.cash) - i128::from(self.root.whole[2]);
                for market in 0..2 {
                    let movement = i128::from(self.root.directions[market])
                        * i128::from(self.root.whole[market]);
                    balance = balance.checked_add(movement).ok_or(Error::Overflow)?;
                    self.market_balances[market] = self.market_balances[market]
                        .checked_sub(movement)
                        .ok_or(Error::Overflow)?;
                }
                self.node = Node {
                    balance,
                    ..Default::default()
                };
                self.stage = ROOT_NODE;
            }
            ROOT_NODE => {
                store.write_node(self.cursor, self.node)?;
                self.kind = 0;
                self.stage = ROOT_ARC;
            }
            ROOT_ARC => {
                let kind = usize::from(self.kind);
                let edge = 2 * (kind as u64 * self.count + self.cursor);
                let endpoints = if kind == 2 {
                    (self.cursor, self.count + 2)
                } else if self.root.directions[kind] > 0 {
                    (self.count + kind as u64, self.cursor)
                } else if self.root.directions[kind] < 0 {
                    (self.cursor, self.count + kind as u64)
                } else {
                    (0, 0)
                };
                store.write_arc(
                    edge,
                    Arc {
                        start: endpoints.0,
                        end: endpoints.1,
                        capacity: u64::from(self.root.fractional[kind]),
                        position: u64::MAX,
                    },
                )?;
                store.write_arc(
                    edge + 1,
                    Arc {
                        start: endpoints.1,
                        end: endpoints.0,
                        capacity: 0,
                        position: u64::MAX,
                    },
                )?;
                self.kind += 1;
                if self.kind == 3 {
                    self.kind = 0;
                    self.cursor += 1;
                    self.stage = if self.cursor == self.count {
                        SPECIAL
                    } else {
                        ROOT
                    };
                }
            }
            SPECIAL => {
                if self.seen_cash != self.cash_before {
                    return Err(Error::Invariant);
                }
                let balance = if self.cursor < self.count + 2 {
                    self.market_balances[(self.cursor - self.count) as usize]
                } else if self.cursor == self.count + 2 {
                    i128::from(self.cash_floors)
                        - i128::from(self.cash_before)
                        - i128::from(self.budgets[0])
                        - i128::from(self.budgets[1])
                } else {
                    0
                };
                store.write_node(
                    self.cursor,
                    Node {
                        balance,
                        ..Default::default()
                    },
                )?;
                self.cursor += 1;
                if self.cursor == self.count + 5 {
                    self.cursor = 0;
                    self.stage = AUX_NODE;
                }
            }
            AUX_NODE => {
                self.node = store.node(self.cursor)?;
                let capacity =
                    u64::try_from(self.node.balance.unsigned_abs()).map_err(|_| Error::Bounds)?;
                if capacity > 3 * self.count {
                    return Err(Error::Invariant);
                }
                self.balance_sum = self
                    .balance_sum
                    .checked_add(self.node.balance)
                    .ok_or(Error::Overflow)?;
                if self.node.balance > 0 {
                    self.required = self.required.checked_add(capacity).ok_or(Error::Overflow)?;
                }
                self.stage = AUX_ARC;
            }
            AUX_ARC => {
                let (start, end) = if self.node.balance > 0 {
                    (self.source(), self.cursor)
                } else {
                    (self.cursor, self.sink())
                };
                store.write_arc(
                    self.auxiliary(self.cursor),
                    Arc {
                        start,
                        end,
                        capacity: self.node.balance.unsigned_abs() as u64,
                        position: u64::MAX,
                    },
                )?;
                store.write_arc(
                    self.auxiliary(self.cursor) + 1,
                    Arc {
                        start: end,
                        end: start,
                        capacity: 0,
                        position: u64::MAX,
                    },
                )?;
                self.cursor += 1;
                if self.cursor == self.count + 3 {
                    if self.balance_sum != 0 || self.required > 3 * self.count {
                        return Err(Error::Invariant);
                    }
                    self.current = 0;
                    self.stage = ENTER;
                } else {
                    self.stage = AUX_NODE;
                }
            }
            ENTER => {
                self.node = store.node(self.current)?;
                if self.current < self.count {
                    self.root = Self::validate_root(store.root(self.current)?)?;
                }
                self.node.first = self.length;
                self.node.next = 0;
                self.node.parent = 0;
                self.node.generation = 0;
                self.node.net = 0;
                self.lane = 0;
                self.scan = 0;
                self.stage = SELECT;
            }
            TARGET => {
                let node = store.node(self.scan)?;
                let target = self.scan;
                self.scan += 1;
                self.stage = SELECT;
                if self.current == self.source() && node.balance > 0 {
                    self.append(self.auxiliary(target))?;
                } else if self.current == self.sink() && node.balance < 0 {
                    self.append(self.auxiliary(target) + 1)?;
                }
            }
            ORDER => {
                self.ordinal = store.order((self.current - self.count) as u8, self.scan)?;
                if self.ordinal >= self.count {
                    return Err(Error::Bounds);
                }
                self.stage = MARKET_ROOT;
            }
            MARKET_ROOT => {
                let root = Self::validate_root(store.root(self.ordinal)?)?;
                let market = (self.current - self.count) as usize;
                self.scan += 1;
                self.stage = SELECT;
                if self.lane == 1 && root.directions[market] > 0 {
                    self.append(2 * (market as u64 * self.count + self.ordinal))?;
                } else if self.lane == 2 && root.directions[market] < 0 {
                    self.append(2 * (market as u64 * self.count + self.ordinal) + 1)?;
                }
            }
            APPEND => {
                let mut arc = store.arc(self.identifier)?;
                if arc.start != self.current || arc.position != u64::MAX {
                    return Err(Error::Invariant);
                }
                arc.position = self.length;
                store.write_arc(self.identifier, arc)?;
                store.write_adjacency(self.length, self.identifier)?;
                self.length += 1;
                self.stage = SELECT;
            }
            FINISH_NODE => {
                self.node.end = self.length;
                store.write_node(self.current, self.node)?;
                self.current += 1;
                if self.current == self.count + 5 {
                    self.current = 0;
                    self.scan = 0;
                    self.stage = CLEAR_ACTIVE;
                } else {
                    self.stage = ENTER;
                }
            }
            CLEAR_ACTIVE => {
                store.write(ACTIVE_REGISTER, self.scan, 0)?;
                self.scan += 1;
                if self.scan == self.hierarchy()?.words() {
                    self.scan = 0;
                    self.stage = ACTIVE_ADJ;
                }
            }
            ACTIVE_ADJ => {
                self.identifier = store.adjacency(self.scan)?;
                if self.identifier >= self.arcs() {
                    return Err(Error::Bounds);
                }
                self.stage = ACTIVE_ARC;
            }
            ACTIVE_ARC => {
                let arc = store.arc(self.identifier)?;
                if arc.position != self.scan {
                    return Err(Error::Invariant);
                }
                if arc.capacity == 0 {
                    self.next_active();
                } else {
                    self.active = Some(self.hierarchy()?.set(self.scan, true)?);
                    self.stage = SET_ACTIVE;
                }
            }
            SET_ACTIVE => {
                let active = self.active.as_mut().ok_or(Error::Invariant)?;
                active.step(store)?;
                if active.is_done() {
                    self.active = None;
                    self.next_active();
                }
            }
            _ => return Err(Error::Bounds),
        }
        self.select()
    }
    pub fn checkpoint(&self) -> [u8; CHECKPOINT_BYTES] {
        let mut bytes = [0; CHECKPOINT_BYTES];
        bytes[0] = 1;
        bytes[1] = self.stage;
        bytes[2] = self.lane;
        bytes[3] = self.kind;
        bytes[4] = u8::from(self.active.is_some());
        for (index, value) in [
            self.count,
            self.cash_before,
            self.budgets[0],
            self.budgets[1],
            self.cursor,
            self.scan,
            self.current,
            self.ordinal,
            self.identifier,
            self.length,
            self.required,
            self.seen_cash,
            self.cash_floors,
        ]
        .into_iter()
        .enumerate()
        {
            bytes[8 + 8 * index..16 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        bytes[112..128].copy_from_slice(&self.market_balances[0].to_le_bytes());
        bytes[128..144].copy_from_slice(&self.market_balances[1].to_le_bytes());
        bytes[144..160].copy_from_slice(&self.balance_sum.to_le_bytes());
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
            bytes[160 + 8 * index..168 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        bytes[200..216].copy_from_slice(&self.node.balance.to_le_bytes());
        bytes[216..232].copy_from_slice(&self.node.net.to_le_bytes());
        bytes[232..240].copy_from_slice(&self.root.cash.to_le_bytes());
        for (index, value) in self.root.whole.into_iter().enumerate() {
            bytes[240 + 8 * index..248 + 8 * index].copy_from_slice(&value.to_le_bytes());
        }
        bytes[264] = self.root.directions[0] as u8;
        bytes[265] = self.root.directions[1] as u8;
        bytes[266] = u8::from(self.root.fractional[0])
            | (u8::from(self.root.fractional[1]) << 1)
            | (u8::from(self.root.fractional[2]) << 2);
        bytes[267..270].copy_from_slice(&self.root.order);
        if let Some(active) = &self.active {
            bytes[272..336].copy_from_slice(&active.checkpoint());
        }
        bytes
    }
    pub fn from_checkpoint(
        bytes: &[u8],
        count: u64,
        cash_before: u64,
        budgets: [u64; 2],
    ) -> Result<Self> {
        if bytes.len() != CHECKPOINT_BYTES
            || bytes[0] != 1
            || bytes[1] > DONE
            || bytes[1] == SELECT
            || bytes[2] > 4
            || bytes[3] > 2
            || bytes[4] > 1
            || bytes[5..8]
                .iter()
                .chain(&bytes[270..272])
                .chain(&bytes[336..])
                .any(|byte| *byte != 0)
            || bytes[266] > 7
        {
            return Err(Error::Bounds);
        }
        let read = |offset| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        let signed = |offset| i128::from_le_bytes(bytes[offset..offset + 16].try_into().unwrap());
        let mut work = Self::new(count, cash_before, budgets)?;
        if [read(8), read(16), read(24), read(32)] != [count, cash_before, budgets[0], budgets[1]] {
            return Err(Error::Bounds);
        }
        work.stage = bytes[1];
        work.lane = bytes[2];
        work.kind = bytes[3];
        work.cursor = read(40);
        work.scan = read(48);
        work.current = read(56);
        work.ordinal = read(64);
        work.identifier = read(72);
        work.length = read(80);
        work.required = read(88);
        work.seen_cash = read(96);
        work.cash_floors = read(104);
        work.market_balances = [signed(112), signed(128)];
        work.balance_sum = signed(144);
        work.node = Node {
            first: read(160),
            end: read(168),
            next: read(176),
            generation: read(184),
            parent: read(192),
            balance: signed(200),
            net: signed(216),
        };
        work.root = Self::validate_root(Root {
            cash: read(232),
            whole: [read(240), read(248), read(256)],
            directions: [bytes[264] as i8, bytes[265] as i8],
            fractional: core::array::from_fn(|index| bytes[266] & (1 << index) != 0),
            order: bytes[267..270].try_into().unwrap(),
        })?;
        if work.cursor > work.sink()
            || work.current > work.sink()
            || work.ordinal >= count
            || work.identifier >= work.arcs()
            || work.length > work.arcs()
            || work.scan > work.arcs()
            || work.required > 3 * count
            || work.seen_cash > cash_before
            || work.cash_floors > MAX_CASH
            || work.node.first > work.arcs()
            || work.node.end > work.arcs()
            || work.node.next != 0
            || work.node.generation != 0
            || work.node.parent != 0
            || work.node.net != 0
            || (matches!(work.stage, ROOT | ROOT_NODE | ROOT_ARC) && work.cursor >= count)
            || (work.stage == SPECIAL && !(count..count + 5).contains(&work.cursor))
            || (matches!(work.stage, AUX_NODE | AUX_ARC) && work.cursor >= count + 3)
            || (work.stage == TARGET && (work.scan >= count + 3 || work.current < work.source()))
            || (matches!(work.stage, ORDER | MARKET_ROOT)
                && (!(count..count + 2).contains(&work.current)
                    || work.scan >= count
                    || ![1, 2].contains(&work.lane)))
            || (work.stage >= CLEAR_ACTIVE && work.length == 0)
            || (matches!(work.stage, ACTIVE_ADJ | ACTIVE_ARC | SET_ACTIVE)
                && work.scan >= work.length)
            || (work.stage == DONE && work.scan != work.length)
        {
            return Err(Error::Bounds);
        }
        if work.stage == CLEAR_ACTIVE && work.scan >= work.hierarchy()?.words() {
            return Err(Error::Bounds);
        }
        if bytes[4] != 0 {
            if work.stage != SET_ACTIVE {
                return Err(Error::Bounds);
            }
            let active = ActiveWork::from_checkpoint(&bytes[272..336], work.hierarchy()?)?;
            if active.is_done() || !active.matches_set(work.scan, true) {
                return Err(Error::Bounds);
            }
            work.active = Some(active);
        } else if work.stage == SET_ACTIVE || bytes[272..336].iter().any(|byte| *byte != 0) {
            return Err(Error::Bounds);
        }
        Ok(work)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn construction_checkpoint_binds_inputs_and_rejects_unsafe_record_indices() {
        let work = GraphBuild::new(3, 10, [2, 4]).unwrap();
        let bytes = work.checkpoint();
        assert_eq!(
            GraphBuild::from_checkpoint(&bytes, 3, 10, [2, 4])
                .unwrap()
                .checkpoint(),
            bytes
        );
        for (offset, value) in [
            (0, 2),
            (1, 18),
            (1, SELECT),
            (2, 5),
            (3, 3),
            (4, 2),
            (5, 1),
            (8, 4),
            (16, 11),
            (24, 3),
            (32, 5),
            (40, 3),
            (48, 31),
            (56, 8),
            (64, 3),
            (72, 30),
            (80, 31),
            (88, 10),
            (96, 11),
            (176, 1),
            (184, 1),
            (192, 1),
            (216, 1),
            (264, 2),
            (266, 8),
            (267, 1),
            (270, 1),
            (272, 1),
            (336, 1),
        ] {
            let mut corrupt = bytes;
            corrupt[offset] = value;
            assert!(
                GraphBuild::from_checkpoint(&corrupt, 3, 10, [2, 4]).is_err(),
                "offset {offset}"
            );
        }
        assert!(GraphBuild::new(0, 0, [0, 0]).is_err());
        assert!(GraphBuild::new(u64::MAX, 0, [0, 0]).is_err());
        assert!(GraphBuild::new(3, MAX_CASH, [1, 0]).is_err());
        assert!(GraphBuild::new(3, u64::MAX, [1, 0]).is_err());
        let mut root = work.root;
        root.whole[0] = 1;
        assert!(GraphBuild::validate_root(root).is_err());
        root.whole[0] = 0;
        root.fractional[1] = true;
        assert!(GraphBuild::validate_root(root).is_err());
    }
}
