"""D101's explicit, incompatible schema-9 delta over the immutable P55A1 IDL.

The predecessor is never recaptured. Unchanged types, instructions, errors and
addresses remain exact. New contexts pin every ordered privilege and argument;
PDA/authority execution additionally requires signed negative acceptance.
"""
from copy import deepcopy
import hashlib
import json
import subprocess
from settlement_wire_contract import fields, PREFIX, INSTRUCTIONS as PAGED

PREDECESSOR = '7b0ab0716810c6894064cc1a11fc5da27ed54a3a'
REMOVED_INSTRUCTIONS = set('advance_account_resolution check_account_resolution_order finalize_account_resolution_rates initialize_account_resolution_page initialize_prepared_index_node initialize_prepared_members order_account_resolution propose_account_resolution round_account_resolution'.split())
REMOVED_TYPES = {'ResolutionPage', 'ResolutionRow', 'ResolutionWork', 'Wide'}
NEW_ACCOUNTS = {'RecoveryStorage', 'StorageFunding', 'StorageTombstone', 'MarginTombstone'}
NEW_EVENTS = {'MarginMembershipChanged', 'RecoveryStorageRefunded'}
LAYOUTS = {
 'VenueRegistry': PREFIX+'membership_epoch:u64 next_id:u64 registered_count:u64 financial_count:u64 live_index:pubkey bump:u8',
 'Portfolio': PREFIX+'owner:pubkey index:u32 active_children:u32 bump:u8',
 'MembershipState': 'checkpoint:u8[544]',
 'MarginTombstone': PREFIX+'portfolio:pubkey owner:pubkey child:u32 id:u64 activation_generation:u64 bump:u8',
 'RecoveryStorage': PREFIX+'ready_capacity:u64 target_capacity:u64 next_allocation:u64 generation:u64 locked_epoch:u64 completed_epoch:u64 bump:u8',
 'StorageFunding': PREFIX+'allocation:pubkey rent_payer:pubkey contributed_lamports:u64 bump:u8',
 'StorageTombstone': PREFIX+'original_kind:u8 completed_epoch:u64 register:u32 page_index:u64 bump:u8',
 'MarginMembershipChanged': 'venue:pubkey slot:u64 margin:pubkey portfolio:pubkey owner:pubkey id:u64 lifecycle:u8 activation_generation:u64 nonce:u64 state_version:u64 delegate_epoch:u64 membership_epoch:u64 registered_count:u64 financial_count:u64 next_id:u64 refunded_lamports:u64',
 'RecoveryStorageRefunded': 'venue:pubkey slot:u64 allocation:pubkey rent_payer:pubkey original_kind:u8 register:u32 page_index:u64 completed_epoch:u64 refunded_lamports:u64 retained_lamports:u64',
 # Frozen source is scalar. The paged plan exclusively owns partial Apply progress.
 'Resolution': PREFIX+'epoch:u64 stage:u8 cursor:u64 count:u64 registry_hash:u8[32] membership_epoch:u64 live_index:pubkey safety_epoch:u64 terms_epoch:u64 config_epochs:u64[2] source_observations:u64[2] source_deadlines:i64[2] prices:u64[2] funding:i128[2] frozen_at:i64 cash_before:u64 pools_before:u64[2] insurance_before:u64[2] fees_before:u64[2] allocated_before:u64 scanned_cash:u64 scanned_lots:i128[2] scanned_gross:u64[2] claim_sums:i128[2] positive_scaled:u128[2] budgets:u64[2] insurance_spent:u64[2] cash_applied:u64 remaining_lots:i128[2] remaining_gross:u64[2] remaining_claims:i128[2] bump:u8',
}
TAIL='event_authority program'
MEMBER=f'owner^ venue safety registry+ portfolio margin+ members+ storage binding {TAIL}'
INSTRUCTIONS={
 'initialize_recovery_storage':(f'authority! venue safety storage+ system_program {TAIL}',''),
 'begin_recovery_provision':(f'authority^ venue safety storage+ {TAIL}','capacity:u64 revision:u64'),
 'cancel_recovery_provision':(f'authority^ venue safety storage+ {TAIL}','generation:u64 revision:u64'),
 'fund_recovery_allocation':(f'payer! venue safety storage allocation+ receipt+ system_program {TAIL}','kind:u8 register:u32 page:u64 generation:u64 ordinal:u64'),
 'verify_recovery_allocation':(f'venue safety storage+ allocation receipt {TAIL}','generation:u64 ordinal:u64 revision:u64'),
 'refund_recovery_allocation':(f'authority^ venue safety storage+ allocation+ receipt rent_payer+ {TAIL}','kind:u8 register:u32 page:u64 revision:u64'),
 'fund_member_page':(f'payer! venue safety allocation+ receipt+ system_program {TAIL}','page_index:u64'),
 'fund_member_index':(f'payer! venue safety allocation+ receipt+ system_program {TAIL}','level:u8 prefix:u64'),
 'activate_margin':(MEMBER,'revision:u64 membership_epoch:u64 safety_epoch:u64 index_revisions:u64[15]'),
 'deactivate_margin':(MEMBER,'revision:u64 membership_epoch:u64 safety_epoch:u64 index_revisions:u64[15]'),
 'retire_margin':(f'owner! venue safety registry+ portfolio+ margin+ members+ binding {TAIL}','revision:u64 safety_epoch:u64'),
 'create_portfolio':(f'owner! venue custody safety portfolio+ system_program {TAIL}','index:u32'),
 'register_margin':(f'owner! venue custody safety registry+ portfolio+ margin+ members+ system_program {TAIL}','subaccount_index:u32 mode:u8 isolated_market_index:u8 role:u8'),
 'initialize_account_resolution':(f'payer! venue custody safety resolution+ system_program {TAIL}',''),
 'check_market_backing':(f'venue safety registry btc eth ledger certificate+ {TAIL}','revision:u64 restart:bool'),
 'check_account_retirement':(f'venue+ custody+ safety+ btc+ eth+ btc_ledger+ eth_ledger+ vault registry certificate+ {TAIL}','revision:u64 restart:bool'),
 'activate_liquidity':(f'authority^ venue custody safety+ btc+ eth+ btc_ledger eth_ledger vault {TAIL} resolution registry storage',''),
 'freeze_accounts':(f'venue+ custody+ safety+ btc+ eth+ btc_ledger+ eth_ledger+ vault caller^ registry resolution+ target members storage+ primary_btc primary_collateral guard_btc guard_collateral primary_eth guard_eth {TAIL}','safety_epoch:u64 resolution_epoch:u64 emergency:bool'),
}
# Existing paged arithmetic is unchanged. Workspace is now prefunded, reusable,
# and locked by the frozen epoch; initializers no longer allocate through payer.
for name,(metas,args) in PAGED.items():
 if name in REMOVED_INSTRUCTIONS: continue
 metas=metas.removeprefix('payer! ').replace('registry resolution','registry storage resolution')
 if name=='complete_settlement_plan': metas=metas.replace('storage resolution','storage+ resolution')
 INSTRUCTIONS[name]=(metas,args)

