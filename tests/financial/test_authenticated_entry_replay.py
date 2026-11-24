"""Native exact basis recovery. The source model anchors admitted fills independently of the Rust verifier."""
from copy import deepcopy
from dataclasses import dataclass
from fractions import Fraction
from hashlib import sha256
import json
from pathlib import Path
import struct
import subprocess
import unittest

from account_contract_reference import Account
from market_settlement_reference import MarketBook
from test_bounded_entry import MARK, SCALE, fill, signed_member_actions
from test_entry_bounds import Decisions, evaluate, observations, opposite_histories
from test_scalable_settlement import decode, frozen_book_command, run

DRIVER = Path("target/debug/examples/authenticated_entry_replay").resolve()
# The caller supplies a trusted position domain. The model binds clearing program,
# venue, margin root, market index and account activation generation in that order.
DOMAIN = sha256(b"Rivalt/entry-replay/domain/v1\0" + bytes([1])*32 + bytes([2])*32
                + bytes([3])*32 + struct.pack("<BQ", 0, 1)).digest()
CHECKPOINT = b"Rivalt/entry-replay/checkpoint/v1\0"
FILL = b"Rivalt/entry-replay/fill/v1\0"


def checkpoint_hash(checkpoint):
    header = struct.pack("<Qq", checkpoint["sequence"], checkpoint["lots"])
    return sha256(CHECKPOINT + DOMAIN + header + bytes(checkpoint["entry"])).digest()


def digest_fill(previous, fill_record):
    return sha256(FILL + previous + struct.pack("<qQ", fill_record["delta"], fill_record["gross"])).digest()


