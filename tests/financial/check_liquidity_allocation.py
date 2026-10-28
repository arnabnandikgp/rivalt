"""Independent, per-lot price and full-state exhaustive financial oracle for P31.

No SDK or production arithmetic is imported. Inputs are emitted to the actual SDK
driver; literal scenarios and seeded varied whole-account books are compared.
"""
import copy
import itertools
import json
import random
import subprocess

SCALE = 10**9


def account(cash=10**9):
    return dict(cash=cash, positions=[dict(q=0, v=0, f=0, g=0) for _ in range(2)], orders=[])


def case():
    makers = []
    for _ in range(3):
        maker = account()
        maker.update(anchor=10000, consumed=0, mode=1, target=0, step=1, tick=0,
                     cap=4096, regions=[[4096, 10, 0]], unavailable=None)
        makers.append(maker)
    return dict(lots=1, side=0, reduce=False, limit=10**9, fee=10**6,
                funding=[0, 0], sources=['Normal', 'Normal'], stored=None,
                root=account(), makers=makers, permutation=[0, 1, 2])


def remaining(root, order):
    if order['state'] not in (1, 2):
        return 0
    result = order['lots'] - order['filled']
    position = root['positions'][order['market']]
    if order['reduce']:
        if order['g'] != position['g'] or position['q'] == 0 or (order['side'] == 0) != (position['q'] < 0):
            return 0
        result = min(result, abs(position['q']))
    return result


def accrue(root, funding):
    root = copy.deepcopy(root)
    for index, position in enumerate(root['positions']):
        position['v'] -= position['q'] * (funding[index] - position['f'])
        position['f'] = funding[index]
    return root


def health(root):
    equity, initial, maintenance, reserved = root['cash'] * SCALE, 0, 0, 0
    for position in root['positions']:
        quantity = position['q']
        equity += min(position['v'] + quantity * (9900 if quantity >= 0 else 10100) * SCALE, 0)
        initial += (abs(quantity) * 10100 + 9) // 10
        maintenance += (abs(quantity) * 10100 + 19) // 20
    for order in root['orders']:
        quantity = remaining(root, order)
        if quantity:
            adverse = max(order['limit'] - 9900 if order['side'] == 0 else 10100 - order['limit'], 0)
            reserved += quantity * (adverse + (0 if order['reduce'] else 1010)) + order['budget'] - order['paid']
    return equity, initial + reserved, max(maintenance * SCALE - equity, 0)


def filled(root, delta, gross, fee, stored=None):
    result = copy.deepcopy(root)
    position = result['positions'][0]
    before, after = position['q'], position['q'] + delta
    if before == 0 or after == 0 or (before > 0) != (after > 0):
        position['g'] += 1
    position['q'] = after
    position['v'] -= (gross if delta > 0 else -gross) * SCALE
    result['cash'] -= fee
    if stored is not None:
        order = result['orders'][stored]
        order['filled'] += abs(delta)
        order['prefix'] += gross
        order['paid'] += fee
        order['state'] = 3 if order['filled'] == order['lots'] else 2
    return result


