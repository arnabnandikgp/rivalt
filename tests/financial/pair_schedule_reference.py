"""Independent sparse book, per-pair commitments and remaining position lots."""
from fractions import Fraction
from hashlib import sha256
from math import ceil
import json
import sys

from check_populated_recovery_bound import FrozenCase, constrained_targets
from frozen_plan_selection import FrozenIdentity
from recovery_lot_bound import earliest_winners, lot_bounds, ordered_pair_witness


def word(value, signed=False):
    return int(value).to_bytes(8, 'little', signed=signed)


def stored_rate(rate, lots):
    if rate.denominator <= lots:
        return rate
    # Direct enumeration at the measured quantities, independent of the
    # continued-fraction encoder in the clearing accounting crate.
    return max(Fraction(int(rate * count), count) for count in range(1, lots + 1))


def pair_schedule_reference(source):
    case = FrozenCase(source)
    identity = FrozenIdentity(bytes(source['venue']), int(source['epoch']),
                              tuple(int(row['id']) for row in case.rows))
    order = identity.order()
    caps = case.linked_share_bounds()
    weights = [case.eligible_weights(market) for market in range(2)]
    choices = [constrained_targets(weights[m], case.ceilings[m], *caps[m], 65536) for m in range(2)]
    targets = earliest_winners(case, choices)
    minimum = lot_bounds(case, choices)
    schedule = ordered_pair_witness(case, targets, minimum)
    markets = []
    for market in range(2):
        amounts = [targets[market], [budget[market] for budget in case.budgets]]
        pages, locations, quantities = [], {}, {}
        for role, values in enumerate(amounts):
            members = [index for index in order if values[index]]
            for start in range(0, len(members), 8):
                entries = []
                for offset, index in enumerate(members[start:start+8]):
                    lots = case.lots[index][market]
                    rate = stored_rate(case.rates[index][market], abs(lots)) if role == 0 else Fraction(0)
                    entry = [index, identity.member_ids[index], lots, rate.numerator, rate.denominator, values[index]]
                    entries.append(list(map(str, entry)))
                    assert index not in locations
                    locations[index] = (role, start+offset)
                    quantities[index] = abs(lots)
                pages.append(dict(role=role, index=str(start//8), entries=entries))
        tail = bytes(32)
        for page in reversed(pages):
            payload = b''.join(word(value, signed=(field == 2)) for row in page['entries']
                               for field, value in enumerate(row))
            page['next'] = tail.hex()
            tail = sha256(b'Rivalt/pair-order-page/v1\0' + bytes([page['role'], len(page['entries'])])
                          + payload + tail).digest()
        pair_hash = sha256(b'Rivalt/pair-fills/v1\0' + identity.venue + word(identity.episode) + bytes([market])).digest()
        hashes = [pair_hash.hex()]
        for matched_market, debtor, winner, atoms in schedule:
            if matched_market != market:
                continue
            lots = ceil(Fraction(atoms)/case.rates[winner][market])
            fields = [identity.member_ids[debtor], identity.member_ids[winner], atoms, lots, atoms//lots, atoms%lots]
            pair_hash = sha256(pair_hash + b''.join(map(word, fields))).digest()
            hashes.append(pair_hash.hex())
            quantities[debtor] -= lots
            quantities[winner] -= lots
        openings = []
        digest = sha256(b'Rivalt/winner-targets/v1\0' + identity.venue + word(identity.episode) + bytes([market])).digest()
        for start in range(0, len(case.rows), 8):
            prefix = digest.hex()
            rows = []
            for index in range(start, min(start+8, len(case.rows))):
                weight, charge = weights[market][index], targets[market][index]
                role, slot = locations.get(index, (None, 0))
                rows.append(dict(weight=str(weight), charge=str(charge), role=role, slot=str(slot)))
                digest = sha256(digest + word(identity.member_ids[index]) + word(weight) + word(charge)).digest()
            openings.append(dict(prefix=prefix, rows=rows))
        assert min(quantities.values(), default=0) >= 0
        markets.append(dict(orderRoot=tail.hex(), pages=pages, openings=openings, hashes=hashes,
                            minimumLots=str(minimum[market]), amounts=str(case.ceilings[market]),
                            quantities={str(index):str(quantity) for index, quantity in quantities.items()}))
    return markets


if __name__ == '__main__':
    json.dump(pair_schedule_reference(json.load(sys.stdin)), sys.stdout)
