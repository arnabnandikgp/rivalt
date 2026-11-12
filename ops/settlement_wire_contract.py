"""Literal P54 paged settlement ABI additions; never recapture old ABI baselines."""
import hashlib
from copy import deepcopy

SCALARS = {'u8', 'u16', 'u32', 'u64', 'i64', 'i128', 'u128', 'bool', 'pubkey'}

def kind(label):
    if label.endswith('?'):
        return {'option': kind(label[:-1])}
    if label.endswith('*'):
        return {'vec': kind(label[:-1])}
    if '[' in label:
        name, count = label[:-1].rsplit('[', 1)
        return {'array': [kind(name), int(count)]}
    return label if label in SCALARS else {'defined': {'name': label}}

def fields(text):
    return [{'name': name, 'type': kind(label)} for name, label in
            (item.split(':') for item in text.split())]

PREFIX = 'schema_version:u16 revision:u64 venue:pubkey '
TYPES = {
    'FrozenMargin': 'id:u64 member:pubkey activation_generation:u64 original_revision:u64 cash:u64 lots:i64[2] generations:u64[2] claims:i128[2] collected:u64',
    'FrozenMarginPage': PREFIX+'epoch:u64 page_index:u64 row_count:u8 rows:FrozenMargin[8] bump:u8',
    'LimbPayload': 'words:u64[256]',
    'SettlementLimbPage': PREFIX+'epoch:u64 attempt:u64 register:u32 page_index:u64 word_count:u16 bump:u8 payload:LimbPayload',
    'MemberEntry': 'root:pubkey lifecycle:u8 activation_generation:u64',
    'MemberEntries': 'entries:MemberEntry[64]',
    'MemberPage': PREFIX+'page_index:u64 allocated_mask:u64 financial_mask:u64 members:MemberEntries bump:u8',
    'MemberIndexNode': PREFIX+'level:u8 prefix:u64 populated_mask:u16 counts:u64[16] bump:u8',
    'RateCheckpoints': 'insurance:u8[64] work:u8[960]',
    'SettlementRates': PREFIX+'epoch:u64 attempt:u64 stage:u8 proposer:pubkey last_progress_slot:u64 factor:u64[5] lengths:u64[2] uploaded:u64[2] state:RateCheckpoints bump:u8',
    'PlanCheckpoint': 'bytes:u8[960]',
    'SettlementPlan': PREFIX+'epoch:u64 rates_revision:u64 rates_attempt:u64 stage:u8 cursor:u64 proposer:pubkey last_progress_slot:u64 order_attempt:u64 order_market:u8 insurance_spent:u64[2] graph_length:u64 graph_required:u64 original_cash_remaining:u64 cash_applied:u64 market_movements:i128[2] adoption_revision:u64 work:PlanCheckpoint bump:u8',
    'PreparationState': 'membership:u8[544] valuation:u8[288] denominator:u8[320]',
    'PreparedSettlement': PREFIX+'epoch:u64 source:pubkey source_revision:u64 registry_revision:u64 membership_epoch:u64 registry_hash:u8[32] count:u64 safety_epoch:u64 terms_epoch:u64 config_epochs:u64[2] prices:u64[2] funding:i128[2] allocated:u64 pools:u64[2] insurance:u64[2] fees:u64[2] gross:u64[2] stage:u8 index_initialized:u16 member_page_initialized:bool state:PreparationState bump:u8',
}
EVENTS = {
    'SettlementPlanProgress': 'venue:pubkey slot:u64 epoch:u64 plan:pubkey stage:u8 cursor:u64 count:u64 adoption_revision:u64 remaining_cash:u64 applied_cash:u64 market_movements:i128[2] gross:u64[2] pools:u64[2] insurance:u64[2] insurance_spent:u64[2] fees:u64[2] ledger_versions:u64[2] liability_versions:u64[2] insurance_fee_remainders:u8[2] allocated:u64 actual_vault:u64 resolution_stage:u8 mode:u8 paused:bool safety_epoch:u64',
    'SettlementMarginApplied': 'venue:pubkey slot:u64 epoch:u64 ordinal:u64 id:u64 member:pubkey cash_before:u64 claims:i128[2] lots:i64[2] flows:u64[2] state:MarginAccountSnapshot',
}
TYPES.update(EVENTS)

