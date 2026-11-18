"""Offline single-debtor experiments for selecting among opposite BTC positions."""
from dataclasses import dataclass, replace
from fractions import Fraction
from math import ceil

from account_contract_reference import Account, require
from clearing_network_reference import AtomClearingPlan
from market_settlement_reference import MarketBook
from settlement_liquidation_model import MarketSnapshot, frozen_btc_baseline, paired_reduction, terminal


@dataclass(frozen=True)
class EligiblePosition:
    member: int
    gain_per_lot: int | Fraction
    cap: int


def eligible_positions(state, debtor, unpaid_open):
    require(state.entries is not None, "complete entry bases required")
    if unpaid_open is not None:
        require(len(unpaid_open) == len(state.lots) and all(
            type(amount) in (int, Fraction) and amount >= 0 for amount in unpaid_open),
            "complete nonnegative unpaid open-profit attribution required")
    eligible = []
    for member, (lots, entry, account) in enumerate(zip(state.lots, state.entries, state.book.accounts)):
        if lots * state.lots[debtor] >= 0:
            continue
        direction = 1 if lots > 0 else -1
        # Every individual execution price must remain between entry and frozen mark.
        gain_per_lot = int(max(0, direction * (state.mark - entry)))
        pairable_lots = min(abs(lots), abs(state.lots[debtor]))
        if unpaid_open is not None:
            # Average-entry histories release the paid and unpaid parts in proportion
            # to lots closed. A partial ADL can use only the matched lots' share.
            gain_per_lot = min(gain_per_lot, Fraction(unpaid_open[member], abs(lots)))
        cap = min(int(pairable_lots * gain_per_lot), int(account.claims[0]))
        if cap > 0:
            eligible.append(EligiblePosition(member, gain_per_lot, cap))
    return eligible


def ordinal_charges(eligible, loss, lots):
    """Counterfactual: serve profitable roots in stable member order until lots or loss run out."""
    charges = []
    for position in eligible:
        charge = min(loss, position.cap, int(lots * position.gain_per_lot))
        charges.append(charge)
        loss -= charge
        lots -= ceil(Fraction(charge) / position.gain_per_lot)
    return charges


def proportional_charges(eligible, loss, lots):
    """Maximize feasible recovery, then approximate the same charge fraction of each eligible cap.

    Exact small-fixture benchmark, pseudo-polynomial in the atom and lot budgets. For
    each (charge, lots) prefix retain the smallest sum(charge_i^2/cap_i). At fixed
    total this is equivalent to minimizing cap-weighted squared deviations from a
    common charge fraction. Negative charges give earlier member IDs priority on ties.
    """
    plans = {(0, 0): (Fraction(0), ())}
    for position in eligible:
        extended = {}
        for (charged, used), (cost, negative_charges) in plans.items():
            maximum = min(position.cap, loss - charged, int((lots - used) * position.gain_per_lot))
            for charge in range(maximum + 1):
                required_lots = ceil(Fraction(charge) / position.gain_per_lot)
                key = charged + charge, used + required_lots
                plan = cost + Fraction(charge * charge, position.cap), negative_charges + (-charge,)
                if key not in extended or plan < extended[key]:
                    extended[key] = plan
        plans = extended
    # After maximum recovery and closest proportionality, minimize forced lot closure.
    def preference(item):
        (charged, used), (cost, negative_charges) = item
        return -charged, cost, used, negative_charges

    _, (_, negative_charges) = min(plans.items(), key=preference)
    return [-charge for charge in negative_charges]


@dataclass(frozen=True)
class EligibilityResult:
    after: MarketSnapshot
    caps: tuple[int, ...]
    charges: tuple[int, ...]
    fills: tuple[tuple[int, int, int], ...]  # member, lots, execution price
    residual: Fraction
    payout: AtomClearingPlan


def resolve(state, debtor, *, allocation="proportional", unpaid_open=None):
    """Use fixture-attributed unpaid open gain, or its upper bound for the no-payment histories."""
    baseline = frozen_btc_baseline(state, debtor)
    initial_loss = sum(row[0] for row in baseline.benchmark.creditor_impairments)
    eligible = eligible_positions(state, debtor, unpaid_open)
    allocators = {"proportional": proportional_charges, "ordinal": ordinal_charges}
    require(allocation in allocators, "unknown allocation experiment")
    assigned = allocators[allocation](eligible, int(initial_loss), abs(state.lots[debtor]))
    after = state
    caps, charges = [0] * len(state.lots), [0] * len(state.lots)
    fills = []
    for position, charge in zip(eligible, assigned, strict=True):
        caps[position.member], charges[position.member] = position.cap, charge
        if charge:
            after, paired = paired_reduction(after, debtor, position.member, position.gain_per_lot, charge)
            fills.extend((position.member, size, price) for size, price in paired)

    payout = terminal(after.book)
    residual = sum(row[0] for row in payout.benchmark.creditor_impairments)
    require(sum(charges) + residual == initial_loss and payout.insurance_spent == baseline.insurance_spent
            and state.book.vault == after.book.vault, "loss, insurance or custody failed to reconcile")
    return EligibilityResult(after, tuple(caps), tuple(charges), tuple(fills), residual, payout)


def maker_history():
    """Debtor, flat creditor, makers A and B, fresh counterparty. Trading fees omitted."""
    accounts = tuple(Account(cash, (0, 0)) for cash in (80, 100, 100, 100, 100))
    state = MarketSnapshot(MarketBook(accounts, insurance=(10, 0)), (0,) * 5, 65, (None,) * 5)
    state = state.trade(1, 0, 2, 65).reprice(85)
    state = state.trade(2, 0, 1, 85).trade(3, 0, 1, 85).reprice(95)
    return state.trade(2, 1, 1, 95).trade(3, 1, 1, 95).reprice(99)


def freeze(state, mark):
    valued = state.reprice(mark)
    return replace(valued, book=replace(valued.book, frozen=True))


if __name__ == "__main__":
    held = maker_history()
    closed = held.trade(4, 2, 2, 99)
    for name, path in (("held", held), ("closed", closed), ("reopened", closed.trade(2, 4, 2, 99))):
        for rule in ("ordinal", "proportional"):
            result = resolve(freeze(path, 100), 0, allocation=rule)
            print(name, rule, "caps", result.caps, "charges", result.charges,
                  "residual", result.residual, "final cash", result.payout.cash)
