# P22B — funded-exit proof and settlement decision

26 October 2026 · G17 in progress · baseline `64615a4`

This is the developing contract for [P22's roadmap](P22-ACCOUNT-CENTRIC-CLEARING.md).
Sections 1–3 establish independent arithmetic and proposed implementation obligations.
Section 4 records the user's selection of market-attributed losses under D57.
The complete financial/layout contract remains due before P23 can close its
dependency. No V1/V2 behavior, new profile or deployment changes here.

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

**Selected by the user on 26 October 2026 (D57): market-attributed settlement/loss
ownership, with explicit cross-market netting and default obligations.** This addresses the user's concern
that a healthy market's isolated claims should not be impaired solely because an
unrelated market shares a technical group. The selected direction includes the harder
accounting work; it does not promise strict contagion isolation or instantaneous
unfunded setoff. Existing V2 remains unchanged.

| Choice | Exact intended consequence | Cost / remaining limit |
|---|---|---|
| **Market-attributed losses (selected)** | In example B, pay BTC 100 and ETH 0; attribute settlement/insurance backing and creditor losses by market. Preserve cross-account obligations and complete default accounting rather than applying one blanket membership haircut | Must specify/verify shared-debtor allocation, netting obligations, cycles, fractional clearing and recovery before implementing/enabling. Cross debtors/netting links can propagate losses; resolving them may still require a complete venue scan/freeze |
| **Retain the current common loss domain (not selected for the new profile)** | In example B, pay BTC 50 and ETH 50 using the existing complete account-net waterfall and common P/I. Still remove fixed user market bundles and unnecessary funded-exit certificates | Simpler continuity of existing economics, but the isolated-profit contagion concern is unchanged. Account/UX improvements cannot be described as default isolation |

The user's explicit option-2 selection resolves B04 and supersedes D56's pending
choice, solely for the fresh profile. Existing V2 retains D47's common waterfall.
Do not close G17 or start P23 until the selected complete contract is recorded.
This does not change the taker/provider fee rates, zero positive unpaid credit or
maker capital isolation. D58 subsequently records approval of seed-plus-fee reserve
funding and a 25% insurance share of collected fees for the fresh profile. No
seed-capital amount or funded deployment is selected.

## 5. Preserved contract constraints and remaining work

The following design constraints remain in force under the selected direction:

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

Remaining P22B outputs: the complete state/transition and dependency
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
| Collect/pay/net claims | Existing role/owner restrictions plus selected settlement contract | Claim/funding ownership and complete selected pool/netting dependencies; the recipient's health check alone never authorizes payout. Section 4 selects market attribution; exact netting/payment transitions remain due |
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

## 7. Insurance: implemented baseline and approved new-profile policy

Inspected at `14586f9`; this is a code/source assessment, not a live reserve-balance
attestation or a new financial test. Insurance is dedicated funded collateral,
not an outside insurer's promise. Current V2 owns one group-level `insurance`
balance alongside `total_cash`, `settlement`, `fees` and `allocated_vault` in
[group state](../programs/clearing/src/state/v2/group.rs). These are separate ledger
balances inside one SPL collateral vault: `V = sum(C) + P + I + T`.

### What already works in the existing implementation

- Actual external collateral can seed insurance. V1 has a direct
  [insurance transfer](../programs/clearing/src/instructions/custody.rs). V2's
  [custody handlers](../programs/clearing/src/instructions/group_custody.rs) allow
  an actual vault surplus to be explicitly classified into I by group authority.
  Classification increases allocated custody by the same amount; it cannot invent
  tokens or turn a user's allocated cash into a donation.
- Collected 2 bps taker fees initially enter T; provider fees remain zero.
  `allocate_group_fees_v2` explicitly moves existing atoms from T to I under group
  authority while active/reconciled. No new tokens move, and no automatic percentage
  is configured. Trader funding payments and liquidation-receiver fees are not
  automatically insurance revenue. Frozen resolution forbids these allocations.
- [Complete default](../programs/clearing/src/instructions/group_safety/resolution/ledger.rs)
  values and collects the cohort first, allocates available whole-atom insurance
  against the residual debt, and transfers that backing from I to P once. Remaining
  uncovered liability impairs the complete eligible unpaid-positive cohort using
  the existing fractional rules. Unallocated T is excluded; healthy sibling cash
  is not an extra insurance balance. Ordinary profit settlement does not spend I.

The test harnesses exercise these transitions; this inspection does not rerun or
requalify them. There is no funded production reserve asserted by the code's presence.

### Direction under D57/D58

Attribute settlement backing and insurance budgets to their markets: `P_m`, `I_m`.
A common physical vault can still custody them if all allocations reconcile and
no atom belongs to two budgets. Cross collateral stays account-owned, counted once;
the selected deterministic debtor allocation precedes market insurance and residual
claim impairment. Insurance does not change margin mode or provide positive unpaid
margin credit. Complete liability accounting remains necessary for netting links.

For the restricted example C, proportional collection leaves debt 30 in each
market. With BTC insurance 20 and ETH insurance 10, residual debt is BTC 10 and ETH
20. These are illustrative integer identities, not acceptance of a general solver
for mixed-sign accounts, cycles or fractional/default priorities. G17 must complete
that solver before dependent implementation.

The user approves **initial seed capital plus replenishment from collected fees**
and then selects **25% of collected taker fees for insurance** under D58. Seed
capital supplies a reserve before volume exists; fee revenue can rebuild it. At
unchanged 2 bps, 1,000,000 quote units of executed notional earn 200 quote units
gross: 50 to that market's insurance and 150 to protocol fees, before network and
operating costs. The remaining 75% is not net profit. No seed amount is selected,
and no funded deployment is authorized. Existing V1/V2 fee behavior stays unchanged.

### Exact 25% fee allocation contract

The new profile fixes `insurance_fee_share_bps = 2500` out of 10,000. This is an
immutable profile policy, not a trader tier, caller argument or hot administrator
override. First assess the existing cumulative 2 bps fee on the authorized route
or order subfill, exactly once across both maker legs. Let `f` be the actual
whole-atom funded fee debit. Split that collected fee, never the notional or an
unpaid fee receivable, using a persistent **per-market** carry `r_m` in `[0,3]`:

```text
insurance_credit = floor((r_m + f) / 4)
next_r_m         = (r_m + f) mod 4
protocol_credit  = f - insurance_credit

C_payer -= f
I_m     += insurance_credit
T_m     += protocol_credit
V and every P_m are unchanged
```

Starting with zero carry, cumulative automatic insurance allocation is exactly
`floor(total_collected_fee_atoms_m / 4)` for each market, independently of how the
same collected total is partitioned across fills, maker legs, orders or payers.
Existing cumulative taker-fee rounding is retained: opening separate orders can
still change the assessed fee total; this policy does not silently waive it.
Zero-fee partial fills allocate zero and preserve the carry. Failed routes/subfills
roll back cash, reserve credits and carry together; failed network fees are separate.

The carry tracks the modulo-four fee count, **not fractional cash**, a participant
claim or spendable insurance. It adds no term to `V = sum(C) + sum(P_m+I_m+T_m)`.
Before the next whole insurance atom accrues, the indivisible cash remainder is in
T. Later fee collection funds the next credit without clawing back withdrawn T.
Seed deposits, explicit extra T-to-I allocations, treasury withdrawals, insurance
consumption and recovery do not advance/reset the carry. Closing/reopening an
order or account cannot reset market policy. A fresh market identity initializes
its carry to zero; retiring/replacing an identity cannot erase outstanding claims
or transfer/relabel reserves from the old one.

Use checked whole-atom balances within the existing candidate cash bound of
`10^15` atoms; `r_m+f <= 10^15+3`. The carry can fit in `u8`; the later exact
account layout must include it explicitly. A lifetime fee accumulator is not
required for splitting and cannot be reset to affect allocation. Events must
include the market/policy identity, gross fee, both credits and before/after carry
so the indexer independently reconstructs the allocation. P27 displays gross
fees, insurance contributions and retained protocol revenue separately.

### Reserve authority, transitions and acceptance

| Action | Required authority/state | Cash effect and preservation |
|---|---|---|
| Seed/top up a market reserve | Authorized donor token transfer and canonical market/mint/vault; explicit attribution under the reserve authority; non-frozen custody state | `V += z; I_m += z`. An actual unclassified vault donation is not insurance until the authorized classification. No trading fee, investor share or claim is minted |
| Allocate the automatic 25% | Clearing's accepted ordinary taker-fee transition; caller cannot opt out or choose a different market | The split above is atomic with the full fee debit and route/order effects; all touched accounts still satisfy final health including the complete fee |
| Allocate additional collected fees | Fee authority; amount bounded by that market's remaining T, canonical identity and non-frozen custody | `T_m -= z; I_m += z`; no change to V, fee carry or gross fee revenue. Already allocated insurance is not counted a second time |
| Consume insurance | Complete selected resolution's frozen valuation/collection and persisted stage; permissionless exact continuation, no caller-selected debtor/creditor subset | Move `min(I_m, floor(residual_debt_m))` whole atoms from I_m to P_m once, with matching debt extinguishment. Retain sub-atom liability for exact fractional resolution. T and foreign reserves are excluded |
| Withdraw retained protocol fees | Fee authority, canonical destination and applicable custody/safety gate; amount bounded by T_m | `T_m -= z; V -= z`; no reserve or carry reset, no borrowing from user cash or I |
| Recover/retire an insurance reserve | No active-profile insurance withdrawal/reassignment instruction; terminal recovery requires the final G17 complete-liability discharge/authority contract | No live administrator sweep, cross-market transfer or early reserve-release bypass. Recovery must preserve the fee carry for any continuing market identity |

Direct external token donations may arrive while frozen; they remain unallocated
surplus and cannot modify the snapshotted default waterfall. No additional trader
funding-payment or liquidation-receiver fee is taxed by this split. Ordinary profit
settlement does not consume insurance. The finite reserve may exhaust; uncovered
liability follows the selected complete market-attributed default rule.

The independent `ReserveLedger` reference models these cash effects and bounded
inputs, including seed/fee distinction and fractional residual debt. It does not
authenticate authority, derive claims, enforce frozen stages/replay, transfer SPL
tokens or prove liquidation/default completion. Its restricted composed default
case has integral claims and no mixed-sign accounts; the general solver remains
required G17 work.

- **P23 / G18:** exact reserve/carry layouts and policy binding; actual seed-token
  transfers and rejection of foreign/duplicate classification/unauthorized writes.
- **P24 / G19 core:** real fee assessment/split for immediate routes, two-maker
  execution and persistent partial fills; zero provider fees, adverse health and
  full rollback on a failed second leg; generated/legacy parity and packet/CU cost.
- **P25 / G19 cash:** explicit allocations/treasury gates, actual custody
  reconciliation, no ordinary gain-payment use of I or double counting of carry.
- **P26 / G20:** complete-cohort market attribution, exhaustion, fractional
  residuals, once-only stage/restart behavior and restricted terminal recovery.
- **P27/P28 / G21:** versioned events, independent PostgreSQL reconstruction,
  funding/cost reporting, reserve visibility and fresh integrated qualification.

Keep the abstraction small: attributed funded reserves, top-up/allocation events,
default consumption, bounded withdrawal/recovery authority and observable balances.
G17 must prevent pledged capital from being withdrawn or reallocated during a
claim/default and define recovery/exhaustion behavior. Do not implicitly sweep a
healthy market's reserve into a failed one. A shared cross-market backstop would
introduce additional risk sharing and needs its own explicit policy. Public LP
insurance shares, yield promises, governance tokens and routine insurance-funded
profit advances are outside this direction. Funded readiness still requires actual
reserve sizing, risk calibration and P16B; the accounting cannot guarantee adequacy.

### Targeted Percolator comparison

The user-supplied [Quicknode book](https://go.quicknode.com/hubfs/Building%20Financial%20Software%20on%20Solana.pdf),
chapter 20, is a pooled-liquidity teaching implementation. Pages 259/262 describe a
fee split into insurance and separate vault-accounting buckets; pages 271–273 use
insurance, then LP liquidity, for uncovered losses and permit insurance-backed
profit payouts. Page 276 explicitly identifies a simplified Percolator-inspired
model. It is not evidence of the current Percolator deployment or Rivalt behavior.
Retain the reserve/accounting lesson; do not import its pooled LP loss bearer,
profit-payment policy or example fee split into Rivalt's competing margined makers.

Separately inspected author repositories at pinned revisions:
[wrapper README `5cb331d`](https://github.com/aeyakovenko/percolator-prog/blob/5cb331dde354517c6371a8acf92cecb194f3bb73/README.md)
describes per-asset insurance/backing and configurable fee routing;
[engine `4db11a8`](https://github.com/aeyakovenko/percolator/blob/4db11a8cb0053815e23a35d3a7d3edc265d8d866/README.md)
describes source-domain-bounded support and labels itself unaudited educational
research. Its [specification](https://github.com/aeyakovenko/percolator/blob/4db11a8cb0053815e23a35d3a7d3edc265d8d866/spec.md)
has insurance credit reservations and realizable positive-P&L credit, which Rivalt
does not adopt. Source pins make the comparison reproducible; no upstream proof
count is claimed as independently executed or as Rivalt acceptance.
