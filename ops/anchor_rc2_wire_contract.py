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
                                            | {r'Rivalt/frozen-market-order/v1\0', r'Rivalt/frozen-member-order/v1\0', r'Rivalt/winner-targets/v1\0'})
    # Native-only exact replay uses separate digest domains for fills and checkpoints.
    expected['rust_byte_literals'] = sorted(set(expected['rust_byte_literals']) | {
        r'Rivalt/entry-replay/fill/v1\0', r'Rivalt/entry-replay/checkpoint/v1\0'})
    # Format marker for the separately qualified margin extension.
    expected['rust_byte_literals'] = sorted(set(expected['rust_byte_literals']) | {'RVPROF01', 'RVPROF02', 'RVPROF03', 'RVMKTS01', 'RVPAIR01', 'RVPAIR02', 'RVBTC001', 'RVLINK01', 'RVJALLOC', 'RVCHAIN1', 'RVLOTS01', 'RVLOTS02', 'RVBOOK01', 'Rivalt/inventory-book/v1', 'RVMULT01', 'Rivalt/multi-lot-book/v1'})
    # Private native continuation domains bind the frozen source and proposed charge vector.
    expected['rust_byte_literals'] = sorted(set(expected['rust_byte_literals']) | {
        r'Rivalt/multi-lot-charge-proposal/v1\0', r'Rivalt/whole-single-market-search/v1\0'})
    # D139 uses distinct header markers for the fixed and paged payout receipts.
    expected['rust_byte_literals'] = sorted(set(expected['rust_byte_literals']) | {'RVJOINT1', 'RVJOINT2', 'joint-payment', 'joint-payment-page', 'RVPAGED1', 'RVBOUND1', 'winner-proof', 'search', 'pair-schedule', 'pair-order',
        r'Rivalt/pair-fills/v1\0', r'Rivalt/pair-order-page/v1\0'})
    # The local payout observer owns PDAs under [coverage-lane, venue, member_id % 8].
    expected['rust_byte_literals'] = sorted(set(expected['rust_byte_literals']) | {'coverage-lane'})
    expected['rust_byte_literals'] = sorted(set(expected['rust_byte_literals']) |
        {'market-listing', 'listed-symbol', 'listing-index', 'listed-funding', '/USD', 'BTC', 'ETH'})
    # The finalized SDK reader independently authenticates the existing on-chain registry hash.
    expected['sdk_hash_domains'] = sorted(set(expected['sdk_hash_domains']) | {'rivalt-financial-membership-v1'})
    assert source_domains() == expected, 'Unapproved seed or signed domain change'


