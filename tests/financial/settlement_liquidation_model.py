"""Clearing research at fixed, fully accrued valuations. Run directly for the cases."""
from dataclasses import dataclass, replace
from fractions import Fraction
from math import ceil

from account_contract_reference import Account, require
from clearing_network_reference import AtomClearingPlan, clear_atom_cohort
from market_settlement_reference import MarketBook, collect, pay


@dataclass(frozen=True)
class MarketSnapshot:
    """Single BTC market with explicit cash, signed claims, inventory and reserves."""
    book: MarketBook
    lots: tuple[int, ...]
    mark: int
    entries: tuple[Fraction | None, ...] | None = None  # Optional average entry from research trade history.

    def __post_init__(self):
        require(type(self.mark) is int and self.mark > 0, "positive valuation required")
        require(len(self.lots) == len(self.book.accounts) and sum(self.lots) == 0
                and all(type(q) is int for q in self.lots), "inventory must reconcile")
        if self.entries is not None:
            require(len(self.entries) == len(self.lots) and all(
                entry is None if lots == 0 else type(entry) in (int, Fraction) and entry > 0
                for lots, entry in zip(self.lots, self.entries)), "basis required on every open position")

    def reprice(self, mark):
        require(not self.book.frozen, "valuation fixed at freeze")
        accounts = tuple(Account(account.cash, (account.claims[0] + lots * (mark - self.mark),
                                                  account.claims[1]))
                         for account, lots in zip(self.book.accounts, self.lots))
        return replace(self, book=replace(self.book, accounts=accounts), mark=mark)

    def trade(self, buyer, seller, quantity, price):
        require(not self.book.frozen, "ordinary trading suspended")
        return self._paired_fill(buyer, seller, quantity, price)

    def _paired_fill(self, buyer, seller, quantity, price):
        require(0 <= buyer < len(self.lots) and 0 <= seller < len(self.lots) and buyer != seller,
                "distinct counterparties required")
        require(type(quantity) is int and quantity > 0 and type(price) is int and price > 0,
                "positive integer lots and price required")
        accounts, lots = list(self.book.accounts), list(self.lots)
        entries = list(self.entries) if self.entries is not None else None
        for member, delta in ((buyer, quantity), (seller, -quantity)):
            account = accounts[member]
            lots[member] += delta
            if entries is not None:
                previous = self.lots[member]
                if lots[member] == 0:
                    entries[member] = None
                elif previous * lots[member] <= 0:
                    entries[member] = Fraction(price)
                elif previous * delta > 0:
                    entries[member] = (entries[member] * previous + price * delta) / Fraction(lots[member])
                # A partial reduction retains the surviving position's average entry.
            accounts[member] = Account(account.cash, (account.claims[0] + delta * (self.mark - price),
                                                       account.claims[1]))
        return replace(self, lots=tuple(lots), book=replace(self.book, accounts=tuple(accounts)),
                       entries=tuple(entries) if entries is not None else None)

    def apply_cash(self, book):
        require(book.vault == self.book.vault, "custody changed during internal settlement")
        return replace(self, book=book)


def ordinary_close():
    # Account order: trader, opening maker A, closing maker B. Ignore fees/funding here.
    start = MarketSnapshot(MarketBook((Account(100, (0, 0)),) * 3), (0, 0, 0), 80)
    opened = start.trade(0, 1, 1, 80)
    marked = opened.reprice(100)
    closed = marked.trade(2, 0, 1, 100)
    collected = closed.apply_cash(collect(closed.book, 1, 0, 20))
    paid = collected.apply_cash(pay(collected.book, 0, 0, 20))
    return dict(opened=opened, marked=marked, closed=closed, collected=collected, paid=paid)


def terminal(book):
    """Same whole-atom baseline used for all final comparisons."""
    require(book.frozen, "terminal calculation requires frozen cohort")
    return clear_atom_cohort(book.accounts, book.pools, book.insurance, book.fees)


@dataclass(frozen=True)
class AdlComparison:
    before: MarketSnapshot
    after_pair: MarketSnapshot
    charge: int
    fills: tuple[tuple[int, int], ...]  # (quantity, execution price), before terminal settlement
    baseline: AtomClearingPlan
    candidate: AtomClearingPlan


def frozen_btc_baseline(state, debtor):
    book = state.book
    require(book.frozen and 0 <= debtor < len(state.lots), "frozen debtor required")
    require(all(account.claims[1] == 0 for account in book.accounts)
            and all(account.claims[0] >= 0 for i, account in enumerate(book.accounts) if i != debtor)
            and book.accounts[debtor].claims[0] < 0, "single-market single-debtor cohort required")
    return terminal(book)


def paired_reduction(state, debtor, winner, profit_per_lot, charge):
    """Execute an assigned whole-atom charge with the fewest whole lots at bounded prices."""
    require(profit_per_lot > 0 and charge > 0 and state.lots[debtor] * state.lots[winner] < 0,
            "profitable opposite exposure required")
    matched = ceil(Fraction(charge) / profit_per_lot)
    require(matched <= min(abs(state.lots[debtor]), abs(state.lots[winner]))
            and charge <= state.book.accounts[winner].claims[0], "charge exceeds open exposure or unpaid claim")
    concession, extra_lots = divmod(charge, matched)
    direction = 1 if state.lots[winner] > 0 else -1
    buyer, seller = (debtor, winner) if direction == 1 else (winner, debtor)
    fills = []
    for size, discount in ((matched - extra_lots, concession), (extra_lots, concession + 1)):
        if size:
            price = state.mark - direction * discount
            state = state._paired_fill(buyer, seller, size, price)
            fills.append((size, price))
    return state, tuple(fills)


