"""Small frozen-book comparison of two-market attribution under BTC forced reductions."""
from dataclasses import dataclass, replace
from fractions import Fraction
from itertools import product
from math import ceil, floor

from account_contract_reference import Account, require
from adl_eligibility_model import eligible_positions
from clearing_network_reference import AtomClearingPlan, InfeasiblePayoutFloor, clear_atom_cohort
from market_settlement_reference import MarketBook
from settlement_liquidation_model import MarketSnapshot, paired_reduction, terminal


def pin_own_cash(book, collections=None):
    """Encode an equivalent terminal input for the unmodified Rust kernel.

    The real program settles fractional flows together. Whole aggregate cash per
    market is necessary to encode this intermediate book in the current driver.
    """
    require(book.frozen, "frozen cohort required")
    accounts = []
    pools = list(book.pools)
    allocations = terminal(book).benchmark.collections if collections is None else collections
    for account, collected in zip(book.accounts, allocations, strict=True):
        available = sum(collected)
        require(Fraction(available).denominator == 1, "account collection must be whole")
        accounts.append(Account(account.cash - int(available), tuple(
            claim + amount for claim, amount in zip(account.claims, collected, strict=True))))
        for market, amount in enumerate(collected):
            pools[market] += amount
    require(all(Fraction(value).denominator == 1 for value in pools),
            "fractional intermediate pools need a joint settlement representation")
    result = replace(book, accounts=tuple(accounts), pools=tuple(map(int, pools)))
    require(result.vault == book.vault, "own cash counted twice")
    return result


def market_losses(plan):
    return tuple(sum(row[market] for row in plan.benchmark.creditor_impairments) for market in range(2))


@dataclass(frozen=True)
class Candidate:
    book: MarketBook
    charges: tuple[int, ...]
    lots: int
    payout: AtomClearingPlan


def compare(state, debtor, unpaid_open, *, pin_cash, protect_eth, protected_rounding=False):
    """Enumerate whole-atom BTC charges with one named debtor and an explicit D113 gain per root.

    Maximize recovered BTC shortfall, then approximate equal percentages of eligible
    gains. The remaining lot-count and member-order ties are research conventions.
    """
    require(state.book.frozen and 0 <= debtor < len(state.lots) and state.book.accounts[debtor].claims[0] < 0,
            "a frozen BTC debtor is required")
    baseline = terminal(state.book)
    initial_losses = market_losses(baseline)
    require(not protected_rounding or protect_eth, "protected rounding requires creditor protection")
    floors = {(index, 1): baseline.claim_cash_movements[index][1]
              for index, account in enumerate(state.book.accounts) if account.claims[1] > 0}
    loss_budget = floor(baseline.benchmark.debtor_writeoffs[debtor][0])
    eligible = eligible_positions(state, debtor, unpaid_open)
    capacity = sum(position.cap for position in eligible)
    lot_budget = abs(state.lots[debtor])
    best_key = None
    best = None
    for charges in product(*(range(min(position.cap, loss_budget) + 1) for position in eligible)):
        total = sum(charges)
        lots = sum(ceil(Fraction(charge) / position.gain_per_lot)
                   for position, charge in zip(eligible, charges, strict=True))
        if total > loss_budget or lots > lot_budget:
            continue
        # Equivalent candidates can have different gross charges when shared
        # cash is recalculated. Compare deviations from each plan's own shares.
        cost = sum((charge - Fraction(total * position.cap, capacity)) ** 2 / position.cap
                   for position, charge in zip(eligible, charges, strict=True))
        adjusted = state
        for position, charge in zip(eligible, charges, strict=True):
            if charge:
                adjusted, _ = paired_reduction(adjusted, debtor, position.member, position.gain_per_lot, charge)
        book = adjusted.book
        inputs = (book.accounts, book.pools, book.insurance, book.fees)
        collections = baseline.benchmark.collections if pin_cash else None
        payout = clear_atom_cohort(*inputs, frozen_collections=collections)
        losses = market_losses(payout)
        # Compare the actual decline in BTC creditor impairment. Reallocating
        # shared collateral can make this smaller than the nominal BTC charge.
        recovered = min(total, initial_losses[0] - losses[0])
        if protect_eth and (losses[1] > initial_losses[1]
                            or payout.insurance_spent[1] > baseline.insurance_spent[1]):
            continue
        if protect_eth and any(payout.claim_cash_movements[index][market] < minimum
                               for (index, market), minimum in floors.items()):
            if not protected_rounding:
                continue
            try:
                payout = clear_atom_cohort(*inputs, frozen_collections=collections, creditor_floors=floors)
            except InfeasiblePayoutFloor:
                continue
        key = (-recovered, cost, total, lots, tuple(-charge for charge in charges))
        if best_key is not None and key >= best_key:
            continue
        require(adjusted.book.vault == state.book.vault and sum(adjusted.lots) == 0, "inconsistent candidate")
        best_key = key
        best = Candidate(adjusted.book, charges, lots, payout)
    require(best is not None, "no feasible allocation")
    return best


def shared_cash():
    # A cross debtor owes BTC 80 / ETH 40. One BTC winner has 20 eligible
    # atoms. The two other creditors have flat claims.
    book = MarketBook((Account(90, (-80, -40)), Account(0, (20, 0)),
                       Account(0, (60, 0)), Account(0, (0, 40))), frozen=True)
    return MarketSnapshot(book, (-1, 1, 0, 0), 100, (20, 80, None, None)), (0, 20, 0, 0)


def linked_winner(*, eth_insurance=0, winner_cash=0):
    # A cross trader is owed 40 BTC-market atoms but owes 40 ETH-market atoms.
    # Twenty BTC atoms are unpaid open price gains on the one surviving lot.
    book = MarketBook((Account(60, (-100, 0)), Account(winner_cash, (40, -40)),
                       Account(0, (60, 0)), Account(0, (0, 40))),
                      insurance=(0, eth_insurance), frozen=True)
    return MarketSnapshot(book, (-1, 1, 0, 0), 100, (80, 80, None, None)), (0, 20, 0, 0)


if __name__ == "__main__":
    for name, (state, gains) in (("shared debtor cash", shared_cash()), ("cross winner", linked_winner()),
                                  ("insured ETH creditor", linked_winner(eth_insurance=25))):
        for pin_cash, protect_eth in ((False, False), (True, False), (True, True)):
            result = compare(state, 0, gains, pin_cash=pin_cash, protect_eth=protect_eth)
            print(name, "pin cash", pin_cash, "protect ETH", protect_eth, "charges", result.charges,
                  "cash", result.payout.cash, "insurance used", result.payout.insurance_spent)
