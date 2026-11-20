"""Independent holder allocations and full prefix digests for signed RPC comparisons."""
from fractions import Fraction
from hashlib import sha256
from math import ceil
import json
import sys

from check_populated_recovery_bound import FrozenCase, constrained_targets
from frozen_plan_selection import FrozenIdentity
from recovery_lot_bound import earliest_winners, lot_bounds


def winner_reference(source):
    case = FrozenCase(source)
    group_caps = case.linked_share_bounds()
    weights = [case.eligible_weights(market) for market in range(2)]
    choices = [constrained_targets(weights[m], case.ceilings[m], *group_caps[m], 65536) for m in range(2)]
    targets = earliest_winners(case, choices)
    floors = lot_bounds(case, choices)
    ids = tuple(int(row['id']) for row in case.rows)
    venue, epoch = bytes(source['venue']), int(source['epoch'])
    order = FrozenIdentity(venue, epoch, ids).order()
    ranks = {member: rank for rank, member in enumerate(order)}
    markets = []
    for market, shares in enumerate(targets):
        linked, _ = group_caps[market]
        cutoffs = []
        for group in (False, True):
            selected = [(Fraction(2 * charge - 1, weights[market][member]), ranks[member], member)
                        for member, charge in enumerate(shares) if charge and (member in linked) == group]
            if selected:
                member = max(selected)[2]
                cutoff = [shares[member], weights[market][member], ids[member]]
            else:
                cutoff = [0, 0, 0]
            cutoffs.append(list(map(str, cutoff)))
        prefixes, recovered = [], [0, 0]
        le = lambda number: number.to_bytes(8, 'little')
        digest = sha256(b'Rivalt/winner-targets/v1\0' + venue + le(epoch) + bytes([market])).digest()
        initial_digest = digest.hex()
        winner_lots = 0
        for index, charge in enumerate(shares):
            digest = sha256(digest + le(ids[index]) + le(weights[market][index]) + le(charge)).digest()
            recovered[index in linked] += charge
            if charge:
                winner_lots += ceil(Fraction(charge) / case.rates[index][market])
            if (index + 1) % 8 == 0 or index + 1 == len(shares):
                prefixes.append(dict(digest=digest.hex(), recovered=list(map(str, recovered)), winnerLots=str(winner_lots)))
        markets.append(dict(cutoffs=cutoffs, minimumLots=str(floors[market]), initialDigest=initial_digest, prefixes=prefixes))
    return markets


if __name__ == '__main__':
    json.dump(winner_reference(json.load(sys.stdin)), sys.stdout)