def undo_listed_maker_delta(actual, program):
    """Check the opt-in listing extension without altering any legacy instruction."""
    actual = deepcopy(actual)
    def remove(category, name):
        row, = [row for row in actual[category] if row['name'] == name]
        actual[category].remove(row)
        return row
    def disc(namespace, name):
        return list(hashlib.sha256(f'{namespace}:{name}'.encode()).digest()[:8])
    if program not in ('clearing', 'maker_a', 'maker_b'):
        return actual
    if program == 'clearing':
        for name, keys, writes, signer, arguments in [
            ('initialize_listed_funding', 'authority venue safety listing listing_index registry funding configuration system_program event_authority program',
             {'authority','funding','configuration'},'authority',[('publisher','pubkey')]),
            ('configure_listed_funding', 'authority venue safety listing funding configuration event_authority program',
             {'funding','configuration'},'authority',[('epoch','u64'),('publisher','pubkey')]),
            ('publish_listed_funding', 'publisher venue safety listing listing_index funding configuration primary_asset primary_collateral guard_asset guard_collateral event_authority program',
             {'funding','configuration'},'publisher',[('report',{'defined':{'name':'FundingReport'}})])]:
            entry=remove('instructions',name)
            assert entry['discriminator']==disc('global',name) and [(a['name'],a['type']) for a in entry['args']]==arguments
            assert [(a['name'],a.get('writable',False),a.get('signer',False)) for a in entry['accounts']]==[
                (key,key in writes,key==signer) for key in keys.split()]
        assert remove('accounts','ListedFunding')['discriminator']==disc('account','ListedFunding')
        assert remove('events','ListedFundingChanged')['discriminator']==disc('event','ListedFundingChanged')
        def exact_fields(name, fields):
            assert [(f['name'],f['type']) for f in remove('types',name)['type']['fields']]==fields
        def defined(name):
            return {'defined':{'name':name}}
        exact_fields('ListedFunding',[('schema_version','u16'),('revision','u64'),('listing','pubkey'),
            ('values',defined('ListedFundingValues')),('bump','u8')])
        exact_fields('ListedFundingValues',[('observation_sequence','u64'),('funding_index_scaled','i128'),('funding_time','i64'),
            *[(name,'u64') for name in ['reference_price','lower','upper','valid_from','valid_until']],('oracle',defined('OracleState'))])
        exact_fields('ListedFundingChanged',[('venue','pubkey'),('slot','u64'),('listing','pubkey'),('funding','pubkey'),('configuration','pubkey'),
            ('values',defined('ListedFundingValues')),('publisher',defined('FundingPublisherPayload')),('report',{'option':defined('FundingReport')})])
        seal = remove('instructions','seal_listed_liquidity')
        assert seal['args'] == [] and seal['discriminator'] == disc('global',seal['name'])
        assert [(a['name'],a.get('writable',False),a.get('signer',False)) for a in seal['accounts']] == [
            (key,key in ('authority','listing','registry'),key=='authority')
            for key in 'authority venue safety listing registry system_program event_authority program'.split()]
        assert remove('events','ListedLiquiditySealed')['discriminator'] == disc('event','ListedLiquiditySealed')
        fields = remove('types','ListedLiquiditySealed')['type']['fields']
        assert [(f['name'],f['type']) for f in fields] == [('venue','pubkey'),('slot','u64'),('listing','pubkey'),
            ('registry','pubkey'),('state',{'defined':{'name':'LiquidityRegistryPayload'}})]
        ix = remove('instructions', 'admit_listed_maker')
        names = 'owner authority venue safety listing capital registration capital_binding config price pricing_program program_data system_program event_authority program'
        assert ix['args'] == [dict(name='instance', type='u8')]
        assert remove('events','ListedMakerAdmitted')['discriminator'] == disc('event','ListedMakerAdmitted')
        fields = remove('types','ListedMakerAdmitted')['type']['fields']
        assert [(f['name'],f['type']) for f in fields] == [('venue','pubkey'),('slot','u64'),('registration','pubkey'),
            ('capital_binding','pubkey'),('state',{'defined':{'name':'MakerRegistrationPayload'}})]
        writes = {'owner','registration','capital_binding'}
        signers = {'owner','authority'}
    else:
        ix = remove('instructions', 'initialize_listed_curve')
        names = 'owner venue listing capital config price system_program event_authority program'
        ordinary = next(row for row in actual['instructions'] if row['name']=='initialize_curve')
        assert ix['args'] == ordinary['args']
        assert remove('accounts','MarketListing')['discriminator'] == disc('account','MarketListing')
        fields = remove('types','MarketListing')['type']['fields']
        assert [(f['name'],f['type']) for f in fields] == [('schema_version','u16'),('revision','u64'),('venue','pubkey'),
            ('market_id','u16'),('symbol',{'array':['u8',8]}),('lots_per_unit','u64'),('quote_mint','pubkey'),
            ('oracle_publisher','pubkey'),('oracle_feed','pubkey'),('status','u8'),('bump','u8')]
        writes = {'owner','config','price'}
        signers = {'owner'}
    assert ix['discriminator'] == disc('global',ix['name'])
    assert [(a['name'],a.get('writable',False),a.get('signer',False)) for a in ix['accounts']] == [
        (key,key in writes,key in signers) for key in names.split()]
    return actual


