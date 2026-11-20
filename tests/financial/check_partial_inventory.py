"""Independently enumerate every charge and disjoint fill in two-by-two small books."""
from fractions import Fraction
from hashlib import sha256
from itertools import product
from random import Random

from check_shared_inventory import native


def exhaustive(venue, epoch, debtors, winners):
    def priority(member):
        prefix = b'Rivalt/frozen-member-order/v1\x00' + venue + epoch.to_bytes(8, 'little')
        return sha256(prefix + member.to_bytes(8, 'little')).digest(), member

    edges = [(debtor, winner) for debtor, _ in debtors for winner, _ in winners]
    order = sorted(edges, key=lambda pair: (priority(pair[1]), priority(pair[0])))
    winner_order = sorted(dict(winners), key=priority)
    limits = [min(dict(debtors)[debtor], dict(winners)[winner]) for debtor, winner in edges]
    best_key, result = None, []
    possible = 0
    for amounts in product(*(range(limit+1) for limit in limits)):
        fills = {edge: amount for edge, amount in zip(edges, amounts) if amount}
        if any(len({edge[role] for edge in fills}) != len(fills) for role in (0, 1)):
            continue
        possible += 1
        recovered = sum(fills.values())
        charges = {winner: sum(amount for (_, w), amount in fills.items() if w == winner) for winner, _ in winners}
        total_capacity = sum(dict(winners).values())
        deviation = sum((charges[winner] - Fraction(recovered*cap, total_capacity))**2/cap
                        for winner, cap in winners if cap)
        key = (recovered, -deviation, -len(fills), tuple(charges[winner] for winner in winner_order),
               tuple(fills.get(edge, 0) for edge in order))
        if best_key is None or key > best_key:
            best_key, result = key, sorted((*edge, amount) for edge, amount in fills.items())
    return result, possible


def main():
    rng = Random(531)
    books = list(product(range(4), repeat=4))
    books.extend(tuple(rng.randrange(8) for _ in range(4)) for _ in range(40))
    candidates = 0
    for epoch, (left, right, first, second) in enumerate(books):
        ids = sorted(rng.sample(range(10000), 4))
        debtors = [(ids[0], left), (ids[3], right)]
        winners = [(ids[1], first), (ids[2], second)]
        venue = rng.randbytes(32)
        expected, count = exhaustive(venue, epoch, debtors, winners)
        assert native(venue, epoch, debtors, winners, partial=True) == expected
        candidates += count
    # Checked-width boundary also exercises recovery whose sum exceeds a u64.
    peak = 2**64-1
    assert native(bytes(32), 0, [(1, peak), (3, peak-1)], [(2, peak), (4, peak-1)], partial=True) == [
        (1, 2, peak), (3, 4, peak-1)]
    print(f'{len(books)} independent books, {candidates} feasible allocations, u64 boundary')


if __name__ == '__main__':
    main()