def compare_open_priority(state, debtor, winner, entry_price):
    """Compare one nominated opposite with equal recovery using a fixed fixture entry."""
    require(0 <= winner < len(state.lots) and debtor != winner and type(entry_price) is int
            and entry_price > 0, "distinct winner and entry required")
    baseline = frozen_btc_baseline(state, debtor)
    initial_loss = sum(row[0] for row in baseline.benchmark.creditor_impairments)
    quantity = min(abs(state.lots[debtor]), abs(state.lots[winner]))
    direction = 1 if state.lots[winner] > 0 else -1
    profit_per_lot = direction * (state.mark - entry_price)
    charge = 0
    fills = ()
    after = state
    if state.lots[debtor] * state.lots[winner] < 0 and profit_per_lot > 0:
        charge = int(min(initial_loss, max(0, state.book.accounts[winner].claims[0]),
                         quantity * profit_per_lot))
    if charge:
        after, fills = paired_reduction(state, debtor, winner, profit_per_lot, charge)
    candidate = terminal(after.book)
    residual = sum(row[0] for row in candidate.benchmark.creditor_impairments)
    require(charge + residual == initial_loss and candidate.insurance_spent == baseline.insurance_spent,
            "attributed loss or insurance changed")
    return AdlComparison(state, after, charge, tuple(fills), baseline, candidate)


def shortfall(open_profit, *, flat=False, insurance=10):
    # Fixed claims sum to zero at 100. The open winner holds 40 unpaid in total.
    book = MarketBook((Account(80, (-100, 0)), Account(0, (60, 0)), Account(0, (40, 0))),
                      insurance=(insurance, 0), frozen=True)
    lots = (0, 0, 0) if flat else (-1, 0, 1)
    return compare_open_priority(MarketSnapshot(book, lots, 100), 0, 2, 100 - open_profit)


def cross_default(insurance=(0, 0)):
    return MarketBook((Account(90, (-80, -40)), Account(0, (80, 0)), Account(0, (0, 40))),
                      insurance=insurance, frozen=True)


def risk_deficit(account, lots, price):
    # Single fixed valuation, empty orders, zero pending funding, existing 5% MM.
    maintenance = (abs(lots) * price + 19) // 20
    return max(0, maintenance - account.cash - sum(min(claim, 0) for claim in account.claims))


def takeover(state, target, receiver, size, price, *, consent):
    """Existing receiver economics under a point-valued index in this research fixture."""
    require(0 <= target < len(state.lots) and 0 <= receiver < len(state.lots) and target != receiver,
            "distinct takeover roles required")
    require(all(account.claims[1] == 0 for account in state.book.accounts), "one-market takeover fixture")
    require(not state.book.frozen and consent and 0 < size <= abs(state.lots[target]),
            "active consenting bounded takeover required")
    require(9 * state.mark <= 10 * price <= 11 * state.mark, "price outside reference band")
    buyer, seller = (receiver, target) if state.lots[target] > 0 else (target, receiver)
    before = risk_deficit(state.book.accounts[target], state.lots[target], state.mark)
    result = state.trade(buyer, seller, size, price)
    accounts = list(result.book.accounts)
    fee = min((size * price + 1999) // 2000, 10000, accounts[target].cash)
    accounts[target] = replace(accounts[target], cash=accounts[target].cash - fee)
    accounts[receiver] = replace(accounts[receiver], cash=accounts[receiver].cash + fee)
    require(risk_deficit(accounts[target], result.lots[target], state.mark) < before,
            "no strict deficit improvement after fee")
    equity = accounts[receiver].cash + sum(min(claim, 0) for claim in accounts[receiver].claims)
    require(equity >= (abs(result.lots[receiver]) * state.mark + 9) // 10,
            "receiver below initial margin")
    return result.apply_cash(replace(result.book, accounts=tuple(accounts))), fee


def main():
    print("Ordinary close (trader, maker A, maker B)")
    for label, state in ordinary_close().items():
        print(label, "lots", state.lots, "cash", tuple(a.cash for a in state.book.accounts),
              "BTC claims", tuple(str(a.claims[0]) for a in state.book.accounts),
              "settlement", state.book.pools[0])
    print("\nBankrupt maker (debtor, flat creditor, open creditor)")
    for profit, flat in ((40, False), (6, False), (0, True)):
        result = shortfall(profit, flat=flat)
        print("eligible profit", profit, "insurance", result.candidate.insurance_spent[0],
              "paired fills", result.fills, "ADL charge", result.charge,
              "residual claim losses", tuple(str(row[0]) for row in result.candidate.benchmark.creditor_impairments),
              "current cash", result.baseline.cash, "candidate cash", result.candidate.cash)
    print("\nCross debtor (debtor, BTC creditor, ETH creditor)")
    for insurance in ((0, 0), (15, 20)):
        plan = terminal(cross_default(insurance))
        print("insurance budgets", insurance, "own cash used", tuple(str(x) for x in plan.benchmark.collections[0]),
              "insurance used", plan.insurance_spent, "final cash", plan.cash)


if __name__ == "__main__":
    main()