def undo_liquidation_delta(actual, program):
    """Check the new keeper route before comparing older interface layers."""
    if program != 'clearing':
        return actual
    actual = deepcopy(actual)
    def unique(name):
        matches = [ix for ix in actual['instructions'] if ix['name'] == name]
        assert len(matches) == 1, name
        return matches[0]
    listing = unique('register_market_listing')
    assert listing['discriminator'] == list(hashlib.sha256(b'global:register_market_listing').digest()[:8])
    assert [(a['name'],a.get('writable',False),a.get('signer',False)) for a in listing['accounts']] == [
        ('authority',True,True),('venue',False,False),('safety',False,False),('listing',True,False),
        ('symbol_binding',True,False),('oracle_feed',False,False),('system_program',False,False),
        ('event_authority',False,False),('program',False,False)]
    for index, seed, arg in [(3,'market-listing','market_id'),(4,'listed-symbol','symbol')]:
        assert listing['accounts'][index]['pda']['seeds'] == [
            {'kind':'const','value':list(seed.encode())}, {'kind':'account','path':'venue'}, {'kind':'arg','path':arg}]
    symbol = {'array':['u8',8]}
    args = [('market_id','u16'),('symbol',symbol),('lots_per_unit','u64'),('oracle_publisher','pubkey')]
    assert [(row['name'],row['type']) for row in listing['args']] == args
    actual['instructions'].remove(listing)
    prefix = [('schema_version','u16'),('revision','u64')]
    index_fields = [('listing','pubkey'),('sources',{'array':['pubkey',4]}),
                    ('source_sequences',{'array':['u64',4]}),('sampled_at','i64'),('deadline','i64'),
                    ('reference','u64'),('lower','u64'),('upper','u64')]
    for name, names in [
        ('bind_listing_index','authority venue safety listing market listing_index primary_collateral guard_collateral system_program event_authority program'),
        ('observe_listing_index','venue safety listing listing_index primary_asset primary_collateral guard_asset guard_collateral event_authority program')]:
        ix = unique(name)
        assert ix['discriminator'] == list(hashlib.sha256(f'global:{name}'.encode()).digest()[:8])
        assert not ix['args']
        assert [(a['name'],a.get('writable',False),a.get('signer',False)) for a in ix['accounts']] == [
            (key,key in ('authority','listing_index'),key=='authority') for key in names.split()]
        index = next(row for row in ix['accounts'] if row['name']=='listing_index')
        assert index['pda']['seeds'] == [{'kind':'const','value':list(b'listing-index')},{'kind':'account','path':'listing'}]
        actual['instructions'].remove(ix)
    terms = args[:3] + [('quote_mint','pubkey'),args[3],('oracle_feed','pubkey'),('status','u8')]
    for name, category, namespace, fields in [
        ('ListingIndex','accounts','account',prefix+index_fields+[('bump','u8')]),
        ('ListingIndexChanged','events','event',[('venue','pubkey'),('slot','u64'),('index','pubkey')]+index_fields),
        ('MarketListing','accounts','account',prefix+[('venue','pubkey')]+terms+[('bump','u8')]),
        ('ListedSymbol','accounts','account',prefix+[('listing','pubkey'),('bump','u8')]),
        ('MarketListingRegistered','events','event',[('venue','pubkey'),('slot','u64'),('listing','pubkey'),
            ('symbol_binding','pubkey')]+terms)]:
        entry = next(row for row in actual[category] if row['name']==name)
        assert entry['discriminator'] == list(hashlib.sha256(f'{namespace}:{name}'.encode()).digest()[:8])
        definition = next(row for row in actual['types'] if row['name']==name)
        assert [(f['name'],f['type']) for f in definition['type']['fields']] == fields
        actual[category].remove(entry)
        actual['types'].remove(definition)
    multi = unique('execute_multi_route')
    assert multi['discriminator'] == list(hashlib.sha256(b'global:execute_multi_route').digest()[:8])
    assert multi['accounts'] == unique('execute_best_route')['accounts']
    assert multi['args'] == [{'name':'args','type':{'defined':{'name':'MultiRouteIntent'}}}]
    multi_type = next(t for t in actual['types'] if t['name']=='MultiRouteIntent')
    assert multi_type['type'] == {'kind': 'struct', 'fields': [{'name': 'order', 'type': {'defined': {'name': 'BestRouteIntent'}}}, {'name': 'extra_epochs', 'type': {'vec': {'defined': {'name': 'MakerEpochs'}}}}]}
    actual['types'].remove(multi_type)
    actual['instructions'].remove(multi)
    continued = next(event for event in actual['events'] if event['name']=='MakerFillContinuation')
    assert continued['discriminator'] == list(hashlib.sha256(b'event:MakerFillContinuation').digest()[:8])
    definition = next(t for t in actual['types'] if t['name']=='MakerFillContinuation')
    continuation_fields = [
        ('venue', 'pubkey'), ('market', 'pubkey'), ('slot', 'u64'), ('nonce', 'u64'), ('first_leg', 'u8'),
        ('root_states', {'vec': {'defined': {'name': 'MarginAccountSnapshot'}}}),
        ('maker_states', {'vec': {'defined': {'name': 'MakerRegistrationPayload'}}}),
        ('legs', {'vec': {'defined': {'name': 'ExecutedLeg'}}}),
    ]
    assert definition['type'] == {'kind': 'struct', 'fields': [
        {'name': name, 'type': field_type} for name, field_type in continuation_fields]}
    actual['events'].remove(continued)
    actual['types'].remove(definition)
    router = unique('execute_best_route')
    assert router['discriminator'] == list(hashlib.sha256(b'global:execute_best_route').digest()[:8])
    assert router['args'] == [{'name': 'args', 'type': {'defined': {'name': 'BestRouteIntent'}}}]
    previous = unique('execute_liquidity_route')
    def flags(meta):
        return (meta['name'], *(bool(meta.get(key)) for key in ('writable', 'signer', 'optional')))
    bundles = [(f'{ordinal}_{name}', name in ('capital', 'registration'), False, False)
               for ordinal in ('zero', 'one', 'two')
               for name in ('capital', 'registration', 'program', 'program_data', 'config', 'price')]
    assert list(map(flags, router['accounts'])) == [
        *map(flags, previous['accounts'][:9]), *bundles, *map(flags, previous['accounts'][-2:])]
    types = {entry['name']: entry for entry in actual['types']}
    def fields(name):
        return types[name]['type']['fields']
    assert fields('MakerEpochs') == [{'name': name, 'type': 'u64'} for name in ('authority', 'control', 'shape', 'depth')]
    assert fields('BestRouteIntent') == [*fields('LiquidityRouteIntent')[:-1],
        {'name': 'maker_epochs', 'type': {'array': [{'defined': {'name': 'MakerEpochs'}}, 3]}}]
    actual['instructions'].remove(router)
    for name in ('BestRouteIntent', 'MakerEpochs'):
        actual['types'].remove(types[name])
    # All financial inputs are read-only during search. Only the final binding
    # can write the prepared settlement, under the original frozen dependencies.
    work = {
        'open_joint_payment': ('payer payment prepared resolution rates btc_pairs eth_pairs btc_allocation eth_allocation system_program', 'payer payment', 'payer'),
        'capture_joint_payment': ('payer payment delta_page prepared resolution frozen_page system_program', 'payer payment delta_page', 'payer'),
        'advance_joint_payment': ('payment prepared resolution frozen_page delta_page', 'payment', ''),
        'bind_joint_payment': ('venue custody safety registry storage resolution btc eth btc_ledger eth_ledger vault prepared rates payment event_authority program', 'prepared', ''),
        'copy_joint_claims': ('venue custody safety registry storage resolution btc eth btc_ledger eth_ledger vault prepared page delta_page event_authority program', 'prepared page', ''),
        'copy_joint_register': ('venue custody safety registry storage resolution btc eth btc_ledger eth_ledger vault prepared rates payment page event_authority program', 'prepared rates page', ''),
        'open_pair_schedule': ('payer certificate allocation prepared resolution system_program', 'payer certificate', 'payer'),
        'append_pair_order': ('payer certificate order_page prepared resolution system_program', 'payer certificate order_page', 'payer'),
        'check_pair_members': ('certificate prepared resolution frozen_page', 'certificate', ''),
        'match_pair_page': ('certificate prepared resolution winners debtors', 'certificate winners debtors', ''),
        'open_winner_proof': ('payer proof prepared resolution system_program', 'payer proof', 'payer'),
        'advance_winner_proof': ('proof prepared resolution page opponents', 'proof', ''),
        'open_search': ('payer search prepared resolution system_program', 'payer search', 'payer'),
        'capture_member': ('search prepared resolution page margin', 'search', ''),
        **{name: ('search prepared resolution', 'search', '') for name in
           ('derive_pairs', 'verify_incumbent', 'cover_range', 'cover_plan', 'seal_search')},
        'record_original_budgets': ('venue custody safety registry storage resolution btc eth btc_ledger eth_ledger vault prepared rates page event_authority program', 'page', ''),
        'scan_foreign_protection': ('venue custody safety registry storage resolution btc eth btc_ledger eth_ledger vault prepared rates page event_authority program', 'prepared', ''),
        'bind_recovery_selection': ('venue custody safety registry storage resolution btc eth btc_ledger eth_ledger vault prepared search event_authority program', 'prepared', ''),
    }
    digest = {'array':['u8',32]}
    entry = {'vec':{'defined':{'name':'PairBookEntry'}}}
    openings = {'vec':{'defined':{'name':'PairMemberOpening'}}}
    for name, args in {
            'open_joint_payment':[('nonce','u64'),('account_bytes','u16'),('width','u16'),('proposals',{'vec':{'defined':{'name':'PaymentProposal'}}}),('revisions',{'array':['u64',3]})],
            'capture_joint_payment':[('index','u64'),('prior',{'array':[digest,2]}),('openings',{'vec':{'defined':{'name':'JointMemberOpening'}}})],
            'advance_joint_payment':[('revision','u64'),('steps','u16')],
            'bind_joint_payment':[('epoch','u64'),('revision','u64')],
            'copy_joint_claims':[('epoch','u64'),('index','u64'),('revision','u64')],
            'copy_joint_register':[('epoch','u64'),('register','u32'),('revision','u64')],
            'open_pair_schedule':[('nonce','u64'),('order_root',digest)],
            'append_pair_order':[('role','u8'),('index','u64'),('entries',entry),('next',digest)],
            'check_pair_members':[('prefix',digest),('openings',openings)],
            'match_pair_page':[('revision','u64')]}.items():
        assert [(arg['name'],arg['type']) for arg in unique(name)['args']] == args, name
    opened = unique('open_winner_proof')
    assert [(argument['name'],argument['type']) for argument in opened['args']] == [
        ('nonce','u64'),('epoch','u64'),('market','u8'),('cutoffs',{'array':[{'defined':{'name':'WinnerCutoff'}},2]})]
    advance = unique('advance_winner_proof')
    assert advance['args'] == [dict(name='revision',type='u64')]
    assert [meta['name'] for meta in advance['accounts'] if meta.get('optional')] == ['opponents']
    budgets = unique('record_original_budgets')
    assert [(arg['name'], arg['type']) for arg in budgets['args']] == [
        ('epoch', 'u64'), ('page_index', 'u64'), ('attempt', 'u64'), ('revision', 'u64'),
        ('page_revisions', {'array': ['u64', 7]})]
    assert unique('scan_foreign_protection')['args'] == budgets['args']
    for name, (names, writes, signers) in work.items():
        item = unique(name)
        assert item['discriminator'] == list(hashlib.sha256(f'global:{name}'.encode()).digest()[:8])
        for actual_metas, expected in ((item['accounts'], names),
                ([meta for meta in item['accounts'] if meta.get('writable')], writes),
                ([meta for meta in item['accounts'] if meta.get('signer')], signers)):
            assert [meta['name'] for meta in actual_metas] == expected.split(), name
        actual['instructions'].remove(item)
    for group, prefix, name in [('accounts','account','RecoverySearch'),('accounts','account','WinnerAllocationProof'),('accounts','account','PairScheduleProof'),('accounts','account','PairOrderPage'),('accounts','account','JointPaymentProof'),('accounts','account','JointPaymentPage'),('events','event','JointClaimsCopied'),('events','event','RecoverySelectionBound')]:
        actual[group].remove(dict(name=name,discriminator=list(hashlib.sha256(f'{prefix}:{name}'.encode()).digest()[:8])))
    for name in ('JointClaimsCopied','JointPaymentPage','JointPaymentProof','PaymentProposal','JointMemberOpening','PairOrderPage','PairScheduleProof','PairBookEntry','PairBookRow','PairMemberOpening','WinnerAllocationProof','WinnerCutoff','WinnerMarginal','WinnerRange','WinnerSide','RecoverySearch','RecoverySelectionBound','RateWitness','SearchMember','SearchEdge','StoredRatio','Priorities'):
        entry, = [item for item in actual['types'] if item['name'] == name]
        assert entry['type']['kind'] == 'struct'
        actual['types'].remove(entry)
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
    ledger_lane = unique('execute_ledger_lane')
    assert ledger_lane['discriminator'] == list(hashlib.sha256(b'global:execute_ledger_lane').digest()[:8])
    assert ledger_lane['args'] == ordinary['args']
    assert next(meta for meta in expected_metas if meta['name'] == 'ledger').pop('writable')
    assert ledger_lane['accounts'] == expected_metas
    actual['instructions'].remove(ledger_lane)
    actual['errors'].remove(dict(code=6133, name='RouteSearchLimit',
        msg='Route selection exceeded its search budget'))
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
        ('LedgerLaneFilled', [dict(field, name='lane_pending') if field['name']=='market_pending' else field for field in revised] + fields([('through','i64'),('index','i128')])),
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


