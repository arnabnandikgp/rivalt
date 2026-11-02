"""D90's explicit RC2 ABI delta, derived from immutable pre-migration IDLs.

Account schema values are verified by runtime/codec tests: IDL field types do not
encode their values. This check never recaptures expected layouts from ported code.
"""
from copy import deepcopy
from pathlib import Path
import argparse
import hashlib
import json
import subprocess

from wire_contract import PROGRAMS, BASELINE, program_contract, source_domains

PREDECESSOR = 'c0bc3aaa3825896fcafbc879fe104362da61c21d'


def expected_idl(program):
    original = json.loads(subprocess.check_output([
        'git', 'show', f'{PREDECESSOR}:packages/sdk/idl/{program}.json']))
    expected = deepcopy(original)
    for category, namespace in (('instructions', 'global'), ('accounts', 'account'), ('events', 'event')):
        for entry in expected[category]:
            entry['discriminator'] = list(hashlib.sha256(
                f'{namespace}:{entry["name"]}'.encode()).digest()[:8])
    instructions = [bytes(entry['discriminator']) for entry in expected['instructions']]
    assert len(instructions) == len(set(instructions))
    assert not set(instructions) & {bytes(entry['discriminator']) for entry in original['instructions']}
    return expected


def flatten(accounts):
    for account in accounts:
        if 'accounts' in account:
            yield from flatten(account['accounts'])
        else:
            yield deepcopy(account)


def clean(value):
    if isinstance(value, list):
        return [clean(item) for item in value]
    if isinstance(value, dict):
        # These are equivalent Borsh byte-vector descriptions.
        if value == {'vec': 'u8'}:
            return 'bytes'
        return {key: clean(item) for key, item in value.items()
                if key != 'docs' and not (key == 'account' and value.get('kind') == 'account')}
    return value


def metadata_delta(actual, expected):
    """Known RC2 IDL limitations, separate from ordered wire privileges.

    These hints do not validate runtime constraints. The negative SBF acceptance
    remains mandatory. Do not ignore unknown metadata changes here.
    """
    assert actual['name'] == expected['name']
    name = actual['name']
    apda, epda = actual.get('pda'), expected.get('pda')
    if apda != epda:
        if apda is None and epda is not None:
            # RC2 does not describe state-field/nested seeds or dynamic programs.
            assert any('.' in seed.get('path', '') for seed in epda['seeds']) or (
                name == 'maker_event_authority' and epda.get('program') ==
                {'kind': 'account', 'path': 'pricing_program'}), (name, apda, epda)
        elif epda is None:
            constants = {'event_authority': b'__event_authority', 'btc': b'market-v3', 'eth': b'market-v3'}
            assert name in constants, (name, apda, epda)
            seeds = [{'kind': 'const', 'value': list(constants[name])}]
            if name != 'event_authority':
                seeds += [{'kind': 'account', 'path': 'venue'},
                          {'kind': 'const', 'value': [0 if name == 'btc' else 1]}]
            assert apda == {'seeds': seeds}, (name, apda)
        else:
            raise AssertionError((name, apda, epda))
    for key in ('address', 'relations'):
        if actual.get(key) == expected.get(key):
            continue
        assert key not in expected, (name, key)
        if key == 'address':
            if name == 'controller':
                assert actual[key] == 'config.state.controller'
            else:
                assert name in {'fee_authority', 'authority', 'quote_mint', 'reserve_authority'}
                assert actual[key] == f'identity.venue.{name}', (name, actual[key])
        else:
            assert name == 'quote_mint' and actual[key] == ['venue'], (name, actual[key])
    # Actual static addresses must still match; only the explicitly checked
    # generator expressions above are ignored when comparing executable bytes.
    for item in (actual, expected):
        for key in ('pda', 'relations', 'address'):
            item.pop(key, None)
    assert actual == expected, (actual, expected)


def comparable(actual, expected):
    actual, expected = clean(deepcopy(actual)), clean(deepcopy(expected))
    actual_instructions = {item['name']: item for item in actual['instructions']}
    assert actual_instructions.keys() == {item['name'] for item in expected['instructions']}
    for instruction in expected['instructions']:
        other = actual_instructions[instruction['name']]
        left, right = list(flatten(other['accounts'])), list(flatten(instruction['accounts']))
        assert len(left) == len(right), instruction['name']
        for first, second in zip(left, right):
            metadata_delta(first, second)
        other['accounts'], instruction['accounts'] = left, right
    foreign = [item for item in actual['types'] if item['name'] == 'ProgramData']
    if foreign:
        assert foreign == [{'name': 'ProgramData', 'type': {'kind': 'struct', 'fields': [
            {'name': 'slot', 'type': 'u64'},
            {'name': 'upgrade_authority_address', 'type': {'option': 'pubkey'}}]}}]
        actual['types'].remove(foreign[0])
    extra_accounts = {item['name']: item for item in actual['accounts']
                      if item['name'] not in {item['name'] for item in expected['accounts']}}
    if extra_accounts:
        # RC2 also lists the three imported clearing accounts in maker IDLs.
        clearing_accounts = {item['name']: item for item in expected_idl('clearing')['accounts']}
        assert extra_accounts == {name: clearing_accounts[name] for name in ('Venue', 'Market', 'MarginAccount')}
        actual['accounts'] = [item for item in actual['accounts'] if item['name'] not in extra_accounts]
    return actual, expected


def check_domains():
    expected = json.loads(BASELINE.read_text())['contract']['domains']
    replacements = {'account:MakerCurveV4': 'account:MakerCurve',
                    'account:MakerPriceV4': 'account:MakerPrice',
                    'global:control_curve_v4': 'global:control_curve',
                    'global:quote_v4': 'global:quote_curve'}
    expected['rust_byte_literals'] = sorted(replacements.get(item, item)
                                            for item in expected['rust_byte_literals'])
    assert source_domains() == expected, 'Unapproved seed or signed domain change'


def check(directory):
    check_domains()
    for program in PROGRAMS:
        actual, expected = comparable(json.loads((directory / f'{program}.json').read_text()), expected_idl(program))
        assert program_contract(actual) == program_contract(expected), (program, program_contract(actual), program_contract(expected))
    print(f'RC2 ABI matches D90 canonical identifiers against immutable {PREDECESSOR}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--idl-directory', type=Path, default=Path('packages/sdk/idl'))
    parser.add_argument('--validate-contract-only', action='store_true')
    args = parser.parse_args()
    if args.validate_contract_only:
        for program in PROGRAMS:
            expected_idl(program)
        print('D90 expected delta validated; no generated or executable ABI claim')
    else:
        check(args.idl_directory)
