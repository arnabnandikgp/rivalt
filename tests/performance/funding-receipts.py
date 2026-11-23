"""Group signed two-market funding receipts by the actual top-level instructions."""
import argparse
import base64
import collections
import hashlib
import json
from pathlib import Path


CLEARING = "Egn8THHpn7AxDMZKgBKui5YTdTcwn2wxwXkFuKzDDbKo"
ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
REPORT = "publish_funding_report"
CHECKPOINT = "checkpoint_market"


def decode_base58(value):
    number = 0
    for digit in value:
        number = number * 58 + ALPHABET.index(digit)
    leading = len(value) - len(value.lstrip("1"))
    return bytes(leading) + number.to_bytes((number.bit_length() + 7) // 8, "big")


def summarize(directory):
    discriminators = {hashlib.sha256(f"global:{name}".encode()).digest()[:8]: name
                      for name in (REPORT, CHECKPOINT)}
    groups = collections.defaultdict(list)
    seen = set()
    for path in directory.glob("wire-*.json"):
        wire = json.loads(path.read_text())
        if wire["label"] != "P32 publisher available two-market reports":
            continue
        receipt = json.loads(path.with_name(path.name.replace("wire-", "transaction-")).read_text())
        transaction = receipt["transaction"]
        signature = wire["signature"]
        raw = base64.b64decode(wire["wireBase64"], validate=True)
        count = len(transaction["signatures"])
        # v1 puts the signatures after the message. Legacy/v0 prefix the message.
        signature_offset = len(raw) - 64 * count if wire["version"] == 1 else 1
        encoded_count = raw[1] if wire["version"] == 1 else raw[0]
        if (signature in seen or count != encoded_count or not 0 < count < 128
                or signature != transaction["signatures"][0]
                or raw[signature_offset:signature_offset + 64] != decode_base58(signature)):
            raise ValueError(f"{path.name}: receipt signature mismatch or duplicate")
        seen.add(signature)
        message = transaction["message"]
        sequence = []
        for instruction in message["instructions"]:
            if message["accountKeys"][instruction["programIdIndex"]] != CLEARING:
                raise ValueError(f"{path.name}: unexpected top-level program")
            sequence.append(discriminators[decode_base58(instruction["data"])[:8]])
        if sequence not in ([REPORT, REPORT], [CHECKPOINT, REPORT] * 2):
            raise ValueError(f"{path.name}: unexpected instruction composition {sequence}")
        meta = receipt["meta"]
        if meta["err"] is not None or not isinstance(meta["computeUnitsConsumed"], int):
            raise ValueError(f"{path.name}: failed transaction or missing CU")
        groups[tuple(sequence)].append(meta["computeUnitsConsumed"])
    if not groups:
        raise ValueError("No signed two-market funding publications found")
    return [{"instructions": sequence, "transactions": len(values), "minCU": min(values),
             "maxCU": max(values)} for sequence, values in sorted(groups.items())]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    print(json.dumps(summarize(parser.parse_args().directory), indent=2))
