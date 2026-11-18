"""Prospective default cutoff experiments for a single BTC market and identified debtor."""
from dataclasses import dataclass, replace
from fractions import Fraction

from account_contract_reference import InvalidTransition, require
from payment_attribution_model import PaymentHistory, mixed_profit


@dataclass(frozen=True)
class Observation:
    mark: int
    deadline: int
    funding: Fraction = Fraction(0)
    witness: int | None = None  # Optional account presented together with this observation.


@dataclass(frozen=True)
class ProveDefault:
    member: int


@dataclass(frozen=True)
class Trade:
    buyer: int
    seller: int
    lots: int
    price: int


@dataclass(frozen=True)
class PayGain:
    member: int
    amount: int


@dataclass(frozen=True)
class Emergency:
    authorized: bool


@dataclass(frozen=True)
class SupplyValuation:
    mark: int
    deadline: int


@dataclass(frozen=True)
class Episode:
    # After a binding commit, this immutable history retains the exact open-lot basis,
    # prior payments, cash and accrued funding. Valuation can finish separately.
    history: PaymentHistory
    source_deadline: int
    boundary: tuple[int, int] | None = None  # (transaction, instruction) in this replay
    closeout_price: int | None = None

    def qualified_witness(self, member, now):
        market = self.history.market
        require(type(member) is int and 0 <= member < len(market.lots), "unknown member")
        account = market.book.accounts[member]
        # This experiment has one exposed market. The live guard checks both markets
        # and the separate all-flat gross-debt predicate for mixed-sign accounts.
        if market.lots[member] and now > self.source_deadline:
            return False
        return account.cash + sum(account.claims) < 0

    def bind(self, order, now):
        mark = self.history.market.mark if now <= self.source_deadline else None
        if mark is None and not any(self.history.market.lots):
            mark = 1  # price-independent flat cohort, as in required_prices
        return replace(self, boundary=order, closeout_price=mark)

    def payout(self, debtor=0):
        require(self.boundary is not None and self.closeout_price is not None, "no valued freeze")
        return self.history.resolve_at(self.closeout_price, debtor)


def step(state, operation, now, order, cutoff):
    if isinstance(operation, SupplyValuation):
        require(state.boundary is not None and state.closeout_price is None, "valuation unavailable")
        require(type(operation.mark) is int and operation.mark > 0 and operation.deadline >= now,
                "invalid valuation")
        return replace(state, closeout_price=operation.mark)

    require(state.boundary is None, "frozen")
    if isinstance(operation, Observation):
        require(operation.deadline >= now, "expired observation")
        history = state.history.accrue(operation.funding).reprice(operation.mark)
        state = replace(state, history=history, source_deadline=operation.deadline)
        if cutoff == "at-observation" and operation.witness is not None and state.qualified_witness(operation.witness, now):
            return state.bind(order, now)
        if cutoff == "full-scan" and any(state.qualified_witness(member, now)
                                         for member in range(len(state.history.market.lots))):
            return state.bind(order, now)
        return state
    if isinstance(operation, ProveDefault):
        require(state.qualified_witness(operation.member, now), "default unproved")
        return state.bind(order, now)
    if isinstance(operation, Emergency):
        require(operation.authorized and state.source_deadline > 0 and now >= state.source_deadline + 30
                and any(state.history.market.lots), "emergency unproved")
        return state.bind(order, now)

    require(now <= state.source_deadline, "expired source")
    if isinstance(operation, Trade):
        history = state.history.trade(operation.buyer, operation.seller, operation.lots, operation.price)
    elif isinstance(operation, PayGain):
        require(type(operation.member) is int and 0 <= operation.member < len(state.history.market.lots),
                "unknown member")
        history = state.history.pay_gain(operation.member, operation.amount)
    else:
        raise TypeError(operation)
    return replace(state, history=history)


def replay(initial, transactions, cutoff):
    """Committed instruction order. Any failed instruction rolls its whole transaction back."""
    require(cutoff in POLICIES, "unknown binding policy")
    require(initial.history.convention == "closed-first", "D113 history required")
    state = initial
    outcomes = []
    previous_time = -1
    for number, (now, operations) in enumerate(transactions):
        require(type(now) is int and now >= previous_time and operations, "invalid transaction order")
        previous_time = now
        candidate = state
        try:
            for index, operation in enumerate(operations):
                candidate = step(candidate, operation, now, (number, index), cutoff)
        except InvalidTransition as error:
            outcomes.append(str(error))
        else:
            state = candidate
            outcomes.append("committed")
    return state, tuple(outcomes)


def starting_book(collection=10):
    history = mixed_profit("closed-first").collect_loss(0, collection).pay_gain(1, 10)
    return Episode(history, source_deadline=10)


OBSERVE = Observation(mark=100, deadline=12, witness=0)
CLOSE = Trade(4, 1, 1, 99)
REOPEN = Trade(1, 4, 1, 99)
PROVE = ProveDefault(0)
POLICIES = ("explicit-freeze", "at-observation", "full-scan")


def cutoff_examples():
    # Same clock value, same submission order for both policies. Tuple groups
    # are transactions, so a close/reopen in one group cannot straddle a freeze.
    return {
        "round trip before observation": ((CLOSE, REOPEN), (OBSERVE,), (PROVE,)),
        "round trip between observation and proof": ((OBSERVE,), (CLOSE, REOPEN), (PROVE,)),
        "proof between close and reopen": ((OBSERVE,), (CLOSE,), (PROVE,), (REOPEN,)),
        "round trip after proof": ((OBSERVE,), (PROVE,), (CLOSE, REOPEN)),
        "observation without witness": ((replace(OBSERVE, witness=None),), (CLOSE, REOPEN), (PROVE,)),
        "price recovers before proof": ((OBSERVE,), (Observation(85, 13, witness=0),), (PROVE,)),
    }


if __name__ == "__main__":
    for label, groups in cutoff_examples().items():
        for policy in POLICIES:
            episode, outcomes = replay(starting_book(), [(1, group) for group in groups], policy)
            print(label, policy, "boundary", episode.boundary, "transactions", outcomes)
            if episode.boundary is not None:
                result = episode.payout()
                print("  ADL", result.charges, "residual", result.residual, "final cash", result.payout.cash)
