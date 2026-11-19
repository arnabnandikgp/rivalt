"""Reference continuation for verifying a proposed joint plan over the complete small search space."""
from dataclasses import dataclass, replace
from fractions import Fraction
from hashlib import sha256
from math import ceil, prod
import json

from account_contract_reference import require
from cross_market_adl_model import market_losses
from frozen_plan_selection import IncomparableFinancialProfiles, _break_exact_ties
from joint_reduction_model import MarketPlan, Pair, evaluate, frozen_market_inputs, recovery_score
from settlement_liquidation_model import paired_reduction, terminal


def _encode(value):
    if isinstance(value, (list, tuple)):
        return [_encode(item) for item in value]
    if isinstance(value, Fraction):
        return [str(value.numerator), str(value.denominator)]
    if type(value) is int:
        return str(value)
    return value


class FrozenSearch:
    def __init__(self, book, exposures, identity, source_digest):
        require(book.frozen and len(exposures) == 2 and len(identity.member_ids) == len(book.accounts)
                and tuple(sorted(identity.member_ids)) == identity.member_ids, "complete canonical frozen source required")
        require(type(source_digest) is bytes and len(source_digest) == 32, "authenticated freeze digest required")
        self.book, self.exposures, self.identity = book, exposures, identity
        self.baseline = terminal(book)
        self.shortfalls = market_losses(self.baseline)
        self.inputs = tuple(frozen_market_inputs(book, market, exposure, self.baseline)
                            for market, exposure in enumerate(exposures))
        # Each digit is one frozen debtor/winner charge in one market. A charge
        # above this inclusive limit cannot occur even before considering shared lots.
        self.radices = tuple(min(budgets[debtor], pos.cap) + 1 for _, budgets, edges, _ in self.inputs
                             for debtor, pos in edges)
        self.size = prod(self.radices)
        fields = ("rivalt-joint-search/D127/1", source_digest.hex(), identity.venue.hex(), identity.episode,
                  identity.member_ids, book.pools, book.insurance, book.fees,
                  [(a.cash, a.claims) for a in book.accounts],
                  [(e.mark, e.lots, e.entries, e.unpaid_gains) for e in exposures])
        self.binding = sha256(json.dumps(_encode(fields), separators=(',', ':')).encode()).hexdigest()

    def candidate(self, ordinal):
        require(type(ordinal) is int and 0 <= ordinal < self.size, "invalid candidate ordinal")
        digits = []
        for radix in self.radices:
            ordinal, charge = divmod(ordinal, radix)
            digits.append(charge)
        charges = iter(digits)
        plans = []
        for state, budgets, edges, caps in self.inputs:
            paid = [0] * len(budgets)
            assigned = [0] * len(budgets)
            pairs = []
            for debtor, position in edges:
                charge = next(charges)
                if not charge:
                    continue
                winner = position.member
                lots = ceil(Fraction(charge) / position.gain_per_lot)
                if (paid[debtor] + charge > budgets[debtor] or assigned[winner] + charge > caps[winner]
                        or lots > min(abs(state.lots[debtor]), abs(state.lots[winner]))):
                    return None
                state, fills = paired_reduction(state, debtor, winner, position.gain_per_lot, charge)
                pairs.append(Pair(debtor, winner, charge, fills))
                paid[debtor] += charge
                assigned[winner] += charge
            capacity, total = sum(caps.values()), sum(assigned)
            deviation = sum((assigned[w] - Fraction(total * cap, capacity)) ** 2 / cap for w, cap in caps.items())
            plans.append(MarketPlan(tuple(a.claims[0] for a in state.book.accounts), tuple(assigned),
                                    state.lots, tuple(pairs), deviation))
        return evaluate(self.book, self.baseline, tuple(plans))

    def begin(self, proposal):
        require(self.candidate(proposal) is not None, "infeasible proposal")
        return Audit(self.proposal_binding(proposal), proposal)

    def proposal_binding(self, ordinal):
        # Fixed-width source digest followed by the canonical ordinal binds
        # continuation to the exact plan whose challengers have been checked.
        return sha256(bytes.fromhex(self.binding) + str(ordinal).encode('ascii')).hexdigest()

    def advance(self, audit, expected_next, budget):
        """The checkpoint must come from trusted storage. Each call covers a contiguous range."""
        require(audit.binding == self.proposal_binding(audit.proposal) and audit.status == "pending"
                and audit.next_ordinal == expected_next and 0 <= expected_next < self.size,
                "stale or completed work")
        require(type(budget) is int and budget > 0, "positive comparison budget required")
        proposed = self.candidate(audit.proposal)
        require(proposed is not None, "infeasible proposal")
        proposed_score = recovery_score(proposed, self.shortfalls)
        end = min(expected_next + budget, self.size)
        for ordinal in range(expected_next, end):
            if ordinal == audit.proposal:
                continue
            other = self.candidate(ordinal)
            if other is None:
                continue
            other_score = recovery_score(other, self.shortfalls)
            if other_score < proposed_score:
                continue
            if other_score == proposed_score:
                # Any remaining incomparable economic objectives keep the proposal
                # uncertified. A caller cannot choose a payout with its submission order.
                try:
                    if _break_exact_ties([proposed, other], self.identity, self.book, self.exposures, self.baseline) is proposed:
                        continue
                except IncomparableFinancialProfiles:
                    return replace(audit, status="incomparable", next_ordinal=ordinal + 1, challenger=ordinal)
            return replace(audit, status="outscored", next_ordinal=ordinal + 1, challenger=ordinal)
        return replace(audit, next_ordinal=end, status="verified" if end == self.size else "pending")

    def verified_plan(self, audit):
        require(audit.binding == self.proposal_binding(audit.proposal) and audit.status == "verified"
                and audit.challenger is None and audit.next_ordinal == self.size,
                "complete verified search required")
        return self.candidate(audit.proposal)


@dataclass(frozen=True)
class Audit:
    binding: str
    proposal: int
    next_ordinal: int = 0
    status: str = "pending"
    challenger: int | None = None
