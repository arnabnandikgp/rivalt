"""P29B executable specification, NOT production code or SVM evidence.

Integer cumulative curve model. Tests use a separately derived per-lot oracle.
Financial state stays in the existing account engine; the small admission model
below exists to expose the allocator's full feasibility assumptions.
"""
from dataclasses import dataclass, replace
from itertools import combinations
from typing import Callable

MAX_DEPTH = 4096
MAX_ROUTE = 4608
MAX_POSITION = 100_000_000
MAX_PRICE = 1_000_000
SCALE = 1_000_000_000


def bounded(value: int, low: int, high: int) -> int:
    if not low <= value <= high:
        raise ValueError("bound")
    return value


@dataclass(frozen=True)
class Region:
    end: int
    offset: int
    slope: int


@dataclass(frozen=True)
class Curve:
    bids: tuple[Region, ...]
    asks: tuple[Region, ...]
    target: int = 0
    step: int = 64
    tick: int = 4
    long_cap: int = MAX_POSITION
    short_cap: int = MAX_POSITION
    reduce_only: bool = False

    def __post_init__(self):
        bounded(self.target, -MAX_POSITION, MAX_POSITION)
        bounded(self.step, 1, MAX_POSITION)
        bounded(self.tick, 0, 1000)
        bounded(self.long_cap, 0, MAX_POSITION)
        bounded(self.short_cap, 0, MAX_POSITION)
        if not self.bids and not self.asks:
            raise ValueError("empty curve")
        for regions in (self.bids, self.asks):
            bounded(len(regions), 0, 8)
            start, previous = 0, 0
            for region in regions:
                bounded(region.end, start + 1, MAX_DEPTH)
                bounded(region.offset, previous, MAX_PRICE)
                bounded(region.slope, 0, 1000)
                previous = region.offset + (region.end - start - 1) * region.slope
                bounded(previous, 0, MAX_PRICE)
                start = region.end


def prefix(regions: tuple[Region, ...], quantity: int) -> int:
    bounded(quantity, 0, regions[-1].end if regions else 0)
    start, total = 0, 0
    for region in regions:
        width = max(0, min(quantity, region.end) - start)
        total += width * region.offset + region.slope * width * (width - 1) // 2
        start = region.end
    return total


