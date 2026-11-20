"""Extract the paged proof interface from a freshly built clearing IDL."""
import json
import sys
from pathlib import Path

source = json.loads(Path(sys.argv[1]).read_text())
names = {"open_search", "capture_member", "derive_pairs", "verify_incumbent",
         "cover_plan", "cover_range", "seal_search", "bind_recovery_selection"}
instructions = [item for item in source["instructions"] if item["name"] in names]
accounts = [item for item in source["accounts"] if item["name"] == "PagedRecoverySearch"]
assert len(instructions) == len(names) and len(accounts) == 1

def references(value):
    if isinstance(value, dict):
        if "defined" in value:
            yield value["defined"]["name"]
        for child in value.values():
            yield from references(child)
    if isinstance(value, list):
        for child in value:
            yield from references(child)

definitions = {item["name"]: item for item in source["types"]}
required = {accounts[0]["name"], *references(instructions)}
pending = list(required)
while pending:
    new = set(references(definitions[pending.pop()])) - required
    required.update(new)
    pending.extend(new)
subset = {
    "address": source["address"], "metadata": source["metadata"],
    "instructions": instructions, "accounts": accounts,
    "types": [item for item in source["types"] if item["name"] in required],
    "errors": [item for item in source["errors"] if 7100 <= item["code"] <= 7107],
}
assert len(subset["errors"]) == 8
Path("packages/sdk/idl/paged_recovery.json").write_text(json.dumps(subset, indent=2) + "\n")
