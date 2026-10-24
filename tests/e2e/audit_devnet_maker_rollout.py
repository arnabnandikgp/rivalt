"""Independent raw-byte audit of the bounded R030 devnet change.

No generated SDK, JS decoder or financial implementation is imported. Inputs
must be actual retained RPC accounts and finalized transaction journals.
"""
import base64
import hashlib
import json
import struct
import sys
from pathlib import Path

ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def address_bytes(value):
    number = 0
    for letter in value:
        number = number * 58 + ALPHABET.index(letter)
    return b"\0" * (len(value) - len(value.lstrip("1"))) + number.to_bytes((number.bit_length() + 7) // 8, "big")


def raw(account):
    assert account["data"][1] == "base64"
    return base64.b64decode(account["data"][0], validate=True)


def u64(data, offset):
    return struct.unpack_from("<Q", data, offset)[0]


def audit(report):
    assert report["result"] == "pass" and report["sourceDirty"] is False
    baseline = json.loads(Path(report["baseline"]).read_text())
    before, after = baseline["accounts"], report["accounts"]
    assert set(before) <= set(after)
    mutable = {report["market"], report["registry"], *(maker["registration"] for maker in report["makers"])}
    for key, account in before.items():
        if key not in mutable:
            assert after[key]["owner"] == account["owner"] and raw(after[key]) == raw(account), key
    old_market, market = raw(before[report["market"]]), raw(after[report["market"]])
    assert market[:8] == hashlib.sha256(b"account:MarketState").digest()[:8]
    expected = bytearray(old_market)
    struct.pack_into("<Q", expected, 148, u64(old_market, 148) + 2)  # config epoch
    struct.pack_into("<Q", expected, 156, u64(old_market, 156) + 3)  # event sequence
    assert market == expected and market[165] == 2
    old_registry, registry = raw(before[report["registry"]]), raw(after[report["registry"]])
    old_count = struct.unpack_from("<H", old_registry, 42)[0]
    count = struct.unpack_from("<H", registry, 42)[0]
    assert count == old_count + 1 == struct.unpack_from("<I", registry, 44)[0]
    assert registry[:42] == old_registry[:42]
    assert registry[48:48 + old_count * 32] == old_registry[48:48 + old_count * 32]
    assert registry[48 + old_count * 32:48 + count * 32] == address_bytes(report["capital"])
    participants = [raw(account) for account in after.values()
                    if raw(account)[:8] == hashlib.sha256(b"account:Participant").digest()[:8]]
    assert len(participants) == count
    assert sum(u64(participant, 76) for participant in participants) == u64(market, 190)
    assert sum(struct.unpack_from("<q", participant, 84)[0] for participant in participants) == 0
    allocated = sum(u64(market, offset) for offset in (190, 198, 206, 214))
    vault = u64(raw(after[report["vault"]]), 64)
    assert allocated == u64(market, 222) <= vault
    participant = raw(after[report["capital"]])
    assert participant[42:74] == address_bytes(report["owner"])
    assert participant[76:124] == bytes(48)  # cash, position, virtual value and funding checkpoint
    for index, maker in enumerate(report["makers"]):
        old_registration = raw(before[maker["registration"]])
        registration = raw(after[maker["registration"]])
        program = next(item for item in report["programs"] if item["name"] == ("maker_a" if index == 0 else "maker_b"))
        expected = bytearray(old_registration)
        expected[203:235] = bytes.fromhex(program["accountSha256"])
        struct.pack_into("<Q", expected, 235, u64(old_registration, 235) + 1)
        expected[291] = 0  # explicit joint reapproval clears quarantine
        assert registration == expected
        config = raw(after[maker["config"]])
        assert after[maker["config"]]["owner"] == program["program"]
        assert config[:8] == hashlib.sha256(b"account:MakerConfig").digest()[:8]
        assert config[10] == index and config[11:43] == address_bytes(report["owner"])
        assert config[43:75] == address_bytes(report["market"])
        assert config[75:107] == address_bytes(report["capital"])
        assert config[107:139] == market[12:44] and u64(config, 139) == 1
        assert u64(config, 155) - u64(config, 147) == 3600
    assert len(report["checks"]) == 12
    signatures, fees, rejections = set(), 0, 0
    for check in report["checks"]:
        entry = json.loads(Path(check["journal"]).read_text())
        assert entry["finalized"] and entry["signature"] == check["signature"] not in signatures
        signatures.add(check["signature"])
        history = entry["history"]
        assert history["transaction"]["signatures"][0] == check["signature"]
        assert history["meta"]["err"] == check["error"]
        fees += history["meta"]["fee"]
        error = entry.get("error")
        if error is not None:
            assert history["meta"]["err"]["InstructionError"][1]["Custom"] == error
            assert entry["before"] == entry["after"] and entry["events"] == []
            rejections += 1
        else:
            assert history["meta"]["err"] is None
    assert rejections == 6
    return {"result": "pass", "signedChecks": 12, "expectedRejections": rejections,
            "participants": count, "vaultAtoms": str(vault), "allocatedAtoms": str(allocated),
            "acceptanceFeeLamports": str(fees), "rawAccountReconciliation": True}


if __name__ == "__main__":
    print(json.dumps(audit(json.loads(Path(sys.argv[1]).read_text())), indent=2))
