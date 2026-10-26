# P22B — funded-exit proof and settlement decision

26 October 2026 · G17 in progress · baseline `64615a4`

This is the developing contract for [P22's roadmap](P22-ACCOUNT-CENTRIC-CLEARING.md).
Sections 1–3 establish independent arithmetic and proposed implementation obligations.
Section 4 is a concrete product decision: its alternatives pay different creditors.
It must be resolved before the complete financial/layout contract and P23 can close
their dependencies. No V1/V2 behavior, new profile or deployment changes here.

## 1. Independent reference and its limits

Run `python3 tests/financial/test_account_contract.py`. The separate
[reference](../tests/financial/account_contract_reference.py) imports no Rust,
SDK or program implementation. Literal expected outcomes test withdrawal coverage,
funding/fractions, collection/payment, default ownership and netting counterexamples.
It also enumerates 23,328 bounded withdrawal inputs with thirds of atoms.

These are specification/model checks. They do not authenticate PDAs, sources,
orders or signatures, prove Solana atomicity, validate checked-integer overflow
bounds, or qualify an executable financial path. The market-default comparison
explicitly rejects mixed-sign accounts: it is not a general cross-default solver.
P24–P26 must recreate the selected cases against the real implementation and
signed compiled programs; P27/P28 require real RPC/WS/PostgreSQL/browser effects.

## 2. Funded withdrawals: local arithmetic proof

At one authenticated on-chain snapshot, let:

- `C` be this account's whole-atom funded cash, counted once;
- `U_m` be its fully accrued common claim in market m;
- `L_m <= U_m` be its conservative risk claim at the same funding endpoint;
- `B = sum(max(-L_m, 0))` be its conservative total negative obligations;
- `H = IM + R` be nonnegative initial margin plus refreshed remaining reservations;
- `w` be the requested whole-atom cash withdrawal after applicable cash costs.

Require `0 < w <= C` and `C - w >= B + H`. Then the account still has at least
enough cash to cover every negative common claim in full, since
`sum(max(-U_m,0)) <= B <= C-w`. Its current gross and account-net cash shortfall
are both zero. Other accounts' cash/claims and settlement/insurance/fee pools do
not change. Under `V = sum(C_a) + P + I + T`, changing this C and V by the same
`-w` preserves the identity. The same cash argument works with explicitly separate
settlement pools, provided their claim/ownership identities are maintained.

Consequently this operation does not take settlement backing from unpaid creditors
or change another account's existing shortfall. This is a current-snapshot result,
not protection against a subsequent price gap, token depeg, dishonest upgrade or
missing on-chain dependency. It does not prove a gain payment safe: payment changes
both settlement backing and the remaining unpaid creditor population.

For an internal cash transfer, first admit the donor under the same inequality,
then add the amount to the recipient without duplicating it. The vault and total
cash are unchanged. Receiving cash does not by itself grant trading permission.
Owner, domain, freeze and recipient-binding checks still apply.

### Preserve already-qualified funding-window safeguards

The current certificate also checks held-funding endpoint combinations. The new
cash path must not forget that obligation when removing the all-member scan:
after withdrawal, require nonnegative account risk equity at every conservative
combination of its still-valid held-funding endpoints, in addition to current
`IM + R` admission. With two positions that means at most four corners. Equivalently
for these additive claims, use the lower risk claim in each endpoint pair.

For example, cash 100 covers each diagonal `(-60,+60)` and `(+60,-60)` separately,
but not the mixed `(-60,-60)` corner. The independent reference rejects that exit.
This is a proposed post-withdrawal requirement; it is not a claim that V2 already
rechecks its full certificate after changing cash. It preserves the funding-window
concern without demanding proofs about unrelated members.

Funding history must be irreversible, but the signed funding index need not be
numerically increasing. If an account consumes index 5 while the market persists
only 0, later hold expiry must not return its effective index to 0 and refund the
already-applied debit. Materialize every consumed relevant market prefix in the
same transaction. New valid negative premiums can legitimately lower the index.
The reference checks both the rollback counterexample and signed fractional accrual.

### Required program preconditions

1. Derive the complete market dependency set from canonical positions, nonzero
   claims, active orders/protections and the requested operation. Never let a caller
   omit a losing market. Account mode/role/market identities remain immutable.
2. Authenticate source bounds and include every pending funding debit at one Clock
   snapshot. Materialize consumed funding prefixes where necessary: a later sampler
   expiry/config change must not reverse funding already applied to an account.
   Check post-withdrawal held-funding corners as well as current admission.
3. Recompute all remaining reservations, fee budgets and protection generations.
   Cached UI/worker equity is not authority; deposited cash is not counted twice.
4. Serialize account/custody changes with Solana write locks; apply checks, state
   changes and the actual SPL token transfer in one transaction. A failed transfer
   or second instruction rolls back the financial effects.
5. Require owner-authorized destination, canonical token/mint/vault binding,
   available actual vault balance and maintained allocated-custody accounting.
   Observe the selected safety/freeze state. No exit during frozen default unless
   the final contract explicitly qualifies such a separate path.
6. Do not bind ordinary funded withdrawal to a historical all-member solvency
   certificate or unrelated event sequence. Relevant current health/freeze changes
   can still reject it. Reconstruct the exact event/custody effect independently.

Under current V2 code, `financial-core::margin::withdraw` already checks own
post-state cash/funding/health. The additional complete-group requirement is in
[group settlement/cash](../programs/clearing/src/instructions/group_safety/settlement.rs).
Removing it from existing V2 is not this phase's implementation or migration plan.

## 3. Exact counterexamples that determine scope

All example amounts below are illustrative whole quote atoms unless written as
fractions. They are terminal/current snapshots, not oracle or deployment evidence.

### A. Funded exit and profit payment are different

Account claims are `(+50, +50, -50)` and P=50; the debtor has no cash. A common
default now pays the two winners 25 each. Paying the first winner 50 before default
leaves P=0 and the other winner receives zero. This illustrates why checking only
the recipient and P is insufficient to preserve the current gain-payment policy.
V2's complete-cohort certificate rejects that insolvent pre-state.

Once the first 50 has actually been paid and is funded C, withdrawing it does not
further change the second winner's claim or P. The allocation change occurred at
payment. The new contract must therefore define payment eligibility separately;
the funded-exit proof cannot be reused to remove a gain-payment safeguard.

### B. A market-only failure affects different creditors under the two models

Four separate accounts, no insurance, no initial settlement cash:

| Account | Funded cash | BTC claim | ETH claim |
|---|---:|---:|---:|
| BTC debtor | 100 | -100 | 0 |
| BTC isolated winner | 0 | +100 | 0 |
| ETH debtor | 0 | 0 | -100 |
| ETH isolated winner | 0 | 0 | +100 |

The existing common waterfall collects 100 and pays **50 BTC / 50 ETH** to the
winners. Market-attributed pools with complete per-market creditor allocation pay
**100 BTC / 0 ETH**. Both conserve cash; neither repairs the missing ETH backing.
The difference is who bears that shortfall. It cannot be decided by an account
rename or presented as a merely technical optimization.

### C. Cross debtors still connect markets

A single debtor has cash 100 and claims `(-80 BTC, -80 ETH)`. With proportional
allocation over its market debts, it pays 50 to each market, leaving each with 30
uncovered. Separate market accounting does not supply the missing 60 or guarantee
isolated winners against failure of their own market's cross debtor.

### D. Unfunded single-account netting is not market-neutral

A flat cross account has `(+100 BTC, -100 ETH)`, a BTC debtor has `-100 BTC`, and
an ETH winner has `+100 ETH`. Initial cash and both pools are zero; both market
claim sums are zero. Cancelling the cross account's opposite claims preserves the
venue sum but changes market sums to `(-100 BTC, +100 ETH)`.

Separate nonnegative cash pools cannot represent that result alone. A market model
needs an explicit BTC-to-ETH obligation, a funded pool transfer, or a qualified
simultaneous clearing arrangement. A cross-market receivable is not cash. Its
shortfall and priority must have an owner; deleting it loses the liability.

If the BTC debtor first pays 100 into the BTC pool, paying the cross account and
collecting its ETH debt moves actual backing to the ETH pool. This is a safe cash
flow identity, but cannot provide immediate netting when the backing is absent.

A closed cycle is a separate case: two accounts with `(100,-100)` and `(-100,100)`
can both be cancelled simultaneously with zero cash and zero final market sums.
That is mathematically possible; it is not the existing single-owner netting call.
A general model must handle both this cycle and cycles with external creditors,
defaults and fractional ownership. Do not use a restricted example as that solver.

## 4. Product decision: loss allocation for the fresh profile

**Recommendation: market-attributed settlement/loss ownership, with explicit
cross-market netting and default obligations.** This addresses the user's concern
that a healthy market's isolated claims should not be impaired solely because an
unrelated market shares a technical group. The recommendation includes the harder
accounting work; it does not promise strict contagion isolation or instantaneous
unfunded setoff. Existing V2 remains unchanged.

| Choice | Exact intended consequence | Cost / remaining limit |
|---|---|---|
| **Market-attributed losses (recommended)** | In example B, pay BTC 100 and ETH 0; attribute settlement/insurance backing and creditor losses by market. Preserve cross-account obligations and complete default accounting rather than applying one blanket membership haircut | Must specify/verify shared-debtor allocation, netting obligations, cycles, fractional clearing and recovery before implementing/enabling. Cross debtors/netting links can propagate losses; resolving them may still require a complete venue scan/freeze |
| **Retain the current common loss domain** | In example B, pay BTC 50 and ETH 50 using the existing complete account-net waterfall and common P/I. Still remove fixed user market bundles and unnecessary funded-exit certificates | Simpler continuity of existing economics, but the isolated-profit contagion concern is unchanged. Account/UX improvements cannot be described as default isolation |

This is the concrete choice required by [D56](DECISIONS.md) and repository policy:
changes to loss bearers require an explicit product decision. Approval to stack
implementation phases is recorded; it does not silently select the different
creditor allocation above. Do not close G17 or start P23 until the choice and its
complete contract are recorded. The model/reference work remains useful under
either choice; neither option changes fees, zero positive unpaid credit or maker
capital isolation.

## 5. Contract work independent of that choice

The following design constraints can be completed while the decision is pending:

- Fresh schema/profile 3 namespace, one six-decimal mint, two initially qualified
  markets and current bounded account/order capacity; no live V1/V2 conversion.
- Portfolio as owner namespace only; child zero cross, positive children immutable
  isolated, maker capital isolated. Deposit/transfer/withdrawal authority remains
  owner-only; delegated trading is scoped, expiring and immediately revocable.
- Separate immutable domain/configuration, account replay authority, market pricing/
  funding dependencies and historical event ordering. An event counter need not be
  a quote validity condition. A shared writable vault/account is not claimed away.
- Preserve exact FOK/two-maker/cumulative-fee and TP/SL-generation behavior. Every
  touched trader, donor, maker and liquidation receiver gets complete final health.
- No positive credit, correlation discount, borrowing facility, funding reversal,
  caller-selected haircut subset or administrator bypass of financial activation.
- Actual old withdrawal/new deposit for migration; no relabelled claims, reserves,
  open positions or fee/insurance ownership. New ordinary financial activation
  remains disabled through P25 and requires P26's fresh safety acceptance.

Remaining P22B outputs after selection: the complete state/transition and dependency
matrix, exact new layout sizes/seeds/discriminators, settlement/insurance/netting
and default/fraction contract, numeric/budget bounds, source/payment/freeze policy,
version-specific supersession record and full independent reference cases. Existing
checks do not close those outputs. External P15B/P16B and deferred endurance remain
unchanged; no funded deployment, paid service or outreach is authorized.

## 6. Authority and dependency contract prepared independently

This is the proposed non-loss-policy boundary for the fresh profile. Exact ABI
layouts and selected resolution dependencies still belong to completed G17. A
market source/configuration being unavailable is not a substitute for an on-chain
permission check, and a worker's cached account view is not the canonical root.

| Action | Authority | State/dependency obligations |
|---|---|---|
| Create portfolio/account | Owner signature; authorized venue/market admission | Canonical venue/owner/index/mode/role, fixed market eligibility, bounded complete member registry, unfrozen state; no initial cash from registration |
| Deposit | Owner and bound source token account | Root, custody/vault/mint and safety state; real token transfer; no price-dependent trading permission from deposit |
| Withdraw funded cash | Owner and bound destination | Complete root health/reservations, relevant sources and consumed funding, held-funding corners, custody and selected freeze state; token transfer and checks atomic |
| Transfer allocated cash | Owner of both distinct roots in the same new deployment/mint | Donor full exit check; recipient funding/identity, no new trading permission; no claim transfer or implicit sibling guarantee |
| Immediate route | Owner or current account-scoped delegate | Root replay nonce, delegate epoch/expiry, market terms, exact size/side/all-in fee limits, relevant sources/funding, selected maker approvals/config/consumption and complete final health |
| Place/replace order | Owner or current account-scoped delegate | Persist exact market, version, fee prefix, expiry, reserve and protection authority; recompute every remaining risk-increasing reservation |
| Cancel | Owner or allowed current delegate; stored permissionless cleanup only for its defined terminal cases | Root/order version and authority; no maker quote or fresh price prerequisite for releasing authority; respect frozen resolution ownership of the book |
| Execute persisted order | Keeper acting under stored live authority | Same financial dependencies as a route plus remaining quantity/fee, version, trigger, delegate epoch and TP/SL generation/allowance |
| Grant/revoke delegate | Root owner only | Root-scoped key/expiry/epoch; revoke stale immediate/order authority; no collateral or netting permission delegated |
| Collect/pay/net claims | Existing role/owner restrictions plus selected settlement contract | Claim/funding ownership and complete selected pool/netting dependencies; the recipient's health check alone never authorizes payout. Final loss/payment policy pending section 4 |
| Liquidate | Consenting funded receiver under protocol eligibility | Whole-account pre/post target deficit after fees, complete receiver health/reserves, current credible bounds and exact exposure reduction |
| Freeze/resolve/recover | Defined permissionless bankruptcy proof or source-emergency authority; exact pages; authorized recovery | Complete selected liability membership, prices/funding/epoch and no omitted claims/fractions. No new financial activation before P26 |

**Required dependency set:** derive market identities from every nonzero position,
nonzero claim, active order/protection and selected action across all touched roots.
Authenticate even a flat claim's market/ledger ownership. Fresh price is required
where valuation, reservations or a trigger depends on it; fixed flat claims do not
invent price exposure. Empty unrelated slots must not acquire an artificial price
dependency. Shared collateral sources remain relevant wherever an exposed position
needs collateral-denominated bounds. Missing/duplicate/foreign entries reject.

**Writes versus invalidation:** funded-account mutation still writes the root;
actual token movement writes custody/vault; consumed funding may write every
exposed market; routes write selected maker consumption. Those locks are real and
must be measured. An unrelated account's event must not invalidate the caller's
intent merely by advancing a venue history counter. Changing genuine authority,
terms, replay nonce, selected pricing commitments or relevant safety state must
still be enforced. The final contract must distinguish exact-version commitments
from user-authorized limits that are re-evaluated against current qualified state.

**Reconstruction:** every changed financial object needs a versioned event and
canonical sequence/identity. Removing a global validity counter cannot remove
complete history discovery, immutable original-signature recovery, failed-event
exclusion or atomic PostgreSQL projection/checkpoint updates. P27 owns the actual
implementation and recovery evidence, not this dependency matrix.
