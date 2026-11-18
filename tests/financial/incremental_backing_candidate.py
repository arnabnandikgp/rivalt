"""P51B backing-summary proof model; no on-chain authority or live risk admission.

Each root is (cash, quantities, checkpoint-adjusted fixed scaled claims). Already
admitted mutations maintain scanned contributions under a fixed price/funding
rectangle. Current oracle validity and whole-account payment admission are still
required outside this model. No price update rewrites cash or funding history.
"""

from dataclasses import dataclass

SCALE = 10**9


@dataclass(frozen=True)
class Root:
    cash: int
    quantities: tuple[int, int]
    fixed: tuple[int, int]


@dataclass(frozen=True)
class Region:
    # (minimum price, maximum price, minimum funding, maximum funding), per market.
    markets: tuple[tuple[int, int, int, int], tuple[int, int, int, int]]

    def minimum_claims(self, root):
        result = []
        for quantity, fixed, (price_low, price_high, funding_low, funding_high) in zip(
            root.quantities, root.fixed, self.markets
        ):
            low, high = price_low*SCALE-funding_high, price_high*SCALE-funding_low
            result.append(fixed + quantity * (low if quantity >= 0 else high))
        return tuple(result)

    def contains(self, prices, funding):
        return all(price_low <= price <= price_high and funding_low <= index <= funding_high
                   for price, index, (price_low, price_high, funding_low, funding_high)
                   in zip(prices, funding, self.markets))


class Backing:
    def __init__(self, roots, region, market):
        if market not in (0, 1):
            raise ValueError("market")
        self.roots = dict(roots)
        self.region, self.market = region, market
        self.scanned = {}
        self.bad = 0
        self.quantity_sum = 0
        self.fixed_sum = 0

    def contribution(self, root):
        minimum = self.region.minimum_claims(root)
        gross_debt = sum(max(-claim, 0) for claim in minimum)
        bad = minimum[self.market] < 0 and root.cash*SCALE < gross_debt
        return int(bad), root.quantities[self.market], root.fixed[self.market]

    def scan(self, identity):
        before = self.scanned.get(identity, (0, 0, 0))
        after = self.contribution(self.roots[identity])
        self.bad += after[0] - before[0]
        self.quantity_sum += after[1] - before[1]
        self.fixed_sum += after[2] - before[2]
        self.scanned[identity] = after

    def mutate(self, updates):
        # A real implementation must authenticate every root and apply these
        # deltas in the SAME atomic invocation as its financial effects.
        for identity, root in updates.items():
            if identity not in self.roots:
                raise ValueError("unknown member")
            self.roots[identity] = root
            if identity in self.scanned:
                self.scan(identity)

    def ready(self, pool, prices, funding, *, current_sources_valid):
        return (current_sources_valid and self.region.contains(prices, funding)
                and len(self.scanned) == len(self.roots) and self.bad == 0
                and self.quantity_sum == 0 and self.fixed_sum == pool*SCALE)