@dataclass(frozen=True)
class Position:
    lots: int = 0
    entry: Fraction = Fraction()
    virtual_scaled: int = 0
    funding: int = 0
    mark: int = MARK

    def apply(self, action):
        delta, gross, mark, funding = action
        new_lots = self.lots + delta
        virtual = self.virtual_scaled - self.lots*(funding-self.funding) - (gross if delta > 0 else -gross)*SCALE
        if not new_lots:
            entry = Fraction()
        elif self.lots*new_lots <= 0:
            entry = Fraction(gross, abs(delta))
        elif abs(new_lots) > abs(self.lots):
            entry = (self.entry*abs(self.lots) + gross)/abs(new_lots)
        else:
            entry = self.entry
        return Position(new_lots, entry, virtual, funding, mark)

    def checkpoint(self, sequence):
        record = b""
        if self.lots:
            scaled = self.entry*SCALE
            numerator, denominator = (value.to_bytes((value.bit_length()+7)//8, "little")
                                      for value in (scaled.numerator, scaled.denominator))
            record = struct.pack("<HHH", len(numerator), 0, len(denominator)) + numerator + denominator
        return {"sequence": sequence, "lots": self.lots, "entry": list(record)}

    @property
    def claim(self):
        return self.virtual_scaled + self.lots*self.mark*SCALE


def positions(actions):
    states = [Position()]
    for action in actions:
        states.append(states[-1].apply(action))
    return states


def request_for(checkpoint, fills, position, max_fills=64, entry_bytes=256):
    witness = [{"delta": delta, "gross": gross} for delta, gross, _, _ in fills]
    digest = checkpoint_hash(checkpoint)
    for record in witness:
        digest = digest_fill(digest, record)
    sequence = checkpoint["sequence"] + len(fills)
    return {"snapshot": {"domain": list(DOMAIN), "tip": list(digest),
                         "sequence": sequence, "lots": position.lots,
                         "claim_scaled": str(position.claim), "mark": position.mark, "matched": abs(position.lots)},
            "witness": {"checkpoint": checkpoint, "fills": witness},
            "budget": {"fills": max_fills, "entry_bytes": entry_bytes}}


def verify(requests):
    def to_wire(request):
        request = deepcopy(request)
        snapshot = request["snapshot"]
        for key in ("sequence", "lots", "claim_scaled", "mark", "matched"):
            snapshot[key] = str(snapshot[key])
        checkpoint = request["witness"]["checkpoint"]
        for key in ("sequence", "lots"):
            checkpoint[key] = str(checkpoint[key])
        for record in request["witness"]["fills"]:
            for key in ("delta", "gross"):
                record[key] = str(record[key])
        return request

    payload = "".join(json.dumps(to_wire(request), separators=(",", ":")) + "\n" for request in requests)
    result = subprocess.run([DRIVER], input=payload, text=True, capture_output=True, check=True)
    rows = [json.loads(line) for line in result.stdout.splitlines()]
    assert len(rows) == len(requests)
    for row in rows:
        if "error" not in row:
            for key in ("ordinary", "forced"):
                row[key] = int(row[key])
            for key in ("sequence", "lots"):
                row["checkpoint"][key] = int(row["checkpoint"][key])
    return rows


class AuthenticatedEntryReplay(unittest.TestCase):
    def verify_segments(self, actions, stride, capacity):
        """Each accepted segment supplies the next checkpoint. Stop on first refusal."""
        states = positions(actions)
        checkpoint = states[0].checkpoint(0)
        measurements = []
        for start in range(0, len(actions), stride):
            end = min(start+stride, len(actions))
            request = request_for(checkpoint, actions[start:end], states[end], stride, capacity)
            row, = verify([request])
            if "error" in row:
                return measurements, (start, end, row["error"])
            expected = states[end]
            self.assertEqual(row["checkpoint"], expected.checkpoint(end))
            self.assertEqual(row["checkpoint_digest"], list(checkpoint_hash(row["checkpoint"])))
            caps = evaluate(expected.entry*abs(expected.lots)*SCALE, expected.lots, expected.claim,
                            expected.mark, abs(expected.lots))
            self.assertEqual((row["ordinary"], row["forced"]), caps)
            peak = max(len(state.checkpoint(0)["entry"]) for state in states[start:end+1])
            self.assertEqual(row["peak_entry_bytes"], peak)
            # Counts only the canonical checkpoint and subsequent (delta, gross) records.
            witness_bytes = 16 + len(checkpoint["entry"]) + 16*(end-start)
            measurements.append((row, witness_bytes))
            checkpoint = row["checkpoint"]
        return measurements, None

    def test_witness_pair_and_actual_frozen_receipts(self):
        for offset, amounts, receipts in [(-1, (27, 8), (0, 7, 1)), (1, (28, 4), (0, 8, 0))]:
            actions = opposite_histories(offset)
            states = positions(actions)
            genesis = states[0].checkpoint(0)
            too_long = request_for(genesis, actions, states[-1])
            self.assertEqual(verify([too_long]), [{"error": "fill budget"}])
            measurements, refusal = self.verify_segments(actions, 64, 256)
            self.assertIsNone(refusal)
            full, = verify([request_for(genesis, actions, states[-1], 65)])
            recovered, size = measurements[-1]
            self.assertEqual((recovered["ordinary"], recovered["forced"]), amounts)
            self.assertEqual(recovered["checkpoint"], full["checkpoint"])
            # The recovery case selects the maximum charge for the seizable four
            # lots, with one BTC debtor, two creditors, eight cash and no insurance.
            charge = recovered["forced"]
            book = MarketBook((Account(8, (-38+charge, 0)), Account(0, (36-charge, 0)),
                               Account(0, (2, 0))), frozen=True)
            settled = decode(run([frozen_book_command(book)])[0])
            self.assertEqual((settled["cash"], settled["spent"]), (receipts, (0, 0)))
            self.assertEqual((len(actions), size, full["peak_entry_bytes"]), (65, 51, 19))
            self.assertEqual(16 + 16*len(actions), 1056)
            intermediate, refusal = self.verify_segments(actions, 32, 256)
            self.assertIsNone(refusal)
            self.assertEqual(intermediate[-1][0]["checkpoint"], full["checkpoint"])

    def test_signed_maker_runs_and_checkpoint_width(self):
        for rounds, key, width, last_bytes in [(65, "WALLET", 240, 345), (69, "DIAGNOSTIC", 254, 473)]:
            actions = signed_member_actions(rounds, key)[2]
            results, refusal = self.verify_segments(actions, 64, 256)
            self.assertIsNone(refusal)
            self.assertEqual(len(results), 3)
            self.assertEqual(max(row["peak_entry_bytes"] for row, _ in results), width)
            self.assertEqual((max(size for _, size in results), results[-1][1]), (1164, last_bytes))
            self.assertEqual(results[-1][0]["checkpoint"]["entry"], [])
            self.assertEqual(results[-1][0]["ordinary"], 4_258_808 if key == "WALLET" else 4_520_904)

    def test_sustained_open_position_and_fixed_budget(self):
        # This position still needs both exact decisions at the freeze cutoff.
        actions = opposite_histories(1, rounds=2048)
        final = observations(actions)[-1]
        self.assertEqual((final.strict, final.exact), (Decisions(None, None), Decisions(2046, 4)))
        results, refusal = self.verify_segments(actions, 64, 256)
        self.assertEqual((len(results), refusal), (30, (1920, 1984, "entry budget")))
        states = positions(actions)
        checkpoint = results[-1][0]["checkpoint"]
        boundary = [request_for(checkpoint, actions[1920:end], states[end]) for end in (1969, 1970)]
        last_fitting, first_refusal = verify(boundary)
        self.assertEqual(last_fitting["peak_entry_bytes"], 256)
        self.assertEqual(first_refusal, {"error": "entry budget"})
        self.assertEqual(len(states[1970].checkpoint(1970)["entry"]), 257)
        completed, refusal = self.verify_segments(actions, 64, 1024)
        self.assertIsNone(refusal)
        recovered = completed[-1][0]
        self.assertEqual((recovered["ordinary"], recovered["forced"]), final.exact)
        self.assertEqual((len(actions), len(completed)), (4101, 65))
        self.assertEqual(max(row["peak_entry_bytes"] for row, _ in completed), 524)
        self.assertEqual((max(size for _, size in completed), completed[-1][1]), (1554, 618))
        charge = recovered["forced"]
        book = MarketBook((Account(513, (-2056+charge, 0)), Account(0, (2054-charge, 0)),
                           Account(0, (2, 0))), frozen=True)
        settled = decode(run([frozen_book_command(book)])[0])
        self.assertEqual((settled["cash"], settled["spent"]), ((0, 513, 0), (0, 0)))

    def test_reject_damage_stale_domains_and_unverified_checkpoints(self):
        actions = opposite_histories(1)
        states = positions(actions)
        previous, = verify([request_for(states[0].checkpoint(0), actions[:32], states[32])])
        base = request_for(previous["checkpoint"], actions[32:], states[-1])
        variants = []
        for mutation in ("missing", "duplicate", "reorder", "alter", "checkpoint", "domain", "snapshot", "capacity"):
            request = deepcopy(base)
            witness, snapshot = request["witness"], request["snapshot"]
            entries = witness["fills"]
            if mutation == "missing":
                entries.pop()
            elif mutation == "duplicate":
                entries[0] = entries[1]
            elif mutation == "reorder":
                entries.reverse()
            elif mutation == "alter":
                entries[-1]["gross"] += 1
            elif mutation == "checkpoint":
                witness["checkpoint"]["entry"][-1] ^= 1
            elif mutation == "domain":
                snapshot["domain"][0] ^= 1
            elif mutation == "snapshot":
                snapshot["lots"] += 1
            else:
                request["budget"]["entry_bytes"] = 1
            variants.append(request)
        errors = [row["error"] for row in verify(variants)]
        self.assertEqual(errors, ["incomplete sequence"] + ["commitment mismatch"]*5 +
                         ["invalid terminal snapshot", "entry budget"])
        # Equal cost bounds and claim do not authenticate a different ordered history.
        other = opposite_histories(-1)
        mixed = request_for(states[0].checkpoint(0), actions, states[-1], 65)
        mixed["witness"]["fills"] = request_for(states[0].checkpoint(0), other, states[-1], 65)["witness"]["fills"]
        self.assertEqual(verify([mixed]), [{"error": "commitment mismatch"}])
        self.assertEqual(verify([base])[0]["forced"], 4)

    def test_short_partial_flip_flat_and_funded_claim(self):
        actions = [fill(-3, MARK+2, MARK, SCALE//3), (1, MARK, MARK, -SCALE//7),
                   (5, 5*MARK+2, MARK+4, SCALE//5), fill(-3, MARK+4, MARK+4, -SCALE//9)]
        results, refusal = self.verify_segments(actions, 1, 256)
        self.assertIsNone(refusal)
        self.assertEqual(results[-1][0]["checkpoint"]["entry"], [])
        # Booking a whole atom from a flat claim changes the frozen snapshot;
        # it does not create a new entry-price history.
        position = positions(actions)[-1]
        request = request_for(results[-1][0]["checkpoint"], [], position)
        before = results[-1][0]["ordinary"]
        self.assertGreater(before, 0)
        request["snapshot"]["claim_scaled"] = str(position.claim-SCALE)
        after, = verify([request])
        self.assertEqual((after["ordinary"], after["forced"]), (before-1, 0))


if __name__ == "__main__":
    unittest.main()
