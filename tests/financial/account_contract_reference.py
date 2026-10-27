"""P22B independent contract arithmetic, not a program or runtime simulator.

Uses exact Python fractions and imports no Rivalt implementation. Common-ledger
transitions and deliberately restricted market-loss examples explain the selected
policy. The reserve model specifies D58's fee split independently of runtime code.
No account/source authentication, Solana atomicity, general checked-integer proof
or general market-default solver is supplied.
"""

from dataclasses import dataclass, replace
from fractions import Fraction


class InvalidTransition(ValueError):
    pass


def require(condition, reason):
    if not condition:
        raise InvalidTransition(reason)


# P22B retains the current bounded profile's atom limit. This independent model
# does not import financial-core or prove its checked-integer implementation.
MAX_CASH_ATOMS = 1_000_000_000_000_000


def bounded_atoms(value):
    return type(value) is int and 0 <= value <= MAX_CASH_ATOMS


@dataclass(frozen=True)
class MarketReserve:
    settlement: int = 0
    insurance: int = 0
    protocol_fees: int = 0
    fee_remainder: int = 0

    def __post_init__(self):
        require(all(bounded_atoms(value) for value in
                    (self.settlement, self.insurance, self.protocol_fees)),
                "reserve balances must be bounded whole atoms")
        require(type(self.fee_remainder) is int and 0 <= self.fee_remainder < 4,
                "fee allocation remainder must be in [0, 3]")


@dataclass(frozen=True)
class ReserveLedger:
    """Cash-bucket identities only, not the full claim/netting/default contract."""
    cash: tuple[int, ...]
    markets: tuple[MarketReserve, MarketReserve]
    vault: int

    def __post_init__(self):
        require(type(self.cash) is tuple and all(bounded_atoms(value) for value in self.cash),
                "account cash must be bounded whole atoms")
        require(type(self.markets) is tuple and len(self.markets) == 2 and
                all(type(market) is MarketReserve for market in self.markets),
                "two canonical market reserves required")
        require(bounded_atoms(self.vault), "vault exceeds the bounded profile")
        require(self.vault == sum(self.cash) + sum(
            market.settlement + market.insurance + market.protocol_fees
            for market in self.markets), "reserve custody does not reconcile")

    def market(self, market_index):
        require(type(market_index) is int and 0 <= market_index < 2, "invalid market")
        return self.markets[market_index]

    def replace_market(self, market_index, reserve, **changes):
        self.market(market_index)
        markets = list(self.markets)
        markets[market_index] = reserve
        return replace(self, markets=tuple(markets), **changes)


def collect_trading_fee(ledger, account_index, market_index, fee_atoms):
    """Allocate an ALREADY assessed cumulative 2-bps fee; never recalculate it."""
    reserve = ledger.market(market_index)
    require(type(account_index) is int and 0 <= account_index < len(ledger.cash),
            "invalid fee payer")
    require(bounded_atoms(fee_atoms) and fee_atoms <= ledger.cash[account_index],
            "fee must be funded by the payer's cash")
    insurance_credit, remainder = divmod(reserve.fee_remainder + fee_atoms, 4)
    cash = list(ledger.cash)
    cash[account_index] -= fee_atoms
    return ledger.replace_market(market_index, replace(
        reserve, insurance=reserve.insurance + insurance_credit,
        protocol_fees=reserve.protocol_fees + fee_atoms - insurance_credit,
        fee_remainder=remainder), cash=tuple(cash))


def inject_insurance(ledger, market_index, amount):
    """Model a verified external transfer; authentication/token CPI are not modeled."""
    reserve = ledger.market(market_index)
    require(bounded_atoms(amount) and amount > 0, "invalid insurance injection")
    return ledger.replace_market(market_index, replace(
        reserve, insurance=reserve.insurance + amount), vault=ledger.vault + amount)


def allocate_fee_reserve(ledger, market_index, amount):
    """Extra explicit T-to-I allocation; never resets or advances the fee carry."""
    reserve = ledger.market(market_index)
    require(bounded_atoms(amount) and 0 < amount <= reserve.protocol_fees,
            "allocation exceeds collected protocol fees")
    return ledger.replace_market(market_index, replace(
        reserve, protocol_fees=reserve.protocol_fees - amount,
        insurance=reserve.insurance + amount))


def withdraw_protocol_fees(ledger, market_index, amount):
    """Arithmetic only; production must enforce fee authority and the safety gate."""
    reserve = ledger.market(market_index)
    require(bounded_atoms(amount) and 0 < amount <= reserve.protocol_fees,
            "withdrawal exceeds retained protocol fees")
    return ledger.replace_market(market_index, replace(
        reserve, protocol_fees=reserve.protocol_fees - amount), vault=ledger.vault - amount)


