"""Protected single-pair settlement, checked against the frozen book and integer fills."""
import copy
from fractions import Fraction
from itertools import permutations
import random
import unittest

from clearing_network_reference import InfeasiblePayoutFloor
from test_three_market_default import SCALE, book, permute, run
from market_indexed_reference import expected


def proposal(data, charge, gain=20, lots=1, target=0, debtor=0, winner=1):
    data = copy.deepcopy(data)
    mark = 100
    direction = 1 if lots > 0 else -1
    positions = []
    for member, size, basis in [(debtor, -lots, mark), (winner, lots, mark - direction * gain)]:
        cost = int(basis * abs(size) * SCALE)
        entry = cost.to_bytes(16, "little") * 2 + abs(size).to_bytes(8, "little")
        positions.append(dict(member=data["rows"][member]["id"], lots=str(size), entry_bytes=list(entry)))
    positions.extend(dict(member=row["id"], lots="0", entry_bytes=[0]*40)
                     for index, row in enumerate(data["rows"]) if index not in (debtor, winner))
    data["reduction"] = dict(market=data["markets"][target]["id"], mark=str(mark), positions=positions,
                             debtor=positions[0]["member"], winner=positions[1]["member"], charge=str(charge))
    return data


def compare_reference(source):
    """Independently reconstruct price concessions, then apply both foreign-market protections."""
    action = source["reduction"]
    data = copy.deepcopy(source)
    baseline = expected(data)
    ids = [row["id"] for row in data["rows"]]
    debtor, winner = (ids.index(action[key]) for key in ("debtor", "winner"))
    target = next(i for i, market in enumerate(data["markets"]) if market["id"] == action["market"])
    by_member = {item["member"]: item for item in action["positions"]}
    position = by_member[action["winner"]]
    lots = int(position["lots"])
    debtor_lots = int(by_member[action["debtor"]]["lots"])
    direction = 1 if lots > 0 else -1
    basis = bytes(position["entry_bytes"])
    endpoint = basis[16:32] if direction > 0 else basis[:16]
    entry = Fraction(int.from_bytes(endpoint, "little"), int.from_bytes(basis[32:], "little") * SCALE)
    per_lot = int(direction * (int(action["mark"]) - entry))
    charge = int(action["charge"])
    if charge > Fraction(baseline["rows"][debtor]["writeoff"][target]):
        return None
    if charge > Fraction(int(data["rows"][winner]["claims"][target]), SCALE):
        return None
    if per_lot <= 0 or charge > min(abs(lots), abs(debtor_lots)) * per_lot:
        return None
    matched = (charge + per_lot - 1) // per_lot
    ticks, extra = divmod(charge, matched)
    # Mark the two integer-price fills. Each member's pool-facing claim moves oppositely.
    gross_concession = (matched - extra) * ticks + extra * (ticks + 1)
    for member, sign in [(debtor, 1), (winner, -1)]:
        claims = data["rows"][member]["claims"]
        claims[target] = str(int(claims[target]) + sign * gross_concession * SCALE)

    adjusted = protected_settlement(source, data, baseline, target)
    if adjusted is None:
        return None
    def loss(plan):
        return sum(Fraction(row["loss"][target]) for row in plan["rows"])
    return dict(settlement=adjusted, matched=str(matched), baseTicks=str(ticks), extraTickLots=str(extra),
                debtorLotsAfter=str(debtor_lots + direction * matched), winnerLotsAfter=str(lots - direction * matched),
                recovery=str(min(charge, loss(baseline) - loss(adjusted))))


def protected_settlement(source, data, baseline, target):
    adjusted = expected(data, frozen=source)
    floors = {}
    for market in range(3):
        if market == target:
            continue
        if int(adjusted["spent"][market]) > int(baseline["spent"][market]):
            return None
        for member, (before, after) in enumerate(zip(baseline["rows"], adjusted["rows"])):
            if Fraction(after["recovered"][market]) < Fraction(before["recovered"][market]):
                return None
            floor = int(before["movements"][market])
            if floor > 0:
                floors[member, market] = floor
    if any(int(adjusted["rows"][i]["movements"][m]) < floor for (i, m), floor in floors.items()):
        try:
            adjusted = expected(data, frozen=source, minimums=floors)
        except InfeasiblePayoutFloor:
            return None
    return adjusted


def linked(debts=(12, 8), insurance=(0, 0, 0)):
    eth, sol = debts
    return book([(60, (-100, 0, 0)), (0, (40, -eth, -sol)), (0, (60, 0, 0)),
                 (0, (0, eth, 0)), (0, (0, 0, sol))], insurance=insurance, fees=(7, 11, 13))


