"""Evaluate the predeclared G22 gates from three actual fresh RPC runs.

No benchmark population is inferred from historical acceptance counts. Raw runs
stay local; this prints a concise, reproducible comparison for the tracked report.
"""
import collections
from fractions import Fraction
import json
import math
from pathlib import Path
import sys


def quantile(values, percentile):
    ordered = sorted(values)
    if not ordered:
        return None
    return ordered[max(0, math.ceil(len(ordered) * percentile / 100) - 1)]


def summarize(run):
    offers, checks = run['offers'], run['checks']
    assert len(offers) == 240 and [offer['index'] for offer in offers] == list(range(240))
    assert run['seed'] == 2902 and run['trackedDirty'] is False
    assert run['unexpectedFinancialDifferences'] == 0
    assert run['elapsedMs'] < 125000
    assert all(check['computeUnits'] * 5 <= check['computeUnitLimit'] * 4 for check in checks)
    assert all(check['bytes'] <= (1232 if check['version'] == 0 else 4096) for check in checks)
    assert all(check['loadedAccounts'] <= 32 for check in checks)
    for offer in offers:
        if offer.get('finalError'):
            # Only explicit quote/source fences near injected transitions can
            # explain an at-construction eligible route rejection. Arithmetic,
            # financial-admission and unknown failures never become a pass merely
            # because their percentage is small.
            code = offer['finalError'].get('InstructionError', [None, {}])[1].get('Custom')
            assert code in {6112, 6113, 6115, 6118, 6124}, 'Unexplained route failure'
            assert 59000 <= offer['startedMs'] <= 80000 or 89000 <= offer['startedMs'] <= 108000
    outcomes = collections.Counter(offer['reason'] or ('filled' if offer.get('finalError') is None and offer['attempted'] else 'unclassified') for offer in offers)
    assert outcomes['unclassified'] == 0
    rows = {}
    for kind in ('ordinary', 'source-pause', 'updater-pause', 'quarantine'):
        selected = [offer for offer in offers if offer['window'] == kind]
        rows[kind] = dict(offered=len(selected), eligible=sum(offer['eligible'] for offer in selected),
                          filled=sum(offer['attempted'] and offer.get('finalError') is None for offer in selected))
    route_checks = [check for check in checks if check['label'].startswith('offered route ')]
    return dict(denominators=run['denominators'], reasons=dict(outcomes), windows=rows,
                route_cu_max=max(check['computeUnits'] for check in route_checks),
                route_bytes_max=max(check['bytes'] for check in route_checks),
                recorded_harness_fees_lamports=str(sum(int(check['feeLamports']) for check in checks)),
                route_fees_lamports=str(sum(int(check['feeLamports']) for check in route_checks)),
                taker_fee_atoms=run['totalFees'], reprices_after_consumption=run['repricesAfterConsumption'],
                structural_rejections=run['strictEpochRejections'],
                schedule_lag_p95_ms=quantile([row['lagMs'] for row in run['schedules']], 95),
                maximum_offer_lag_ms=max(offer['lagMs'] for offer in offers))


def lock_sets(directory, run):
    """Extract actual static writable keys; v0/v1 runs use no lookup tables."""
    groups, all_keys = {}, {}
    for index, check in enumerate(run['checks']):
        label = check['label']
        kind = ('route' if label.startswith('offered route ') else 'reprice' if label == 'continuation reprice batch'
                else 'publisher' if label == 'continuation publisher reports'
                else 'legacy-funding' if label == 'continuation legacy funding sample' else None)
        if kind is None:
            continue
        transaction = json.loads((directory / f'transaction-{index}.json').read_text())
        message = transaction['transaction']['message']
        header, keys = message['header'], message['accountKeys']
        signed = header['numRequiredSignatures']
        writable = keys[:signed-header['numReadonlySignedAccounts']] + keys[signed:len(keys)-header['numReadonlyUnsignedAccounts']]
        assert not transaction['meta'].get('loadedAddresses', {}).get('writable')
        groups.setdefault(kind, []).append(set(writable))
        all_keys.setdefault(kind, set()).update(keys)
    unions = {kind: set.union(*populations) for kind, populations in groups.items()}
    intersections = {f'route/{kind}': sorted(unions['route'] & values) for kind, values in unions.items() if kind != 'route'}
    conflicts = {f'route/{kind}': sorted((all_keys['route'] & writable) | (unions['route'] & all_keys[kind]))
                 for kind, writable in unions.items() if kind != 'route'}
    return dict(unions={kind: sorted(values) for kind, values in unions.items()},
                maximum_writable_counts={kind: max(map(len, values)) for kind, values in groups.items()},
                write_write_intersections=intersections, potential_read_write_conflicts=conflicts,
                observed_account_in_use=sum(check['error'] == 'AccountInUse' for check in run['checks']),
                transport_retries=0, note='One shared test fee payer is included. Logical report/control races are classified separately.')


def compare(runs):
    assert [run['profile'] for run in runs] == ['baseline', 'control', 'treatment']
    assert all(run['host'] == runs[0]['host'] for run in runs)
    assert runs[1]['build'] == runs[2]['build'], 'Same canonical binaries'
    summaries = {run['profile']: summarize(run) for run in runs}
    matched = [index for index in range(240) if all(run['offers'][index]['window'] == 'ordinary'
               and run['offers'][index]['attempted'] and run['offers'][index].get('finalError') is None for run in runs[:2])]
    assert len(matched) >= 100, f'Only {len(matched)} comparable attempts'
    latencies = [[run['offers'][index]['signedToConfirmedMs'] for index in matched] for run in runs[:2]]
    p95 = [quantile(population, 95) for population in latencies]
    latency_pass = p95[1] <= p95[0] * 1.25
    rates = [Fraction(run['denominators']['finalized'], run['denominators']['eligible']) for run in runs]
    success_pass = rates[1] >= rates[0] - Fraction(5, 100) and rates[2] >= rates[1] - Fraction(5, 100)
    for run in runs[1:]:
        assert run['repricesAfterConsumption'] >= 20 and run['strictEpochRejections'] >= 20
    assert len(runs[2]['depletion']) == 3 and all(row['depleted'] and row['repricePreservedDepletion'] for row in runs[2]['depletion'])
    result = dict(profiles=summaries, matched_ordinary_attempts=len(matched),
                  baseline_signed_to_confirmed_ms={f'p{p}': quantile(latencies[0], p) for p in (50, 95, 99)},
                  control_signed_to_confirmed_ms={f'p{p}': quantile(latencies[1], p) for p in (50, 95, 99)},
                  control_p95_ratio=p95[1] / p95[0], latency_gate=latency_pass, success_gate=success_pass,
                  eligible_success_rates=[str(rate) for rate in rates],
                  limitations=['Confirmed RPC observation approximates landing; finalized bytes/status are separately verified.',
                               'The funding authority and cost differ between V3 and V4.',
                               'Internal makers and synthetic collateral; no independent economics or endurance claim.'])
    print(json.dumps(result, indent=2))
    assert latency_pass, 'Control exceeds the predeclared 25% p95 latency threshold'
    assert success_pass, 'Eligible success exceeds the predeclared 5pp regression threshold'
    return result


if __name__ == '__main__':
    assert len(sys.argv) == 4, 'baseline/summary.json control/summary.json treatment/summary.json'
    runs = [json.loads(Path(path).read_text()) for path in sys.argv[1:]]
    result = compare(runs)
    locks = {run['profile']: lock_sets(Path(path).parent, run) for path, run in zip(sys.argv[1:], runs)}
    print(json.dumps({'actual_writable_keys': locks}, indent=2))
