"""Independent current raw-byte custody audit. Imports no SDK/program math."""
import base64
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys

ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'


def key(raw):
    number = int.from_bytes(raw, 'big')
    result = ''
    while number:
        number, digit = divmod(number, 58)
        result = ALPHABET[digit] + result
    return '1' * (len(raw) - len(raw.lstrip(b'\0'))) + result


def integer(raw, offset, size=8, signed=False):
    return int.from_bytes(raw[offset:offset + size], 'little', signed=signed)


def account(report, address, name, size):
    raw = base64.b64decode(report['rawAccounts'][address])
    assert len(raw) == size, (name, len(raw))
    assert raw[:8] == hashlib.sha256(f'account:{name}'.encode()).digest()[:8]
    assert integer(raw, 8, 2) == 6 and integer(raw, 10) > 0
    return raw


def audit(report):
    result = report['result']
    venue = account(report, result['venue'], 'Venue', 329)
    custody = account(report, result['custody'], 'Custody', 83)
    safety = account(report, result['safety'], 'VenueSafety', 85)
    registry = account(report, result['registry'], 'VenueRegistry', 2113)
    assert integer(venue, 18, 2) == 4
    assert key(venue[180:212]) == result['quoteMint']
    assert key(venue[212:244]) == result['vault']
    assert [key(venue[244 + index * 32:276 + index * 32]) for index in range(2)] == result['markets']
    assert venue[308] == 2 and integer(venue, 325, 2) == 2500
    assert all(key(raw[18:50]) == result['venue'] for raw in (custody, safety, registry))
    assert safety[50:52] == bytes([0, 0]), 'new trading or paused custody remains active'
    assert integer(custody, 50) == 0 and integer(custody, 58) == 18
    assert integer(custody, 66) == integer(custody, 74) == 0
    assert integer(registry, 58, 2) == integer(registry, 60, 4) == len(result['roots']) == 5
    assert [key(registry[64 + index * 32:96 + index * 32]) for index in range(5)] == result['roots']
    cash_total = 0
    for index, address in enumerate(result['roots']):
        raw = account(report, address, 'MarginAccount', 978)
        assert key(raw[18:50]) == result['venue']
        assert integer(raw, 116, 2) == index
        assert integer(raw, 121) == 0
        assert raw[129:225] == bytes(96), 'position/claim/funding mutation in custody profile'
        assert integer(raw, 225) == 0 and integer(raw, 289) == 0
        assert raw[297:977] == bytes(680), 'order authority in custody profile'
        assert integer(raw, 281) == 1
        cash_total += integer(raw, 121)
    reserves = []
    for index, address in enumerate(result['ledgers']):
        raw = account(report, address, 'MarketLedger', 117)
        assert key(raw[18:50]) == result['venue'] and key(raw[50:82]) == result['markets'][index]
        assert raw[82] == index and raw[107] == 0
        assert integer(raw, 83) == integer(raw, 99) == 0
        reserves.append(integer(raw, 91))
    assert reserves == [7, 11]
    vault = base64.b64decode(report['rawAccounts'][result['vault']])
    user = base64.b64decode(report['rawAccounts'][result['userToken']])
    assert len(vault) == len(user) == 165
    assert key(vault[:32]) == key(user[:32]) == result['quoteMint']
    assert key(vault[32:64]) == result['venue'] and key(user[32:64]) == result['owner']
    assert integer(vault, 64) == cash_total + sum(reserves) == 18
    assert integer(user, 64) == 2_000_000 - 7 - 11
    assert integer(vault, 64) + integer(user, 64) == 2_000_000
    assert report['wsNotifications'] > 0 and report['checks']
    assert all(check['signature'] and check['bytes'] <= 1232 and check['computeUnits'] <= 320_000 for check in report['checks'])
    assert all((check['status'] == 'pass') == (check['error'] is None) for check in report['checks'])
    return len(report['checks'])


def mutated(report, address, offset):
    result = deepcopy(report)
    raw = bytearray(base64.b64decode(result['rawAccounts'][address]))
    raw[offset] ^= 1
    result['rawAccounts'][address] = base64.b64encode(raw).decode()
    return result


if __name__ == '__main__':
    report = json.loads(Path(sys.argv[1]).read_text())
    count = audit(report)
    result = report['result']
    mutations = [(result['custody'], 58), (result['roots'][0], 137), (result['ledgers'][0], 91),
                 (result['ledgers'][1], 107), (result['vault'], 64), (result['venue'], 325),
                 (result['registry'], 64), (result['safety'], 50)]
    for address, offset in mutations:
        try:
            audit(mutated(report, address, offset))
        except AssertionError:
            pass
        else:
            raise AssertionError(f'auditor accepted mutation at {offset}')
    print(f'Current independent raw-byte audit: {count} signed RPC outcomes, cash/market reserves/token identities; {len(mutations)} mutations rejected')
