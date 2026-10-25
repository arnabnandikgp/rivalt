#!/usr/bin/env python3
"""Independent schema-2 setup auditor. No SDK, Rust, report totals or settlement imports."""
import base64
import copy
import json
import sys
from pathlib import Path

ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
def address_bytes(value):
    number = 0
    for character in value:
        number = number * 58 + ALPHABET.index(character)
    return number.to_bytes(32, 'big')

def audit(report):
    accounts = {key: base64.b64decode(value, validate=True) for key, value in report['rawAccounts'].items()}
    def integer(data, offset, width=8, signed=False):
        return int.from_bytes(data[offset:offset + width], 'little', signed=signed)
    group_key = report['group']
    group = accounts[group_key]
    assert len(group) == 273 and integer(group, 8, 2) == integer(group, 10, 2) == 2
    assert group[204] == 2 and group[229] == 0 and group[230] == 0
    assert [integer(group, offset) for offset in [231, 239, 247, 255, 263]] == [2_002_000_000, 0, 0, 0, 2_002_000_000]
    vault = next(data for key, data in accounts.items() if address_bytes(key) == group[108:140])
    assert len(vault) == 165 and integer(vault, 64) == 2_002_000_000
    cash = 0
    for index, root_key in enumerate(report['roots']):
        root = accounts[root_key]
        assert len(root) == 970 and integer(root, 8, 2) == 2 and root[10:42] == address_bytes(group_key)
        assert integer(root, 108, 2) == index
        assert root[121:217] == bytes(96) and integer(root, 217) == 0 and integer(root, 281) == 0
        expected = 1_000_000 if index < 2 else 500_000_000 if index < 6 else 0
        assert integer(root, 113) == expected
        assert root[110] == (1 if index < 6 else 0)
        assert root[111] == (index % 2 if index < 6 else 255)
        assert root[112] == (1 if 2 <= index < 6 else 0)
        cash += expected
    assert cash == integer(group, 231)
    market_sources = []
    for index, market_key in enumerate(report['markets']):
        market = accounts[market_key]
        assert len(market) == 446 and market[42] == index and market[10:42] == address_bytes(group_key)
        assert integer(market, 51) == (1_000_000 if index == 0 else 100_000)
        assert integer(market, 75, 16, True) == 0 and integer(market, 99) == 0
        reference = 60_000 if index == 0 else 30_000
        assert [integer(market, offset) for offset in [115,123,131]] == [reference, reference * 99 // 100, reference * 101 // 100]
        assert market[331] == 2 and integer(market, 405) == (100 if index == 0 else 200)
        assert integer(market, 429) == 0  # No pre-activation funding coverage.
        sources = [market[offset:offset+32] for offset in [155,187,219,251]]
        market_sources.append(sources)
        for identity, feed_id in zip(sources, [1,2,3,4] if index == 0 else [5,2,6,4]):
            feed = next(data for key, data in accounts.items() if address_bytes(key) == identity)
            assert feed[40:72] == bytes([feed_id]) * 32
            assert len(feed) == 142 and integer(feed,72) > 0 and feed[112] == 2
            assert integer(feed,113,8,True) == (60_000_000_000 if feed_id in [1,3] else 3_000_000_000 if feed_id in [5,6] else 1_000_000)
    assert market_sources[0][0] != market_sources[1][0] and market_sources[0][2] != market_sources[1][2]
    assert market_sources[0][1] == market_sources[1][1] and market_sources[0][3] == market_sources[1][3]
    capital = report['makerCapital']
    assert len(capital) == len(set(capital)) == 4
    registrations = [data for data in accounts.values() if len(data) == 326]
    assert len(registrations) == 4
    assert {data[76:108] for data in registrations} == {address_bytes(key) for key in capital}
    for registration in registrations:
        assert registration[10:42] == address_bytes(group_key) and registration[74] in [0,1] and registration[75] in [0,1]
        assert integer(registration,276) == 2 and integer(registration,308) == integer(registration,316) == 0
        assert registration[324] == 0
    assert report['financialActivation'] is False
    assert all(check['status'] in ['pass','rejected'] and check['bytes'] <= 1232 for check in report['checks'])
    assert all(int(check['computeUnits']) * 5 <= check['declaredComputeUnits'] * 4 for check in report['checks'] if check['status'] == 'pass')

if __name__ == '__main__':
    report = json.loads(Path(sys.argv[1]).read_text())
    audit(report)
    # Mutate actual captured bytes, not derived report totals. Every independent
    # auditor boundary must reject the changed ledger/source identity.
    alterations = [(report['roots'][0],113),(report['roots'][0],121),
                   (report['markets'][1],75),(report['markets'][1],155),
                   (report['group'],255),(report['markets'][1],115)]
    for key, offset in alterations:
        changed = copy.deepcopy(report)
        data = bytearray(base64.b64decode(changed['rawAccounts'][key]))
        data[offset] ^= 1
        changed['rawAccounts'][key] = base64.b64encode(data).decode()
        try:
            audit(changed)
        except (AssertionError, StopIteration):
            pass
        else:
            raise AssertionError(f'auditor accepted mutated field {offset}')
    print('PASS: independent raw-byte audit of two markets, six feeds, four funded capital roots, vault and disabled finance; six byte mutations reject')