ACCOUNTS = {'FrozenMarginPage','SettlementLimbPage','MemberPage','MemberIndexNode','PreparedSettlement','SettlementRates','SettlementPlan'}
# Existing verification contexts stay readonly; Apply's exact writers are explicit.
SOURCE = 'venue custody safety registry resolution btc eth btc_ledger eth_ledger vault'
TAIL = 'event_authority program'
INSTRUCTIONS = {
    'initialize_prepared_settlement': (f'payer! {SOURCE} prepared+ system_program {TAIL}', 'epoch:u64 source_revision:u64'),
    'initialize_prepared_index_node': (f'payer! {SOURCE} prepared+ node+ system_program {TAIL}', 'epoch:u64 level:u8 revision:u64'),
    'initialize_prepared_members': (f'payer! {SOURCE} prepared+ page+ system_program {TAIL}', 'epoch:u64 revision:u64'),
    'initialize_frozen_margin_page': (f'payer! {SOURCE} prepared page+ system_program {TAIL}', 'epoch:u64 page_index:u64'),
    'advance_prepared_membership': (f'{SOURCE} prepared+ index {TAIL}', 'epoch:u64 revision:u64'),
    'value_prepared_member': (f'{SOURCE} prepared+ members margin page+ {TAIL}', 'epoch:u64 revision:u64'),
    'initialize_settlement_limb_page': (f'payer! {SOURCE} prepared page+ system_program {TAIL}', 'epoch:u64 register:u32 page_index:u64'),
    'accept_denominator_row': (f'{SOURCE} prepared+ page {TAIL}', 'epoch:u64 revision:u64'),
    'initialize_settlement_rates': (f'payer! {SOURCE} prepared rates+ system_program {TAIL}', 'epoch:u64'),
    'begin_settlement_rate_proposal': (f'{SOURCE} prepared rates+ actor^ {TAIL}', 'epoch:u64 revision:u64 factor:u64[5] lengths:u64[2]'),
    'reset_settlement_rate_proposal': (f'{SOURCE} prepared rates+ actor^ {TAIL}', 'epoch:u64 revision:u64 attempt:u64'),
    'upload_settlement_rate': (f'{SOURCE} prepared rates+ page+ proposer^ {TAIL}', 'epoch:u64 revision:u64 attempt:u64 market:u8 offset:u64 words:u64*'),
    'prepare_settlement_rate_scratch': (f'{SOURCE} prepared rates page+ {TAIL}', 'epoch:u64 attempt:u64'),
    'accept_settlement_rate_row': (f'{SOURCE} prepared rates+ page {TAIL}', 'epoch:u64 revision:u64 attempt:u64'),
    'continue_settlement_rates': (f'{SOURCE} prepared rates+ {TAIL}', 'epoch:u64 revision:u64 attempt:u64 steps:u16 revisions:u64[3]'),
    'continue_settlement_denominator': (f'{SOURCE} prepared+ {TAIL}', 'epoch:u64 revision:u64 steps:u16 revisions:u64[3]'),
    'initialize_settlement_plan': (f'payer! {SOURCE} prepared rates plan+ system_program {TAIL}', 'epoch:u64'),
    'initialize_settlement_plan_page': (f'payer! {SOURCE} prepared rates plan page+ system_program {TAIL}', 'epoch:u64 register:u32 page_index:u64'),
    'accept_settlement_plan_row': (f'{SOURCE} prepared rates plan+ page actor^ {TAIL}', 'epoch:u64 revision:u64 ordinal:u64 attempt:u64 revisions:u64[3]'),
    'begin_settlement_plan_order': (f'{SOURCE} prepared rates plan+ actor^ {TAIL}', 'epoch:u64 revision:u64'),
    'reset_settlement_plan_order': (f'{SOURCE} prepared rates plan+ actor^ {TAIL}', 'epoch:u64 revision:u64 attempt:u64'),
    'continue_settlement_plan': (f'{SOURCE} prepared rates plan+ {TAIL}', 'epoch:u64 revision:u64 attempt:u64 steps:u16 revisions:u64[3]'),
}
def source_writes(*names):
    return ' '.join(name+'+' if name in names else name for name in SOURCE.split())