DOMAINS_ADDED={'recovery-storage','storage-funding','rivalt-financial-membership-v1'}
DOMAINS_REMOVED={'resolution-page-v3','resolution-work-v3'}


def context_metadata(name):
 """Literal RC2 PDA hints and has-one relations for the approved new contexts."""
 def const(value):return {'kind':'const','value':list(value.encode())}
 def account(value):return {'kind':'account','path':value}
 def arg(value):return {'kind':'arg','path':value}
 seeds={key:[const(label),account(parent)] for key,label,parent in (
  ('custody','custody-v3','venue'),('safety','safety-v3','venue'),('registry','registry-v3','venue'),
  ('storage','recovery-storage','venue'),('resolution','resolution-v3','venue'),('vault','vault-v3','venue'),
  ('btc_ledger','ledger-v3','btc'),('eth_ledger','ledger-v3','eth'))}
 seeds.update({key:[const('market-v3'),account('venue'),{'kind':'const','value':[index]}] for index,key in enumerate(('btc','eth'))})
 seeds.update(event_authority=[const('__event_authority')],receipt=[const('storage-funding'),account('venue'),account('allocation')],
  portfolio=[const('portfolio-v3'),account('venue'),account('owner'),arg('index')],
  margin=[const('margin-v3'),account('portfolio'),arg('subaccount_index')])
 source='custody safety registry storage resolution btc eth btc_ledger eth_ledger'
 financial='custody safety btc eth btc_ledger eth_ledger'
 if name in PAGED:
  pda_keys=source+' vault';relations={'venue':source.split()}
 elif name in ('activate_liquidity','check_account_retirement','freeze_accounts'):
  pda_keys=financial+' vault';relations={'venue':financial.split(),'vault':['venue']}
  if name=='activate_liquidity':relations['authority']=['venue']
 elif name in ('activate_margin','deactivate_margin'):
  pda_keys='safety registry storage';relations={'owner':['portfolio','margin'],'portfolio':['margin'],
   'venue':'safety registry portfolio margin members storage'.split()}
 elif name=='check_market_backing':
  pda_keys='safety registry btc eth';relations={'venue':'safety registry btc eth ledger certificate'.split()}
 elif name=='create_portfolio':pda_keys='custody safety portfolio';relations={'venue':['custody','safety']}
 elif name=='register_margin':pda_keys='custody safety registry margin';relations={'owner':['portfolio'],'venue':'custody safety registry portfolio members'.split()}
 elif name=='retire_margin':pda_keys='safety registry';relations={'owner':['portfolio'],'venue':'safety registry portfolio members'.split()}
 elif name=='initialize_account_resolution':pda_keys='custody safety resolution';relations={'venue':['custody','safety']}
 elif name in ('fund_member_page','fund_member_index'):pda_keys='safety receipt';relations={'venue':['safety']}
 else:
  pda_keys='safety storage';relations={'venue':['safety','storage']}
  if name in ('initialize_recovery_storage','begin_recovery_provision','cancel_recovery_provision','refund_recovery_allocation'):
   relations['authority']=['venue']
  if name=='initialize_recovery_storage':relations['venue']=['safety']
  if name in ('fund_recovery_allocation','verify_recovery_allocation','refund_recovery_allocation'):pda_keys+=' receipt'
  if name in ('verify_recovery_allocation','refund_recovery_allocation'):relations['venue'].append('receipt')
  if name=='refund_recovery_allocation':relations['rent_payer']=['receipt']
 result={key:{'pda':{'seeds':seeds[key]}} for key in (pda_keys+' event_authority').split()}
 for key,value in relations.items():result.setdefault(key,{})['relations']=value
 if 'system_program' in INSTRUCTIONS[name][0].split():result['system_program']={'address':'11111111111111111111111111111111'}
 return result


