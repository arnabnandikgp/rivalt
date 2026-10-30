"""D87's explicit schema-7 delta from immutable accepted P41 IDLs.

The predecessor is validated through D84/D86. Expected layouts/metas below follow
accounts.md; generated current output is never an expectation input.
"""
from copy import deepcopy
import json
import subprocess
from wire_contract import program_contract

PREDECESSOR = '49b95a4'


def expected_idl(program, market_idl):
    expected = json.loads(subprocess.check_output([
        'git', 'show', f'{PREDECESSOR}:packages/sdk/idl/{program}.json']))
    assert program_contract(expected) == program_contract(market_idl(program))
    if program != 'clearing':
        return expected
    definitions = {item['name']: item['type']['fields'] for item in expected['types'] if item['type']['kind'] == 'struct'}

    def remove_fields(name, removed):
        fields = definitions[name]
        assert set(removed) <= {field['name'] for field in fields}, (name, removed)
        fields[:] = [field for field in fields if field['name'] not in removed]

    def replace_type(name, field_name, old, new):
        field = next(field for field in definitions[name] if field['name'] == field_name)
        assert field['type'] == old, (name, field)
        field['type'] = new

    remove_fields('Custody', ('total_cash', 'liability_versions'))
    definitions['MarketLedger'].insert(-1, {'name': 'liability_version', 'type': 'u64'})
    definitions['MarketLedgerSnapshot'].append({'name': 'liability_version', 'type': 'u64'})
    for name in ('SettlementCertificate', 'BackingSnapshot'):
        field = next(field for field in definitions[name] if field['name'] == 'liability_versions')
        assert field['type'] == {'array': ['u64', 2]}
        field.update(name='liability_version', type='u64')
    for name in ('AccountCustodyChanged', 'AccountFinancialChanged', 'LiquidityRouteExecuted'):
        remove_fields(name, ('total_cash', 'liability_versions'))
    for name in ('AccountAuthorityChanged', 'AccountOrderChanged', 'AccountLiquidated'):
        remove_fields(name, ('liability_versions',))
    remove_fields('RetiredReserveWithdrawn', ('total_cash',))
    for name in ('AccountCustodyChanged', 'AccountFinancialChanged'):
        replace_type(name, 'allocated_vault', 'u64', {'option': 'u64'})
    replace_type('AccountFinancialChanged', 'actual_vault', 'u64', {'option': 'u64'})
    ledger_type = {'defined': {'name': 'MarketLedgerSnapshot'}}
    replace_type('AccountFinancialChanged', 'ledgers', {'array': [ledger_type, 2]}, {'vec': ledger_type})
    definitions['AccountLiquidated'].append({'name': 'ledgers', 'type': {'vec': ledger_type}})
    fields = definitions['LiquidityRouteExecuted']
    index = next(index for index, field in enumerate(fields) if field['name'] == 'ledger')
    fields.insert(index + 1, {'name': 'other_ledger', 'type': {'option': ledger_type}})

    def remove_accounts(fields, removed):
        assert set(removed) <= {field['name'] for field in fields}, removed
        fields[:] = [field for field in fields if field['name'] not in removed]
        for field in fields:
            if 'relations' in field:
                field['relations'] = [relation for relation in field['relations'] if relation not in removed]
                if not field['relations']:
                    del field['relations']

    def seed_account(name, seed, path, writable=True, optional=False):
        field = {'name': name, 'pda': {'seeds': [
            {'kind': 'const', 'value': list(seed.encode())}, {'kind': 'account', 'path': path}]}}
        if writable:
            field['writable'] = True
        if optional:
            field['optional'] = True
        return field

    no_custody = ('approve_liquidity', 'check_market_backing', 'configure_funding_publisher',
                  'control_liquidity', 'initialize_funding_publisher', 'initialize_liquidity',
                  'initialize_market_backing', 'manage_account_order', 'publish_funding_report',
                  'quarantine_liquidity', 'register_liquidity', 'replenish_liquidity',
                  'seal_liquidity', 'set_account_delegate')
    financial = ('collect_account_loss', 'pay_account_gain', 'net_account_claims',
                 'transfer_funded_account', 'withdraw_funded_account', 'liquidate_account')
    treasury = ('allocate_market_fees', 'withdraw_market_fees', 'withdraw_retired_reserve')
    for instruction in expected['instructions']:
        name, fields = instruction['name'], instruction['accounts']
        if name in no_custody:
            remove_accounts(fields, ('custody',))
        elif name == 'transfer_account_custody':
            remove_accounts(fields, ('custody', 'btc_ledger', 'eth_ledger', 'vault'))
        elif name in ('deposit_account', 'withdraw_account_custody'):
            for field in fields:
                if field['name'] in ('btc_ledger', 'eth_ledger'):
                    field.update(writable=True, optional=True)
        elif name in ('classify_market_surplus', 'seed_market_insurance'):
            index = next(index for index, field in enumerate(fields) if field['name'] == 'btc_ledger')
            remove_accounts(fields, ('btc_ledger', 'eth_ledger'))
            fields.insert(index, seed_account('ledger', 'ledger-v3', 'ledger.market'))
            next(field for field in fields if field['name'] == 'venue')['relations'].append('ledger')
        elif name in ('execute_liquidity_order', 'execute_liquidity_route'):
            identity = next(field for field in fields if field['name'] == 'identity')['accounts']
            remove_accounts(identity, ('custody', 'vault'))
            next(field for field in identity if field['name'] == 'other_ledger').update(writable=True, optional=True)
        elif name in financial:
            identity = next(field for field in fields if field['name'] == 'identity')['accounts']
            remove_accounts(identity, ('custody', 'vault', 'btc_ledger', 'eth_ledger'))
            additions = [seed_account(f'{market}_ledger', 'ledger-v3', f'identity.venue.markets [{index}]',
                                      optional=name != 'net_account_claims') for index, market in enumerate(('btc', 'eth'))]
            if name == 'withdraw_funded_account':
                additions.extend([seed_account('custody', 'custody-v3', 'identity.venue'),
                                  seed_account('vault', 'vault-v3', 'identity.venue')])
            fields[1:1] = additions
        elif name in treasury:
            identity = next(field for field in fields if field['name'] == 'identity')['accounts']
            retained = {field['name']: field for field in deepcopy(identity)}
            remove_accounts(identity, ('custody', 'vault', 'btc', 'eth', 'btc_ledger', 'eth_ledger'))
            identity.append(seed_account('ledger', 'ledger-v3', 'ledger.market'))
            next(field for field in identity if field['name'] == 'venue')['relations'].append('ledger')
            if name == 'allocate_market_fees':
                remove_accounts(fields, ('quote_mint', 'user_token', 'token_program'))
            else:
                identity.extend([retained['custody'], retained['vault']])
                next(field for field in identity if field['name'] == 'venue')['relations'].append('custody')
                if name == 'withdraw_market_fees':
                    next(field for field in fields if field['name'] == 'user_token').pop('optional')
    return expected
