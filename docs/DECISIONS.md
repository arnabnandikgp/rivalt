# Protocol decisions

This register summarizes choices enforced by the local protocol. The [original dated decisions and their alternatives](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/DECISIONS.md) remain available by decision number.

| Choice | Reason and consequence |
|---|---|
| Common clearing with isolated maker capital | A trader can open against one maker and close against another. The clearing program owns the position, custody and risk checks. A maker controls prices and its separately funded inventory. [Accounts](clearing/accounts.md) |
| Funded cash and unpaid claims are separate | A profitable close may leave an unpaid claim. Usable collateral must exist in custody. Positive unpaid gains supply no margin credit. Risk values longs and shorts against independent adverse prices. [Accounting](clearing/accounting.md) |
| Market-attributed fees and insurance (D137–D138) | The taker pays 2 bps on aggregate execution. Providers pay zero. Each market owns 25% of collected fees as insurance, with exact carry. Fills and checkpoints together certify market totals before reserves can be spent. [Accounting](clearing/accounting.md) |
| Ordinary price-profit payments require closing quantity | Fresh local accounts pay the realized part of a partial or full close, within backed market cash and the positive net claim. Frozen recovery still values remaining open lots. [Profit attribution](clearing/default-plan-verification.md) |
| Permissionless forced reduction and a funded receiver (D124) | Clearing admits a maker liquidation only when it reduces the post-fee deficit under the price checks. A receiver must consent and meet margin after taking inventory. Insurance has separate ownership. [Liquidation](clearing/risk-and-resolution.md#liquidation) |
| One verified frozen episode (D116–D122, D127, D139–D144) | Fix the debtor's original market shares. Protect other-market payouts and insurance. Maximize permitted recovery, allocate charges by the agreed priorities and resolve ties deterministically. Apply cash only after clearing verifies the complete result. [Default verification](clearing/default-plan-verification.md) |
| Separate funding depth from risk (D74–D76, D145) | A restricted publisher computes impact from published maker curves off chain. Clearing authenticates the report and accrues funding. Independent index sources value margin and govern liquidation. [Funding](liquidity/funding.md) |
| Choose the best eligible route at execution (D145–D146) | The trader signs size and economic limits. Clearing reads standing quotes for all three registered makers and can use one or two. A search that cannot establish the best eligible result within its budget fails atomically. [Routing](liquidity/routing.md) |
| Finalized chain effects govern the journal (D84, D88, D94) | Persist a signed original before dispatch, distinguish expiry from unknown outcomes, and reconcile finalized account state before publishing financial facts. [Durability](application/durability.md) |
| Pin deployment identity | Each client and worker binds the genesis, anchor, artifact set and schema. Historical sessions retain their original identities. A signed local test gives evidence for that deployment and workload. [Deployment](operations/deployment.md) |

Record future material choices here with a date, alternatives considered, consequences for users, and the current contract. [Project status](STATUS.md) tracks open questions separately.

**27 November 2026 — Reuse the venue's collateral oracle for inactive listings.**
The local venue authority binds the listing's index once. Clearing derives the
independent asset guard from the publisher of the existing collateral guard.
This gives a new underlying the same collateral valuation as BTC and ETH and
lets anyone submit an observation without selecting the feeds. Rejections retain
the original expiry of the last qualified sample. Market admission remains a
separate financial decision. [Index rules](clearing/risk-and-resolution.md#observing-the-index-of-an-inactive-listing)

**27 November 2026 — Give each inactive listing a stable ID and a unique ticker.**
The local venue authority reserves both names atomically in two small PDAs.
This lets clients discover a proposed market without rewriting a shared directory
or reallocating existing margin accounts. Registration authenticates the primary
feed's identity and leaves the market inactive. Price observation, maker admission
and the complete default and exit paths each require separate qualification
before trading can open. [Listing contract](clearing/accounts.md#registering-an-inactive-market)

**27 November 2026 — Verify a bounded wider default in the settlement transaction.** In the local qualification build, accept permissionless proposals for the registered roster. Authenticate current account bytes, verify greatest recovery rates and compare every candidate before committing the terminal balances. This avoids a persistent freeze that could strand a book outside the verifier’s supported class. The first local certificate required a strictly best allocation with whole terminal flows. Its successor checks the same strict recovery priority, verifies whole insurance budgets from the original reserves and runs protected circulation over fractional terminal flows. If the complete book has no eligible whole-atom reduction, permit terminal settlement only for a verified post-insurance loss. This lets owners withdraw the funded remainder while preventing a keeper from terminating a fully covered book. For two winners in a single charged market, a certified full recovery bounds the search to rival splits of the same total. Retain frozen member priority and shared lot limits. A proposal that cannot establish the full recovery is outside this certificate. Wider trading still requires the full venue settlement contract. [Certificate and bounds](clearing/risk-and-resolution.md#signed-verification-across-market-ids)

**27 November 2026 — Qualify wider default through one market-indexed engine.** The successor accepts frozen market IDs and member obligations at runtime. The two- and three-market examples remain financial regressions. Wider accounts can link more markets across the frozen book than any one member occupies, so qualify those two dimensions independently. Reuse the frozen debt proportions, market-specific insurance and protected rounding rules. Wider trading requires signed verification of the complete settlement and wallet exits on the venue profile. [Settlement contract](clearing/risk-and-resolution.md#settlement-across-a-frozen-set-of-markets)

**27 November 2026 — Bind candidate slot references to the margin account, market ID and occupancy period.** Fixed global offsets grow with the venue's listings. Reusing an offset or market ID alone can make an old reference point to a newly admitted obligation. Preserve a market's binding until all its exposure, claims and live order authority are discharged. Assign its next occupancy a fresh account-local counter. Qualification first projected existing BTC/ETH roots into this representation. The [funded custody fixture](clearing/accounts.md#funded-custody-qualification) persists the candidate directory under a separate program and test-token vault so it can exercise more markets without changing trading admission. [Account contract](clearing/accounts.md#market-slots-in-the-width-qualification)

**26 November 2026 — Maintain debtor bounds in small groups for local payout qualification.** Rebuild the affected groups inside the financial write. On payment, check their intervals against the current held prices and funding bounds. Per-row checks remain authoritative whenever an interval is insufficient. This preserves creditor protection for an idle debtor between trades while allowing a solvent open book to pay from summaries alone. The profile has an explicit fresh-genesis allocation and its own artifact identity. [Accounting contract](clearing/accounting.md#incremental-debtor-checks-on-open-books)

**26 November 2026 — Execute verified backing and closed-profit credit together on the bounded local profile.** A caller can request payment directly from the market pool when clearing verifies the complete current book in the same instruction. The existing certificate path and historical artifact bindings remain available. Reading all eight coverage lanes exposes a shared read dependency with any fill that changes one of them. [Authority and account contract](clearing/accounting.md#atomic-credit-of-closed-profit)

**26 November 2026 — Maintain debtor coverage at the financial commit.** On a fresh local venue the clearing instruction that changes a balance or financial membership must also maintain the corresponding coverage row. A separate caller-supplied recording instruction allowed a financial write to omit its coverage update. Clearing now commits both changes atomically. Permissionless observers read the current rows. A registered empty identity can retire once it has left financial membership. The existing certificate continues to authorize payouts while direct claims and adverse books undergo qualification. [Contract and storage limits](clearing/accounting.md#clearing-maintained-debtor-coverage)

**26 November 2026 — Split cross-debtor recoveries before insurance.** For the wider-market successor, recovered proceeds cover frozen remaining destination debts in proportion to their sizes, capped at debt. Each destination then uses only its own insurance. An insurance-aware allocation could pay more creditors in full by drawing more of one market's reserve. The approved rule keeps that reserve from changing another market's share. If a proposed close discharges one destination debt, recovered funds above that debt go toward the remaining debt before the debtor retains any surplus. The local venue still supports two markets. [Worked comparison](clearing/risk-and-resolution.md#gate-for-a-third-cross-market) · [Native reduction comparison](clearing/default-plan-verification.md#one-proposed-reduction-on-a-three-market-frozen-book) · [Signed single-pair scope](clearing/default-plan-verification.md#signed-three-market-default-with-one-eligible-pair)

**26 November 2026 — Qualify payout backing before widening cross margin.** The successor targets direct payment of a backed closed claim without ordinary membership scans. A funded pool alone cannot authorize payment when a shared debtor is underfunded. Qualifying a third market at the same time would mix a change to default economics with a change to payout verification. Build against the BTC/ETH payout contract first. A third cross market requires a separately verified liquidation and default allocation rule. The current certificate and two-market deployment remain authoritative during qualification. [Payout cases](clearing/accounting.md#acceptance-contract-for-ordinary-payouts) · [Default example](clearing/risk-and-resolution.md#gate-for-a-third-cross-market)

**25 November 2026 — Separate discovery from the signed execution set.** In wide local qualification the wallet discovers every registered maker and signs three candidate bundles. Clearing chooses the best admissible single or pair within that set at execution. A better quote can appear outside the set after signing. This supersedes D145’s full-directory on-chain comparison for the wider deployment and bounds writable accounts per order. Three physical accounting lanes continue to provide complete market checkpoints. [Routing contract](liquidity/routing.md#wide-maker-discovery-in-local-qualification)

**25 November 2026 — Bound average entry for fresh local venues.** Preserve cumulative cost across reductions. Round surviving total cost outward only when adding inventory. Ordinary settlement uses the highest possible open gain, while default can seize only the lowest supported open gain. Accept a possible delay of one ordinary atom or a reduction of one chargeable atom per matched lot at a tick. The separate funded-cash ledger and full-close claim stay authoritative. This supersedes the exact-entry storage requirement of the previous closed-quantity deployment. A fill or freeze needs no historical witness. [Arithmetic and limits](clearing/accounting.md#ordinary-payouts-on-closed-quantity)

**24 November 2026 — Adopt closed-quantity ordinary price-profit settlement.** This supersedes the ordinary open-payment portion of D112–D115, D123 and D125 for fresh local deployments. A maker or trader who carries profitable inventory can realize it by reducing that inventory. Accrued funding and the return of previously collected losses retain separate fixed-claim treatment. The old design needed a quantity-dependent storage reserve for future open payments. Reintroducing open-price payouts is deferred. Historical accounts and their signed journals retain their original deployment. [Accounting contract](clearing/accounting.md#ordinary-payouts-on-closed-quantity)

**25 November 2026 — Allow wider atomic fills on an explicitly selected deployment.** An authenticated wallet shortlist can supply up to eight distinct maker capitals to one order. Clearing allocates the exact quantity on current bounded curves and admits the full allocation atomically. A financial failure can still refuse an order with another executable allocation. The two-leg search remains available. This extends the earlier two-counterparty decision for the local multi-maker instruction. [Routing contract](liquidity/routing.md#wider-atomic-fills)

### 28 November 2026 · Isolate newly listed maker capital by listing address

The local admission profile keeps the existing collateral vault and Financial
membership. An immutable capital binding points to the registration for one
full listing address. The one-byte selector reserves a tag for this class of
account. A listed maker's deposit therefore cannot back a BTC/ETH fill or a
second listing. [Account contract](clearing/accounts.md#isolated-maker-capital-for-an-inactive-listing)


### 28 November 2026 · Use frozen market priority for asymmetric protected finalists

Two plans can reach every market's recovery ceiling and draw identical market insurance while sharing losses more proportionally in different markets. When they also close the same total number of lots and satisfy each protected whole-atom receipt, prefer the smaller proportional deviation in the first distinguishing market. Sort market IDs by SHA-256 of the domain `Rivalt/frozen-market-order/v1` followed by a zero byte, the venue's 32 bytes, the frozen episode as little-endian u64 and the market ID as little-endian u16. Break a hash collision by numeric market ID. The caller and the slot of submission have no input. Equal sharing and equal per-market lot counts retain frozen member priority. [Default contract](clearing/risk-and-resolution.md#settlement-across-a-frozen-set-of-markets)


### 28 November 2026 · Eliminate unnecessary forced volume within each market

After maximizing protected recovery, compare proportional sharing in each market. If the surviving wider-market plans have identical insurance spending and pass exact and whole-atom creditor protection, discard a plan when a rival closes no more lots in any market and fewer in at least one. Rank the survivors by proportional deviation in frozen market order, then by lots in that order if their deviations tie. Stable frozen member priority resolves an exact tie. The previous equal-total-lot restriction is superseded. Lots in different markets have different units. [Worked example](operations/qualification-scorecard.md#forced-volume-by-market)


### 28 November 2026 · Keep listed positions on the same funded margin PDA

Fresh local wider accounts append sorted, market-ID-keyed position records
after their BTC and ETH entry costs. A fill can lock one participant root and
a cash or frozen-book reader can derive its complete position set directly
from that address. Cash, membership identity and the vault authority retain
one owner each. A two-market consumer may use a wider root only when the
appendix is empty. Integrating a listed fill also requires venue-wide protection
for payout and default instructions that can act without reading that root.
[Account layout and limits](clearing/accounts.md#listed-markets-on-the-funded-margin-account)
