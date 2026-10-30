"""Name-independent IDL compatibility guard for the canonical-name refactor.

This pins serialization/authority metadata, not executable behavior. SBF tests,
legacy Anchor parity and actual RPC qualification remain separate requirements.
Never refresh the baseline simply because a changed program fails this check.
"""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import subprocess

PROGRAMS = ("clearing", "maker_a", "maker_b")
BASELINE = Path("tests/fixtures/wire-contract.json")


def digest(value):
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def program_contract(idl):
    """Expand type references so renames cannot hide a layout change.

    List order (fields, variants, args and metas) is preserved. Top-level IDL
    declaration order and source type/handler labels have no wire meaning.
    PDA `account` labels are generator type hints, sometimes naming a Context
    absent from `types`; the actual seed bytes/field paths stay pinned.
    """
    definitions = {item["name"]: item for item in idl.get("types", [])}

    def normalize(value, visiting=()):
        if isinstance(value, list):
            return [normalize(item, visiting) for item in value]
        if not isinstance(value, dict):
            return value
        if set(value) == {"defined"}:
            reference = value["defined"]
            name = reference["name"] if isinstance(reference, dict) else reference
            if name in visiting:
                raise ValueError(f"Recursive ABI type requires explicit handling: {name}")
            if isinstance(reference, dict) and set(reference) != {"name"}:
                raise ValueError(f"Generic ABI type requires explicit handling: {name}")
            return normalize({key: item for key, item in definitions[name].items()
                              if key != "name"}, (*visiting, name))
        return {key: normalize(item, visiting) for key, item in value.items()
                if key != "docs" and not (key == "account" and value.get("kind") == "account")}

    result = {"address": idl["address"]}
    for category in ("instructions", "accounts", "events", "types", "errors"):
        records = []
        for original in idl.get(category, []):
            item = deepcopy(original)
            if category != "errors":
                name = item.pop("name")
                if category in ("accounts", "events"):
                    item["layout"] = normalize({"defined": {"name": name}})
            records.append(digest(normalize(item)))
        # Keep duplicate counts; two same-layout records are still distinct API entries.
        result[category] = {"count": len(records), "sha256": digest(sorted(records))}
    return result


def source_domains():
    """Conservatively retain byte-string seeds/domains and JS signed hash domains.

    These literals complement IDL PDA metadata. Their membership is pinned;
    moving a definition or deduplicating an identical literal is permitted.
    """
    rust_bytes = set()
    for root in (Path("programs"), Path("crates")):
        for path in root.rglob("*.rs"):
            rust_bytes.update(re.findall(r'\bb"((?:[^"\\]|\\.)*)"', path.read_text()))
    signed_domains = set()
    for path in Path("packages/sdk/src").glob("*.ts"):
        if not path.name.endswith(".test.ts"):
            signed_domains.update(re.findall(r'[\x27"](rivalt-[a-z0-9-]+)[\x27"]', path.read_text()))
    return {"rust_byte_literals": sorted(rust_bytes), "sdk_hash_domains": sorted(signed_domains)}


def capture():
    return {"programs": {program: program_contract(json.loads(
        Path(f"packages/sdk/idl/{program}.json").read_text())) for program in PROGRAMS},
        "domains": source_domains()}


def assert_original_discriminators():
    # Independent of Anchor/IDL generators. Only used when freezing the original
    # contract; renamed source deliberately preserves these old discriminator bytes.
    for program in PROGRAMS:
        idl = json.loads(Path(f"packages/sdk/idl/{program}.json").read_text())
        for category, namespace in (("instructions", "global"), ("accounts", "account"), ("events", "event")):
            for item in idl.get(category, []):
                expected = hashlib.sha256(f'{namespace}:{item["name"]}'.encode()).digest()[:8]
                assert bytes(item["discriminator"]) == expected, (program, category, item["name"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture-original", action="store_true")
    args = parser.parse_args()
    current = capture()
    if args.capture_original:
        if BASELINE.exists():
            raise SystemExit("Refusing to overwrite the frozen original wire contract")
        assert_original_discriminators()
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        for program in PROGRAMS:
            path = f"packages/sdk/idl/{program}.json"
            assert Path(path).read_bytes() == subprocess.check_output(["git", "show", f"{revision}:{path}"])
        original = {"revision": revision, "contract": current}
        BASELINE.write_text(json.dumps(original, indent=2) + "\n")
        print(f"Captured original wire contract at {revision}")
    else:
        original = json.loads(BASELINE.read_text())
        if current != original["contract"]:
            differences = [program for program in PROGRAMS
                           if current["programs"][program] != original["contract"]["programs"][program]]
            if current["domains"] != original["contract"]["domains"]:
                differences.append("source seeds/hash domains")
            raise SystemExit(f'Wire contract differs from {original["revision"]}: {", ".join(differences)}')
        print(f'Wire contract matches {original["revision"]}: three programs, layouts/metas/seeds/errors/domains')


if __name__ == "__main__":
    main()