def potential(curve: Curve, inventory: int) -> int:
    distance = abs(inventory - curve.target)
    quotient, remainder = divmod(distance, curve.step)
    return curve.tick * (curve.step * quotient * (quotient - 1) // 2 + quotient * remainder)


def capacity(curve: Curve, side: int, inventory: int, consumed: int) -> int:
    bounded(side, 0, 1)  # 0 taker buy, 1 taker sell
    bounded(inventory, -MAX_POSITION, MAX_POSITION)
    bounded(consumed, 0, MAX_DEPTH)
    regions = curve.asks if side == 0 else curve.bids
    remaining = max(0, (regions[-1].end if regions else 0) - consumed)
    directional = inventory + curve.short_cap if side == 0 else curve.long_cap - inventory
    if curve.reduce_only:
        directional = min(directional, max(0, inventory if side == 0 else -inventory))
    return max(0, min(remaining, directional))


def quote(curve: Curve, anchor: int, side: int, lots: int, inventory: int, consumed: int) -> int:
    bounded(anchor, 1, MAX_PRICE)
    bounded(lots, 1, capacity(curve, side, inventory, consumed))
    direction = -1 if side == 0 else 1
    regions = curve.asks if side == 0 else curve.bids
    offset = prefix(regions, consumed + lots) - prefix(regions, consumed)
    skew = potential(curve, inventory + direction * lots) - potential(curve, inventory)
    gross = anchor * lots + (-direction) * (offset + skew)
    # Convex costs imply ordered marginal prices: endpoints suffice for bounds.
    def marginal(index):
        before = inventory + direction * index
        spread = prefix(regions, consumed + index + 1) - prefix(regions, consumed + index)
        change = potential(curve, before + direction) - potential(curve, before)
        return anchor + (-direction) * (spread + change)
    bounded(marginal(0), 1, MAX_PRICE)
    bounded(marginal(lots - 1), 1, MAX_PRICE)
    return bounded(gross, lots, lots * MAX_PRICE)


@dataclass(frozen=True)
class Publication:
    control: int = 1
    shape: int = 1
    depth: int = 1
    sequence: int = 0
    anchor: int = 0
    slot: int = 0
    time: int = 0
    ttl: int = 150
    buy_consumed: int = 0
    sell_consumed: int = 0
    enabled: bool = True

    def reprice(self, actor, owner, updater, updater_expiry, expected_control,
                expected_sequence, anchor, slot, time):
        if actor != owner and (actor != updater or slot >= updater_expiry):
            raise ValueError("authority")
        if expected_control != self.control or expected_sequence != self.sequence:
            raise ValueError("sequence")
        bounded(anchor, 1, MAX_PRICE)
        bounded(slot, 0, (1 << 64) - 1 - self.ttl)
        bounded(time, 0, (1 << 63) - 7)
        return replace(self, sequence=bounded(self.sequence + 1, 1, (1 << 64) - 1),
                       anchor=anchor, slot=slot, time=time)

    def valid(self, slot, time):
        return (self.enabled and self.sequence > 0 and self.slot <= slot < self.slot + self.ttl
                and self.time <= time < self.time + 6)

    def replace_shape(self):
        return replace(self, shape=bounded(self.shape + 1, 1, (1 << 64) - 1))

    def replenish(self, sides):
        bounded(sides, 1, 3)
        return replace(self, depth=bounded(self.depth + 1, 1, (1 << 64) - 1),
                       buy_consumed=0 if sides & 1 else self.buy_consumed,
                       sell_consumed=0 if sides & 2 else self.sell_consumed)

    def binding(self):
        return self.control, self.shape, self.depth


@dataclass(frozen=True)
class Position:
    quantity: int
    claim: int  # scaled quote claim incl. entry notional, before pending funding
    lower: int
    upper: int
    funding_delta: int = 0


def health(cash: int, positions: tuple[Position, ...], reserved: int = 0):
    """Reference root risk, not a replacement for the V3 engine/booking rules."""
    equity = cash * SCALE
    initial = reserved
    maintenance = 0
    for position in positions:
        price = position.lower if position.quantity >= 0 else position.upper
        claim = (position.claim - position.quantity * position.funding_delta
                 + position.quantity * price * SCALE)
        equity += min(0, claim)
        exposure = abs(position.quantity) * position.upper
        initial += (exposure + 9) // 10
        maintenance += (exposure + 19) // 20
    return equity, initial * SCALE, maintenance * SCALE


def fee(notional: int) -> int:
    return (notional + 4999) // 5000


@dataclass(frozen=True)
class Candidate:
    instance: int
    capital: str
    curve: Curve
    anchor: int
    inventory: int = 0
    consumed: int = 0


def allocations(candidates: tuple[Candidate, ...], lots: int):
    """Every nonzero singleton/pair composition, no prefix-health assumption."""
    bounded(lots, 1, MAX_ROUTE)
    bounded(len(candidates), 1, 3)
    ordered = sorted(candidates, key=lambda maker: maker.instance)
    if len({maker.capital for maker in ordered}) != len(ordered):
        raise ValueError("capital alias")
    if len({maker.instance for maker in ordered}) != len(ordered):
        raise ValueError("instance alias")
    if any(not 0 <= maker.instance <= 2 for maker in ordered):
        raise ValueError("instance")
    for maker in ordered:
        yield ((maker, lots),)
    for first, second in combinations(ordered, 2):
        for first_lots in range(max(1, lots - MAX_DEPTH), min(lots - 1, MAX_DEPTH) + 1):
            yield ((first, first_lots), (second, lots - first_lots))


def best_route(candidates, side, lots, admissible: Callable = lambda legs, amounts, charge: True,
               prior_notional=0, charge_fee=True):
    winner = None
    for legs in allocations(candidates, lots):
        try:
            amounts = tuple(quote(maker.curve, maker.anchor, side, quantity,
                                  maker.inventory, maker.consumed) for maker, quantity in legs)
        except ValueError:
            continue
        notional = sum(amounts)
        charge = fee(prior_notional + notional) - fee(prior_notional) if charge_fee else 0
        if not admissible(legs, amounts, charge):
            continue
        cost = notional + charge if side == 0 else -(notional - charge)
        identities = tuple(maker.instance for maker, _ in legs)
        key = (cost, len(legs), identities, -legs[0][1])
        if winner is None or key < winner[0]:
            winner = (key, tuple((maker.instance, quantity) for maker, quantity in legs), notional, charge)
    return None if winner is None else winner[1:]


def premium(reference: int, quantity: int, bid: int, ask: int):
    bounded(reference, 10_000, 100_000)
    if quantity != (6_000_000 + reference - 1) // reference or not 0 < bid <= ask:
        raise ValueError("funding context")
    numerator = (bid + ask - 2 * quantity * reference) * SCALE
    value = (abs(numerator) // (2 * quantity)) * (-1 if numerator < 0 else 1)
    limit = reference * SCALE * 50 // 10_000
    return max(-limit, min(limit, value))


def held_index(base: int, premium_scaled: int, sampled_at: int, held_until: int, now: int):
    elapsed = max(0, min(now, held_until) - sampled_at)
    product = premium_scaled * elapsed
    return base + (abs(product) // 3600) * (-1 if product < 0 else 1)


def funding_quote(candidates, publications, reference, slot, time, eligible=lambda *_: True):
    bounded(reference, 10_000, 100_000)
    if len(candidates) != 3 or len(publications) != 3:
        raise ValueError("incomplete coverage")
    if not all(publication.valid(slot, time) for publication in publications):
        raise ValueError("unqualified input")
    quantity = (6_000_000 + reference - 1) // reference
    # Caller already authenticates candidates and their publication bindings.
    bid = best_route(candidates, 1, quantity, eligible, charge_fee=False)
    ask = best_route(candidates, 0, quantity, eligible, charge_fee=False)
    if bid is None or ask is None:
        raise ValueError("unavailable reference size")
    return bid, ask, premium(reference, quantity, bid[1], ask[1])


# Borsh field order, widths; no implicit padding. Includes account discriminator.
# Accounts are inert specifications until P30/P32 implement them and prove parity.
LAYOUTS = {
    "LiquidityRegistryV4": (
        ("discriminator", 8), ("schema_version", 2), ("venue", 32), ("market", 32),
        ("count", 1), ("sealed", 1), ("registrations", 96), ("bump", 1)),
    "MakerRegistrationV4": (
        ("discriminator", 8), ("schema_version", 2), ("venue", 32), ("market", 32),
        ("capital", 32), ("owner", 32), ("pricing_program", 32), ("program_data", 32),
        ("config", 32), ("price", 32), ("approved_hash", 32), ("instance", 1),
        ("authority_epoch", 8), ("depth_epoch", 8), ("buy_consumed", 8),
        ("sell_consumed", 8), ("quarantined", 1), ("bump", 1)),
    "MakerCurveV4": (
        ("discriminator", 8), ("schema_version", 2), ("venue", 32), ("market", 32),
        ("capital", 32), ("controller", 32), ("owner", 32), ("updater", 32),
        ("updater_expiry_slot", 8), ("control_epoch", 8), ("shape_epoch", 8),
        ("domain", 32), ("instance", 1), ("capability", 2), ("mode", 1),
        ("ttl_slots", 2), ("target", 8), ("skew_step", 8), ("skew_tick", 8),
        ("long_cap", 8), ("short_cap", 8), ("bid_count", 1), ("ask_count", 1),
        ("bids", 192), ("asks", 192), ("bump", 1)),
    "MakerPriceV4": (
        ("discriminator", 8), ("schema_version", 2), ("config", 32),
        ("control_epoch", 8), ("sequence", 8), ("anchor", 8), ("updated_slot", 8),
        ("updated_time", 8), ("bump", 1)),
}


def offsets(layout):
    start, result = 0, {}
    for name, width in LAYOUTS[layout]:
        result[name] = start
        start += width
    return result, start


def shortvec_size(value):
    bounded(value, 0, 65535)
    return 1 if value < 128 else (2 if value < 16384 else 3)


def packet_size(static_accounts, instructions, lookup_writable=0, lookup_readonly=0, signatures=1):
    """Solana v0 transaction including two compute instructions.

    instructions is (account-index count, instruction-data bytes) per instruction.
    Account-index bytes count duplicate instruction references, not unique keys.
    One ALT when any lookup keys are used. No estimation of CU or runtime latency.
    """
    lookups = lookup_writable + lookup_readonly
    bounded(static_accounts + lookups, 1, 256)
    bounded(signatures, 1, static_accounts)
    message = 1 + 3 + shortvec_size(static_accounts) + 32 * static_accounts + 32
    all_instructions = ((0, 5), (0, 9), *instructions)
    message += shortvec_size(len(all_instructions))
    for count, data_size in all_instructions:
        message += 1 + shortvec_size(count) + count + shortvec_size(data_size) + data_size
    message += 1  # lookup table vector length
    if lookups:
        message += 32 + shortvec_size(lookup_writable) + lookup_writable
        message += shortvec_size(lookup_readonly) + lookup_readonly
    return shortvec_size(signatures) + 64 * signatures + message