def before_window_extensions(actual, program):
    if program == 'clearing':
        actual = deepcopy(actual)
        matches = [row for row in actual['instructions'] if row['name'] == 'verify_indexed_default']
        assert len(matches) == 1
        instruction, = matches
        assert instruction['discriminator'] == list(hashlib.sha256(b'global:verify_indexed_default').digest()[:8])
        assert [a['name'] for a in instruction['accounts']] == 'venue custody safety registry storage resolution btc eth btc_ledger eth_ledger vault'.split()
        assert not any(a.get('writable') or a.get('signer') or a.get('optional') for a in instruction['accounts'])
        assert [(a['name'], a['type']) for a in instruction['args']] == [
            ('epoch', 'u64'), ('selected', 'u8'), ('denominator', 'u32'), ('rates', {'vec':'u32'})]
        assert instruction['returns'] == {'vec':'u64'}
        actual['instructions'].remove(instruction)
        binder, = [row for row in actual['instructions'] if row['name'] == 'bind_indexed_default']
        inventory, = [row for row in actual['instructions'] if row['name'] == 'verify_inventory_book']
        assert binder['accounts'] == inventory['accounts']
        assert binder['discriminator'] == list(hashlib.sha256(b'global:bind_indexed_default').digest()[:8])
        assert binder['args'] == [instruction['args'][0], dict(name='revision', type='u64'), *instruction['args'][1:]]
        assert 'returns' not in binder
        actual['instructions'].remove(binder)
        name = 'IndexedSettlementBound'
        actual['events'].remove(dict(name=name, discriminator=list(hashlib.sha256(f'event:{name}'.encode()).digest()[:8])))
        pair = {'array':['u64',2]}
        transfers = {'vec':{'array':['i64',2]}}
        vector = {'vec':'u64'}
        fields = [('venue','pubkey'),('epoch','u64'),('prepared','pubkey'),('selection_ordinal','u64'),
                  ('verified_plans','u64'),('charge_atoms',pair),('insurance_spent',pair),('member_ids',vector),
                  ('claim_deltas',transfers),('movements',transfers),('final_cash',vector),('slot','u64')]
        payload, = [row for row in actual['types'] if row['name'] == name]
        assert clean(payload) == dict(name=name,type=dict(kind='struct',fields=[dict(name=k,type=v) for k,v in fields]))
        actual['types'].remove(payload)
    return undo_liquidation_delta(undo_listed_maker_delta(actual, program), program)


def comparable_program(program, actual):
    """Validate every explicit extension before comparing the retained D90 ABI."""
    actual = before_window_extensions(actual, program)
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