def quote(maker, side, quantity):
    if maker['unavailable'] or maker['mode'] == 0:
        return None
    inventory = maker['positions'][0]['q']
    direction = -1 if side == 0 else 1
    after = inventory + direction * quantity
    if abs(after) > maker['cap'] or maker['mode'] == 3 and (abs(after) >= abs(inventory) or after * inventory < 0):
        return None
    # Explicit marginal offset list and integer potential are deliberately unlike
    # the implementation's region-prefix closed form.
    offsets, start = [], 0
    for end, offset, slope in maker['regions']:
        offsets.extend(offset + slope * index for index in range(end - start))
        start = end
    begin = maker['consumed']
    if begin + quantity > len(offsets):
        return None

    def potential(position):
        return sum(index // maker['step'] * maker['tick'] for index in range(abs(position - maker['target'])))

    prices = []
    for index in range(quantity):
        position = inventory + direction * index
        price = maker['anchor'] - direction * (offsets[begin + index] + potential(position + direction) - potential(position))
        if not 1 <= price <= 10**6:
            return None
        prices.append(price)
    gross = sum(prices)
    return gross if quantity * 9000 <= gross <= quantity * 11000 else None


def oracle(vector):
    side, quantity, reduce = vector['side'], vector['lots'], vector['reduce']
    original, stored = vector['root'], vector['stored']
    order = original['orders'][stored] if stored is not None else None
    if order:
        reduce = order['reduce']
        if order['market'] != 0 or order['side'] != side or remaining(original, order) < quantity:
            return dict(rejected=True)
    if reduce and (quantity > abs(original['positions'][0]['q']) or (side == 0) != (original['positions'][0]['q'] < 0)):
        return dict(rejected=True)
    for index, source in enumerate(vector['sources']):
        relevant = index == 0 or original['positions'][index]['q'] != 0 or any(
            entry['market'] == index and remaining(original, entry) for entry in original['orders'])
        if relevant and source != 'Normal' and not (reduce and source == 'Degraded'):
            return dict(rejected=True)
    root = accrue(original, vector['funding'])
    capitals = [accrue(maker, vector['funding']) for maker in vector['makers']]
    prefix = order['prefix'] if order else 0
    budget = order['budget'] - order['paid'] if order else vector['fee']
    limit = order['limit'] * quantity if order else vector['limit']
    candidates = []
    for index in range(3):
        candidates.append([(index, quantity)])
    for first, second in itertools.combinations(range(3), 2):
        candidates.extend([(first, split), (second, quantity - split)] for split in range(1, quantity))
    best, best_key = None, None
    for legs in candidates:
        gross, valid = 0, True
        for index, size in legs:
            price = quote(vector['makers'][index], side, size)
            if price is None:
                valid = False
                break
            provider = filled(capitals[index], -size if side == 0 else size, price, 0)
            equity, requirement, _ = health(provider)
            if provider['cash'] < 0 or equity < requirement * SCALE:
                valid = False
                break
            gross += price
        if not valid or gross < 1000:
            continue
        fee = (prefix + gross + 4999) // 5000 - (prefix + 4999) // 5000
        all_in = gross + fee if side == 0 else gross - fee
        if fee > budget or (all_in > limit if side == 0 else all_in < limit):
            continue
        trader = filled(root, quantity if side == 0 else -quantity, gross, fee, stored)
        equity, requirement, deficit = health(trader)
        if trader['cash'] < 0 or (equity < requirement * SCALE and not (reduce and deficit < health(root)[2])):
            continue
        key = (all_in if side == 0 else -all_in, len(legs), tuple(index for index, _ in legs), -legs[0][1])
        if best_key is None or key < best_key:
            best_key = key
            best = dict(gross=str(gross), fee=str(fee), allIn=str(all_in), legs=[[index, str(size)] for index, size in legs])
    return best


def vectors():
    result = []
    # Exact funded-cash boundary and one fractional scaled atom across markets.
    for cash, claim in [(1123, 0), (1123, -1), (1122, 10**15)]:
        vector = case(); vector['root']['cash'] = cash; vector['root']['positions'][1]['v'] = claim
        result.append(vector)
    for quantity in range(1, 7):
        vector = case(); vector['lots'] = quantity; vector['makers'][0]['cash'] = 500
        vector['makers'][0]['positions'][0].update(q=3, v=-30000*SCALE, g=1)
        for maker in vector['makers'][1:]: maker['unavailable'] = 'quarantined'
        result.append(vector)
    rng = random.Random(310031)
    for iteration in range(400):
        vector = case(); vector.update(lots=rng.randrange(1, 17), side=iteration % 2)
        vector['limit'] = 10**9 if vector['side'] == 0 else 0
        vector['root']['cash'] = rng.randrange(0, 40000)
        vector['funding'] = [rng.randrange(-SCALE, SCALE), rng.randrange(-SCALE, SCALE)]
        for index, position in enumerate(vector['root']['positions']):
            position['q'] = rng.randrange(-8, 9); position['g'] = 1
            position['v'] = -position['q'] * 10000*SCALE + rng.randrange(-2000*SCALE, 2000*SCALE)
        if iteration % 4 == 0:
            vector['reduce'] = True
            vector['lots'] = rng.randrange(1, 5)
            vector['root']['positions'][0]['q'] = vector['lots'] * (1 if vector['side'] else -1)
        if iteration % 5 == 0:
            vector['sources'][iteration % 2] = ['Degraded', 'Frozen', 'NoCredibleBounds'][iteration % 3]
        for maker in vector['makers']:
            maker.update(anchor=rng.randrange(9900, 10101), cap=rng.randrange(8, 25), consumed=rng.randrange(0, 5),
                         target=rng.randrange(-5, 6), step=rng.randrange(1, 5), tick=rng.randrange(0, 7))
            maker['positions'][0].update(q=rng.randrange(-6, 7), g=1)
            maker['positions'][0]['v'] = -maker['positions'][0]['q']*10000*SCALE
            maker['cash'] = rng.randrange(0, 30000)
            maker['regions'] = [[rng.randrange(5, 9), 3, rng.randrange(0, 4)], [rng.randrange(16, 25), 40, 0]]
            if rng.randrange(8) == 0: maker['unavailable'] = 'stale-publication'
            if rng.randrange(8) == 0: maker['mode'] = 3
        # Full books include unrelated-market reservations and generation-bound
        # reductions; selected subfills free only their own remaining reservation.
        if iteration % 3 == 0:
            for index in range(4):
                vector['root']['orders'].append(dict(market=index % 2, state=1, side=index % 2,
                    lots=rng.randrange(1, 5), filled=0, prefix=0, paid=0, budget=100, limit=10020,
                    reduce=index == 3, g=1))
            if iteration % 6 == 0:
                vector['stored'] = 0
                vector['root']['orders'][0].update(side=vector['side'],lots=vector['lots']+1,filled=1,
                    prefix=10001,paid=3,limit=10500 if vector['side'] == 0 else 9500,reduce=vector['reduce'])
        result.append(vector)
    # All permutations must preserve exact tie ordering, including two instances
    # of the same program. Offset slopes force an interior optimal split.
    for permutation in itertools.permutations(range(3)):
        vector = case(); vector['lots'] = 16; vector['permutation'] = list(permutation)
        vector['makers'][0]['regions'] = [[20, 10, 4]]
        for maker in vector['makers'][1:]: maker['regions'] = [[20, 30, 0]]
        result.append(vector)
    return result


if __name__ == '__main__':
    cases = vectors()
    expected = [oracle(vector) for vector in cases]
    completed = subprocess.run(['node', '--import', 'tsx', 'tests/financial/liquidity-sdk-driver.ts'],
                               input=''.join(json.dumps(vector)+'\n' for vector in cases), text=True, capture_output=True, check=True)
    actual = [json.loads(line) for line in completed.stdout.splitlines()]
    assert len(actual) == len(expected), (len(actual), len(expected), completed.stderr)
    for index, (result, target) in enumerate(zip(actual, expected)):
        if isinstance(result, dict) and result.get('rejected'): result = dict(rejected=True)
        assert result == target, json.dumps(dict(index=index, actual=result, expected=target, vector=cases[index]))
    print(json.dumps(dict(cases=len(cases), allocated=sum(value is not None and 'rejected' not in value for value in expected),
                          unavailable=sum(value is None for value in expected), rejected=sum(isinstance(value,dict) and value.get('rejected',False) for value in expected))))
