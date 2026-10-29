# R095 — self-review of skipped PRs #45 and #47

30 October 2026. Review of [P30 / #45](https://github.com/arnabnandikgp/rivalt/pull/45)
at `fe91497b8aa04e595718668472c66611036c2074` against `48abd8b`, and
[P32 / #47](https://github.com/arnabnandikgp/rivalt/pull/47) at
`46be8d441133ebf99cb77414274a24a3f306c26f` against `693e5f9`.
CodeRabbit skipped these PRs; neither has a submitted review. This is the
implementation agent's self-review, not P16B independent review or an audit.

## Result and disposition

No actionable financial, authority or atomicity defect was found in the reviewed
paths. One low-severity specification mismatch was reproduced and corrected:
P29B's blanket statement that trailing data is rejected also appeared to cover
instruction arguments. Anchor 1.2.1's generated dispatcher uses prefix
deserialization and accepts an unused instruction suffix. Both compiled makers
accept the literal three-lot quote request plus byte `0x99` and return gross
317, remaining 5. The SDK emits the canonical unsuffixed encoding.

Retain the existing dispatcher behavior and narrow the documentation claim
explicitly in P29B and DECISIONS. Exact maker config/publication lengths in
`maker_liquidity/validation.rs` and exact 204-byte responses in
`maker-interface/src/canonical.rs::validate_response` are enforced separately.
Complete signed transaction bytes remain immutable; financial intent replay is
guarded by account/order/publication state, not by a hash of instruction arguments.
No program, ABI layout, risk safeguard, fee or loss-allocation code changes.

## Review coverage

#45 changes 130 files, including 77 generated SDK/IDL files; #47 changes 133,
including 28 generated SDK/IDL files. Review followed the handwritten trust
boundaries and checked generated consistency/legacy ABI separately. Later-stack
changes were considered to avoid reporting already-fixed defects.

| Boundary | Files inspected and checks traced |
|---|---|
| Canonical mathematics | `crates/maker-interface/src/canonical.rs`, `canonical/ladder.rs`, SDK `canonical-quote.ts`: region ordering, checked potential/prefix arithmetic, marginal endpoints, capacity, reduce-only and fragmented-fill behavior |
| Maker authority | `programs/maker-canonical.rs`, clearing `maker_liquidity/{contexts,validation,mod}.rs`: canonical PDAs, capital uniqueness, owner/updater CAS, revoke/enable, independent consumption, joint hash approval and quarantine |
| CPI isolation | `maker_liquidity/pricing.rs` and control gateway: complete code hash, registration/cache bindings, exact canonical return validation, read-only quote inputs, dedicated noncustodial control signer and full post-control state comparison |
| Financial routes | `maker_liquidity/routes/*`, shared `group_trading/routes.rs`, account adapters: optional leg tuples, aliases/self-trade, structural epochs, current price/depth, whole-account funding/reservations, stored limits/fee prefixes and atomic commit |
| Publisher | `maker_liquidity/publisher/*`, `funding.rs`, SDK `funding-{publisher,impact,sources}.ts`: complete snapshots, fixed Q, signer/epoch/sequence/time fences, independent sources/bands, unavailable observations, prior-interval accrual and control truncation |
| Activation and safety | Changed account custody/trading/cash/resolution gates, source initialization and disabled sampler: explicit profile-4 qualification only, legacy separation, complete safety storage and unchanged liquidation/default/exit engine |
| Shared arithmetic and transport | P32 fill/generation/reservation refactors; SDK `liquidity-route.ts`, `canonical-transport.ts`; generated accounts/events/instructions, measured v0/v1 selection and unchanged signed limits |

The superseded on-chain sampler and test-only hypothetical financial admission
were distinguished from the live publisher path. Published depth is deliberately
not guaranteed executable liquidity under D74/D75; this is an accepted trust
boundary, not a newly discovered missing margin check.

## Fresh scoped verification

All live checks pin clean `608f73c641cc10b90fbbb92f4e2984890ae5100e` before these
documentation edits. The retained build manifest pins clean `6437f7d`; all four
binary hashes verify, and `git diff 6437f7d HEAD -- programs crates Cargo.toml
Cargo.lock` is empty. No new SBF build is claimed.

| Check | Actual result |
|---|---|
| `python3 tests/financial/test_maker_curve_contract.py` | 27 independent contract cases pass |
| Independent curve parity, SDK and both retained maker SBFs | 3,172 vectors per evaluator: 1,547 exact quotes and 1,625 expected rejections each |
| Compiled canonical maker lifecycle on retained P32 artifacts | 123 signed cases, 16 expected rejections; 104 instruction encodings and 20 account decodes match isolated legacy Anchor; no SVM event-parity claim |
| Five focused Vitest files | 24 pass: canonical quote, transport, funding publisher, route builder and isolated legacy route conformance |
| Native financial-core changed helpers | One maker candidate/fill case and two reservation cases pass; no unrelated native suites run |
| `pnpm generate:check` | All three generated SDK trees reproduce exactly; existing PDA alias diagnostics remain |
| Fresh publisher Surfpool/RPC/WS probe | 84 signed outcomes, nine expected failures, eight accepted reports; 75 instruction/two account/73 event legacy matches. Maximum successful publisher operation 30,588 CU, 871 bytes, 14 keys |
| Fresh execution Surfpool/RPC/WS probe | 125 signed outcomes, four expected failures; 138 instruction/two account/143 event legacy matches. Actual singleton, repriced, two-maker, second-market and stored-order fills reconcile |
| Execution resource/economic checks | Maximum tested route 589,740 CU under 800k, 1,262 bytes/v1, 26 keys. Total cash 7,999,917 plus 83 fee/insurance atoms equals 8,000,000; market positions and funding-adjusted claims sum to zero |
| Current hosted PR checks | #45 `fe91497` and #47 `46be8d4`: scope/client/financial/report/shell SUCCESS; CodeRabbit NEUTRAL, not approval |

RPC entrypoints are `funding-publisher-rpc.ts` and `liquidity-execution-rpc.ts`, run
sequentially through `ops/liquidity-continuation-smoke.sh` with treatment profile
and separate fresh run directories. The execution fee ledger is BTC insurance
19 / protocol 57 / carry 0 and ETH insurance 1 / protocol 6 / carry 3. Stored
subfills charge a cumulative 25 atoms rather than two independent rounded fees.
The published 600-lot optimum is independently fixed at bid 5,999,400 and ask
6,001,800; actual zero-cash makers do not remove their published depth.

Local raw evidence is `.local/r095-review/{publisher,execution,lifecycle}/`, plus
the parity/native logs there and `.local/r095-{focused-tests-after-generation,
independent-contract,sdk-parity,generation}.log`. Local parity/lifecycle wrappers
change only import, artifact and output paths to use verified current binaries and
preserve older evidence. The separate suffixed-request probe changes just that
request's bytes. No raw evidence is committed.

An initial test attempt overlapped the generator's write-and-compare operation
and reported `@solana/kit` resolution failure from a generated module; all 24 tests
pass when run after generation. The first local SBF wrapper lacked the RPC workspace's module links;
it failed before execution, then passed after using those existing dependencies.
Both failed attempts remain recorded and are not counted as passing tests.

## Limits and next action

No new PostgreSQL/service/browser, full liquidation/default matrix, 600-offer
comparison, maximum-book benchmark or endurance run was needed for this source
review and documentation correction. Those retain their original pinned evidence;
these smaller probes do not replace them. No local Anchor rebuild was attempted
with less than 0.5 GiB free; scoped compiled checks use hash-verified artifacts and
the native financial-core crate has no external dependencies. Nothing was deleted
from the user's research, databases, configuration, keys or previous evidence.
Both owned Surfpool listeners are stopped. Documentation checks pass for 205
local link targets, balanced fences, tracked-evidence policy and diff whitespace.

The publisher remains trusted for honest complete aggregation within on-chain
bounds. The three-maker local profile and narrow historical P34 latency margin
are not production scale or independent security qualification. Keep all seven
ready PRs open; assess new feedback or await separate integration authorization.
P15B/P16B remain Open and continuous 24-hour endurance remains Deferred.
