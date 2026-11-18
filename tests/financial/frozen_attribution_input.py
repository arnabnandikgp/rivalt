"""Exact survivor-basis replay against a clearing-authenticated history commitment, in research only."""
from dataclasses import dataclass
from hashlib import sha256
from fractions import Fraction
from struct import pack

from account_contract_reference import require

DOMAIN = b'Rivalt/research/closed-first-history/v1\x00'
SCALE = 10**9


@dataclass(frozen=True)
class Origin:
    venue: bytes
    member: int
    activation: int
    market: int
    generation: int

    def initial(self):
        require(type(self.venue) is bytes and len(self.venue) == 32 and
                all(type(value) is int and 0 <= value < 2**64 for value in
                    (self.member, self.activation, self.generation)) and
                type(self.market) is int and self.market in (0, 1), "invalid history origin")
        return sha256(DOMAIN + self.venue +
                      pack('<QQBQ', self.member, self.activation, self.market, self.generation)).digest()


@dataclass(frozen=True)
class Fill:
    delta: int
    price: int

    def encode(self):
        require(type(self.delta) is int and 0 < abs(self.delta) <= 2**63-1 and
                type(self.price) is int and 0 < self.price < 2**64, "invalid fill")
        return b'F' + pack('<qQ', self.delta, self.price)


@dataclass(frozen=True)
class Payment:
    # Aggregate pre-payment claim in the protocol's fixed-point scale.
    mark: int
    claim_scaled: int
    atoms: int

    def encode(self):
        require(type(self.claim_scaled) is int and 0 < self.claim_scaled < 2**127 and
                type(self.mark) is int and 0 < self.mark < 2**64 and
                type(self.atoms) is int and 0 < self.atoms < 2**64 and
                self.atoms*SCALE <= self.claim_scaled, "invalid gain payment")
        return b'P' + pack('<QQ', self.mark, self.atoms) + self.claim_scaled.to_bytes(16, 'little', signed=True)


@dataclass(frozen=True)
class Prefix:
    count: int
    digest: bytes

    def append(self, event):
        require(type(event) in (Fill, Payment) and 0 <= self.count < 2**64-1, "invalid history record")
        count = self.count + 1
        return Prefix(count, sha256(self.digest + pack('<Q', count) + event.encode()).digest())


@dataclass(frozen=True)
class Survivor:
    lots: int = 0
    entry_cost: Fraction = Fraction(0)       # signed lots times their average entry
    unpaid_basis: Fraction = Fraction(0)     # entry cost plus payments assigned to surviving lots

    def apply(self, event):
        if isinstance(event, Fill):
            remaining = self.lots + event.delta
            if not remaining or self.lots * remaining <= 0:
                cost = Fraction(remaining * event.price)
                return Survivor(remaining, cost, cost)
            if self.lots * event.delta > 0:
                additional = event.delta * event.price
                return Survivor(remaining, self.entry_cost+additional, self.unpaid_basis+additional)
            share = Fraction(remaining, self.lots)
            return Survivor(remaining, self.entry_cost*share, self.unpaid_basis*share)
        claim = Fraction(event.claim_scaled, SCALE)
        fixed = claim - (self.lots * event.mark - self.unpaid_basis)
        return Survivor(self.lots, self.entry_cost, self.unpaid_basis+max(0, event.atoms-max(0, fixed)))

    def charge_cap(self, mark, claim_scaled, matched):
        require(type(mark) is int and mark > 0 and type(claim_scaled) is int and
                type(matched) is int and 0 <= matched <= abs(self.lots), "invalid matched position")
        if not matched:
            return 0
        marked = self.lots * mark
        # The fill tick must satisfy the entry bound on every individual lot.
        gross_per_lot = max(0, (marked-self.entry_cost)//abs(self.lots))
        open_share = matched * max(0, marked-self.unpaid_basis) // abs(self.lots)
        return min(gross_per_lot*matched, open_share, max(0, claim_scaled//SCALE))


def freeze_prefix(origin, events):
    prefix = Prefix(0, origin.initial())
    for event in events:
        prefix = prefix.append(event)
    return prefix


def verified_survivor(origin, expected_prefix, expected_lots, events):
    """Caller supplies an authenticated frozen origin, head, length and surviving lot count."""
    prefix = Prefix(0, origin.initial())
    state = Survivor()
    for event in events:
        require(prefix.count < expected_prefix.count, "unexpected trailing event")
        prefix = prefix.append(event)
        state = state.apply(event)
    require(prefix == expected_prefix and state.lots == expected_lots, "frozen history does not match")
    return state


def pack_survivor(state):
    """Canonical research encoding for the complete current position, independent of event history."""
    from math import lcm
    paid = state.unpaid_basis-state.entry_cost
    require(paid >= 0 and (state.lots or (state.entry_cost == 0 and paid == 0)), "invalid attribution")
    denominator = lcm(state.entry_cost.denominator, paid.denominator)
    cost_num, paid_num = int(state.entry_cost*denominator), int(paid*denominator)
    def magnitude(number):
        return number.to_bytes((number.bit_length()+7)//8, 'little')
    terms = [magnitude(abs(cost_num)), magnitude(paid_num), magnitude(denominator)]
    return pack('<qBIII',state.lots,int(cost_num < 0),*(len(term) for term in terms))+b''.join(terms)


def unpack_survivor(raw):
    from struct import unpack_from, calcsize
    layout = '<qBIII'
    cursor = calcsize(layout)
    require(len(raw) >= cursor,"incomplete attribution header")
    lots, negative, *lengths = unpack_from(layout,raw)
    require(negative in (0,1) and cursor+sum(lengths)==len(raw),"invalid attribution payload")
    terms = []
    for length in lengths:
        terms.append(int.from_bytes(raw[cursor:cursor+length],'little'))
        cursor += length
    cost, paid, denominator = terms
    require(denominator > 0,"zero denominator")
    cost = Fraction(-cost if negative else cost, denominator)
    state = Survivor(lots,cost,cost+Fraction(paid,denominator))
    require(pack_survivor(state) == raw, "noncanonical attribution")
    return state
