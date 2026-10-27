"""P22B normal market settlement and frozen-cohort authority model.

Exact specification evidence, not signature/source/runtime verification. Account
claims are supplied at one fully accrued authenticated snapshot in the real path.
"""
from dataclasses import dataclass, replace
from account_contract_reference import Account, require


@dataclass(frozen=True)
class MarketBook:
    accounts: tuple[Account, ...]
    pools: tuple[int, int] = (0, 0)
    insurance: tuple[int, int] = (0, 0)
    fees: tuple[int, int] = (0, 0)
    frozen: bool = False

    def __post_init__(self):
        require(all(type(value) is int and value >= 0 for value in (*self.pools, *self.insurance, *self.fees)),
                'whole funded market balances')
        require(all(sum(account.claims[market] for account in self.accounts) == self.pools[market] for market in range(2)),
                'per-market claim identity')

    @property
    def vault(self):
        return sum(account.cash for account in self.accounts) + sum(self.pools + self.insurance + self.fees)

    def mutate(self, index, claims, cash, pools):
        accounts = list(self.accounts)
        accounts[index] = Account(cash, tuple(claims))
        result = replace(self, accounts=tuple(accounts), pools=tuple(pools))
        require(result.vault == self.vault, 'cash conservation')
        return result


def gross_debt(account):
    return sum(max(-claim, 0) for claim in account.claims)


def payment_eligible(book, market):
    require(market in (0, 1), 'canonical market')
    # A shared debtor's own cash covers BOTH negative obligations, counted once.
    # Positive receivables and all insurance are deliberately excluded.
    return not book.frozen and all(account.cash >= gross_debt(account) for account in book.accounts
                                   if account.claims[market] < 0)


def collect(book, index, market, amount):
    account = book.accounts[index]
    require(not book.frozen and type(amount) is int and amount > 0, 'active whole collection')
    require(account.cash >= gross_debt(account), 'underfunded debtor needs complete resolution')
    require(amount <= -account.claims[market], 'negative whole entitlement')
    claims, pools = list(account.claims), list(book.pools)
    claims[market] += amount
    pools[market] += amount
    return book.mutate(index, claims, account.cash - amount, pools)


def pay(book, index, market, amount):
    account = book.accounts[index]
    require(payment_eligible(book, market), 'complete market backing certificate')
    require(type(amount) is int and 0 < amount <= min(account.claims[market], book.pools[market]), 'whole funded entitlement')
    claims, pools = list(account.claims), list(book.pools)
    claims[market] -= amount
    pools[market] -= amount
    return book.mutate(index, claims, account.cash + amount, pools)


def net_flat(book, index, source_market, amount, *, owner_signed=True, cross=True, flat=True, live_orders=False):
    require(owner_signed and cross and flat and not live_orders, 'owner flat cross account without order authority')
    require(payment_eligible(book, source_market), 'source profit payment eligibility')
    destination = 1 - source_market
    account = book.accounts[index]
    require(type(amount) is int and 0 < amount <= min(account.claims[source_market],
            -account.claims[destination], book.pools[source_market]), 'netting requires actual whole backing')
    claims, pools = list(account.claims), list(book.pools)
    claims[source_market] -= amount
    claims[destination] += amount
    pools[source_market] -= amount
    pools[destination] += amount
    return book.mutate(index, claims, account.cash, pools)


@dataclass(frozen=True)
class FrozenCursor:
    """Canonical once-only paging; arithmetic plans never authorize page omission."""
    members: tuple[str, ...]
    epoch: int
    stage: int = 0
    next: int = 0
    # Value, proportional denominator, proof, flow plan, apply, reconcile.
    PASSES = 6

    def page(self, epoch, stage, supplied):
        require(epoch == self.epoch and stage == self.stage and self.stage < self.PASSES, 'stale stage/epoch')
        require(1 <= len(supplied) <= 2, 'bounded nonempty page')
        require(tuple(supplied) == self.members[self.next:self.next + len(supplied)], 'exact canonical page')
        end = self.next + len(supplied)
        return replace(self, stage=self.stage + (end == len(self.members)), next=0 if end == len(self.members) else end)

    def recover(self, *, authorized, reconciled, sources_ready):
        require(self.stage == self.PASSES and authorized and reconciled and sources_ready,
                'recovery requires complete discharge, authority and qualified sources')
        return self.epoch + 1