def undo_membership_delta(actual,program):
 from anchor_rc2_wire_contract import clean, flatten
 original=json.loads(subprocess.check_output(['git','show',f'{PREDECESSOR}:packages/sdk/idl/{program}.json']))
 for category in ('types','instructions','accounts','events','errors'):
  assert len({x['name'] for x in actual[category]})==len(actual[category]),(program,category,'duplicate declaration')
 expected=deepcopy(original)
 definitions={item['name']:clean(item) for item in expected['types']}
 def change(name,updates=None,append='',before=None,remove=()):
  entries=definitions[name]['type']['fields']
  for entry in entries:
   if entry['name'] in (updates or {}): entry['type']=updates[entry['name']]
  entries[:]=[entry for entry in entries if entry['name'] not in remove]
  index=next((index for index,item in enumerate(entries) if item['name']==before),len(entries))
  entries[index:index]=fields(append)
 for name in ('MarginAccount','MarginAccountSnapshot','AccountCashSnapshot'):
  if name in definitions:change(name,{'subaccount_index':'u32','id':'u64'},'lifecycle:u8 activation_generation:u64','bump')
 if program=='clearing':
  for name in REMOVED_TYPES: del definitions[name]
  for name,layout in LAYOUTS.items():
   definitions[name]={'name':name,'type':{'kind':'struct','fields':fields(layout)}}
  for name in ('SettlementCertificate','RetirementCertificate','BackingSnapshot','AccountRetirementProgress'):
   change(name,{'count':'u64','next':'u64'},'membership:MembershipState','bump')
  for name in ('AccountsRetired','AccountResolutionFrozen'):change(name,{'count':'u64'})
  for name in ('AccountResolutionApplied','AccountResolutionPlanned','AccountResolutionValued'):change(name,{'id':'u64'})
  change('AccountCustodyChanged',{'index':'u32','member_count':{'option':'u64'}})
  entries=definitions['AccountCustodyChanged']['type']['fields'];index=next(i for i,x in enumerate(entries) if x['name']=='actual_vault')
  entries[index:index]=[{'name':name,'type':{'option':'u64'}} for name in ('registered_count','next_member_id')]
  change('PreparedSettlement',remove=('index_initialized','member_page_initialized'))
 assert {x['name']:clean(x) for x in actual['types']}==definitions,(program,'D101 type layouts')
 for category,added,removed,namespace in (
  ('accounts',NEW_ACCOUNTS,{'ResolutionPage','ResolutionWork'},'account'),('events',NEW_EVENTS,set(),'event')):
  entries={x['name']:clean(x) for x in original[category]}
  if program=='clearing':
   for name in removed:del entries[name]
   for name in added:entries[name]={'name':name,'discriminator':list(hashlib.sha256(f'{namespace}:{name}'.encode()).digest()[:8])}
  assert {x['name']:clean(x) for x in actual[category]}==entries,(program,category)
 instructions={x['name']:x for x in actual['instructions']};prior={x['name']:x for x in original['instructions']}
 delta=INSTRUCTIONS if program=='clearing' else {}
 removed=REMOVED_INSTRUCTIONS if program=='clearing' else set()
 assert set(instructions)==(set(prior)-removed)|set(delta),(program,'instruction membership')
 for name,item in instructions.items():
  if name not in delta:assert clean(item)==clean(prior[name]),(program,name);continue
  metas,args=delta[name]
  assert item['discriminator']==list(hashlib.sha256(f'global:{name}'.encode()).digest()[:8]),name
  observed=[(m['name'],m.get('writable',False),m.get('signer',False),m.get('optional',False)) for m in flatten(item['accounts'])]
  expected_metas=[(m.rstrip('!+^'),m.endswith(('!','+')),m.endswith(('!','^')),False) for m in metas.split()]
  assert observed==expected_metas,(name,observed,expected_metas)
  metadata={m['name']:{k:v for k,v in clean(m).items() if k not in ('name','signer','writable','optional')} for m in flatten(item['accounts'])}
  assert {k:v for k,v in metadata.items() if v}==context_metadata(name),(name,'PDA/relations metadata')
  assert clean(item['args'])==fields(args),(name,'args')
  assert not item.get('returns'),name
 assert actual['address']==original['address'] and actual['errors']==original['errors'],program
 return original
