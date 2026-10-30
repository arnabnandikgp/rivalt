"""D84's explicit ABI delta from the accepted P40A predecessor.

This constructs expected layouts from immutable predecessor IDLs, before comparing
rebuilt output. It never captures expectations from modified/generated layouts.
The P36/P37 wire fixture remains untouched. Runtime activation is a separate gate.
"""
from copy import deepcopy
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
from wire_contract import program_contract, source_domains

PREDECESSOR = 'f8984e04ca655b81312a5ec13443dba5f08f6a21'
ACCOUNTS = ('Venue', 'Custody', 'VenueSafety', 'VenueRegistry', 'Portfolio',
            'MarginAccount', 'Market', 'MarketLedger', 'CapitalBinding',
            'SettlementCertificate', 'Resolution', 'ResolutionPage', 'ResolutionWork',
            'RetirementCertificate', 'LiquidityRegistry', 'MakerRegistration', 'FundingPublisher')
PAYLOADS = ('MarginAccountSnapshot', 'MarketSnapshot', 'LiquidityRegistryPayload',
            'MakerRegistrationPayload', 'FundingPublisherPayload')
READONLY_CUSTODY = (
    'activate_liquidity', 'approve_liquidity', 'check_market_backing',
    'configure_funding_publisher', 'control_liquidity', 'create_portfolio',
    'initialize_funding_publisher', 'initialize_liquidity', 'initialize_liquidity_oracle',
    'initialize_market', 'initialize_market_backing', 'initialize_venue_registry',
    'pause_venue', 'publish_funding_report', 'quarantine_liquidity',
    'register_liquidity', 'register_margin', 'replenish_liquidity',
    'seal_liquidity', 'transfer_account_custody',
)
PRECREATION = ('initialize_account_resolution', 'initialize_account_resolution_page', 'initialize_account_retirement')


def discriminator(namespace, name):
    return list(hashlib.sha256(f'{namespace}:{name}'.encode()).digest()[:8])


def predecessor_idl(program):
    return json.loads(subprocess.check_output(['git', 'show', f'{PREDECESSOR}:packages/sdk/idl/{program}.json']))


def expected_idl(program):
    original = predecessor_idl(program)
    frozen = json.loads(Path('tests/fixtures/wire-contract.json').read_text())
    assert program_contract(original) == frozen['contract']['programs'][program]
    expected = deepcopy(original)
    definitions = {item['name']: item for item in expected['types']}
    if program != 'clearing':
        # Maker-owned accounts/instructions remain unchanged; its generated IDL
        # also exposes the three imported clearing types it authenticates.
        for name in ('Venue', 'Market', 'MarginAccount'):
            fields = definitions[name]['type']['fields']
            assert fields[0] == {'name': 'schema_version', 'type': 'u16'}, name
            fields.insert(1, {'name': 'revision', 'type': 'u64'})
        return expected
    assert set(ACCOUNTS) == {item['name'] for item in expected['accounts']}
    for name in (*ACCOUNTS, *PAYLOADS):
        fields = definitions[name]['type']['fields']
        assert fields[0] == {'name': 'schema_version', 'type': 'u16'}, name
        fields.insert(1, {'name': 'revision', 'type': 'u64'})
    for name, field in (('Custody', 'sequence'), ('RetirementCertificate', 'custody_sequence')):
        fields = definitions[name]['type']['fields']
        index = next(index for index, entry in enumerate(fields) if entry['name'] == field)
        assert fields[index]['type'] == 'u64'
        fields.pop(index)
    for category, namespace in (('accounts', 'account'), ('events', 'event')):
        for entry in expected[category]:
            entry['discriminator'] = discriminator(namespace, entry['name'])
            if category == 'events':
                fields = definitions[entry['name']]['type']['fields']
                index = next(index for index, field in enumerate(fields) if field['name'] == 'sequence')
                assert fields[index]['type'] == 'u64'
                fields.pop(index)
    for instruction in expected['instructions']:
        if instruction['name'] in READONLY_CUSTODY:
            fields = instruction['accounts']
            if instruction['name'] == 'activate_liquidity':
                fields = next(field for field in fields if field['name'] == 'qualification')['accounts']
            custody = next(field for field in fields if field['name'] == 'custody')
            assert custody.pop('writable') is True
        if instruction['name'] in PRECREATION:
            instruction['accounts'].extend([{'name': 'event_authority'}, {'name': 'program'}])
    additions = {
        'ScopedRead': [('account', 'pubkey'), ('kind', 'u8'), ('revision', 'u64')],
        'ScopedWrite': [('account', 'pubkey'), ('kind', 'u8'), ('before', 'u64'), ('after', 'u64')],
        'AccountTransition': [
            ('schema_version', 'u16'), ('venue', 'pubkey'), ('domain', {'array': ['u8', 32]}),
            ('slot', 'u64'), ('instruction', {'array': ['u8', 8]}), ('payload_count', 'u16'),
            ('reads', {'vec': {'defined': {'name': 'ScopedRead'}}}),
            ('writes', {'vec': {'defined': {'name': 'ScopedWrite'}}}),
        ],
    }
    for name, fields in additions.items():
        assert name not in definitions
        expected['types'].append({'name': name, 'type': {'kind': 'struct', 'fields': [
            {'name': field, 'type': field_type} for field, field_type in fields]}})
    expected['events'].append({'name': 'AccountTransition', 'discriminator': discriminator('event', 'AccountTransition')})
    return expected


def check(directory):
    frozen = json.loads(Path('tests/fixtures/wire-contract.json').read_text())
    assert source_domains() == frozen['contract']['domains'], 'Seeds/hash domains changed outside D84'
    for program in ('clearing', 'maker_a', 'maker_b'):
        expected = program_contract(expected_idl(program))
        current = program_contract(json.loads((directory / f'{program}.json').read_text()))
        assert current == expected, (program, current, expected)
    print(f'Scoped ABI matches explicit D84 delta from {PREDECESSOR}: 17 layouts, 28 events, 20 custody read metas, three footer metas; maker-owned ABIs unchanged, imported clearing types revised')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--idl-directory', type=Path, default=Path('packages/sdk/idl'))
    parser.add_argument('--validate-contract-only', action='store_true')
    arguments = parser.parse_args()
    if arguments.validate_contract_only:
        for program in ('clearing', 'maker_a', 'maker_b'):
            expected_idl(program)
        print('Explicit D84 delta is valid against immutable predecessor; no rebuilt ABI claim')
    else:
        check(arguments.idl_directory)
