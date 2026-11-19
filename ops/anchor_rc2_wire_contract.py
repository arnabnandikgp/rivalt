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
from settlement_wire_contract import strip_additions, DOMAINS, undo_window_delta
from backing_wire_contract import undo_backing_delta
from membership_wire_contract import undo_membership_delta, DOMAINS_ADDED, DOMAINS_REMOVED

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
    expected['rust_byte_literals'] = sorted(set(replacements.get(item, item)
                                            for item in expected['rust_byte_literals']) | set(DOMAINS) | DOMAINS_ADDED)
    # P55B1 adds a native arithmetic-checkpoint domain only. No Anchor account,
    # PDA seed, signed transaction domain or instruction changes in this phase.
    expected['rust_byte_literals'] = sorted((set(expected['rust_byte_literals']) - DOMAINS_REMOVED) | {'RVBACK01'})
    # D121 episode ordering is used only by the research selector at this revision.
    expected['rust_byte_literals'] = sorted(set(expected['rust_byte_literals'])
                                            | {r'Rivalt/frozen-member-order/v1\0'})
    # Format marker for the separately qualified margin extension.
    expected['rust_byte_literals'] = sorted(set(expected['rust_byte_literals']) | {'RVPROF01', 'RVPAIR01', 'RVPAIR02', 'RVBTC001', 'RVLINK01', 'RVJALLOC', 'RVCHAIN1', 'RVLOTS01', 'RVLOTS02', 'RVBOOK01', 'Rivalt/inventory-book/v1', 'RVMULT01', 'Rivalt/multi-lot-book/v1'})
    # Private native continuation domains bind the frozen source and proposed charge vector.
    expected['rust_byte_literals'] = sorted(set(expected['rust_byte_literals']) | {
        r'Rivalt/multi-lot-charge-proposal/v1\0', r'Rivalt/whole-single-market-search/v1\0'})
    assert source_domains() == expected, 'Unapproved seed or signed domain change'


