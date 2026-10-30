"""Literal independent accounting checks for the declared P33 service scenario.

Reads actual completed evidence; never submits a transaction or calls SDK math.
The eight fills are BTC (5+5+5+5+1+1) lots and ETH (5+5) lots at index +/-2/3.
"""
import json
import sys
from pathlib import Path


def check_traders(state, openings, events):
    scale=10**9
    markets=state['venue']['markets']
    traders={key:dict(cash=1_000_000,lots=[0,0],claims=[0,0],fills=[]) for key,root in state['roots'].items() if root['role']==0}
    assert len(traders)==2
    identities={root['id']:key for key,root in state['roots'].items()}
    indexes=[int(opening['fundingIndexScaled']) for opening in openings]
    sequence=int(openings[0]['cursor']);assert sequence==int(openings[1]['cursor'])
    for event in events:
        change=event['payload'];sequence+=1;assert int(event['cursor'])==sequence
        for value in [change.get('marketState'),(change.get('otherMarketState') or {}).get('value'),change.get('state'),*change.get('markets',[])]:
            if isinstance(value,dict) and 'fundingIndexScaled' in value:
                market=value['index'];updated=int(value['fundingIndexScaled'])
                for trader in traders.values():trader['claims'][market]-=trader['lots'][market]*(updated-indexes[market])
                indexes[market]=updated
        if event['kind']=='LiquidityRouteExecutedV4':
            market=markets.index(change['market']);side=change['side'];lots=int(change['lots'])
            gross=lots*((60000 if market==0 else 30000)+(3 if side==0 else -2))
            assert int(change['grossQuote'])==gross
            fee=(gross+4999)//5000;assert int(change['fee'])==fee
            trader=traders[identities[change['rootStates'][0]['id']]]
            trader['cash']-=fee;trader['lots'][market]+=lots*(1 if side==0 else -1)
            trader['claims'][market]+=gross*scale*(-1 if side==0 else 1)
            trader['fills'].append((market,side,lots))
        elif event['kind']=='AccountFinancialChangedV3':
            assert change['kind']==0 and len(change['roots'])==1
            traders[change['roots'][0]]['cash']-=int(change['amount'])
        elif event['kind']=='AccountCustodyChangedV3':
            assert change['kind']==4
            traders[change['subject']]['cash']+=int(change['amount'])
    assert str(sequence)==state['sequence']
    for key,trader in traders.items():
        root=state['roots'][key]
        assert int(root['cash'])==trader['cash'],'Per-trader funded cash'
        assert trader['lots']==[0,0]
        for index,position in enumerate(root['positions']):
            assert int(position['lots'])==0
            assert int(position['virtualScaled'])==trader['claims'][index],'Per-trader fractional unpaid claim'
        expected=[(0,0,5),(1,0,5),(1,1,5),(0,1,5),(0,0,1),(0,1,1)] if root['mode']==0 else [(0,0,5),(0,1,5)]
        assert trader['fills']==expected
    return traders


def check(path):
    run = json.loads(Path(path).read_text())
    assert run['trackedDirty'] is False
    assert len(run['browser']) == 10 and len(run['wallets']) == 2
    assert all(row['status'] in ('finalized', 'failed') for row in run['intents'])
    assert run['reconciliation']['unallocatedSurplus'] == '0'
    state = run['state']
    directory = Path(path).parent
    inputs = [json.loads((directory / f'maker-{index}-0-economics-input.json').read_text()) for index in (0, 1)]
    assert inputs[0]['events'] == inputs[1]['events']
    check_traders(state, [value['opening'] for value in inputs], inputs[0]['events'])
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
    assert sum(int(root['cash']) for root in state['roots'].values()) == 8_000_000-7-btc_fees-eth_fees
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
