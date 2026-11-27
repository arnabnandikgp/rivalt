"""Compare Rust charge search with exhaustive whole-lot assignments and exact cash flows."""
import copy
from fractions import Fraction
from itertools import product, permutations
import json
import os
import random
import subprocess
import unittest

from frozen_plan_selection import FrozenIdentity
from test_three_market_default import SCALE, book, permute
from test_three_market_reduction import protected_settlement
from three_market_reference import expected

BINARY = os.getenv("RIVALT_THREE_MARKET_COMPETITION", "target/debug/examples/three_market_competition")


def run(cases):
    output = subprocess.run([BINARY], input="".join(json.dumps(c) + "\n" for c in cases),
                            capture_output=True, text=True, check=True)
    results = [json.loads(line) for line in output.stdout.splitlines()]
    assert len(results) == len(cases)
    return results


def with_positions(data, lots, entries, *, mark=100, target=0, episode=1):
    positions = []
    for row, qty, entry in zip(data["rows"], lots, entries, strict=True):
        scaled = Fraction(entry) * abs(qty) * SCALE
        assert scaled.denominator == 1
        raw = int(scaled).to_bytes(16, 'little') * 2 + abs(qty).to_bytes(8, 'little')
        positions.append(dict(member=row["id"], lots=str(qty), entry_bytes=list(raw)))
    data["competition"] = dict(market=data["markets"][target]["id"], mark=str(mark), positions=positions,
                               venue=list(range(32)), episode=str(episode), search_limit="10000")
    return data


def competition(*, debtor_lots=2, winner_lots=(1, 1), gains=(10, 10), debts=(0, 0), debtor_cash=9, insurance=(1, 0, 0),
                claims=(10, 10), flat=6, other_debt=6, direction=1, episode=1):
    # The solvent short holds any offsetting lots beyond the defaulting short.
    # Its debt is fully cash-backed, so those lots cannot be seized for the default.
    linked_gain, other_gain = claims
    eth, sol = debts
    members = [(debtor_cash, (-(linked_gain + other_gain + flat - other_debt), 0, 0)), (0, (linked_gain, -eth, -sol)), (0, (other_gain, 0, 0)),
               (1, (flat, 0, 0)), (other_debt, (-other_debt, 0, 0)), (2, (0, eth, 0)), (3, (0, 0, sol))]
    lots = [-debtor_lots, *winner_lots, 0, debtor_lots - sum(winner_lots), 0, 0]
    return with_positions(book(members, insurance=insurance, fees=(7, 3, 2)), [q * direction for q in lots],
                          [100, 100 - direction * gains[0], 100 - direction * gains[1], 0, 100, 0, 0], episode=episode)


