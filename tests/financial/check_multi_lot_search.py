"""Compare native BTC default searches with independent joint clearing and rational arithmetic."""
import json
from fractions import Fraction
from itertools import product
from pathlib import Path
from subprocess import run
from sys import argv

from account_contract_reference import Account
from frozen_plan_selection import FrozenIdentity, select_joint
from joint_reduction_model import Exposure
from market_settlement_reference import MarketBook
from test_scalable_settlement import SCALE

BINARY = Path(__file__).resolve().parents[2] / 'target/debug/examples/multi_lot_audit'


def history(basis, lots):
    if not lots:
        assert (int(basis['entryScaled']), int(basis['paidScaled'])) == (0, 0)
        return ''
    values = [int(basis[key]) for key in ('entryScaled', 'paidScaled', 'denominator')]
    limbs = [value.to_bytes((value.bit_length()+7)//8, 'little') for value in values]
    return (b''.join(len(limb).to_bytes(2, 'little') for limb in limbs) + b''.join(limbs)).hex()


def comparison(data, *, partial=True):
    rows = data['rows']
    venue, epoch = bytes.fromhex(data['venueHex']), int(data['epoch'])
    ids = tuple(int(row['id']) for row in rows)
    identity = FrozenIdentity(venue, epoch, ids)
    mark = int(data['marks'][0])
    balances = tuple(int(row['cash']) for row in rows)
    faces = tuple(Fraction(int(row['claims'][0]), SCALE) for row in rows)
    lots = tuple(int(row['lots'][0]) for row in rows)
    assert all(int(row['claims'][1]) == int(row['lots'][1]) == 0 for row in rows)
    assert all(face.denominator == 1 for face in faces)
    assert tuple(map(int, data['pools'])) == (0, 0) and sum(faces) == sum(lots) == 0
    entries, unpaid, inputs = [], [], []
    for row, qty, cash in zip(rows, lots, balances, strict=True):
        basis = row['basis'][0]
        divisor = int(basis['denominator']) * SCALE
        entry = Fraction(int(basis['entryScaled']), divisor) if qty else None
        paid = abs(qty)*Fraction(int(basis['paidScaled']), divisor)
        entries.append(entry)
        unpaid.append(max(0, qty*(mark-entry)-paid) if qty else 0)
        inputs.append(dict(id=str(row['id']), lots=str(qty), claim=str(row['claims'][0]),
                           cash=str(cash), history=history(basis, qty)))
    book = MarketBook(tuple(Account(cash, (face, 0)) for cash, face in zip(balances, faces)),
                      pools=(0, 0), insurance=tuple(map(int, data['insurance'])),
                      fees=tuple(map(int, data['fees'])), frozen=True)
    empty = (0,) * len(rows)
    exposures = (Exposure(mark, lots, tuple(entries), tuple(unpaid)),
                 Exposure(int(data['marks'][1]), empty, (None,)*len(rows), empty))
    winner = select_joint(book, exposures, identity)
    pairs = winner.markets[0].pairs
    proposed = [[str(ids[pair.debtor]), str(ids[pair.winner]), str(pair.charge)] for pair in pairs]
    cmd = dict(venue=venue.hex(), freeze=data['sourceDigest'], epoch=str(epoch), mark=str(mark),
               insurance=str(book.insurance[0]), rows=inputs, proposed=proposed, chunk='17', limit=str(10**12))
    vectors = [cmd]
    if partial:
        vectors += [dict(cmd, limit='1'), dict(cmd, proposed=[])]
    result = run([str(BINARY)], input=''.join(json.dumps(v)+'\n' for v in vectors), text=True,
                 capture_output=True, check=True)
    checks = [json.loads(line) for line in result.stdout.splitlines()]
    actual = checks[0]
    assert actual['status'] == 'verified' and actual['checked'] == actual['space'], actual
    wanted = {}
    for pair in pairs:
        matched = sum(size for size, _ in pair.fills)
        base, extra = divmod(pair.charge, matched)
        assert sum(size*abs(price-mark) for size, price in pair.fills) == pair.charge
        wanted[ids[pair.debtor], ids[pair.winner]] = pair.charge, matched, base, extra
    assert {(int(d), int(w)): tuple(map(int, terms)) for d,w,*terms in actual['fills']} == wanted
    if partial and int(actual['space']) > 1:
        assert checks[1]['status'] == 'pending' and checks[1]['fills'] is None
        if proposed:
            assert checks[2]['status'] == 'outscored' and checks[2]['fills'] is None
    return dict(candidates=actual['space'], chunks=actual['chunks'], fills=actual['fills'],
                charges=winner.charges, cash=list(winner.payout.cash), compared=len(checks))


def vectors():
    # All have a balanced, single-market freeze. Change the paid share, entry,
    # debtor lots and insurance without using the native scorer for expectations.
    for index,(short_lots, paid, insurance, flip) in enumerate(product((1,2,3),(0,1),(0,3),(-1,1))):
        quantities = [short_lots, 4-short_lots, -2, -2, 0]
        faces = [-6,-5,5,4,2]
        accounts = []
        for member,(qty,face) in enumerate(zip(quantities,faces)):
            qty *= flip
            price = (102 if flip == 1 else 98) if member==2 else (103 if flip==1 else 97)
            basis = dict(entryScaled=str(price*SCALE if qty else 0), paidScaled=str(paid*SCALE//2 if member==2 else 0), denominator='1')
            accounts.append(dict(id=str(100+member), lots=[str(qty),'0'], claims=[str(face*SCALE),'0'],
                                 cash=str((2,1,3,0,0)[member]), basis=[basis]))
        yield dict(venueHex='ad'*32, sourceDigest='ac'*32, epoch=str(index), marks=['100','100'],
                   pools=['0','0'], insurance=[str(insurance),'0'], fees=['0','0'], rows=accounts)


if __name__ == '__main__':
    if len(argv)>1:
        raw = json.loads(Path(argv[1]).read_text())
        print(json.dumps(comparison(raw.get('inputs', raw))))
    else:
        results = [comparison(vector) for vector in vectors()]
        print(json.dumps(dict(books=len(results), candidates=sum(int(r['candidates']) for r in results),
                              proposedOrPrefixChecks=sum(r['compared'] for r in results))))
