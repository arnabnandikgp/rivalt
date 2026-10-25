"""Independent raw-byte custody audit; no SDK/core imports or retained fixture input."""
import base64
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text())
identities = report['result']
raw = {key: base64.b64decode(value) for key, value in report['rawAccounts'].items()}

def unsigned(data, offset, size=8):
    return int.from_bytes(data[offset:offset+size], 'little')

group = raw[identities['group']]
assert len(group) == 273 and unsigned(group, 8, 2) == 2 and unsigned(group, 10, 2) == 2
assert group[204] == 2  # immutable complete two-market registry count
assert group[229] == 0 and group[230] == 0  # custody mode, unpaused
total_cash, pool, insurance, fees, allocated = [unsigned(group, offset) for offset in [231,239,247,255,263]]
assert (total_cash, pool, insurance, fees, allocated) == (0,0,7,0,7)
root_cash = 0
for member_id, address in enumerate(identities['roots']):
    root = raw[address]
    assert len(root) == 970 and unsigned(root,8,2) == 2
    assert unsigned(root,108,2) == member_id
    root_cash += unsigned(root,113)
    assert unsigned(root,113) == 0
    assert root[121:217] == bytes(96), 'cash-only accounts must own no position/claim/funding/generation'
assert root_cash == total_cash
assert unsigned(raw[identities['vault']],64) == allocated
assert unsigned(raw[identities['userToken']],64) == 2_000_000 - 7
registry = raw[identities['registry']]
assert unsigned(registry,42,2) == 5 and unsigned(registry,44,4) == 5
assert report['wsNotifications'] > 0
assert all(row['status'] in ('pass','rejected') and row['signature'] for row in report['checks'])
assert all(row['computeUnits'] <= 320_000 and row['bytes'] <= 1232 for row in report['checks'])
print('PASS: independent V2 raw-byte cash/membership/two-slot audit; V=I=7, owner tokens=1999993')
