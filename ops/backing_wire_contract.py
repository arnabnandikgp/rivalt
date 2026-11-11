"""D102's explicit schema-10 delta over the immutable P55B1 IDLs.

No discriminator, address, argument, PDA hint, error or other privilege changes.
The imported margin layout changes in both maker IDLs too.
"""
from copy import deepcopy
import json
import subprocess
from settlement_wire_contract import fields, PREFIX

PREDECESSOR = 'c6502654922eb349bae344422e4a65765916c64a'


def undo_backing_delta(actual, program):
    from anchor_rc2_wire_contract import clean
    original = json.loads(subprocess.check_output([
        'git', 'show', f'{PREDECESSOR}:packages/sdk/idl/{program}.json']))
    expected = deepcopy(original)
    definitions = {item['name']: item for item in expected['types']}

    def append(name, layout, before=None):
        entries = definitions[name]['type']['fields']
        position = next((i for i, entry in enumerate(entries) if entry['name'] == before), len(entries))
        entries[position:position] = fields(layout)

    append('MarginAccount', 'backing_epochs:u64[2]', 'bump')
    if program == 'clearing':
        append('MarginAccountSnapshot', 'backing_epochs:u64[2]', 'bump')
        append('MarketLedger', 'backing:BackingState', 'bump')
        append('MarketLedgerSnapshot', 'backing:BackingState')
        append('AccountBackingChanged', 'ledger:MarketLedgerSnapshot? margin:pubkey? root_state:MarginAccountSnapshot?')
        for name, layout in {
            'BackingRegion': 'prices:u64[2][2] funding:i128[2][2]',
            'BackingState': 'epoch:u64 safety_epoch:u64 membership_epoch:u64 terms_epoch:u64 config_epochs:u64[2] region:BackingRegion summary:u8[104]',
            'SettlementCertificate': PREFIX + 'market_index:u8 backing_epoch:u64 count:u64 next:u64 complete:bool membership:MembershipState bump:u8',
            'BackingSnapshot': 'schema_version:u16 venue:pubkey market_index:u8 backing_epoch:u64 count:u64 next:u64 complete:bool membership:MembershipState bump:u8',
        }.items():
            definitions[name] = {'name': name, 'type': {'kind': 'struct', 'fields': fields(layout)}}
        instruction = next(item for item in expected['instructions'] if item['name'] == 'check_market_backing')
        next(meta for meta in instruction['accounts'] if meta['name'] == 'ledger')['writable'] = True
    expected['types'] = sorted(definitions.values(), key=lambda item: item['name'])
    # Order of type declarations is not wire data; everything within them is.
    observed = deepcopy(actual)
    observed['types'] = sorted(observed['types'], key=lambda item: item['name'])
    assert clean(observed) == clean(expected), (program, 'D102 explicit ABI delta')
    return original
