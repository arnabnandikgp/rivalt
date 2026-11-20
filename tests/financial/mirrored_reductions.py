"""Check an exact BTC/ETH reflection on complete, already verified plans."""
from collections import Counter, defaultdict


def _edges(plan):
    return {(pair.debtor, pair.winner, market): (pair.charge, pair.fills)
            for market, result in enumerate(plan.markets) for pair in result.pairs}


def _receipt(payout, member, market):
    rational = payout.benchmark
    return (rational.collections[member][market], rational.debtor_writeoffs[member][market],
            rational.creditor_impairments[member][market], rational.cash_entitlements[member],
            payout.claim_cash_movements[member][market], payout.cash[member])


def exact_market_mirror(book, exposures, baseline, first, second):
    """Find an involution exchanging both markets, every paired fill and each receipt.

    Member identities stay fixed for final priority. The permutation is evidence
    of financial symmetry only. Duplicate economic rows can have different
    counterparties, so matching row totals alone is insufficient.
    """
    if (first.recovered != second.recovered or exposures[0].mark != exposures[1].mark
            or first.payout.insurance_spent != second.payout.insurance_spent):
        return False
    for amounts in (book.pools, book.insurance, book.fees, baseline.benchmark.rates,
                    baseline.insurance_spent, baseline.effective_insurance_budgets):
        if amounts[0] != amounts[1]:
            return False
    for market, other in ((0, 1), (1, 0)):
        def totals(plan, side):
            result = plan.markets[side]
            return (plan.recovered[side], result.deviation, result.charged,
                    plan.payout.benchmark.rates[side], plan.payout.insurance_spent[side],
                    plan.payout.effective_insurance_budgets[side])
        if totals(first, market) != totals(second, other):
            return False

    def key(member, markets, left, right):
        account = book.accounts[member]
        def outcomes(plan, market):
            leg = plan.markets[market]
            return (leg.claims[member], leg.winner_charges[member], leg.remaining_lots[member],
                    _receipt(plan.payout, member, market))
        return (account.cash, tuple((account.claims[m], exposures[m].lots[member],
                                     exposures[m].entries[member], exposures[m].unpaid_gains[member],
                                     _receipt(baseline, member, m), outcomes(left, m), outcomes(right, m))
                                    for m in markets))

    members = range(len(book.accounts))
    forward = [key(i, (0, 1), first, second) for i in members]
    reflected = [key(i, (1, 0), second, first) for i in members]
    if Counter(forward) != Counter(reflected):
        return False
    peers = defaultdict(list)
    for member in members:
        peers[reflected[member]].append(member)

    first_edges, second_edges = _edges(first), _edges(second)
    active = {index for edges in (first_edges, second_edges) for debtor, winner, _ in edges
              for index in (debtor, winner)}
    # Flat/inactive rows have no incident fills and can be paired by like keys.
    # For active rows prove that the same bijection preserves every labelled edge.
    def match(mapping):
        if len(mapping) == len(active):
            return all(second_edges.get((mapping[d], mapping[w], 1-m)) == fill
                       for (d, w, m), fill in first_edges.items())
        member = min(active - mapping.keys(), key=lambda i: (len(peers[forward[i]]), i))
        for peer in peers[forward[member]]:
            if peer not in active or peer in mapping or forward[peer] != reflected[member]:
                continue
            candidate = {**mapping, member: peer, peer: member}
            if all(second_edges.get((candidate[d], candidate[w], 1-m)) == fill
                   for (d, w, m), fill in first_edges.items() if d in candidate and w in candidate):
                if match(candidate):
                    return True
        return False

    return len(first_edges) == len(second_edges) and match({})