def cover_default_debt(ledger, market_index, residual_debt):
    """One market's cash effect AFTER a complete qualified collection pass.

    Caller must establish frozen cohort/stage, current exact residual and replay
    protection. This reference alone does not prove those runtime preconditions.
    Sub-atom residual remains a liability for the selected fractional resolution.
    """
    reserve = ledger.market(market_index)
    require(type(residual_debt) in (int, Fraction) and residual_debt >= 0,
            "default debt must be exact and nonnegative")
    residual_debt = Fraction(residual_debt)
    insurance_used = min(reserve.insurance, residual_debt.numerator // residual_debt.denominator)
    result = ledger.replace_market(market_index, replace(
        reserve, insurance=reserve.insurance - insurance_used,
        settlement=reserve.settlement + insurance_used))
    return result, residual_debt - insurance_used


@dataclass(frozen=True)
class Account:
    cash: int
    claims: tuple[Fraction, Fraction]

    def __post_init__(self):
        require(type(self.cash) is int and self.cash >= 0, "cash must be whole atoms")
        require(len(self.claims) == 2, "complete two-market claim vector required")
        require(all(type(value) in (int, Fraction) for value in self.claims),
                "claims must be exact")
        object.__setattr__(self, "claims", tuple(Fraction(value) for value in self.claims))


@dataclass(frozen=True)
class CommonLedger:
    accounts: tuple[Account, ...]
    pool: int = 0
    insurance: int = 0
    fees: int = 0

    @property
    def allocated(self):
        return sum(account.cash for account in self.accounts) + self.pool + self.insurance + self.fees

    def validate(self):
        require(all(type(value) is int and value >= 0
                    for value in (self.pool, self.insurance, self.fees)), "invalid cash pool")
        require(sum(sum(account.claims) for account in self.accounts) == self.pool,
                "unpaid claims do not reconcile to settlement cash")

    def replace_account(self, index, account, **pools):
        accounts = list(self.accounts)
        accounts[index] = account
        result = replace(self, accounts=tuple(accounts), **pools)
        result.validate()
        return result


def risk_equity(cash, risk_claims):
    require(type(cash) is int and cash >= 0, "cash must be whole atoms")
    require(len(risk_claims) == 2, "complete risk vector required")
    require(all(type(value) in (int, Fraction) for value in risk_claims), "risk claims must be exact")
    return cash + sum(min(Fraction(claim), 0) for claim in risk_claims)


def funded_withdraw(ledger, index, amount, risk_claims, initial_margin=0, reserved=0,
                    funding_endpoint_claims=None):
    """Arithmetic candidate only; production must authenticate every precondition."""
    ledger.validate()
    account = ledger.accounts[index]
    require(type(amount) is int and 0 < amount <= account.cash, "invalid withdrawal")
    require(len(risk_claims) == 2, "complete risk vector required")
    require(all(risk <= common for risk, common in zip(risk_claims, account.claims)),
            "risk claims must conservatively bound common claims")
    require(all(type(value) is int and value >= 0 for value in (initial_margin, reserved)),
            "requirements must be whole nonnegative atoms")
    require(risk_equity(account.cash - amount, risk_claims) >= initial_margin + reserved,
            "post-withdrawal obligations are not covered")
    endpoints = funding_endpoint_claims
    if endpoints is None:
        endpoints = tuple((claim, claim) for claim in risk_claims)
    require(len(endpoints) == 2 and all(len(pair) == 2 for pair in endpoints),
            "complete held-funding endpoint pairs required")
    require(all(type(value) in (int, Fraction) for pair in endpoints for value in pair),
            "funding endpoints must be exact")
    require(all(min(pair) <= current <= max(pair) for pair, current in zip(endpoints, risk_claims)),
            "current risk claim must lie within its funding endpoints")
    require(risk_equity(account.cash - amount, tuple(min(pair) for pair in endpoints)) >= 0,
            "post-withdrawal held-funding corner is insolvent")
    result = ledger.replace_account(index, replace(account, cash=account.cash - amount))
    require(result.allocated == ledger.allocated - amount, "cash mismatch")
    return result


def accrue_claim(lots, virtual, checkpoint, funding):
    """Exact claim ownership; signed funding may legitimately increase or decrease."""
    require(type(lots) is int, "lots must be integral")
    require(all(type(value) in (int, Fraction) for value in (virtual, checkpoint, funding)),
            "funding values must be exact")
    return Fraction(virtual) - lots * (funding - checkpoint)


def collect(ledger, index, market, amount):
    ledger.validate()
    account = ledger.accounts[index]
    require(type(amount) is int and 0 < amount <= account.cash, "unfunded collection")
    require(Fraction(amount) <= -account.claims[market], "collection exceeds liability")
    claims = list(account.claims)
    claims[market] += amount
    result = ledger.replace_account(index, Account(account.cash - amount, tuple(claims)),
                                    pool=ledger.pool + amount)
    require(result.allocated == ledger.allocated, "collection creates cash")
    return result


def pay(ledger, index, market, amount):
    """Backing/claim identity only; payout admissibility is a separate contract gate."""
    ledger.validate()
    account = ledger.accounts[index]
    require(type(amount) is int and 0 < amount <= ledger.pool, "insufficient pool cash")
    require(Fraction(amount) <= account.claims[market], "payment exceeds entitlement")
    claims = list(account.claims)
    claims[market] -= amount
    result = ledger.replace_account(index, Account(account.cash + amount, tuple(claims)),
                                    pool=ledger.pool - amount)
    require(result.allocated == ledger.allocated, "payment creates cash")
    return result


def flat_net(ledger, index):
    """Common-domain arithmetic; caller must prove flat/no-order owner authority."""
    ledger.validate()
    account = ledger.accounts[index]
    first, second = account.claims
    require(first * second < 0, "opposite claims required")
    cancelled = min(abs(first), abs(second))
    claims = (first - cancelled, second + cancelled) if first > 0 else (
        first + cancelled, second - cancelled)
    return ledger.replace_account(index, replace(account, claims=claims))


def apportion_atoms(total, weights):
    """Exact pro-rata entitlement, then stable-index largest remainders for atoms."""
    require(type(total) is int and total >= 0, "invalid amount")
    require(all(type(weight) in (int, Fraction) and weight >= 0 for weight in weights),
            "weights must be exact and nonnegative")
    denominator = sum(weights)
    if denominator == 0:
        require(total == 0, "cash without claimant")
        return tuple(0 for _ in weights)
    exact = tuple(Fraction(total) * weight / denominator for weight in weights)
    result = [value.numerator // value.denominator for value in exact]
    order = sorted(range(len(weights)), key=lambda index: (-(exact[index] - result[index]), index))
    for index in order[:total - sum(result)]:
        result[index] += 1
    require(sum(result) == total, "atom allocation mismatch")
    return tuple(result)


def common_default(ledger):
    """Terminal common-domain waterfall; fees are not insurance, no cash clawback."""
    ledger.validate()
    net = tuple(sum(account.claims) for account in ledger.accounts)
    collected = tuple(min(account.cash, (-min(claim, 0)).numerator //
                          (-min(claim, 0)).denominator)
                      for account, claim in zip(ledger.accounts, net))
    residual_debt = sum(max(-claim - cash, 0) for claim, cash in zip(net, collected))
    insurance_used = min(ledger.insurance, residual_debt.numerator // residual_debt.denominator)
    available = ledger.pool + sum(collected) + insurance_used
    positive = tuple(max(claim, 0) for claim in net)
    require(sum(positive) - residual_debt == ledger.pool + sum(collected), "debt mismatch")
    payments = apportion_atoms(available, positive)
    final_cash = tuple(account.cash - loss + payment
                       for account, loss, payment in zip(ledger.accounts, collected, payments))
    require(sum(final_cash) + ledger.insurance - insurance_used + ledger.fees == ledger.allocated,
            "default cash mismatch")
    return final_cash, payments, insurance_used


def market_default_example(accounts, pools=(0, 0), insurance=(0, 0)):
    """Restricted comparison ONLY: integral claims, no account has both signs.

    Cash is apportioned over a debtor's gross market debts, then each market pays
    its own complete positive cohort. Mixed-sign accounts/cycles need a separately
    selected recovery/netting contract. Reject them instead of suggesting this is
    an implementation-ready general cross-market default algorithm.
    """
    require(len(pools) == len(insurance) == 2, "two market pools required")
    require(all(type(value) is int and value >= 0 for value in (*pools, *insurance)), "invalid pools")
    for account in accounts:
        require(all(claim.denominator == 1 for claim in account.claims), "example requires whole claims")
        require(not (min(account.claims) < 0 < max(account.claims)),
                "mixed-sign/cyclic default is not defined by this example")
    for market in range(2):
        require(sum(account.claims[market] for account in accounts) == pools[market],
                "market claim identity broken")
    contributions = []
    for account in accounts:
        debts = tuple(int(max(-claim, 0)) for claim in account.claims)
        contributions.append(apportion_atoms(min(account.cash, sum(debts)), debts))
    payments = []
    insurance_used = []
    for market in range(2):
        collected = sum(contribution[market] for contribution in contributions)
        debt = sum(max(-account.claims[market], 0) for account in accounts) - collected
        used = min(insurance[market], int(debt))
        insurance_used.append(used)
        payments.append(apportion_atoms(pools[market] + collected + used,
                                        tuple(max(account.claims[market], 0) for account in accounts)))
    final_cash = tuple(account.cash - sum(contributions[index]) +
                       sum(payment[index] for payment in payments)
                       for index, account in enumerate(accounts))
    before = sum(account.cash for account in accounts) + sum(pools) + sum(insurance)
    require(sum(final_cash) + sum(insurance) - sum(insurance_used) == before, "market cash mismatch")
    return final_cash, tuple(payments), tuple(insurance_used)