INSTRUCTIONS.update({
    'adopt_settlement_plan': (f'{source_writes("resolution")} prepared rates plan+ {TAIL}', 'epoch:u64 revision:u64'),
    'apply_settlement_margin': (f'{source_writes("btc", "eth")} prepared rates plan+ page margin+ flow_page+ {TAIL}', 'epoch:u64 revision:u64 ordinal:u64 revisions:u64[3]'),
    'complete_settlement_application': (f'{source_writes("btc_ledger", "eth_ledger")} prepared rates plan+ {TAIL}', 'epoch:u64 revision:u64'),
    'reconcile_settlement_margin': (f'{SOURCE} prepared rates plan+ page margin flow_page {TAIL}', 'epoch:u64 revision:u64 ordinal:u64'),
    'complete_settlement_plan': (f'{source_writes("safety", "resolution")} prepared rates plan+ {TAIL}', 'epoch:u64 revision:u64'),
})

DOMAINS = ['account:MemberIndexNode','account:MemberPage','account:PreparedSettlement',
           'account:SettlementLimbPage','frozen-margin-page','member-index',
           'member-page','prepared-settlement','resolution-limbs','settlement-rates','account:SettlementRates',
           'settlement-plan','account:SettlementPlan']

def strip_additions(idl):
    """Check the literal extension first; return the untouched predecessor surface."""
    from anchor_rc2_wire_contract import clean, flatten
    result = deepcopy(idl)
    definitions = {item['name']: clean(item) for item in idl['types']}
    for name, layout in TYPES.items():
        assert definitions[name] == {'name':name,'type':{'kind':'struct','fields':fields(layout)}}, name
    accounts = {item['name']: item for item in idl['accounts']}
    for name in ACCOUNTS:
        assert accounts[name] == {'name':name,'discriminator':list(hashlib.sha256(f'account:{name}'.encode()).digest()[:8])}, name
    instructions = {item['name']:item for item in idl['instructions']}
    for name, (metas, arguments) in INSTRUCTIONS.items():
        item = instructions[name]
        assert item['discriminator'] == list(hashlib.sha256(f'global:{name}'.encode()).digest()[:8]), name
        expected=[(meta.rstrip('!+^'), meta.endswith(('!','+')),meta.endswith(('!','^')),False) for meta in metas.split()]
        observed=[(meta['name'],meta.get('writable',False),meta.get('signer',False),meta.get('optional',False)) for meta in flatten(item['accounts'])]
        assert observed == expected, (name, observed, expected)
        assert clean(item['args']) == fields(arguments), name
        assert not item.get('returns'), name
    events = {item['name']: item for item in idl['events']}
    for name in EVENTS:
        assert events[name] == {'name':name,'discriminator':list(hashlib.sha256(f'event:{name}'.encode()).digest()[:8])}, name
    for category, names in [('instructions',INSTRUCTIONS),('accounts',ACCOUNTS),('types',TYPES),('events',EVENTS)]:
        result[category]=[item for item in result[category] if item['name'] not in names]
    return result


def undo_window_delta(actual, program):
    """D108 adds one bounded plan-I/O entrypoint; prior ABI stays byte-identical."""
    if program != 'clearing':
        return actual
    import subprocess
    import json
    from anchor_rc2_wire_contract import clean
    predecessor = json.loads(subprocess.check_output([
        'git', 'show', '0ca99277a95452ac400e6e11b67d49f23cf5d77d:packages/sdk/idl/clearing.json']))
    expected = deepcopy(next(item for item in predecessor['instructions'] if item['name'] == 'continue_settlement_plan'))
    name = 'continue_settlement_plan_window'
    expected['name'] = name
    expected['discriminator'] = list(hashlib.sha256(f'global:{name}'.encode()).digest()[:8])
    expected['args'] = fields('epoch:u64 revision:u64 attempt:u64 steps:u16') + [
        {'name': 'pages', 'type': {'vec': {'defined': {'name': 'SettlementPageAccess'}}}}]
    assert sum(item['name'] == name for item in actual['instructions']) == 1
    assert sum(item['name'] == 'SettlementPageAccess' for item in actual['types']) == 1
    observed = next(item for item in actual['instructions'] if item['name'] == name)
    assert clean(observed) == clean(expected), 'D108 bounded window instruction/authority delta'
    access = next(item for item in actual['types'] if item['name'] == 'SettlementPageAccess')
    assert clean(access) == {'name': 'SettlementPageAccess', 'type': {'kind': 'struct',
        'fields': fields('register:u32 page_index:u64 writable:bool revision:u64')}}, 'D108 descriptor layout'
    result = deepcopy(actual)
    result['instructions'] = [item for item in result['instructions'] if item['name'] != name]
    result['types'] = [item for item in result['types'] if item['name'] != 'SettlementPageAccess']
    assert clean(result) == clean(predecessor), 'D108 changed the preexisting ABI'
    return result
