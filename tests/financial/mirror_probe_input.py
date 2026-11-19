"""Build the isolated SBF probe's committed inputs from the complete eight-root book."""
from dataclasses import replace
from fractions import Fraction
from hashlib import sha256
import json
from struct import pack
import sys

from bounded_default_search import FrozenSearch
from frozen_plan_selection import FrozenIdentity, IncomparableFinancialProfiles, select_joint
from test_joint_market_ties import mirror_book
from test_native_protected_receipts import protected_command
from test_scalable_settlement import decode, run


def digest(kind, *fields):
    def canonical(value):
        if isinstance(value, (tuple, list)):
            return [canonical(item) for item in value]
        if isinstance(value, Fraction):
            return str(value)
        return str(value) if isinstance(value, int) else value
    return sha256(json.dumps([kind, canonical(fields)], separators=(',', ':')).encode()).digest()


def probe_input(venue, episode, fees, reverse=False):
    book, exposures = mirror_book()
    book = replace(book, fees=fees)
    identity = FrozenIdentity(venue, episode, tuple(range(8)))
    search = FrozenSearch(book, exposures, identity, bytes(32))
    ordinals = (99, 54) if reverse else (54, 99)
    plans = [search.candidate(ordinal) for ordinal in ordinals]
    baseline = search.baseline
    # Verify actual native cash, both flows per root and insurance, including
    # original and adjusted own-cash sources, before encoding test inputs.
    checks = [(book, baseline), *((plan.book, plan.payout) for plan in plans)]
    for line, (_, payout) in zip(run([protected_command(book, item) for item, _ in checks]), checks, strict=True):
        native = decode(line)
        assert (native['cash'], native['movements'], native['spent']) == (
            payout.cash, payout.claim_cash_movements, payout.insurance_spent)

    def receipt(payout, i, m):
        exact = payout.benchmark
        return (exact.rates[m], exact.collections[i][m], exact.debtor_writeoffs[i][m],
                exact.creditor_impairments[i][m], exact.cash_entitlements[i],
                payout.claim_cash_movements[i][m], payout.cash[i])

    wire = bytearray()
    for m, exposure in enumerate(exposures):
        wire += digest('frozen-market', exposure.mark, book.fees[m], book.insurance[m], book.pools[m],
                       baseline.benchmark.rates[m], baseline.insurance_spent[m], baseline.effective_insurance_budgets[m])
    for plan in plans:
        for m, leg in enumerate(plan.markets):
            wire += digest('settled-market', plan.payout.benchmark.rates[m], plan.payout.effective_insurance_budgets[m],
                           leg.deviation, leg.charged, sum(q for pair in leg.pairs for q, _ in pair.fills))
    for plan in plans:
        for m in range(2):
            assert Fraction(plan.recovered[m]).denominator == 1
            wire += pack('<QQ', int(plan.recovered[m]), plan.payout.insurance_spent[m])
    for i, account in enumerate(book.accounts):
        wire += pack('<Q', identity.member_ids[i])
        for m, exposure in enumerate(exposures):
            wire += digest('frozen-member', account.cash, account.claims[m], exposure.lots[i], exposure.entries[i],
                           exposure.unpaid_gains[i], receipt(baseline, i, m))
        for plan in plans:
            for m, leg in enumerate(plan.markets):
                wire += digest('settled-member', leg.claims[i], leg.remaining_lots[i], receipt(plan.payout, i, m))
        for plan in plans:
            wire += pack('<QQ', *(leg.winner_charges[i] for leg in plan.markets))
    for plan in plans:
        pairs = sorted((p.winner, m, p.debtor, p.charge, p.fills) for m, leg in enumerate(plan.markets) for p in leg.pairs)
        wire += pack('B', len(pairs))
        for winner, market, debtor, charge, fills in pairs:
            wire += pack('<BBBQ', winner, market, debtor, charge) + digest('paired-fills', fills)
    try:
        winner = plans.index(select_joint(book, exposures, identity)) + 1
    except IncomparableFinancialProfiles:
        winner = 0
    return dict(input=wire.hex(), winner=winner, ordinal=ordinals[winner-1] if winner else None,
                flat=list(plans[winner-1].payout.cash[-2:]) if winner else None)


if __name__ == '__main__':
    print(json.dumps(probe_input(bytes.fromhex(sys.argv[1]), int(sys.argv[2]), (int(sys.argv[3]), 0),
                                 reverse=sys.argv[4] == 'reverse')))
