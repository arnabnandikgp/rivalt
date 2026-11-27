# Verification and qualification

Use the smallest check that exercises the changed behavior. For a financial transition, derive expected values independently and verify the actual handler. Select the binary and helper expected by each harness. The fresh-demo installer and historical smoke wrappers have distinct artifact formats. For an integrated claim, submit the signed transaction, fetch its finalized RPC result, inspect the account and token changes, and replay the finalized history through PostgreSQL. A local calculation, simulation, submitted signature and wallet receipt establish different facts.

## Checks by change

| Change | Focused checks |
|---|---|
| Documentation | Check local links and heading anchors, referenced files and commands, `git diff --check` and `python3 ops/check-evidence-policy.py`. |
| Accounts, wire or SDK | `python3 ops/wire_contract.py`, `pnpm generate:check`, `pnpm typecheck`, affected instruction/IDL conformance and signed rollback cases. [Isolated legacy client](../../tests/anchor-conformance/) |
| Prices, margin, cash or default | [Independent financial models](../../tests/financial/) and the affected Rust crate. Exercise boundary, fee, funding, fractional ownership and conservation through the appropriate [RPC harness](../../tests/rpc-contract/). |
| Maker quote or router | `python3 tests/financial/test_maker_curve_contract.py`, `python3 tests/financial/check_liquidity_allocation.py`, affected SDK tests, and a signed fill/refusal using the intended deployment profile. |
| Funding or services | `bash ops/funding-publisher-smoke.sh` or `bash ops/liquidity-services-smoke.sh` with their pinned artifacts. Verify actual report expiry or restart/replay for the affected path. |
| User-facing trade and payout | Verify wallet review and guards, actual fills, fees, inventory, funded and unpaid balances, vault movement and fresh SQL replay. [Wallet workload](local-development.md#wallet-load-comparison) |
| CI scope | [Workflow](../../.github/workflows/pr-checks.yml) and [scope selector](../../ops/ci-scope.py). Broad regression belongs in the relevant CI jobs. |

For the [withdrawal width comparison](qualification-scorecard.md#withdrawal-risk-at-two-four-and-eight-markets),
run `cargo test --locked --offline -p financial-core --test withdrawal_width -- --nocapture`.
Compare both cash requirements with all independent funding corners at two, four
and eight markets. Run `RIVALT_PROOF_SCOPE=withdrawal-width bash ops/default-proof-smoke.sh`
for the signed diagnostic. At each width, require the exact maximum to pass, one
extra atom to refuse, and missing and substituted markets to refuse. Check
fixture accounts before and after, compare the returned remaining cash with the
independent amount, and rebuild the receipt table from finalized program history.

For the local market-listing check, build clearing at `1adaf018` with
`RIVALT_ATTRIBUTION_PROFILE=inactive-market-listing bash ops/build-profit-attribution.sh`.
Set `RIVALT_SETTLEMENT_ARTIFACT_DIR` to its manifest directory,
`RIVALT_ROUTER_REVISION=1adaf018353172e446820a04597b45b97bcbac23` and
`RIVALT_SETTLEMENT_PROBE=execution-router-inactive-listing`, then run
`bash ops/scalable-settlement-smoke.sh`. Check discovery on finalized RPC,
duplicate ID and ticker rollback, oracle substitution, authority, and both the
order and fill boundaries. Compare the registered accounts with independent
Anchor decoders and reconcile both records through fresh PostgreSQL replay.

For the listing index workload, use the same build profile at the clearing commit
recorded in [the scorecard](qualification-scorecard.md#inactive-sol-index-observation). Set `RIVALT_ROUTER_REVISION` to that
commit and `RIVALT_SETTLEMENT_ARTIFACT_DIR` to its build, then run
`RIVALT_SETTLEMENT_PROBE=execution-router-listing-index bash ops/scalable-settlement-smoke.sh`.
Compare per-lot bounds at 99-cent and $1.01 collateral with independent arithmetic.
Verify source substitutions, stale and conflicting reports, expired sample recovery,
the transaction signer, unchanged balances and the final state in fresh SQL replay.

For listed maker admission, build clearing and both makers at `5929eb48` with
`RIVALT_ATTRIBUTION_PROFILE=listed-maker-admission bash ops/build-profit-attribution.sh`.
Set `RIVALT_SETTLEMENT_ARTIFACT_DIR` to the output directory and
`RIVALT_ROUTER_REVISION=5929eb48f2963499bc0a5316a9a22c2b99dcdd3d`. Run
`RIVALT_SETTLEMENT_PROBE=execution-router-listed-maker bash ops/scalable-settlement-smoke.sh`.
Check the wallet and vault around the full deposit and exit, both market ID
directions, BTC/ETH capital substitution, code approval and finalized SQL replay.

To qualify the occupied-market cash floor on the venue, build program commit
`4e11ef9488b3c2205a1fa1bad02c0215cae8d976` with
`RIVALT_ATTRIBUTION_PROFILE=indexed-withdrawal bash ops/build-profit-attribution.sh`.
From the qualification checkout, set `RIVALT_ROUTER_REVISION` to that full commit,
`RIVALT_SETTLEMENT_ARTIFACT_DIR` to the build directory and
`RIVALT_SETTLEMENT_PROBE=execution-router-indexed-withdrawal`. Run
`bash ops/scalable-settlement-smoke.sh`. The signed checks cover an order-only
dependency, two opposite exposures, one atom above the cash floor, donor and
recipient cash, wallet/vault deltas and independent PostgreSQL replay.

For market-slot retention, run `cargo test --locked --offline -p clearing-accounting --features surviving-profit --test market_slots`. For signed replay, select `RIVALT_SETTLEMENT_PROBE=execution-router-grouped-slots` with the [pinned grouped-credit build](local-development.md#incremental-debtor-groups-on-open-markets) and run `bash ops/scalable-settlement-smoke.sh` with a new run directory. Require the same sparse bindings through live protection orders and both signs of flat claims, signed rollback on each omitted ETH dependency, release after final discharge, stale-reference rejection after reuse, a matching SPL wallet delta and fresh PostgreSQL reconciliation. Only the native test varies the market count.

For [funded custody at increasing widths](qualification-scorecard.md#funded-custody-across-persisted-markets), run `RIVALT_PROOF_SCOPE=slot-custody bash ops/default-proof-smoke.sh`. Derive both cash floors independently, enumerate every funding corner, verify the persisted funding checkpoints on both roots and compare wallet/vault token balances. Refusals must preserve the full account bytes. Rebuild cash changes in fresh PostgreSQL from finalized program history and reconcile them to each margin PDA and the vault.

For [signed orders on a sparse account](../clearing/accounts.md#signed-orders-on-a-sparse-cross-account), run `RIVALT_PROOF_SCOPE=slot-orders bash ops/default-proof-smoke.sh`. Start with empty roots and real test-token deposits. Split one opening order and one reduce-only close across fills, reprice two markets between signing and execution, check both counterparties’ entries and claims, and withdraw the independently calculated maximum. Verify that an omitted sibling, a stale revision, a breached limit, insufficient maker cash and an extra atom of withdrawal all refuse without modifying financial state. Re-fetch finalized instructions into a fresh PostgreSQL database. Reconcile signed lot changes, funding-adjusted claims, cumulative fees, per-market insurance and SPL balances.

For the [sparse funded-receiver check](../clearing/risk-and-resolution.md#funded-receiver-on-a-sparse-cross-account), run `RIVALT_PROOF_SCOPE=slot-liquidation bash ops/default-proof-smoke.sh`. Build the positions with signed orders, leave a debt in a flat market, then shock a different market from the one being liquidated. Test zero progress after the receiver fee, a receiver one atom short after reserving its own order, absent consent and omitted markets. Verify the exact signers, both account revisions, order cancellation or retention, final SPL withdrawal and post-recovery refusal. Recompute both deficits and the receiver’s initial margin from finalized history in a fresh PostgreSQL database.

For [two winners on a four-market book](qualification-scorecard.md#two-winners-on-a-four-market-book), run `RIVALT_PROOF_SCOPE=competing-indexed-default bash ops/default-proof-smoke.sh`. Reconstruct both winners’ current entries, the debtor’s capacity and all four markets’ claims from signed fills. Enumerate every physically legal whole-atom allocation independently. Check the accepted split, rejection of a full recovery that harms foreign creditors, rejection of a less proportional safe split, the stored lots and the final SPL withdrawals. The focused verifier test `two_winners_cannot_reuse_the_only_debtor_lot` covers a scarce lot and final member-priority ties.

For [actual venue settlement inputs](qualification-scorecard.md#complete-settlement-inputs-from-venue-clearing), use the pinned listed-maker binary and environment above with `RIVALT_SETTLEMENT_PROBE=execution-router-venue-book bash ops/scalable-settlement-smoke.sh`. The signed workload compares native Rust against independent rational arithmetic before collection, after collection and at a signed insolvency freeze. Its fresh PostgreSQL replay reconciles the funded venue.

For [simultaneous competing markets](qualification-scorecard.md#competing-winners-in-two-distressed-markets), run `RIVALT_PROOF_SCOPE=joint-competing-indexed-default bash ops/default-proof-smoke.sh`. Independently enumerate both markets together, verify every recorded split from finalized custody, and reconcile every wallet exit and the remaining SPL vault through fresh PostgreSQL.

For [residual settlement with open positions](qualification-scorecard.md#residual-settlement-with-open-positions), run `RIVALT_PROOF_SCOPE=residual-indexed-default bash ops/default-proof-smoke.sh`. Submit the all-par rates on the healthy book, then apply two price shocks and reset the opposing makers’ entry prices through trades. Verify the remaining loss, zero forced charges, each owner’s withdrawal and the fees left in SPL custody. Repeat the insured workload below to check that an eligible reduction cannot be skipped.

For [insured settlement with two debt destinations](qualification-scorecard.md#insured-settlement-with-two-debt-destinations), run `RIVALT_PROOF_SCOPE=insured-indexed-default bash ops/default-proof-smoke.sh`. Build the debts, charged inventory and market insurance from signed fills. Check the frozen 2:3 split, the four-atom concession, the insured market’s one-atom draw and the protected creditor’s 27-atom receipt. Rebuild the funding, fees, original positions, alternative allocations, rounding repair and wallet exits in fresh PostgreSQL and the independent fraction model. Run the earlier indexed workload below for compatibility. The focused host tests in `default-plan-selection` with feature `indexed-settlement` cover a clipped fractional reserve draw, a capped destination and an insured market with multiple debtors.

For the [market-indexed settlement](qualification-scorecard.md#one-settlement-engine-across-market-widths), run:

```sh
source ops/env.sh
cargo build --locked --offline -p financial-core --features market-settlement-model --example market_settlement
cargo test --locked --offline -p financial-core --features market-settlement-model --lib market_settlement::
python3 tests/financial/test_market_indexed_default.py
```

Exercise independently supplied market and member rosters, several source and destination markets, exact joint versus standalone protection, mixed fractional books, a cashless cycle and a cycle with an unpaid outside creditor. Compare permutations of both the market columns and member roster. The twelve-market chain limits each member to two occupied markets. Run the existing three-market, protected-pair and competing-winner comparisons below when the shared kernel or Python reference changes.

For the [three-market frozen book](qualification-scorecard.md#three-market-frozen-book-settlement), run the native fixture from the repository root:

```sh
source ops/env.sh
cargo build --locked -p financial-core --features three-market-model --example three_market_default
python3 tests/financial/test_three_market_default.py
```

Rust solves the simultaneous capacity constraints with exact rational arithmetic. The Python reference enumerates which debts and markets are paid in full, solves the resulting balance equations and checks candidate rates against the original cash flows. Compare all exact and rounded results, permute market columns and stable membership input order, and repeat two-market cases against the established atom contract. The comparison ends at terminal plan balances. Signed verification, application and custody exits require a separate Surfpool and PostgreSQL run.

For the [protected reduction comparison](qualification-scorecard.md#protected-three-market-forced-reduction), use the same native binary. Run `python3 tests/financial/test_three_market_reduction.py` and `cargo test --locked -p financial-core --features three-market-model --lib market_settlement::rounding`. Compare both non-target markets’ exact recoveries, rounded receipts and reserve spend against the independently reconstructed no-action settlement. Check each matched lot against its frozen entry, the debtor’s attributable writeoff, capped onward payments, and a refusal when the minimum receipts cannot all be funded.

For the [market-indexed settlement](qualification-scorecard.md#signed-market-indexed-settlement), run `RIVALT_PROOF_SCOPE=indexed-default bash ops/default-proof-smoke.sh`. Rebuild the book from signed fills, verify all candidate rates and compare the winning charges and lot counts with finalized PostgreSQL replay and the independent fraction reference. Check each owner's SPL exit, the fees remaining in the vault and full rollback on stale, incomplete and inferior proposals. The same program separately meters the original linked-book example through a read-only instruction. Those inputs exercise the arithmetic without making withdrawals.

For the [signed single-pair default](../clearing/default-plan-verification.md#signed-three-market-default-with-one-eligible-pair), run `RIVALT_PROOF_SCOPE=three-market-default bash ops/default-proof-smoke.sh`. The script builds the dedicated local program, checks the deployed bytes, sends signed deposits and fills, freezes all five accounts, resolves and withdraws from SPL custody. Independently hash the original financial accounts, check rollback after every refusal, and replay finalized transactions in fresh PostgreSQL. Feed the reconstructed frozen book and entry into the exact-fraction reference and enumerate every whole charge through the debtor’s original uninsured writeoff. Compare the chosen charge, matched lots, market insurance, each wallet and the remainder in the vault.

For the capacity-limited competing-winner case, run
`RIVALT_PROOF_SCOPE=partial-indexed-default bash ops/default-proof-smoke.sh`.
Require two separately earned one-atom open gains on a default with eleven
uninsured atoms. Check all four physically possible allocations, the nine-atom
residual, each wallet exit, the retained fees and a fresh journal replay.
Repeat `competing-indexed-default` on the same revision for the full recovery
with binding foreign-creditor protection.

For the [signed competing-winner default](qualification-scorecard.md#signed-two-winner-settlement-and-withdrawals), run `RIVALT_PROOF_SCOPE=competing-three-market-default bash ops/default-proof-smoke.sh`. Six signed fills must generate both winning BTC entries, their realized claims and the cross trader’s debts to ETH and SOL. Against one freeze, submit 5/5, 3/7, an incorrect total and the legacy aggregate instruction. Each refusal must preserve every watched financial account. Compare the accepted charges and lot schedules with independent enumeration from finalized fills. Reconcile all five balances, the three owner-authorized withdrawals and the reserve balance of each market. Repeat the single-pair command above after changing the shared verifier or replay.

For the [two-winner selection](qualification-scorecard.md#competing-winners-in-a-three-market-default), run the native driver and comparison:

```sh
cargo build --locked --offline -p default-plan-selection --features three-market-search --example three_market_competition
python3 tests/financial/test_three_market_competition.py
cargo test --locked --offline -p default-plan-selection --features three-market-search --lib three_market::tests
```

Compare every selected charge, matched lot, integer price concession and exact and rounded terminal flow against the independent whole-lot enumeration. Include a genuinely scarce debtor lot, different per-lot capacities, another market’s exact receipt, a zero-action optimum, an episode-order tie and an exhausted search. Re-run the two prior three-market Python comparisons when changing their shared frozen inputs or rounding checks.

For the [payout coverage comparison](qualification-scorecard.md#btceth-backing-summary-comparison),
build `cargo build --locked --offline -p financial-core --bin backing-driver`
and run `python3 tests/financial/test_payout_coverage_summary.py`. This compares
native debtor-coverage decisions. Signed claim admission, authenticated account
updates, wallet latency and fresh PostgreSQL replay remain integration gates.

Run `cargo test --locked --offline -p financial-core --test payout_coverage -- --nocapture`
for the [exact BTC/ETH comparison](qualification-scorecard.md#exact-btceth-debtor-coverage).
It checks stale inputs after an admitted native fill, exact versus summary reads,
and two independent ways of valuing the same cohort. The resulting row counts
measure native financial work. The current clearing payout still requires its
certificate. For signed exact-read costs, run
`RIVALT_PROOF_SCOPE=coverage bash ops/default-proof-smoke.sh` on the local
stack. This fixture meters the row predicate on selected program-owned accounts.
It verifies the one-atom refusal, the repair and six finalized read outcomes
against PostgreSQL. It does not execute a clearing payout.

For the [cold ETH coverage comparison](qualification-scorecard.md#clearing-owned-coverage-during-a-cold-eth-payout), run the [shadow workload](local-development.md#comparing-debtor-coverage-during-the-cold-eth-payout) on its pinned binary. Require a signed incomplete-cohort refusal, an early covered reading strictly before the first complete ETH certificate, a matching reading beside each payment, all three SPL withdrawals and fresh PostgreSQL replay. Count every post-bootstrap margin write and its atomic coverage update before using the CU or contention results.

For the [clearing-maintained coverage build](local-development.md#verifying-mandatory-coverage-updates), start with an empty registry and include its lane in each instruction that changes a financial member. Require signed rollback of membership, SPL and two-party writes with an omitted or incorrect lane. Compare the surviving rows after leaving and rejoining, exercise a two-sided fill, and reconcile finalized history into fresh PostgreSQL. The focused native tests in `scoped_history::tests` cover dynamic account lists, stale row images and two members sharing a lane.

For the [idle-debtor comparison](local-development.md#comparing-market-backing-during-a-btc-price-shock), independently check net lots, net fixed claims and gross debtor losses at current risk bounds. Compare against a freshly completed certificate and a signed payment attempt at each of the initial, adverse and recovered prices. Verify the debtor and lane bytes across each reprice, reject a mismatched ledger and an expired required source, admit an expired unrelated source, and replay finalized effects into a fresh database.

For the [direct-credit workload](local-development.md#qualifying-direct-profit-credits), start with a fresh market and zero settlement certificates. Confirm a funded credit after a new member joins, repeat after an idle debtor recovers and a member leaves, and trace the credited profit through the owner’s SPL withdrawal. Refused requests must preserve the recipient, debtors, pool, checkpoints and coverage rows. Compare sequential and simultaneous fill/credit pairs with distinct fee payers, verify the overlapping locks from the actual transactions, and reconcile finalized effects through a fresh PostgreSQL replay.

For the [coverage-capacity workload](local-development.md#direct-payout-at-full-coverage-capacity), fill all eight lanes with canonical financial accounts and provision an extra recovery seat. Compare all 128 margin roots with their lane records, carry the closed ETH spread from its debtor to the maker’s SPL wallet, and compare whole-transaction CU for equal credits with zero and 128 individually checked rows. Require clearing’s signed execution logs to identify each branch. A refused activation must preserve the writable financial and membership accounts. Retry the same identity after freeing a seat elsewhere and again after freeing a seat in its own lane. Reconcile the final membership and cash by replaying finalized transactions into fresh PostgreSQL.

For the [1,000-member qualification](local-development.md#direct-payout-at-1000-financial-members), authenticate the separate binary and verify 125 rows in each lane against canonical roots. Start both equal credits at the ordinary 400,000 CU and 32 KiB heap. For every refused original, compare simulation with the finalized error, check the credit dependencies for rollback, and record its signature and fee. A diagnostic success qualifies its own resource settings. Trace the full funded spread into the owner’s SPL balance and independently reconcile the resulting membership in PostgreSQL. The streamed reader repeats both cases on the same account layout. Decode the signed account list and verify only the recipient’s coverage lane is writable. On the same binary, require the price-shock control to reach the individual debtor check, reject the backed-pool request with `covered=0`, and complete payment after recovery.

On wide routing clearing `5e32c124` with harness `951adeea`, two ordinary
100-lot buys used 405,464 CU (BTC, 16 makers, 27 loaded accounts) and
445,226 CU (ETH, 32 makers, 32 loaded accounts). The later ETH quote from a
supplied maker won. An omitted reprice was cheaper. A one-lot explicit
reduction used 252,986 CU. Wrong-lane and price-limit refusals rolled back.
A clean database independently replayed 358 events and reconciled 395 RPC
accounts. This run used internal test collateral and a three-maker shortlist.

## Evidence by deployment

| Path | What was verified | Evidence and limits |
|---|---|---|
| Funded maker search, clearing `e02e72a0`, harness `db964391` | At the signed $100.053343 ceiling the ETH buy filled at maker 1 in 434,876 transaction CU. The $100.046674 ceiling refused in 359,578 CU. All other signed outcomes and fill amounts matched the prior routed run. | 24/36 filled, including 22/30 ordinary BTC requests. Checked atomic refusals, wallet exit and 463 replayed events. [Reproduction](local-development.md#matched-btc-fill-benchmark) |
| Matched wallet and explicit legs, clearing `b7e4458b`, harness `6ddfcaee` | Both venues filled 22/30 ordinary BTC requests, including three splits, across deep, fragmented and one-sided books. With an underfunded maker, the ETH router returned 6133 and the explicit alternative finalized. | 36 measured signed requests per venue, atomic refusals, two SPL exits, and 422/463 reconciled PostgreSQL events. [Dollar fills and costs](performance.md#dollar-sized-orders-and-executable-depth) |
| Frozen default with fixed-width entry, clearing `b7e4458b`, harness `d175285e` | The nine-member BTC/ETH freeze verified the joint plan, charged 13 and 12 atoms and completed four wallet withdrawals. | 126 keeper originals, 176 replayed events, eight legacy/RC2 instruction encodings. The near-tick counterexamples were exercised separately in native financial tests. |
| Fixed-width local entry, clearing `b7e4458b`, harness `d175285e` | 163/163 BTC wallet fills across 80 inventory cycles, fixed 40-byte market records, maker withdrawal, and an independent six-buy partial-close and payout lifecycle. | Fresh PostgreSQL replay of 951 and 381 events respectively. [Measured CU and sizes](performance.md#fixed-width-maker-entry) |
| Mixed-price maker inventory, clearing `ec6f1ffa` | The signed wallet-budget run reached a maker storage refusal and a compute refusal. The diagnostic run reached the 128- and 256-byte storage refusals. Each run verified exact entries on both sides, rolled back refused fills, reduced the maker to flat and withdrew principal plus profit to its SPL wallet. | Wallet harness `24af1d2d` reconciled 840 events. Diagnostic harness `aca1e51c` reconciled 872. [Workload, CU and amounts](performance.md#mixed-price-maker-storage) |
| Ordinary payouts on closed quantity, clearing `ec6f1ffa`, harness `ed60fc6c` | Six buys filled. With cash already collected in the BTC pool, clearing refused open-price profit, paid the partial-close ceiling, and refused an extra atom. The wallet received 1,148.168568 net after final close and withdrawal. | [Sizes, CU and limits](performance.md#closed-quantity-settlement). Finalized RPC, token balances and 381 replayed PostgreSQL events cover one deterministic book. |
| Frozen default on closed quantity, clearing `ec6f1ffa`, harness `4718f365` | A nine-member BTC/ETH book verified the joint plan, charged 13 and 12 atoms, then completed one trader and three maker withdrawals. | 126 keeper originals, 176 replayed events and eight recovery instruction encodings checked. This run covers this frozen book. [Reproduction](local-development.md#closed-quantity-payout-qualification) |
| Earlier execution-time router, `986b3cd3` | Signed singleton and two-maker fills, reprice at landing, atomic limit and search refusals. | [PR #167](https://github.com/arnabnandikgp/rivalt/pull/167). The [fixed BTC notional baseline](performance.md#btc-orders-at-fixed-dollar-sizes) adds signed capacity refusals, rollback and an SPL wallet exit after the control fills. |
| Maker liquidation and receiver, `5d7a7c0f` | On a 50-lot trader, the keeper sold ten lots to a maker, held when the receiver lacked capital, then transferred five after funding. The maintenance deficit reached zero with 35 lots remaining. | [PR #143](https://github.com/arnabnandikgp/rivalt/pull/143). The operator owned the receiver. Independent liquidator participation and profitability are open. |
| Default on populated books | On `3acd4a4d`, all 128 members reconciled and one wallet withdrew 986,527 atoms. One payout calculation took 471 continuations. On `79724a5a`, three 75-member books completed after keeper restart using 193, 285 and 327 finalized keeper transactions. | [128-member qualification](https://github.com/arnabnandikgp/rivalt/pull/152) · [75-member qualification](https://github.com/arnabnandikgp/rivalt/pull/158). Costs depend on frozen positions, claims and proof eligibility. |
| Earlier devnet and external gates | Historical devnet oracle and external wallet registration used previous programs. Current trading is local. | [Historical record](../HISTORY.md) · [Open gates](../STATUS.md). |

The [closed-quantity payout comparison](qualification-scorecard.md#closed-quantity-payout-comparison) on `afc45179` ran eight native cases against the financial crates. It establishes the payout and storage results for those histories. The longer native mixed-price history exposed a storage limit in that exact-entry profile.

The [entry-cost bounds comparison](qualification-scorecard.md#can-two-entry-cost-bounds-certify-the-exact-payment) on `0bf61818` verified the 32-byte representation against exact attribution on retained fill histories and rounding boundaries. Two histories with the same stored bounds require different payments. This is native evidence only.

The [exact replay experiment](qualification-scorecard.md#exact-replay-from-a-verified-checkpoint) on `3c0e35b4` recovered both entitlements with authenticated fill data and measured the first exact-record overflow on a longer frozen history. The commitments and checkpoint rotations were modeled locally. That experiment used exact records. Fresh local deployments use the [40-byte entry record](../clearing/accounts.md#wire-format-and-changes).

Retain raw evidence at its ignored local path. Record new results against exact program and harness revisions, with the denominator, failed attempts, economic outcome and remaining limitation. Detailed runs and reproduction notes belong in the PR.

The opt-in local multi-maker deployment has signed three-, four- and eight-leg fills, independent financial expectations, a last-leg rollback and fresh PostgreSQL replay. Wallet-relay authorization was checked on the original signed bytes. The isolated Anchor clients reproduced four wider instruction payloads from the retained originals and decoded 21 committed clearing events. The IDL lock inventory lists the fixed context. The signed widths include the dynamic maker accounts. [Measured widths and exact deployment](performance.md#atomic-fills-across-three-to-eight-makers)

Six matched venues independently replayed their completed journals into PostgreSQL. The economic report audited all 48 signed order receipts and counted twelve more wallet refusals before signing. The independent flat-book optimizer also matched 576 exhaustive small-book quantity enumerations. [Matched dollar results and scope](performance.md#matched-dollar-execution-across-16-and-32-makers)

The depth-aware wallet repeat on clearing `f0b8a599` and SDK/harness `0edb3064` audited 48 signed receipts, twelve unsigned refusals and six fresh PostgreSQL replays. Both formerly omitted eight-leg sales reached the previously computed reference proceeds. [Matched outcomes and limits](performance.md#wallet-selection-by-order-size)

The curved-book and maker-margin comparison on clearing `f0b8a599` and signed harness `b61ade13` verified five wallet-signed orders across two fresh venues. Three filled and two rolled back. PostgreSQL independently replayed 181 wallet-venue events and 188 control-venue events, with funded vaults reconciled in both. The report checks equal pretrade economic inputs across arms. Finding 2 remains open for both orders. [Execution prices and refusal causes](performance.md#curved-quotes-and-binding-maker-margin)

The signed funded-multi-maker repeat on clearing `50bd8836` and harness `152e4f18` reproduced the independently calculated ETH allocation through the ordinary wallet, verified a one-atom limit rejection, and landed the best four-curve BTC control. PostgreSQL reconciled both fresh journals. [Measured outcomes](performance.md#funded-opening-depth)

At wallet revision `7353f463` both ordinary orders, their signed controls and the one-atom refusal were audited on clearing `50bd8836`. Across these two matched local venues four signed fills landed and one signed order rolled back. Both fresh PostgreSQL replays reconciled 185 events. [Verified dollar fills](performance.md#price-aware-wallet-execution)

Clearing `b0e1a43f` and harness `a9dc0bba` passed the per-leg average-price and aggregate-fee review cases, both signed tighter-limit refusals, both positive width cases and the existing curved and margin-constrained wallet cases. Each venue replayed finalized transactions into fresh PostgreSQL and reconciled against on-chain state. [Signed price and fee limits](performance.md#signed-price-and-fee-limits)

The wallet contention qualification used harness `27710e33` and clearing `b0e1a43f`. All 288 scheduled requests were signed, filled and matched to finalized RPC and WS evidence. Replays into fresh PostgreSQL databases reconciled 477 BTC, 473 ETH and 557 split-venue events. The audit checked the fee payer, price, fee, consumed depth and whole-message read/write sets. [Scope and figures](performance.md#wallet-count-and-market-contention)

The Agave 4.2.2 scheduler replay on harness `5475b255` and clearing `b0e1a43f` audited 144/144 finalized v1 fills, their WS observations and 915 PostgreSQL events across three fresh venues. Each signed order matched one native scheduler admission. Eight signatures received multiple worker assignments. The report retains their full sequences and measures time to first and last worker start. All six timed funding reports landed successfully. This qualifies the local wallet trace at zero priority fee. [Scheduler timing and limitations](performance.md#native-validator-queue-timing)

The split-market repeat on harness `9369c98d` and the same binaries audited 48/48 finalized orders, their WS observations, two successful funding reports and a fresh 305-event PostgreSQL replay over 259 accounts. Each signed order's measured stages sum to its elapsed preparation time. The comparison checks the full order schedule, wallet assignments, binary hashes and native leader admissions across both runs. [Wallet timing and denominators](performance.md#where-the-wallet-spends-time-before-signing)

Harness `97523cdf` compared two fully prepared 50-wallet bursts on the same native validator and clearing binary. Each venue finalized 50/50 original v1 fills, observed them over WebSocket and matched them to 50 native scheduler admissions and assignments. Fresh PostgreSQL replay on each venue reproduced 459 events, all 333 accounts and the 29,000,000-token test vault. Only maker 0 supplied depth in each traded market. The two landing-block intervals measured 457.13 and 470.48 ms. [Burst results and limits](performance.md#fifty-already-signed-orders-in-one-slot)

Offline harness `36b6b256` restored bank 406 from the `9369c98d` split ledger with Agave 4.2.2 and matched its original bank hash. In two Node processes the baseline and candidate decoders agreed with an independent byte decoder on all 655 bank accounts, produced the same serializable snapshot for all twelve wallets, and both detected a changed maker binary. This qualifies the profiling input and local decoder comparison. [Stage attribution, timings and scope](performance.md#wallet-snapshot-decoding-and-verification)

The SDK default at `402a6c03` passed the same bank replay under Node and in two fresh Chrome processes. Browser coverage includes all 655 decoded payloads, twelve verified wallet states, malformed inputs and quarantine of a modified maker program on BTC and ETH. The measured SDK and harness are integrated at `cf61ad81`. [Browser timings and scope](performance.md#browser-wallet-verification-with-the-default-decoder)

At `f873bfd1` the [close-to-wallet comparison](performance.md#from-a-profitable-close-to-tokens-in-the-wallet) verified four BTC closes and four owner-signed SPL exits across two bounded-entry venues. All 96 scheduled background orders filled. Every successful exit had competing fills in strictly intervening slots; finalized RPC/WS and PostgreSQL replay agreed on both venues. The observation began with a current BTC backing certificate and a partially funded pool.

The [worker scheduling comparison](performance.md#scheduling-payouts-while-losses-keep-arriving) at clearing `b7e4458b` reconciled 558, 576 and 562 finalized events across the collection-first control, the work-class rotation and the creditor rotation. Each run verified both signed token exits, all 48 competing fills, the exact post-release collections on BTC and ETH and both closing pool balances.

The [cold ETH exit](performance.md#first-eth-maker-payout-with-cold-backing) on harness `254404ef` checked all 48 original fills, the worker’s first complete ETH backing scan, signed payments and three owner-signed token exits. Fresh PostgreSQL replay reconciled 903 events. The ETH maker ended flat with its original 100 test collateral in margin and its 480-atom profit in its wallet.

The [automatic direct-credit comparison](performance.md#automatic-payout-on-the-same-12-member-book) used harness `88625d28` against two pinned clearing binaries. Finalized originals matched websocket outcomes, each arm completed all three owner-signed token exits, and fresh PostgreSQL replay reconciled 550 events on direct clearing and 899 on the control. The independent fill-event report reconstructed the same 480-atom ETH maker spread on each. The direct worker credited it without an ETH certificate. This qualification covers twelve financial members.


The [grouped open-book qualification](performance.md#payout-with-incremental-debtor-groups) ties the three signed payouts to decoded fill events, margin roots, source values, token exit and 4,413 replayed PostgreSQL events on harness `796a16b0`. Coverage maintenance and the exact fallback also have a separate idle cross-debtor shock control on `40691ed8`. Both used clearing `e4aff314`. The [stressed worker qualification](performance.md#automatic-wallet-payouts-on-a-stressed-1000-member-book) on `11cb1b55` matches queue originals to RPC/WS and both wallet exits to finalized token deltas. Independent fill and price receipts reproduce the idle debtor’s 9,138-atom shortfall and 6,702-atom recovered headroom. Fresh replay matched 3,583 events.


For the [funded venue default preview](qualification-scorecard.md#checking-the-protected-plan-on-the-funded-venue), build the `venue-default-verifier` profile with `ops/build-profit-attribution.sh`. Run `ops/scalable-settlement-smoke.sh` with `RIVALT_SETTLEMENT_PROBE=execution-router-venue-default`, the pinned `RIVALT_ROUTER_REVISION` and its `RIVALT_SETTLEMENT_ARTIFACT_DIR`. Assert the entire returned entitlement vector, all six signed refusals, unchanged financial accounts, wire conformance and PostgreSQL replay.


The joint competing indexed workload also checks [frozen market priority](qualification-scorecard.md#asymmetric-frozen-market-priority). Run `python3 tests/financial/test_indexed_market_priority.py` for full enumeration and `cargo test -p default-plan-selection --features indexed-settlement market_indexed` for the actual verifier. The signed workload checks both episode outcomes and rejects the opposite nomination before comparing its independent resource results and funded four-market withdrawals with PostgreSQL.


Use the `venue-default-application` program artifact and `RIVALT_SETTLEMENT_PROBE=execution-router-venue-application` with `ops/scalable-settlement-smoke.sh` for [venue application and owner withdrawals](qualification-scorecard.md#applying-the-verified-payouts-on-the-venue). Set `RIVALT_ROUTER_REVISION` to the exact program source revision. The supervisor requires the pinned unified settlement page helper. It verifies real wallet and vault deltas, refused bindings, and independently reconstructed financial events in a fresh PostgreSQL database.

The same signed workload repeats the [unequal forced-volume comparison](qualification-scorecard.md#forced-volume-by-market) across both episodes. Check the amount paid to each creditor, which allocation was refused and the per-market lot counts in the independent reference.

The local `execution-router-listed-directory` probe funds three SOL maker capitals and checks directory completeness, authority, replays, SDK discovery, post-seal index observations and continued BTC trading. At clearing `a3a2c3cb` and harness `6b0a53ab`, the signed seal used 538 bytes, 12 keys and 20,589 CU. See [current acceptance](../STATUS.md).

The `execution-router-listed-funding` probe independently checks SOL report size and gross amounts, the 50 bps premium cap, unavailable depth, oracle substitution, signer rotation, replay and unchanged venue cash. The 311-transaction run on clearing `b609e3e8` reconciled 127 financial events. [Contract and amounts](../liquidity/funding.md#funding-for-a-sealed-listing)
