"""Replay the same BTC ledger under two conventions for classifying ordinary payments."""
from dataclasses import dataclass, replace
from fractions import Fraction

from account_contract_reference import Account, accrue_claim, require
from adl_eligibility_model import freeze, resolve
from market_settlement_reference import MarketBook, collect, pay
from settlement_liquidation_model import MarketSnapshot


@dataclass(frozen=True)
class PaymentHistory:
    market: MarketSnapshot
    convention: str
    # Amount of earlier payments assigned to the price P&L of lots still held.
    paid_open: tuple[Fraction, ...]
    funding_index: Fraction = Fraction(0)

    def __post_init__(self):
        require(self.convention in ("closed-first", "open-first"), "unknown payment attribution")
        require(self.market.entries is not None and len(self.paid_open) == len(self.market.lots)
                and all(type(paid) in (int, Fraction) and paid >= 0 and (lots != 0 or paid == 0)
                        for paid, lots in zip(self.paid_open, self.market.lots)),
                "complete surviving open-payment attribution required")

    @classmethod
    def start(cls, convention, cash, mark, insurance=0):
        accounts = tuple(Account(balance, (0, 0)) for balance in cash)
        market = MarketSnapshot(MarketBook(accounts, insurance=(insurance, 0)),
                                (0,) * len(cash), mark, (None,) * len(cash))
        return cls(market, convention, (Fraction(0),) * len(cash))

    def components(self, member):
        """Signed unpaid open price P&L, and the remaining signed fixed claim."""
        lots = self.market.lots[member]
        gross = lots * (self.market.mark - self.market.entries[member]) if lots else 0
        open_claim = gross - self.paid_open[member]
        return open_claim, self.market.book.accounts[member].claims[0] - open_claim

    def reprice(self, mark):
        return replace(self, market=self.market.reprice(mark))

    def accrue(self, funding_index):
        require(not self.market.book.frozen, "frozen funding index")
        accounts = tuple(
            Account(account.cash, (accrue_claim(lots, account.claims[0], self.funding_index, funding_index),
                                   account.claims[1]))
            for lots, account in zip(self.market.lots, self.market.book.accounts, strict=True))
        book = replace(self.market.book, accounts=accounts)
        return replace(self, market=self.market.apply_cash(book), funding_index=Fraction(funding_index))

    def trade(self, buyer, seller, quantity, price):
        updated = self.market.trade(buyer, seller, quantity, price)
        paid = list(self.paid_open)
        for member in (buyer, seller):
            before, after = self.market.lots[member], updated.lots[member]
            if before * after <= 0:
                paid[member] = Fraction(0)
            elif abs(after) < abs(before):
                paid[member] *= Fraction(after, before)
        return replace(self, market=updated, paid_open=tuple(paid))

    def collect_loss(self, member, amount):
        # Recovery of a debtor's own funded cash settles an obligation. It cannot
        # endow a surviving lot with additional eligible price profit.
        book = collect(self.market.book, member, 0, amount)
        return replace(self, market=self.market.apply_cash(book))

    def pay_gain(self, member, amount):
        book = pay(self.market.book, member, 0, amount)
        open_claim, fixed_claim = self.components(member)
        if self.convention == "open-first":
            open_payment = min(amount, max(0, open_claim))
        else:
            open_payment = max(0, amount - max(0, fixed_claim))
        paid = list(self.paid_open)
        paid[member] += open_payment
        return replace(self, market=self.market.apply_cash(book), paid_open=tuple(paid))

    def resolve_at(self, mark, debtor=0):
        valued = replace(self, market=freeze(self.market, mark))
        unpaid = tuple(max(0, valued.components(member)[0]) for member in range(len(valued.market.lots)))
        return resolve(valued.market, debtor, unpaid_open=unpaid)


def mixed_profit(convention, size=1):
    """D, maker A, maker B, flat creditor, fresh maker C. Start from zero claims."""
    state = PaymentHistory.start(convention, (30 * size, 100, 100, 100, 100), 70)
    state = state.trade(3, 0, size, 70).reprice(80)
    state = state.trade(1, 3, size, 80).trade(1, 0, size, 80).reprice(90)
    return state.trade(2, 1, size, 90)


def histories(convention):
    mixed = mixed_profit(convention).collect_loss(0, 10).pay_gain(1, 10)
    larger = mixed_profit(convention, 2).collect_loss(0, 20).pay_gain(1, 20)
    partial = larger.trade(4, 1, 1, 90)
    before_reentry = mixed.reprice(99)
    round_trip = before_reentry.trade(4, 1, 1, 99).trade(1, 4, 1, 99)
    return {
        "mixed payment": mixed,
        "longs receive funding": mixed.accrue(-2),
        "partial close, longs pay funding": partial.accrue(2),
        "partial close, longs receive funding": partial.accrue(-2),
        "close and reopen": round_trip,
    }


if __name__ == "__main__":
    for rule in ("closed-first", "open-first"):
        print(rule, "(debtor, maker A, maker B, flat creditor, maker C)")
        for label, history in histories(rule).items():
            result = history.resolve_at(100)
            print(label, "charges", result.charges, "residual", result.residual, "final cash", result.payout.cash)
