"""Regression checks for the refactor's ABI guard, not financial qualification."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("wire_contract", "ops/wire_contract.py")
wire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wire)


class WireContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = json.loads(Path("packages/sdk/idl/clearing.json").read_text())
        cls.expected = wire.program_contract(cls.original)

    def assert_changed(self, mutate):
        changed = deepcopy(self.original)
        mutate(changed)
        self.assertNotEqual(wire.program_contract(changed), self.expected)

    def test_source_names_and_declaration_order_are_not_wire(self):
        renamed = deepcopy(self.original)
        names = {item["name"]: "Renamed" + item["name"] for item in renamed["types"]}

        def references(value):
            if isinstance(value, list):
                return [references(item) for item in value]
            if isinstance(value, dict):
                if "defined" in value:
                    return {"defined": {"name": names[value["defined"]["name"]]}}
                return {key: references(item) for key, item in value.items()}
            return value

        renamed = references(renamed)
        for category in ("instructions", "accounts", "events", "types"):
            for item in renamed[category]:
                item["name"] = names.get(item["name"], "renamed_" + item["name"])
                item["docs"] = ["A new source name preserves old bytes."]
            renamed[category].reverse()
        self.assertEqual(wire.program_contract(renamed), self.expected)

    def test_program_address(self):
        self.assert_changed(lambda value: value.update(address="11111111111111111111111111111111"))

    def test_all_discriminator_categories(self):
        for category in ("instructions", "accounts", "events"):
            with self.subTest(category=category):
                self.assert_changed(lambda value: value[category][0]["discriminator"].reverse())

    def test_account_field_order_and_width(self):
        name = self.original["accounts"][0]["name"]
        def fields(value):
            return next(item for item in value["types"] if item["name"] == name)["type"]["fields"]
        self.assert_changed(lambda value: fields(value).reverse())
        self.assert_changed(lambda value: fields(value)[0].update(type="u128"))

    def test_event_layout_binding(self):
        def swap(value):
            value["events"][0]["discriminator"], value["events"][1]["discriminator"] = (
                value["events"][1]["discriminator"], value["events"][0]["discriminator"])
        self.assert_changed(swap)

    def test_enum_tags_and_array_lengths(self):
        def enum(value):
            return next(item["type"]["variants"] for item in value["types"]
                        if item["type"]["kind"] == "enum" and len(item["type"]["variants"]) > 1)
        self.assert_changed(lambda value: enum(value).reverse())
        def resize(value):
            for item in value["types"]:
                for field in item["type"].get("fields", []):
                    if isinstance(field.get("type"), dict) and "array" in field["type"]:
                        field["type"]["array"][1] += 1
                        return
            self.fail("No array fixture")
        self.assert_changed(resize)

    def test_signer_writable_optional_and_order(self):
        # A simple flat context is sufficient to exercise each authority flag.
        def instruction(value):
            return next(item for item in value["instructions"]
                        if len(item["accounts"]) > 1 and "accounts" not in item["accounts"][0])
        for flag in ("signer", "writable", "optional"):
            with self.subTest(flag=flag):
                def toggle(value):
                    meta = instruction(value)["accounts"][0]
                    meta[flag] = not meta.get(flag, False)
                self.assert_changed(toggle)
        self.assert_changed(lambda value: instruction(value)["accounts"].reverse())

    def test_pda_seed_and_field_path(self):
        def seed(value, kind):
            def visit(accounts):
                for account in accounts:
                    if "accounts" in account:
                        yield from visit(account["accounts"])
                    yield from account.get("pda", {}).get("seeds", [])
            return next(seed for item in value["instructions"]
                        for seed in visit(item["accounts"]) if seed["kind"] == kind)
        self.assert_changed(lambda value: seed(value, "const").update(value=[0]))
        self.assert_changed(lambda value: seed(value, "account").update(path="foreign.owner"))

    def test_instruction_payload_and_error_codes(self):
        def payload(value):
            next(item for item in value["instructions"] if item["args"])["args"][0]["type"] = "u8"
        self.assert_changed(payload)
        self.assert_changed(lambda value: value["errors"][0].update(code=9999))

    def test_duplicate_entries_remain_visible(self):
        self.assert_changed(lambda value: value["instructions"].append(deepcopy(value["instructions"][0])))

    def test_frozen_original_and_domains(self):
        baseline = json.loads(wire.BASELINE.read_text())
        self.assertEqual(wire.capture(), baseline["contract"])


if __name__ == "__main__":
    unittest.main()