class ProtectedReductionTests(unittest.TestCase):
    def compare_orders(self, data, passes):
        model = compare_reference(data)
        self.assertEqual(model is not None, passes)
        variants = []
        for order in permutations(range(3)):
            for reverse in (False, True):
                variant = permute(data, order, reverse)
                if reverse:
                    variant["reduction"]["positions"].reverse()
                variants.append(variant)
        actual = run(variants)
        if passes:
            self.assertEqual(actual, [model] * 12)
        else:
            self.assertEqual(actual, [{"error": "Entitlement"}] * 12)
        return model

    def test_partial_close_and_both_foreign_markets(self):
        good = self.compare_orders(proposal(linked(), 10, gain=6, lots=-3), True)
        self.assertEqual((good["matched"], good["baseTicks"], good["debtorLotsAfter"]), ("2", "5", "1"))
        self.assertEqual([r["cash"] for r in good["settlement"]["rows"]], ["0", "0", "40", "12", "8"])
        self.assertEqual(good["recovery"], "10")
        # At 11, 60*29/89 is less than 20. The two exact receipts fall even though
        # the ordinary whole-atom plan still gives creditors their former 12 and 8.
        original = linked()
        changed = copy.deepcopy(original)
        changed["rows"][0]["claims"][0] = str(-89 * SCALE)
        changed["rows"][1]["claims"][0] = str(29 * SCALE)
        foreign = expected(changed, frozen=original)["rows"][-2:]
        self.assertEqual([row["cash"] for row in foreign], ["12", "8"])
        self.assertEqual([row["entitlement"] for row in foreign], ["1044/89", "696/89"])
        self.compare_orders(proposal(linked(), 11), False)
        # Only the third market suffers.
        self.compare_orders(proposal(linked((0, 20)), 20), False)
        # Three ETH and two SOL insurance atoms would hide the lost receipts.
        insured = linked(insurance=(0, 3, 2))
        self.compare_orders(proposal(insured, 20), False)
        exposed = copy.deepcopy(insured)
        exposed["rows"][0]["claims"][0] = str(-80*SCALE)
        exposed["rows"][1]["claims"][0] = str(20*SCALE)
        unprotected = expected(exposed, frozen=insured)
        self.assertEqual(unprotected["spent"], ["0", "3", "2"])
        self.assertEqual([r["cash"] for r in unprotected["rows"][-2:]], ["12", "8"])

    def test_frozen_cash_and_multiple_destination_debts(self):
        shared = book([(90, (-80, -24, -16)), (0, (20, 0, 0)), (0, (60, 0, 0)),
                       (0, (0, 24, 0)), (0, (0, 0, 16))])
        result = self.compare_orders(proposal(shared, 20), True)["settlement"]
        self.assertEqual(result["rows"][0]["own"], ["60", "18", "12"])
        self.assertEqual([r["cash"] for r in result["rows"]], ["0", "0", "60", "18", "12"])
        fractional = book([(1, (-4, -2, -2)), (0, (3, 0, 0)), (0, (1, 2, 2))])
        result = self.compare_orders(proposal(fractional, 3), True)["settlement"]
        self.assertEqual(result["rows"][0]["own"], ["1/2", "1/4", "1/4"])

        # The first row owns half of any SOL recovery for each destination.
        # At 20 charged, neither cap binds. At 40, BTC can take only 60
        # of the recovered 150. The only other debt takes the remaining 90.
        cycle = book([(0, (-100, -100, 200)), (0, (50, 0, 0)), (0, (150, 0, -200)),
                      (100, (-100, 0, 0)), (0, (0, 100, 0))])
        self.assertEqual(expected(cycle)["rows"][0]["forwarded"], ["60", "60", "0"])
        partial = self.compare_orders(proposal(cycle, 20, gain=40), True)["settlement"]
        self.assertEqual(partial["rows"][0]["forwarded"], ["500/7", "500/7", "0"])
        full = self.compare_orders(proposal(cycle, 40, gain=40), True)["settlement"]
        self.assertEqual(full["rows"][0]["forwarded"], ["60", "90", "0"])
        self.assertEqual(full["spent"], ["0", "0", "0"])

    def test_protected_rounding_at_both_foreign_destinations(self):
        # Both foreign markets split an increased pool between creditors; ordinary
        # rounding can take a receipt atom from the smallest account.
        twin = book([(10, (-20, 0, 0)), (0, (4, 0, 0)), (0, (16, -9, -9)),
                     (0, (0, 5, 0)), (0, (0, 3, 0)), (0, (0, 1, 0)),
                     (0, (0, 0, 5)), (0, (0, 0, 3)), (0, (0, 0, 1))])
        actual = self.compare_orders(proposal(twin, 4), True)["settlement"]
        reduced = copy.deepcopy(twin)
        reduced["rows"][0]["claims"][0] = str(-16*SCALE)
        reduced["rows"][1]["claims"][0] = "0"
        ordinary = expected(reduced, frozen=twin)
        self.assertEqual([r["cash"] for r in ordinary["rows"][3:]], ["3", "2", "0"] * 2)
        self.assertEqual([r["cash"] for r in actual["rows"][3:]], ["3", "1", "1"] * 2)

    def test_cross_creditor_gross_receipt_survives_while_cash_is_forwarded(self):
        pairs = [(3, -8, 3), (2, 4, -3), (2, 4, -7), (1, 3, -4), (1, -3, 11)]
        data = book([(cash, (btc, Fraction(eth, 2), 0)) for cash, btc, eth in pairs] +
                    [(1, (0, 0, -1)), (0, (0, 0, 1))])
        ordinary = copy.deepcopy(data)
        ordinary["rows"][0]["claims"][0] = str(-7 * SCALE)
        ordinary["rows"][1]["claims"][0] = str(3 * SCALE)
        unprotected = expected(ordinary, frozen=data)
        guarded = self.compare_orders(proposal(data, 1), True)["settlement"]
        self.assertEqual(unprotected["rates"], guarded["rates"])
        self.assertEqual([unprotected["rows"][i]["movements"][1] for i in (0, 4)], ["2", "5"])
        self.assertEqual([guarded["rows"][i]["movements"][1] for i in (0, 4)], ["1", "6"])

    def test_attribution_and_shortfall_caps(self):
        # A second debtor owes eight of the ten atoms of market shortfall.
        data = book([(8, (-10, 0, 0)), (0, (20, 0, 0)), (2, (-10, 0, 0))])
        self.compare_orders(proposal(data, 2), True)
        self.compare_orders(proposal(data, 3), False)
        # At half a tick below an integer gain, five whole ticks are unavailable.
        eligible = proposal(linked(), 5, gain=5)
        history = eligible["reduction"]["positions"][1]["entry_bytes"]
        history[16:32] = list((95*SCALE + 1).to_bytes(16, "little"))
        self.assertIsNone(compare_reference(eligible))
        self.assertEqual(run([eligible]), [{"error": "Bounds"}])

    def test_generated_books(self):
        rng = random.Random(1104)
        books = []
        for i in range(54):
            target = i % 3
            debts = [Fraction(rng.randrange(0, 21), 2) for _ in range(2)]
            source = linked(debts, insurance=(0, rng.randrange(5), rng.randrange(5)))
            # Rotate the financial contents under the stable market IDs.
            for row in source["rows"]:
                original = row["claims"]
                row["claims"] = original[-target:] + original[:-target] if target else original
            original = [m["insurance"] for m in source["markets"]]
            for m, market in enumerate(source["markets"]):
                market["insurance"] = original[(m-target) % 3]
            books.append(proposal(source, rng.randrange(1, 21), lots=(-3 if i % 2 else 3), target=target))
        counts = [0, 0]
        for index, (data, result) in enumerate(zip(books, run(books))):
            with self.subTest(index=index):
                reference = compare_reference(data)
                counts[reference is not None] += 1
                if reference is None:
                    self.assertIn("error", result)
                else:
                    self.assertEqual(result, reference)
        self.assertGreater(min(counts), 0)

    def test_interlinked_fractional_books(self):
        # Choose debtor/winner identities from complete random balanced claims. Include
        # losses offset by another market and more than one debtor for the same market.
        rng = random.Random(1304)
        cases = []
        for index in range(60):
            target = index % 3
            claims = [[Fraction(rng.randrange(-22, 23), 2) for _ in range(3)] for _ in range(3)]
            claims.append([-sum(row[m] for row in claims) for m in range(3)])
            if all(row[target] == 0 for row in claims):
                continue
            debtor = min(range(4), key=lambda i: claims[i][target])
            winner = max(range(4), key=lambda i: claims[i][target])
            data = book([(rng.randrange(4), row) for row in claims],
                        insurance=tuple(rng.randrange(3) for _ in range(3)))
            cases.append(proposal(data, 1 + index % 4, target=target, debtor=debtor, winner=winner))
        results = run(cases)
        for index, (data, actual) in enumerate(zip(cases, results)):
            with self.subTest(index=index):
                reference = compare_reference(data)
                if reference is None:
                    self.assertIn("error", actual)
                else:
                    self.assertEqual(actual, reference)
        self.assertTrue(any("error" in row for row in results))
        self.assertTrue(any("settlement" in row for row in results))

    def test_invalid_position_inputs(self):
        cases = []
        for change in (
            lambda action: action.update(mark="0"), lambda action: action.update(charge="0"),
            lambda action: action.update(market=99), lambda action: action.update(winner=action["debtor"]),
            lambda action: action["positions"].pop(), lambda action: action["positions"].pop(0),
            lambda action: action["positions"].append(action["positions"][0]),
            lambda action: action["positions"][0].update(member="999"),
            lambda action: action["positions"].__delitem__(slice(0, 2)),
            lambda action: action.update(winner=action["positions"][2]["member"]),
            lambda action: action["positions"][1].update(entry_bytes=[0]*40),
        ):
            data = proposal(linked(), 10)
            change(data["reduction"])
            cases.append(data)
        self.assertTrue(all("error" in r for r in run(cases)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
