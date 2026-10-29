"""Literal independent accounting checks for the declared P33 service scenario.

Reads actual completed evidence; never submits a transaction or calls SDK math.
The eight fills are BTC (5+5+5+5+1+1) lots and ETH (5+5) lots at index +/-2/3.
"""
import json
import sys
from pathlib import Path


def check(path):
    run = json.loads(Path(path).read_text())
    assert run['trackedDirty'] is False
    assert len(run['browser']) == 10 and len(run['wallets']) == 2
    assert all(row['status'] in ('finalized', 'failed') for row in run['intents'])
    assert run['reconciliation']['surplus'] == '0'
    state = run['state']
    markets = state['venue']['markets']
    # Each exact-base taker execution pays ceil(gross/5000), independently.
    btc_fees = sum((quantity*price+4999)//5000 for quantity, price in
                   [(5, 60003), (5, 59998), (5, 60003), (5, 59998), (1, 60003), (1, 59998)])
    eth_fees = sum((5*price+4999)//5000 for price in (30003, 29998))
    assert (btc_fees, eth_fees) == (267, 61)
    for market, fees in zip(markets, (btc_fees, eth_fees)):
        ledger = next(value for value in state['ledgers'].values() if value['market'] == market)
        assert int(ledger['insurance']) == fees//4
        assert int(ledger['fees']) == fees-fees//4
        assert ledger['insuranceFeeRemainder'] == fees % 4
        assert int(ledger['settlement']) == 0
    # Initial deposits: six makers + two traders, each one million atoms.
    # Lost-ack withdrawal removes seven; browser withdrawal/deposit cancel.
    assert int(state['custody']['allocatedVault']) == 8_000_000-7
    assert int(state['custody']['totalCash']) == 8_000_000-7-btc_fees-eth_fees
    assert sum(int(root['cash']) for root in state['roots'].values()) == int(state['custody']['totalCash'])
    assert len(state['roots']) == 8
    for root in state['roots'].values():
        assert all(int(position['lots']) == 0 for position in root['positions'])
    for index in (0, 1):
        assert sum(int(root['positions'][index]['virtualScaled']) for root in state['roots'].values()) == 0
    assert len(run['economics']) == 6
    for market, lots, notional in zip(markets, (22, 10), (1_320_011, 300_005)):
        reports = [report for report in run['economics'] if report['market'] == market]
        assert len(reports) == 3
        assert sum(int(report['filledLots']) for report in reports) == lots
        assert sum(int(report['grossNotionalAtoms']) for report in reports) == notional
        for report in reports:
            assert report['reconciliation'] == 'pass'
            assert report['fundedPnlAtoms'] == '0' and report['cashAtoms'] == '1000000'
            assert report['providerFeesAtoms'] == '0' and report['inventoryLots'] == '0'
            assert report['hedge']['observedHedges'] is False
            assert report['hedge']['deductedFromReportedPnl'] is False
    assert run['inputReplay']['independentFlatPriceArithmetic'] is True
    for original in [run['faults'][0], run['faults'][1], run['faults'][2]['fault']]:
        assert original['actualSignal'] == 'SIGKILL'
        assert original['droppedAcknowledgement'] and original['persistedBeforeBroadcast']
        assert original['receipt']['status'] in ('finalized', 'failed')
    print(json.dumps({'result': 'pass', 'revision': run['revision'], 'roots': 8,
                      'takerFeesAtoms': [btc_fees, eth_fees], 'insuranceAtoms': [66, 15],
                      'vaultAtoms': '7999993', 'rootCashAtoms': '7999665',
                      'flatInventory': True, 'zeroAggregateUnpaidClaims': True,
                      'internalMakerReports': 6, 'externalMakerQualification': False}))


if __name__ == '__main__':
    check(sys.argv[1])
