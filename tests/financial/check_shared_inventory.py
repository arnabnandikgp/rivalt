"""Compare the native one-lot selector with exhaustive allocations and signed inputs."""
import argparse
from fractions import Fraction
from hashlib import sha256
from itertools import permutations
import json
from pathlib import Path
from random import Random
from subprocess import check_output

from shared_inventory_comparison import compare

BINARY = 'target/debug/examples/single_lot_assignment'


def native(venue, epoch, debtors, winners, *, partial=False):
    def encode(members):
        return ','.join(f'{member}:{amount}' for member, amount in members)
    output = check_output([BINARY, *(["--partial"] if partial else []), venue.hex(), str(epoch), encode(debtors), encode(winners)], text=True)
    if output.strip() == 'unsupported':
        return None
    return sorted(tuple(map(int, line.split())) for line in output.splitlines())


def exhaustive(venue, epoch, debtors, winners):
    def order(member):
        domain = b'Rivalt/frozen-member-order/v1\0' + venue + epoch.to_bytes(8, 'little')
        return sha256(domain + member.to_bytes(8, 'little')).digest(), member
    winner_ranks = sorted((member for member, _ in winners), key=order)
    debtor_ranks = sorted((member for member, _ in debtors), key=order)
    best = best_key = None
    for opposing in permutations(winners):
        if any(amount > cap for (_, amount), (_, cap) in zip(debtors, opposing)):
            continue
        assignment = {(debtor, winner): amount for (debtor, amount), (winner, _) in zip(debtors, opposing)}
        charges = {winner: amount for (_, winner), amount in assignment.items()}
        cost = sum(Fraction(charges[winner]**2, cap) for winner, cap in winners)
        key = (-cost, tuple(charges[winner] for winner in winner_ranks),
               tuple(assignment.get((debtor, winner), 0) for winner in winner_ranks for debtor in debtor_ranks))
        if best_key is None or key > best_key:
            best, best_key = sorted((*pair, amount) for pair, amount in assignment.items()), key
    return best


def check_signed(evidence):
    recorded = json.loads(evidence.read_text())
    source = recorded['inputs']
    assert recorded['profile'] == 'ordinary shared winner inventory' and not recorded['refused']
    actual = compare(source)
    assert json.loads(json.dumps(actual)) == recorded['comparison']
    venue, epoch = bytes.fromhex(source['venueHex']), int(source['epoch'])
    rows = {row['key']: row for row in source['rows']}
    debtors = sorted((int(rows[source[key]]['id']), budget) for key, budget in
                     zip(('debtor', 'otherTrader'), actual['debtorBudgets'], strict=True))
    winners = sorted((int(rows[key]['id']), int(rows[key]['claims'][0])//10**9) for key in source['winners'])
    plan = native(venue, epoch, debtors, winners)
    assert plan == sorted((int(pair['debtor']), int(pair['winner']), pair['charge']) for pair in actual['schedules'])

    return plan


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('evidence', type=Path, nargs='?')
    args = parser.parse_args()
    plan = check_signed(args.evidence) if args.evidence else None
    venue, epoch = bytes(range(32)), 1
    random = Random(115)
    examined = accepted = 0
    for count in range(1, 7):
        debt_ids = [2*i for i in range(count)]
        win_ids = [2*i+1 for i in range(count)]
        for trial in range(20):
            amounts = [random.randint(1, 5) for _ in debt_ids]
            caps = [random.randint(1, 6) for _ in win_ids] if trial % 2 else [random.randint(5, 8) for _ in win_ids]
            if trial == 0:
                amounts, caps = [2]*count, [3]*count
            debtors, winners = list(zip(debt_ids, amounts)), list(zip(win_ids, caps))
            expected = exhaustive(venue, trial+1, debtors, winners)
            assert native(venue, trial+1, debtors, winners) == expected
            accepted += expected is not None
            examined += 1
    for debtors, winners in (
        ([(2, 1)], [(2, 2)]), ([(2, 1), (2, 2)], [(0, 1), (1, 2)]),
        ([(2, 1), (4, 1)], [(0, 1)]), ([(2, 0)], [(0, 1)]),
    ):
        assert native(venue, epoch, debtors, winners) is None
    boundary = 2**64-1
    wide = native(venue, epoch, [(0, boundary-1), (2, boundary)], [(1, boundary-1), (3,boundary)])
    assert wide == [(0,1,boundary-1),(2,3,boundary)]
    print(json.dumps(dict(signedAssignment=plan, exhaustiveBooks=examined, fullRecoveryBooks=accepted,
                          insufficientCapacityBooks=examined-accepted, malformedInputs=4)))


if __name__ == '__main__':
    main()
