"""Research selection from a complete authenticated frozen cohort. No runtime binding."""
from dataclasses import dataclass
from hashlib import sha256

from account_contract_reference import require
from joint_reduction_model import compare_joint

DOMAIN = b"Rivalt/frozen-member-order/v1\x00"


@dataclass(frozen=True)
class FrozenIdentity:
    venue: bytes
    episode: int
    member_ids: tuple[int, ...]

    def __post_init__(self):
        require(type(self.venue) is bytes and len(self.venue) == 32, "venue address required")
        require(type(self.episode) is int and 0 <= self.episode < 2**64, "invalid frozen episode")
        require(all(type(member) is int and 0 <= member < 2**64 for member in self.member_ids)
                and len(self.member_ids) == len(set(self.member_ids)), "invalid frozen member IDs")

    def order(self):
        prefix = DOMAIN + self.venue + self.episode.to_bytes(8, 'little')
        def priority(index):
            member = self.member_ids[index]
            return sha256(prefix + member.to_bytes(8, 'little')).digest(), member
        return sorted(range(len(self.member_ids)), key=priority)


def select_joint(book, exposures, freeze):
    """Replay the selected economics, then resolve remaining exact allocation ties."""
    require(len(freeze.member_ids) == len(book.accounts), "incomplete frozen membership")
    # Terminal rounding uses stable member order. Reject reordered rows before
    # any claimant ordinal can be associated with a different identity.
    indices = sorted(range(len(book.accounts)), key=freeze.member_ids.__getitem__)
    require(indices == list(range(len(indices))), "frozen rows must be in stable member order")
    plans = compare_joint(book, exposures)
    return _break_exact_ties(plans, freeze)


def _break_exact_ties(plans, freeze):
    """Takes D120 score-tied finalists. Keeper submission order is immaterial."""
    require(bool(plans), "missing ranked plans")
    # Equal D120 scores can occur under exchanged market recovery fractions.
    # Resolve a dominated fairness/closure profile first. A trade-off between
    # financial profiles cannot be silently turned into an identity tie.
    def profile(plan):
        return (tuple(market.deviation for market in plan.markets),
                tuple((market.charged, sum(size for pair in market.pairs for size, _ in pair.fills))
                      for market in plan.markets))

    def dominates(first, second):
        for left, right in zip(first, second):
            if left != right:
                return all(a <= b for a, b in zip(left, right))
        return False

    profiles = {profile(plan) for plan in plans}
    best = [first for first in profiles if not any(dominates(other, first) for other in profiles)]
    require(len(best) == 1, "financial objectives differ across tied recovery scores")
    finalists = [plan for plan in plans if profile(plan) == best[0]]
    if len(finalists) == 1:
        return finalists[0]

    members = freeze.order()
    ranks = {index: rank for rank, index in enumerate(members)}
    def pair_map(plan):
        return {(ranks[pair.winner], market, ranks[pair.debtor]): pair.charge
                for market, ledger in enumerate(plan.markets) for pair in ledger.pairs}
    assignments = [pair_map(plan) for plan in finalists]
    keys = sorted(set().union(*(assignment.keys() for assignment in assignments)))
    def preference(item):
        plan, assignment = item
        charges = tuple(market.winner_charges[index] for index in members for market in plan.markets)
        return charges, tuple(assignment.get(key, 0) for key in keys)
    return max(zip(finalists, assignments), key=preference)[0]
