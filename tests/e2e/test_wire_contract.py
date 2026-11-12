"""Regression checks for the refactor's ABI guard, not financial qualification."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

spec = importlib.util.spec_from_file_location("wire_contract", "ops/wire_contract.py")
wire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wire)
sys.path.insert(0, str(Path("ops").resolve()))
import scoped_wire_contract as scoped
import anchor_rc2_wire_contract as rc2


class WireContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = json.loads(Path("packages/sdk/idl/clearing.json").read_text())
        cls.expected = wire.program_contract(cls.original)

    def assert_changed(self, mutate):
        changed = deepcopy(self.original)
        mutate(changed)
        self.assertNotEqual(wire.program_contract(changed), self.expected)

    def test_backing_delta_preserves_exact_epoch_layout_and_ledger_privilege(self):
        from backing_wire_contract import undo_backing_delta
        from settlement_wire_contract import undo_window_delta
        original = undo_window_delta(self.original, 'clearing')
        undo_backing_delta(original, 'clearing')
        for name in ('MarginAccount', 'MarketLedger', 'BackingState', 'BackingRegion', 'SettlementCertificate', 'AccountBackingChanged'):
            altered = deepcopy(original)
            layout = next(item for item in altered['types'] if item['name'] == name)['type']['fields']
            layout.reverse()
            with self.subTest(name=name), self.assertRaises(AssertionError):
                undo_backing_delta(altered, 'clearing')
        altered = deepcopy(original)
        instruction = next(item for item in altered['instructions'] if item['name'] == 'check_market_backing')
        next(meta for meta in instruction['accounts'] if meta['name'] == 'ledger')['writable'] = False
        with self.assertRaises(AssertionError):
            undo_backing_delta(altered, 'clearing')

    def test_window_extension_rejects_unknown_authority_payload_or_layout(self):
        from settlement_wire_contract import undo_window_delta
        undo_window_delta(self.original, 'clearing')
        for mutation in ('argument', 'order', 'discriminator', 'layout', 'duplicate'):
            altered = deepcopy(self.original)
            instruction = next(item for item in altered['instructions'] if item['name'] == 'continue_settlement_plan_window')
            if mutation == 'argument': instruction['args'][3]['type'] = 'u32'
            elif mutation == 'order': instruction['accounts'].reverse()
            elif mutation == 'discriminator': instruction['discriminator'][0] ^= 1
            elif mutation == 'layout':
                next(item for item in altered['types'] if item['name'] == 'SettlementPageAccess')['type']['fields'].reverse()
            else: altered['instructions'].append(deepcopy(instruction))
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                undo_window_delta(altered, 'clearing')

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
        rc2.check_domains()
        for program in wire.PROGRAMS:
            with self.subTest(program=program):
                # Preserve the immutable pre-change fixture. The successor must
                # match only the deliberately enumerated D84 delta from it.
                self.assertEqual(wire.program_contract(scoped.predecessor_idl(program)),
                                 baseline["contract"]["programs"][program])
                actual, expected = rc2.comparable_program(program, json.loads(Path(f"packages/sdk/idl/{program}.json").read_text()))
                self.assertEqual(wire.program_contract(actual), wire.program_contract(expected))

    def test_rc2_metadata_exceptions_do_not_hide_unknown_authority_changes(self):
        for mutation in ('privilege', 'seed', 'address', 'order'):
            changed = deepcopy(self.original)
            retained = rc2.expected_idl('clearing')['instructions'][0]['name']
            instruction = next(item for item in changed['instructions'] if item['name'] == retained)
            account = instruction['accounts'][0]
            if mutation == 'privilege': account['writable'] = True
            elif mutation == 'seed': account['pda'] = {'seeds': [{'kind': 'const', 'value': [0]}]}
            elif mutation == 'address': account['address'] = '11111111111111111111111111111111'
            else: instruction['accounts'].reverse()
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                rc2.comparable_program('clearing', changed)

    def test_settlement_extension_is_checked_before_retained_abi_comparison(self):
        for mutation in ('privilege', 'signer', 'order', 'argument', 'layout', 'discriminator'):
            changed = deepcopy(self.original)
            instruction = next(item for item in changed['instructions']
                               if item['name'] == 'continue_settlement_rates')
            if mutation == 'privilege': instruction['accounts'][0]['writable'] = True
            elif mutation == 'signer': instruction['accounts'][0]['signer'] = True
            elif mutation == 'order': instruction['accounts'].reverse()
            elif mutation == 'argument': instruction['args'][0]['type'] = 'u8'
            elif mutation == 'discriminator': instruction['discriminator'][0] ^= 1
            else:
                next(item for item in changed['types'] if item['name'] == 'SettlementRates')['type']['fields'].reverse()
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                rc2.comparable_program('clearing', changed)

    def test_membership_delta_keeps_identity_width_metadata_and_privileges_exact(self):
        for mutation in ('id', 'child', 'generation', 'signer', 'storage_writer', 'seed', 'duplicate'):
            changed = deepcopy(self.original)
            instruction = next(item for item in changed['instructions'] if item['name'] == 'activate_margin')
            fields = next(item['type']['fields'] for item in changed['types'] if item['name'] == 'MarginAccount')
            if mutation in ('id', 'child', 'generation'):
                field = {'id':'id','child':'subaccount_index','generation':'activation_generation'}[mutation]
                next(item for item in fields if item['name'] == field)['type'] = 'u16'
            elif mutation == 'signer': instruction['accounts'][0]['signer'] = False
            elif mutation == 'storage_writer':
                next(item for item in instruction['accounts'] if item['name'] == 'storage')['writable'] = True
            elif mutation == 'seed':
                next(item for item in instruction['accounts'] if item['name'] == 'registry')['pda']['seeds'][0]['value'] = [0]
            else: changed['instructions'].append(deepcopy(instruction))
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                rc2.comparable_program('clearing', changed)


if __name__ == "__main__":
    unittest.main()