def reference(data):
    source = data["competition"]
    target = next(i for i, m in enumerate(data["markets"]) if m["id"] == source["market"])
    baseline = expected(data)
    original = sorted(data["rows"], key=lambda row: int(row["id"]))
    positions = {p["member"]: p for p in source["positions"]}
    lots = [int(positions[r['id']]['lots']) for r in original]
    debtor, = [i for i, qty in enumerate(lots) if qty and Fraction(baseline["rows"][i]["writeoff"][target]) >= 1]
    budget = int(Fraction(baseline["rows"][debtor]["writeoff"][target]))
    options = []
    winners = []
    for i, qty in enumerate(lots):
        if lots[debtor] * qty >= 0 or int(original[i]["claims"][target]) < SCALE:
            continue
        raw = bytes(positions[original[i]["id"]]["entry_bytes"])
        endpoint = raw[16:32] if qty > 0 else raw[:16]
        entry = Fraction(int.from_bytes(endpoint, 'little'), int.from_bytes(raw[32:], 'little') * SCALE)
        ticks = int((int(source["mark"]) - entry) * (1 if qty > 0 else - 1))
        if ticks <= 0:
            continue
        # Enumerate the charges reachable by assigning 0, 1, ... original lots.
        # Record the first lot count that realizes each integer concession.
        reachable = {0: 0}
        for assigned in range(1, 1 + min(abs(qty), abs(lots[debtor]))):
            for charge in range(1, 1 + min(assigned * ticks, int(original[i]["claims"][target]) // SCALE)):
                reachable.setdefault(charge, assigned)
        if len(reachable) > 1:
            options.append(reachable)
            winners.append(i)
    assert len(winners) == 2
    ids = [int(original[i]["id"]) for i in winners]
    priority = FrozenIdentity(bytes(source["venue"]), int(source["episode"]), tuple(ids)).order()
    weights = [max(o) for o in options]
    best_rank = best = None
    physical = protected = 0
    original_loss = sum(Fraction(row["loss"][target]) for row in baseline["rows"])
    for choices in product(*[o.items() for o in options]):
        charges, matched = zip(*choices)
        total = sum(charges)
        if total > budget or sum(matched) > abs(lots[debtor]):
            continue
        physical += 1
        adjusted = copy.deepcopy(data)
        by_member = {row["id"]: row for row in adjusted["rows"]}
        changes = [(debtor, total), *zip(winners, (-charge for charge in charges))]
        for index, delta in changes:
            account = by_member[original[index]["id"]]
            account["claims"][target] = str(int(account["claims"][target]) + delta * SCALE)
        terminal = protected_settlement(data, adjusted, baseline, target)
        if terminal is None:
            continue
        protected += 1
        recovery = min(total, original_loss - sum(Fraction(r["loss"][target]) for r in terminal["rows"]))
        # Direct weighted distance from ideal proportional shares. Rust uses a
        # difference of sums of squares; this expression is independent.
        ideal = [Fraction(total * weight, sum(weights)) for weight in weights]
        deviation = sum((charge - target_share)**2 / weight
                        for charge, target_share, weight in zip(charges, ideal, weights))
        rank = (recovery, -deviation, -total, -sum(matched), tuple(charges[i] for i in priority))
        if best_rank is None or rank > best_rank:
            best_rank = rank
            records = []
            for member_id, charge, count, weight in zip(ids, charges, matched, weights):
                ticks, extra = divmod(charge, count) if count else (0, 0)
                records.append(dict(id=str(member_id), weight=str(weight), charge=str(charge), matched=str(count),
                                    baseTicks=str(ticks), extraTickLots=str(extra)))
            best = dict(debtor=original[debtor]["id"], budget=str(budget), winners=records,
                      recovery=str(recovery), settlement=terminal)
    assert best is not None
    return best, physical, protected


class CompetitionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.books = cls.replays = cls.candidates = cls.admissible = 0

    @classmethod
    def tearDownClass(cls):
        print(f"{cls.books} reference books, {cls.replays} native selections, "
              f"{cls.candidates} possible lot and charge allocations, {cls.admissible} protected")

    def compare(self, data, *, variants=False):
        model, candidates, admissible = reference(data)
        inputs = [data]
        if variants:
            for order in permutations(range(3)):
                v = permute(data, order, True)
                v["competition"]["positions"].reverse()
                inputs.append(v)
        cls = type(self)
        cls.books += 1
        cls.replays += len(inputs)
        cls.candidates += candidates
        cls.admissible += admissible
        for result in run(inputs):
            self.assertGreater(int(result.pop("examined")), 0)
            self.assertEqual(result, model)
        return [int(winner["charge"]) for winner in model["winners"]], model

    def test_shared_inventory_and_ties(self):
        charges, plan = self.compare(competition(), variants=True)
        self.assertEqual(charges, [5, 5])
        self.assertEqual(plan["recovery"], "10")
        # The two makers can each give up six atoms, but the first needs two
        # lots to give up four. Even an episode favoring it chooses three/four.
        charges, plan = self.compare(competition(
            debtor_lots=3, winner_lots=(2, 1), gains=(3, 6), debtor_cash=12, episode=1))
        self.assertEqual(charges, [3, 4])
        self.assertEqual([w["matched"] for w in plan["winners"]], ["1", "1"])
        choices = set()
        for epoch in (1, 2, 3, 4, 5, 6):
            charges, _ = self.compare(competition(debtor_lots=1, episode=epoch))
            choices.add(tuple(charges))
        self.assertEqual(choices, {(0, 10), (10, 0)})
        charges, plan = self.compare(competition(debtor_lots=1, gains=(3, 6)), variants=True)
        self.assertEqual((charges, plan["recovery"]), ([0, 6], "6"))

    def test_linked_winner_preserves_both_destinations(self):
        data = competition(claims=(12, 12), flat=6, other_debt=0, debtor_cash=19, debts=(5, 3), insurance=(1, 1, 1))
        charges, plan = self.compare(data, variants=True)
        self.assertEqual(charges, [4, 6])
        self.assertEqual(plan["settlement"]["spent"], ["1", "0", "0"])
        self.assertEqual([r["cash"] for r in plan["settlement"]["rows"]], ["0", "0", "6", "7", "0", "7", "6"])
        # A six/four alternative would spend one extra ETH insurance atom and still harm SOL.
        changed = copy.deepcopy(data)
        for i, delta in [(0, 10), (1, -6), (2, -4)]:
            changed["rows"][i]["claims"][0] = str(int(changed["rows"][i]["claims"][0]) + delta * SCALE)
        baseline = expected(data)
        self.assertEqual(expected(changed, frozen=data)["spent"], ["1", "1", "0"])
        self.assertIsNone(protected_settlement(data, changed, baseline, 0))

    def test_fractional_entry_and_no_action(self):
        charges, _ = self.compare(competition(debtor_lots=3, winner_lots=(2, 2), gains=(Fraction(3, 2), 3),
                                              debtor_cash=15), variants=True)
        self.assertEqual(charges, [1, 3])
        data = with_positions(book([(19, (-20, 0, 0)), (0, (10, -10, 0)), (0, (10, 0, -10)),
                                  (0, (0, 10, 0)), (0, (0, 0, 10))]), [-2, 1, 1, 0, 0], [100, 90, 90, 0, 0])
        charges, plan = self.compare(data, variants=True)
        self.assertEqual((charges, plan["recovery"]), ([0, 0], "0"))
        self.assertEqual(plan["settlement"], expected(data))

    def test_invalid_or_unfinished_search(self):
        data = competition(debtor_lots=1)
        best, = run([data])
        exact = int(best["examined"])
        self.assertGreater(exact, 1)
        tests = []
        for limit in (0, exact - 1, exact):
            case = copy.deepcopy(data)
            case["competition"]["search_limit"] = str(limit)
            tests.append(case)
        omitted = copy.deepcopy(data)
        omitted["competition"]["positions"].pop()
        duplicate = copy.deepcopy(data)
        duplicate["competition"]["positions"][-1] = duplicate["competition"]["positions"][0]
        wrong = copy.deepcopy(data)
        wrong["competition"]["market"] = 7
        tampered = copy.deepcopy(data)
        tampered["vault"] = str(int(tampered["vault"]) + 1)
        unknown = copy.deepcopy(data)
        unknown["winners"] = ["113", "126"]
        bad = run(tests + [omitted, duplicate, wrong, tampered, unknown])
        self.assertEqual(bad[:3], [{"error":"SearchLimit"}, {"error":"SearchLimit"}, best])
        self.assertEqual(bad[3:7], [{"error":"Cohort"}] * 3 + [{"error":"Invariant"}])
        self.assertIn("error", bad[-1])

    def test_large_equal_book_reaches_maximum_in_one_evaluation(self):
        factor = 100_000
        data = competition(debtor_lots=2*factor, winner_lots=(factor, factor), gains=(10, 10),
                           claims=(10*factor, 10*factor), flat=6*factor, other_debt=6*factor,
                           debtor_cash=9*factor, insurance=(factor, 0, 0))
        data["competition"]["search_limit"] = "1"
        result, = run([data])
        self.assertEqual(result["examined"], "1")
        self.assertEqual(result["recovery"], "1000000")
        self.assertEqual([w["charge"] for w in result["winners"]], ["500000", "500000"])
        self.assertEqual([w["matched"] for w in result["winners"]], ["50000", "50000"])
        changed = copy.deepcopy(data)
        for i, adjustment in enumerate([1000000, -500000, -500000]):
            claim = changed["rows"][i]["claims"]
            claim[0] = str(int(claim[0]) + adjustment * SCALE)
        self.assertEqual(result["settlement"], expected(changed, frozen=data))

    def test_unqualified_roster_shapes(self):
        two_debtors = competition(debtor_lots=1)
        secondary = two_debtors["rows"][4]
        two_debtors["vault"] = str(int(two_debtors["vault"]) - int(secondary["cash"]))
        secondary["cash"] = "0"
        # A third positively exposed winner cannot be dropped just to fit the verifier.
        three_winners = with_positions(book([(5, (-15, 0, 0)), (0, (5, 0, 0)), (0, (5, 0, 0)), (0, (5, 0, 0))]),
                                       [-3, 1, 1, 1], [100, 95, 95, 95])
        one_winner = competition(gains=(0, 10))
        self.assertEqual(run([two_debtors, three_winners, one_winner]), [{"error":"Cohort"}] * 3)

    def test_frozen_cash_fractional_claims_and_cycles(self):
        half = Fraction(1, 2)
        # The debtor owes BTC and ETH and receives SOL. Both winners owe SOL,
        # and the solvent short settles a separate BTC debt from its own cash.
        data = with_positions(book([(4, (-18, -4, 9)), (1, (9 + half, 1, -6)), (0, (6, 2, -5)),
                                    (1, (3 + half, 1, 2)), (1, (-1, 0, 0))], insurance=(1, 1, 0)),
                              [-2, 1, 2, 0, -1], [100, 95, 98, 0, 100])
        _, plan = self.compare(data, variants=True)
        self.assertEqual(plan["settlement"]["rows"][0]["own"], ["36/11", "8/11", "0"])

    def test_varied_books(self):
        rng = random.Random(119)
        for i in range(18):
            size = (rng.randint(1, 3), rng.randint(1, 3))
            data = competition(debtor_lots=rng.randint(1, sum(size)), winner_lots=size, gains=(rng.randint(1, 5), rng.randint(1, 5)),
                debtor_cash=rng.randint(10, 16), debts=(rng.randint(0, 4), rng.randint(0, 4)),
                insurance=(rng.randint(0, 2), rng.randint(0, 2), rng.randint(0, 2)), direction=(-1)**i, episode=i)
            # Rotate which of the listed markets carries the two eligible winners.
            for row in data["rows"]:
                claims = row["claims"]
                shift = i % 3
                row["claims"] = claims[shift:] + claims[:shift]
            data["competition"]["market"] = data["markets"][(-i)%3]["id"]
            self.compare(data)


if __name__ == "__main__":
    unittest.main()
