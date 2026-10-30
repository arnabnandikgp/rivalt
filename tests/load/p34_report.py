"""Independent final-population and normal-window financial audit.

Consumes actual P34 evidence. No SDK, projection or financial implementation is
imported. Exceptional/default accounting has its own raw-account audit.
"""
import base64
import collections
from datetime import datetime
import json
from fractions import Fraction
from pathlib import Path
import sys
from p32_comparison import quantile, lock_sets

SCALE = 1_000_000_000


def trunc(value, divisor):
    return (1 if value >= 0 else -1) * (abs(value) // divisor)


def decode_base58(value):
    alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    number=0
    for char in value:
        number=number*58+alphabet.index(char)
    return bytes(len(value)-len(value.lstrip('1')))+number.to_bytes((number.bit_length()+7)//8,'big')


def writable_keys(transaction):
    message=transaction['transaction']['message'];header=message['header'];keys=message['accountKeys']
    signed=header['numRequiredSignatures']
    return set(keys[:signed-header['numReadonlySignedAccounts']]+keys[signed:len(keys)-header['numReadonlyUnsignedAccounts']])


def audit_finances(run):
    record = run['serviceReport']
    initial, final = record['opening'], record['state']
    markets = initial['venue']['markets']
    roots = {key: dict(cash=int(root['cash']), positions=[dict(lots=int(position['lots']),
             virtual=int(position['virtualScaled']), checkpoint=int(position['fundingCheckpointScaled']))
             for position in root['positions']], funding=[0, 0], gross=0, lots=0, fills=0)
             for key, root in initial['roots'].items()}
    by_id = {root['id']: key for key, root in initial['roots'].items()}
    indexes = [int(initial['markets'][key]['fundingIndexScaled']) for key in markets]
    maker_states = dict(initial['makers'])
    fees, withdrawals, sequence = [0, 0], 0, int(initial['sequence'])

    def accrue():
        for root in roots.values():
            for market_index, position in enumerate(root['positions']):
                funding = -position['lots'] * (indexes[market_index] - position['checkpoint'])
                position['virtual'] += funding
                root['funding'][market_index] += funding
                position['checkpoint'] = indexes[market_index]

    def check(root_snapshot):
        expected = roots[by_id[root_snapshot['id']]]
        assert expected['cash'] == int(root_snapshot['cash']), 'Funded cash mismatch'
        for index, position in enumerate(root_snapshot['positions']):
            assert expected['positions'][index]['lots'] == int(position['lots'])
            claim = int(position['virtualScaled']) - int(position['lots']) * (indexes[index] - int(position['fundingCheckpointScaled']))
            assert expected['positions'][index]['virtual'] == claim, 'Fractional claim/funding mismatch'

    def fill(key, market_index, delta, gross_delta, fee=0):
        root = roots[key]
        root['cash'] -= fee
        root['positions'][market_index]['lots'] += delta
        root['positions'][market_index]['virtual'] += gross_delta * SCALE
        assert root['cash'] >= 0

    for event in record['journal']:
        change, kind = event['payload'], event['kind']
        sequence += 1
        assert int(event['cursor']) == sequence, 'Missing local journal payload'
        for value in [change.get('marketState'), change.get('otherMarketState'), change.get('state'), *change.get('markets', [])]:
            if isinstance(value, dict) and 'fundingIndexScaled' in value:
                indexes[value['index']] = int(value['fundingIndexScaled'])
        accrue()
        if kind in ('LiquidityRouteExecutedV4', 'AccountRouteExecutedV3'):
            market_index = markets.index(change['market'])
            side, quantity, gross, fee = change['side'], int(change['lots']), int(change['grossQuote']), int(change['fee'])
            assert side in (0, 1) and quantity > 0
            assert fee == (gross + 4999) // 5000
            assert int(change['carryBefore']) == fees[market_index] % 4
            assert int(change['insuranceCredit']) == (fee + fees[market_index] % 4) // 4
            assert int(change['retainedFee']) == fee - int(change['insuranceCredit'])
            fees[market_index] += fee
            assert int(change['carryAfter']) == fees[market_index] % 4
            legs = change.get('legs', [])
            if kind == 'AccountRouteExecutedV3':
                for updated in change['makerStates']:
                    before = next(value for value in maker_states.values() if value['capital'] == updated['capital'])
                    consumed_key = 'buyConsumed' if side == 0 else 'sellConsumed'
                    consumed = int(before[consumed_key])
                    lots = int(updated[consumed_key]) - consumed
                    if not lots:
                        continue
                    maker_id = updated['makerId']
                    inventory = roots[updated['capital']]['positions'][market_index]['lots']
                    skew = trunc(inventory, 64 if maker_id == 0 else 256) * (4 if maker_id == 0 else 1)
                    reference = int(change['marketState']['referencePrice'])
                    total = sum(reference-skew+(1 if side == 0 else -1)*
                                (10+consumed+lot if maker_id == 0 else 30+max(0, consumed+lot-256)) for lot in range(lots))
                    legs.append(dict(capital=updated['capital'], lots=lots, gross=total))
                for updated in change['makerStates']:
                    key = next(key for key, value in maker_states.items() if value['capital'] == updated['capital'])
                    maker_states[key] = updated
            assert sum(int(leg['lots']) for leg in legs) == quantity
            assert sum(int(leg['gross']) for leg in legs) == gross
            trader = by_id[change['rootStates'][0]['id']]
            direction = 1 if side == 0 else -1
            fill(trader, market_index, direction * quantity, -direction * gross, fee)
            for leg in legs:
                key, lots, notional = leg['capital'], int(leg['lots']), int(leg['gross'])
                fill(key, market_index, -direction * lots, direction * notional)
                roots[key]['gross'] += notional
                roots[key]['lots'] += lots
                roots[key]['fills'] += 1
        elif kind == 'AccountFinancialChangedV3':
            assert change['kind'] == 0, 'Undeclared transfer/settlement path in comparison'
            assert len(change['roots']) == 1
            amount = int(change['amount'])
            roots[change['roots'][0]]['cash'] -= amount
            withdrawals += amount
        elif kind == 'AccountMakerChangedV3':
            updated = change['state']
            key = next(key for key, value in maker_states.items() if value['capital'] == updated['capital'])
            maker_states[key] = updated
        else:
            assert kind in ('AccountOrderChangedV3', 'AccountOracleChangedV3', 'LiquidityMakerChangedV4',
                            'FundingReportAcceptedV4', 'FundingPublisherChangedV4'), kind
        for value in change.get('rootStates', []):
            check(value)
        if kind == 'AccountOrderChangedV3':
            check(change['state'])
    assert sequence == int(final['sequence'])
    for index, market in enumerate(markets):
        indexes[index] = int(final['markets'][market]['fundingIndexScaled'])
    accrue()
    for root in final['roots'].values():
        check(root)
    assert withdrawals == 2
    cash = sum(root['cash'] for root in roots.values())
    assert cash + sum(fees) + withdrawals == 3_004_000_000
    assert cash == int(final['custody']['totalCash'])
    assert int(record['reconciliation']['actualVault']) == 3_004_000_000 - withdrawals
    assert record['reconciliation']['unallocatedSurplus'] == '0'
    for index, market in enumerate(markets):
        ledger = next(value for value in final['ledgers'].values() if value['market'] == market)
        assert int(ledger['insurance']) == fees[index] // 4
        assert int(ledger['fees']) == fees[index] - fees[index] // 4
        assert ledger['insuranceFeeRemainder'] == fees[index] % 4
        assert sum(root['positions'][index]['lots'] for root in roots.values()) == 0
        assert sum(root['positions'][index]['virtual'] for root in roots.values()) == 0
    makers = []
    for key, original in initial['roots'].items():
        if original['role'] != 1:
            continue
        root = roots[key]
        market_index = original['isolatedMarketIndex']
        position = root['positions'][market_index]
        reference = int(final['markets'][markets[market_index]]['referencePrice'])
        assert root['cash'] == int(original['cash']), 'No fabricated funded maker profit'
        makers.append(dict(capital=key, market=markets[market_index], fills=root['fills'], filled_lots=str(root['lots']),
                           notional_atoms=str(root['gross']), inventory_lots=str(position['lots']), funded_pnl_atoms='0',
                           unpaid_pnl_scaled=str(position['virtual']+position['lots']*reference*SCALE),
                           funding_pnl_scaled=str(root['funding'][market_index]), provider_fee_atoms='0',
                           assumed_hedge_cost_scaled=str(root['gross']*SCALE//10000),
                           hedge_assumption_bps=1, observed_hedges=False, hedge_cost_deducted=False))
    assert len(makers) == 6
    return dict(result='pass', fee_atoms=list(map(str, fees)), withdrawn_atoms='2', cash_atoms=str(cash),
                exact_fractional_conservation=True, internal_makers=makers)


def quality_by_size(offers):
    result={}
    for market in (0,1):
        for mode in ('isolated','cross'):
            for size in (1,2,4,8,16):
                selected=[offer for offer in offers if offer['marketIndex']==market and offer['mode']==mode and int(offer['lots'])==size]
                successful=[offer for offer in selected if offer['attempted'] and not offer.get('finalError')]
                reference=60000 if market==0 else 30000
                notional=cost=drift=0
                for offer in successful:
                    gross=int(offer['landedGross']);fee=(gross+4999)//5000
                    notional+=size*reference
                    cost+=(gross-size*reference if offer['side']==0 else size*reference-gross)+fee
                    drift+=int(offer['quoteDriftAtoms'])*(1 if offer['side']==0 else -1)
                result[f'{market}/{mode}/{size}']=dict(offered=len(selected),eligible=sum(o['eligible'] for o in selected),filled=len(successful),
                    reference_notional_atoms=str(notional),all_in_cost_vs_index_atoms=str(cost),
                    all_in_cost_bps_exact=str(Fraction(cost*10000,notional)) if notional else None,
                    adverse_quote_drift_atoms=str(drift))
    return result


def summarize(run, directory):
    offers, checks, services = run['offers'], run['checks'], run['serviceReport']
    assert len(offers) == 600 and [offer['index'] for offer in offers] == list(range(600))
    assert run['seed'] == 2902 and run['trackedDirty'] is False and run['elapsedMs'] < 305000
    assert run['unexpectedFinancialDifferences'] == 0
    assert all(check['computeUnits']*5 <= check['computeUnitLimit']*4 for check in checks)
    assert all(check['bytes'] <= (1232 if check['version'] == 0 else 4096) and check['loadedAccounts'] <= 32 for check in checks)
    assert services['freshReplayIdentical'] and services['counts']['unresolved'] == '0'
    assert {row['kind'] for row in services['incidents']} == {'publisher-restart', 'indexer-restart'}
    assert len(services['operational']) == 4
    assert all(row['status'] in ('finalized', 'failed') for row in services['intents'])
    categories = collections.Counter()
    for offer in offers:
        if offer.get('finalError'):
            code = offer['finalError'].get('InstructionError', [None, {}])[1].get('Custom')
            assert code in {6112, 6113, 6115, 6118, 6124}, 'Unexplained route failure'
            if run['profile']=='baseline' and code==6115:
                check_index=next(index for index,check in enumerate(checks) if check['label']==f"offered route {offer['index']}")
                landed=json.loads((directory/f'transaction-{check_index}.json').read_text())
                selected={leg['instance'] for leg in offer['allocation']['legs']}
                expired=[maker for maker in services['opening']['makers'].values() if maker['marketIndex']==offer['marketIndex']
                         and maker['makerId'] in selected and int(maker['expirySlot'])<=landed['slot']]
                assert expired, 'Legacy MakerQuote failure must have independently observed epoch expiry'
            else:
                assert 59000<=offer['startedMs']<=80000 or 89000<=offer['startedMs']<=108000, 'Failure outside declared transition windows'
        reason = offer['reason'] or ('filled' if offer['attempted'] and not offer.get('finalError') else None)
        assert reason, 'Unclassified opportunity'
        categories[reason] += 1
    successful = [offer for offer in offers if offer['attempted'] and not offer.get('finalError')]
    markouts = {}
    for horizon in (2, 10):
        samples = []
        for offer in successful:
            observation = next(row for row in offer['markouts'] if row['horizonSeconds'] == horizon)
            assert observation['observedAfterMs'] >= horizon * 1000
            amount = int(offer['landedGross'])-int(offer['lots'])*int(observation['referencePrice'])
            samples.append(amount if offer['side'] == 0 else -amount)
        markouts[f'{horizon}s'] = dict(count=len(samples), maker_markout_atoms=str(sum(samples)),
                                     max_observation_delay_ms=max(next(row['observedAfterMs'] for row in offer['markouts'] if row['horizonSeconds']==horizon)-horizon*1000 for offer in successful))
    actual = json.loads((directory/'service-transactions.json').read_text())
    by_id = {row['requestId']: row['payload'] for row in actual}
    service_fees = collections.Counter()
    service_resources=[];publisher_delays=[];publisher_failures=collections.Counter()
    for intent in services['intents']:
        transaction = by_id[intent['request_id']]
        assert transaction['transaction']['signatures'][0] == intent['signature']
        assert transaction['meta']['err'] == intent['result']['error']
        assert int(transaction['meta']['fee']) == int(intent['result']['fee'])
        wire = base64.b64decode(intent['wire'], validate=True)
        assert len(wire) <= 1232, 'Current funding/stored service originals must fit v0'
        assert wire[1+64*wire[0]] == 128
        service_fees[intent['budget']] += int(transaction['meta']['fee'])
        message=transaction['transaction']['message'];keys=message['accountKeys'];limits=[]
        for instruction in message['instructions']:
            if keys[instruction['programIdIndex']]=='ComputeBudget111111111111111111111111111111':
                data=decode_base58(instruction['data'])
                if data[0]==2:limits.append(int.from_bytes(data[1:],'little'))
                if data[0]==3:assert int.from_bytes(data[1:],'little')==0
        assert len(limits)==1
        units=transaction['meta']['computeUnitsConsumed'];assert units*5<=limits[0]*4
        publisher=intent['budget'].startswith('liquidity-funding-')
        assert len(set(keys)) <= (20 if publisher else 32)
        if publisher:assert limits[0]==200000
        service_resources.append(dict(budget=intent['budget'],units=units,limit=limits[0],bytes=len(wire),keys=len(set(keys)),
                                      writable=sorted(writable_keys(transaction))))
        if publisher:
            created=datetime.fromisoformat(intent['created_at'].replace('Z','+00:00')).timestamp()*1000
            # Local chain Clock can lag wall time. Do not subtract blockTime
            # from a database timestamp or clamp negative results to zero.
            # Queue finalization is measured on the same PostgreSQL clock.
            if intent.get('updated_at'):
                resolved=datetime.fromisoformat(intent['updated_at'].replace('Z','+00:00')).timestamp()*1000
                assert resolved>=created
                publisher_delays.append(resolved-created)
            if transaction['meta']['err']:
                code=transaction['meta']['err'].get('InstructionError',[None,{}])[1].get('Custom')
                assert code in (6124,6131), 'Unexplained publisher rejection'
                publisher_failures[str(code)]+=1

    route_checks = [check for check in checks if check['label'].startswith('offered route ')]
    return dict(denominators=run['denominators'], reasons=dict(categories), size_quality=quality_by_size(offers),
                market_modes={f'{market}/{mode}':sum(offer['marketIndex']==market and offer['mode']==mode for offer in offers) for market in (0,1) for mode in ('isolated','cross')},
                build_ms={f'p{p}':quantile([offer['buildMs'] for offer in successful],p) for p in (50,95,99)},
                build_sign_ms={f'p{p}':quantile([check['buildSignMs'] for check in route_checks],p) for p in (50,95,99)},
                landing_ms={f'p{p}':quantile([check['signedToConfirmedMs'] for check in route_checks],p) for p in (50,95,99)},
                max_schedule_lag_ms=max(offer['lagMs'] for offer in offers),
                route_cu_max=max(check['computeUnits'] for check in route_checks),
                route_bytes_max=max(check['bytes'] for check in route_checks),
                fixture_network_fees_lamports=str(sum(int(check['feeLamports']) for check in checks)),
                service_network_fees_lamports={key:str(value) for key,value in service_fees.items()},
                service_resources_by_budget={budget:dict(count=sum(row['budget']==budget for row in service_resources),
                    max_cu=max(row['units'] for row in service_resources if row['budget']==budget),
                    max_bytes=max(row['bytes'] for row in service_resources if row['budget']==budget),
                    max_keys=max(row['keys'] for row in service_resources if row['budget']==budget),
                    writable_union=sorted(set().union(*(set(row['writable']) for row in service_resources if row['budget']==budget)))) for budget in service_fees},
                publisher_rejections=dict(publisher_failures),
                publisher_persist_to_final_receipt_ms={f'p{p}':quantile(publisher_delays,p) for p in (50,95,99)} if publisher_delays else None,
                publisher_timing_scope='PostgreSQL original persistence to finalized receipt; not first landing',
                funding_coverage={market:dict(covered_seconds=int(services['state']['markets'][market]['oracle']['coveredSeconds'])-int(services['opening']['markets'][market]['oracle']['coveredSeconds']),
                    skipped_seconds=int(services['state']['markets'][market]['oracle']['skippedSeconds'])-int(services['opening']['markets'][market]['oracle']['skippedSeconds']),
                    scope='service opening through markout and receipt drain; not exactly the 300-second offer window') for market in services['state']['venue']['markets']},
                reprice_build_sign_ms={f'p{p}':quantile([check['buildSignMs'] for check in checks if check['label']=='continuation reprice batch'],p) for p in (50,95,99)},
                reprice_landing_ms={f'p{p}':quantile([check['signedToConfirmedMs'] for check in checks if check['label']=='continuation reprice batch'],p) for p in (50,95,99)},
                markouts=markouts, independent_finances=audit_finances(run),
                locks=lock_sets(directory,run), retained_publisher_reports=services['retainedReports'])


def compare(paths):
    runs = [json.loads(path.read_text()) for path in paths]
    assert [run['profile'] for run in runs] == ['baseline','control','treatment']
    assert all(run['host']==runs[0]['host'] for run in runs)
    assert runs[1]['build']==runs[2]['build']
    summaries = {run['profile']:summarize(run,path.parent) for run,path in zip(runs,paths)}
    matched = [index for index in range(600) if all(run['offers'][index]['window']=='ordinary' and run['offers'][index]['attempted'] and not run['offers'][index].get('finalError') for run in runs[:2])]
    assert len(matched)>=100, 'Insufficient matched population'
    latencies = [[run['offers'][index]['signedToConfirmedMs'] for index in matched] for run in runs[:2]]
    p95 = [quantile(values,95) for values in latencies]
    rates = [Fraction(run['denominators']['finalized'],run['denominators']['eligible']) for run in runs]
    for run in runs[1:]:
        assert run['repricesAfterConsumption']>=20 and run['strictEpochRejections']==20
    assert len(runs[2]['depletion'])==3 and all(row['depleted'] and row['repricePreservedDepletion'] for row in runs[2]['depletion'])
    result = dict(profiles=summaries,matched_attempts=len(matched),baseline_p95_ms=p95[0],control_p95_ms=p95[1],
                  control_p95_ratio=p95[1]/p95[0],latency_gate=p95[1]<=p95[0]*1.25,
                  success_gate=rates[1]>=rates[0]-Fraction(5,100) and rates[2]>=rates[1]-Fraction(5,100),
                  eligible_success_rates=list(map(str,rates)),independent_maker_validation=False,endurance_24h=False)
    print(json.dumps(result,indent=2))
    assert result['latency_gate'] and result['success_gate'], 'Predeclared comparative gate failed'
    return result


if __name__=='__main__':
    if len(sys.argv)==2:
        path=Path(sys.argv[1]);run=json.loads(path.read_text());print(json.dumps(summarize(run,path.parent),indent=2))
    else:
        assert len(sys.argv)==4,'baseline/summary.json control/summary.json treatment/summary.json'
        compare([Path(value) for value in sys.argv[1:]])