def undo_liquidation_delta(actual, program):
    """Check the new keeper route before comparing older interface layers."""
    if program != 'clearing':
        return actual
    actual = deepcopy(actual)
    def unique(name):
        matches = [ix for ix in actual['instructions'] if ix['name'] == name]
        assert len(matches) == 1, name
        return matches[0]
    checkpoint = unique('checkpoint_market')
    assert checkpoint['discriminator'] == list(hashlib.sha256(b'global:checkpoint_market').digest()[:8])
    assert not checkpoint['args'] and 'returns' not in checkpoint
    assert [item['name'] for item in checkpoint['accounts']] == 'venue safety market first second third event_authority program'.split()
    assert [item['name'] for item in checkpoint['accounts'] if item.get('writable')] == ['market']
    assert not any(item.get('signer') or item.get('optional') for item in checkpoint['accounts'])
    assert checkpoint['accounts'][3:6] == unique('read_market_gross')['accounts'][2:5]
    actual['instructions'].remove(checkpoint)
    lane = unique('execute_market_lane')
    assert lane['discriminator'] == list(hashlib.sha256(b'global:execute_market_lane').digest()[:8])
    ordinary = unique('execute_liquidity_route')
    assert lane['args'] == ordinary['args']
    expected_metas = deepcopy(ordinary['accounts'])
    selected = next(meta for meta in expected_metas if meta['name'] == 'market')
    assert selected.pop('writable')
    assert lane['accounts'] == expected_metas
    actual['instructions'].remove(lane)
    actual['errors'].remove(dict(code=6132, name='MarketCheckpoint',
        msg='A current funding and gross checkpoint is required for each market'))
    view = unique('read_market_gross')
    assert view['discriminator'] == list(hashlib.sha256(b'global:read_market_gross').digest()[:8])
    assert view.get('returns') == 'u64' and not view['args']
    assert [item['name'] for item in view['accounts']] == 'venue market first second third'.split()
    assert not any(item.get('signer') or item.get('writable') or item.get('optional') for item in view['accounts'])
    for index, lane in enumerate(view['accounts'][2:]):
        assert lane['pda']['seeds'] == [dict(kind='const',value=list(b'maker-v4')),dict(kind='account',path='market'),dict(kind='const',value=[index])]
    actual['instructions'].remove(view)
    fees = unique('classify_market_fees')
    assert fees['discriminator'] == list(hashlib.sha256(b'global:classify_market_fees').digest()[:8])
    assert not fees['args']
    assert [item['name'] for item in fees['accounts']] == 'venue safety ledger first second third event_authority program'.split()
    assert [item['name'] for item in fees['accounts'] if item.get('writable')] == ['ledger']
    assert not any(item.get('signer') or item.get('optional') for item in fees['accounts'])
    assert fees['accounts'][:3] == unique('allocate_market_fees')['accounts'][:3]
    assert fees['accounts'][-2:] == unique('allocate_market_fees')['accounts'][-2:]
    actual['instructions'].remove(fees)
    route_fields = next(item['type']['fields'] for item in actual['types'] if item['name']=='LiquidityRouteExecuted')
    remove_split = {'insurance_credit','retained_fee','carry_before','carry_after'}
    revised = [field for field in route_fields if field['name'] not in remove_split]
    insert = next(i for i,field in enumerate(revised) if field['name']=='ledger')
    def fields(items):
        return [dict(name=name,type=kind) for name,kind in items]
    revised[insert:insert] = fields([('lane_collected','u128'),('market_pending','u64')])
    for name, expected in (
        ('LiquidityRouteFeeRecorded', revised),
        ('MarketLaneFilled', revised + fields([('through','i64'),('index','i128')])),
        ('MarketCheckpointed', fields([('venue','pubkey'),('market','pubkey'),('slot','u64'),('state',{'defined':{'name':'MarketSnapshot'}})])),
        ('MarketFeesClassified', fields([('venue','pubkey'),('market','pubkey'),('slot','u64'),('classified','u128'),
                                       ('amount','u64'),('insurance_credit','u64'),('ledger',{'defined':{'name':'MarketLedgerSnapshot'}})]))
    ):
        actual['events'].remove(dict(name=name,discriminator=list(hashlib.sha256(f'event:{name}'.encode()).digest()[:8])))
        event_type = next(item for item in actual['types'] if item['name']==name)
        assert clean(event_type) == dict(name=name,type=dict(kind='struct',fields=expected))
        actual['types'].remove(event_type)
    book = unique('verify_inventory_book')
    assert book['discriminator'] == list(hashlib.sha256(b'global:verify_inventory_book').digest()[:8])
    assert book['args'] == [dict(name=key,type='u64') for key in ('epoch','revision')] + [dict(name='ordinals',type={'vec':'u64'})]
    assert [item['name'] for item in book['accounts']] == (
        'venue custody safety registry storage resolution btc eth btc_ledger eth_ledger vault prepared event_authority program').split()
    assert [item['name'] for item in book['accounts'] if item.get('writable')] == ['prepared']
    assert not any(item.get('signer') or item.get('optional') for item in book['accounts'])
    actual['instructions'].remove(book)
    for name,capacity_width,pair_width in [('InventoryBookVerified',2,4),('MultiLotBookVerified',4,6)]:
        actual['events'].remove(dict(name=name,discriminator=list(hashlib.sha256(f'event:{name}'.encode()).digest()[:8])))
        fields = [dict(name='venue',type='pubkey'),*[dict(name=key,type='u64') for key in ('epoch','slot','total')],
                  *[dict(name=key,type={'vec':{'array':['u64',width]}}) for key,width in [('capacities',capacity_width),('pairs',pair_width)]]]
        book_type = next(item for item in actual['types'] if item['name'] == name)
        assert clean(book_type) == dict(name=name,type=dict(kind='struct',fields=fields))
        actual['types'].remove(book_type)
    shared = unique('verify_shared_inventory')
    assert shared['discriminator'] == list(hashlib.sha256(b'global:verify_shared_inventory').digest()[:8])
    assert shared['args'] == [dict(name=key, type='u64') for key in ('epoch', 'revision')] + [
        dict(name=key, type={'array':['u64',width]}) for key,width in [('ordinals',4),('charges',2)]]
    assert [item['name'] for item in shared['accounts']] == (
        'venue custody safety registry storage resolution btc eth btc_ledger eth_ledger vault prepared first_page '
        'second_page third_page fourth_page first_winner second_winner event_authority program').split()
    assert [item['name'] for item in shared['accounts'] if item.get('writable')] == ['prepared']
    assert not any(item.get('signer') for item in shared['accounts'])
    assert [item['name'] for item in shared['accounts'] if item.get('optional')] == ['second_page','third_page','fourth_page']
    actual['instructions'].remove(shared)
    name = 'SharedInventoryVerified'
    actual['events'].remove(dict(name=name, discriminator=list(hashlib.sha256(f'event:{name}'.encode()).digest()[:8])))
    fields = [dict(name='venue', type='pubkey'), *[dict(name=key, type='u64') for key in ('epoch', 'slot')],
              dict(name='members', type={'array':['u64',4]}), *[dict(name=key, type={'array':['u64',2]})
              for key in ('charges','eligible','prices')]]
    shared_type = next(item for item in actual['types'] if item['name'] == name)
    assert clean(shared_type) == dict(name=name, type=dict(kind='struct', fields=fields))
    actual['types'].remove(shared_type)
    foreign = unique('verify_foreign_creditors')
    assert foreign['discriminator'] == list(hashlib.sha256(b'global:verify_foreign_creditors').digest()[:8])
    assert foreign['args'] == [dict(name=key, type='u64') for key in ('epoch', 'revision')] + [
        dict(name=key, type={'array':['u64',width]}) for key,width in [('ordinals',4),('charges',2)]]
    assert [item['name'] for item in foreign['accounts']] == (
        'venue custody safety registry storage resolution btc eth btc_ledger eth_ledger vault prepared first_page '
        'second_page third_page fourth_page cross_winner eth_winner event_authority program').split()
    assert [item['name'] for item in foreign['accounts'] if item.get('writable')] == ['prepared']
    assert not any(item.get('signer') for item in foreign['accounts'])
    assert [item['name'] for item in foreign['accounts'] if item.get('optional')] == ['second_page','third_page','fourth_page']
    actual['instructions'].remove(foreign)
    name = 'ForeignCreditorsVerified'
    actual['events'].remove(dict(name=name, discriminator=list(hashlib.sha256(f'event:{name}'.encode()).digest()[:8])))
    fields = [dict(name='venue', type='pubkey'), *[dict(name=key, type='u64') for key in ('epoch', 'slot')],
              dict(name='members', type={'array':['u64',4]}), *[dict(name=key, type={'array':['u64',2]})
              for key in ('charges','eligible','matched_lots','base_prices','extra_tick_lots')]]
    foreign_type = next(item for item in actual['types'] if item['name'] == name)
    assert clean(foreign_type) == dict(name=name, type=dict(kind='struct', fields=fields))
    actual['types'].remove(foreign_type)
    allocation = unique('advance_btc_allocation')
    linked = unique('advance_linked_allocation')
    assert linked['discriminator'] == list(hashlib.sha256(b'global:advance_linked_allocation').digest()[:8])
    assert linked['accounts'] == allocation['accounts']
    assert linked['args'] == allocation['args'][:3] + [
        dict(name='cutoffs', type={'option': {'array': [{'array': ['u64', 4]}, 2]}})]
    actual['instructions'].remove(linked)
    name = 'FrozenLinkedAllocationRow'
    actual['events'].remove(dict(name=name, discriminator=list(hashlib.sha256(f'event:{name}'.encode()).digest()[:8])))
    fields = [dict(name='venue', type='pubkey'),
              *[dict(name=key, type='u64') for key in ('slot', 'epoch', 'attempt', 'ordinal', 'debtor_id', 'member_id')],
              *[dict(name=key, type={'array': ['u64', 2]}) for key in
                ('shares', 'targets', 'eligible', 'charges', 'matched_lots', 'base_prices', 'extra_tick_lots')],
              dict(name='status', type='u8')]
    linked_row = next(item for item in actual['types'] if item['name'] == name)
    assert clean(linked_row) == dict(name=name, type=dict(kind='struct', fields=fields))
    actual['types'].remove(linked_row)
    assert allocation['discriminator'] == list(hashlib.sha256(b'global:advance_btc_allocation').digest()[:8])
    assert allocation['args'] == [dict(name=name, type='u64') for name in ('epoch','revision','ordinal')] + [
        dict(name='cutoff', type={'option': {'array': ['u64', 4]}})]
    assert [item['name'] for item in allocation['accounts']] == (
        'venue custody safety registry storage resolution btc eth btc_ledger eth_ledger vault prepared page margin event_authority program').split()
    assert [item['name'] for item in allocation['accounts'] if item.get('writable')] == ['prepared','page']
    assert not any(item.get('signer') or item.get('optional') for item in allocation['accounts'])
    actual['instructions'].remove(allocation)
    name = 'FrozenJointReductionVerified'
    actual['events'].remove(dict(name=name, discriminator=list(hashlib.sha256(f'event:{name}'.encode()).digest()[:8])))
    fields = [dict(name='venue', type='pubkey'), *[dict(name=key, type='u64') for key in ('epoch', 'slot', 'debtor_id')],
              *[dict(name=key, type={'array': ['u64', 2]}) for key in
                ('winners', 'shares', 'charges', 'eligible', 'matched_lots', 'base_prices', 'extra_tick_lots')]]
    joint = next(item for item in actual['types'] if item['name'] == name)
    assert clean(joint) == dict(name=name, type=dict(kind='struct', fields=fields))
    actual['types'].remove(joint)
    name='FrozenBtcAllocationRow'
    event=dict(name=name,discriminator=list(hashlib.sha256(f'event:{name}'.encode()).digest()[:8]))
    actual['events'].remove(event)
    fields=[dict(name=field,type='u64') for field in (
        'slot epoch attempt ordinal debtor_id member_id shortfall eligible charge matched_lots base_price extra_tick_lots').split()]
    actual['types'].remove(dict(name=name,type=dict(kind='struct',fields=[dict(name='venue',type='pubkey'),*fields,dict(name='status',type='u8')])))
    pair=unique('verify_frozen_pair')
    assert pair['discriminator']==list(hashlib.sha256(b'global:verify_frozen_pair').digest()[:8])
    assert pair['args']==[{'name':name,'type':'u64'} for name in ('epoch','revision','debtor_ordinal','winner_ordinal')]
    assert [field['name'] for field in pair['accounts']]==(
        'venue custody safety registry storage resolution btc eth btc_ledger eth_ledger vault prepared debtor_page '
        'winner_page debtor winner event_authority program').split()
    assert [field['name'] for field in pair['accounts'] if field.get('writable')]==['prepared']
    assert not any(field.get('signer') for field in pair['accounts'])
    assert [field['name'] for field in pair['accounts'] if field.get('optional')]==['winner_page']
    actual['instructions'].remove(pair)
    event_name='FrozenPairVerified'
    event={'name':event_name,'discriminator':list(hashlib.sha256(f'event:{event_name}'.encode()).digest()[:8])}
    assert actual['events'].count(event)==1
    actual['events'].remove(event)
    fields=[{'name':name,'type':'pubkey' if name=='venue' else 'u64'} for name in
            ('venue','slot','epoch','debtor_id','winner_id','mark','price','charge','unpaid_gain_cap')]
    event_type={'name':event_name,'type':{'kind':'struct','fields':fields}}
    assert actual['types'].count(event_type)==1
    actual['types'].remove(event_type)
    residual_name='FrozenBtcReductionVerified'
    residual_event={'name':residual_name,'discriminator':list(hashlib.sha256(f'event:{residual_name}'.encode()).digest()[:8])}
    residual_fields=[{'name':name,'type':'pubkey' if name=='venue' else 'u64'} for name in
                    ('venue','slot','epoch','debtor_id','winner_id','mark','base_price','charge','unpaid_gain_cap','matched_lots','extra_tick_lots')]
    residual_type={'name':residual_name,'type':{'kind':'struct','fields':residual_fields}}
    residual_types=[item for item in actual['types'] if item['name']==residual_name]
    assert actual['events'].count(residual_event)==1 and len(residual_types)==1
    assert {key:value for key,value in residual_types[0].items() if key!='docs'}==residual_type
    actual['events'].remove(residual_event)
    actual['types'].remove(residual_types[0])
    capacity = unique('manage_profit_capacity')
    assert capacity['discriminator'] == list(hashlib.sha256(b'global:manage_profit_capacity').digest()[:8])
    assert capacity['args'] == [{'name': name, 'type': kind} for name, kind in
                                [('slot_bytes','u16'), ('revision','u64'), ('max_payment','u64')]]
    assert [(field['name'], field.get('writable',False), field.get('signer',False))
            for field in capacity['accounts']] == [
                ('actor',False,True), ('payer',True,True), ('previous_contributor',True,False),
                ('venue',False,False), ('safety',False,False), ('margin',True,False),
                ('system_program',False,False), ('event_authority',False,False), ('program',False,False)]
    assert capacity['accounts'][6]['address'] == '11111111111111111111111111111111'
    actual['instructions'].remove(capacity)
    direct = unique('execute_liquidity_route')
    forced = unique('liquidate_liquidity_route')
    tag = list(hashlib.sha256(b'global:liquidate_liquidity_route').digest()[:8])
    assert forced == {**direct, 'name': 'liquidate_liquidity_route', 'discriminator': tag}
    actual['instructions'].remove(forced)
    return actual


def comparable_program(program, actual):
    """Validate every explicit extension before comparing the retained D90 ABI."""
    actual = undo_liquidation_delta(actual, program)
    actual = undo_window_delta(actual, program)
    actual = undo_backing_delta(actual, program)
    actual = undo_membership_delta(actual, program)
    if program == 'clearing':
        actual = strip_additions(actual)
    return comparable(actual, expected_idl(program))


def check(directory):
    check_domains()
    for program in PROGRAMS:
        actual = json.loads((directory / f'{program}.json').read_text())
        actual, expected = comparable_program(program, actual)
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
