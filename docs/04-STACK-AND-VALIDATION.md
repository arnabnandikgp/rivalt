# Stack, validation and measurement
Rivalt · baseline R1 · 20 October 2026

## Selected stack

These are implementation starting selections, not an installed/tested lockfile.

| Area | Selection | Required gate |
|---|---|---|
| Three programs | Rust, Anchor CLI/anchor-lang/anchor-spl 1.2.1 | Exact versions; compile/SBF/account/CPI tests |
| Financial core | Framework-independent Rust; checked integer/fixed-point math | G02 bounds, independent reference and property tests |
| Solana build | Agave/Solana CLI 4.1.2 initial candidate | Confirm against Anchor 1.2.1; pin host Rust and SBF platform tools separately |
| Application client | @solana/web3.js 3.1.1, Codama-generated Kit-compatible instructions/codecs | Generated ABI parity and actual asynchronous signing/sending |
| Anchor conformance | @anchor-lang/core 1.2.1 with compatible web3.js 1.x in isolated test workspace | No forced overrides or legacy types in production API |
| Program clients | @solana-program/token, system and compute-budget as required | Compatible exact lockfile; classic SPL collateral |
| Services | Node 24 LTS, strict TypeScript, pnpm, Fastify | bigint internally; decimal integer strings in JSON |
| Storage | PostgreSQL 18, pg, SQL migrations, transactional jobs/outbox | Exact numeric columns and durable event/checkpoint transactions |
| UI | React, TypeScript, Vite, @solana/wallet-adapter 3.1.1 / Wallet Standard | Real signing path, rejection/account/cluster changes |
| Local runtime | Surfpool 1.6.1 starting candidate as a separate RPC/WS process | Verify install/provenance and required standard-method behavior |
| Tests | Rust/proptest, LiteSVM, Vitest, Playwright | Each layer answers its own risk; no duplicated broad suite everywhere |
| Operations | Native/compatible containers, structured logs and Prometheus-compatible metrics | Reproducible local command, scoped cleanup and restart |

Fresh official documentation checks on 20 October confirm Anchor 1.2.1, the legacy constraint of the stable Anchor TS client, web3.js v3's Kit interoperability and the web3.js/wallet-adapter 3.1.1 release. The older 3.1.0 starting pair is superseded. Surfpool 1.6.1 is retained from run 36; its exact release page was not retrievable in this audit, so installation/hash and method checks remain P01 requirements. No combined build was executed here.

P01 implementation addendum: exact installed versions, archive hashes, the isolated legacy workspace and the executable RPC contract are now documented in [P01-SPINE](P01-SPINE.md). The actual host/SBF pins are Rust 1.97.1 and platform-tools v1.52/rustc 1.89.0-dev/SBPF v0 respectively. Agave 4.1.2 bundles cargo-build-sbf 4.1.0; Surfpool 1.6.1 reports solana-core 4.2.1. These are distinct identities. See D16 for the measured build-default incompatibility and WORKLOG for current acceptance evidence; the preceding paragraph records the original documentation audit.

P02 adds exact `anchor-spl` 1.2.1, Node LiteSVM 1.6.1, modern classic token client 0.18.0 and system client 0.16.0. LiteSVM and Surfpool run the same signed custody scenarios, then each environment adds its own relevant checks. Economics use hand-calculated Rust assertions plus an independent Python `Fraction` oracle with a fixed seed and arbitrary-sized integers; this phase does not add a proptest dependency. Oversized SBF stack diagnostics are fatal even when LLVM returns zero. The guard uses system `grep` and also rejects an unreadable log or a failed checker. See [ACCOUNTING-AND-CUSTODY](P02-ACCOUNTING-AND-CUSTODY.md) and WORKLOG for actual scope and evidence.

P03 retains the same external dependency versions; it explicitly uses the already locked solana-sha256-hasher 3.1.0 for full ProgramData approval hashes. The three IDLs/SDKs have independent legacy parity, and Rust/TypeScript quote evaluation is checked against enumerated marginal-lot prices. Signed LiteSVM and Surfpool scenarios test capital bindings, read-only quote CPI, epochs and upgrade rejection. `RIVALT_SLOT_TIME=20 pnpm smoke` uses an explicitly recorded 20 ms local cadence; default remains 100 ms. Expiry still advances through actual slots over standard RPC, with no simulated financial effects.

Primary references:
- [Anchor 1.2.1](https://www.anchor-lang.com/docs/updates/release-notes/1-2-1)
- [Anchor 1.2.0 CLI recommendation](https://www.anchor-lang.com/docs/updates/release-notes/1-2-0)
- [Stable Anchor TS compatibility](https://www.anchor-lang.com/docs/clients/typescript)
- [Solana JavaScript clients](https://solana.com/docs/clients/official/javascript)
- [web3.js and companion wallet releases](https://github.com/solana-foundation/solana-web3.js/releases)
- [Surfpool overview](https://solana.com/docs/tools/surfpool)
- [Codama](https://github.com/codama-idl/codama)

## Compatibility contract

Production path: Anchor Rust → IDL → Codama importer/renderer → modern generated SDK → web3.js v3.

Stable Anchor's TS client remains a separate legacy conformance tool. Exchange canonical bytes, address strings and integer strings between test paths. Do not cast legacy PublicKey/BN/Connection/Transaction objects into modern types. Do not import legacy @solana/spl-token in the modern runtime.

Use the default Anchor Rust solana-v3 family unless a demonstrated compatibility issue justifies a recorded change. Rust dependency families, CLI majors, JS majors and Solana transaction message versions are distinct. Do not mix Anchor solana-v3/solana-v4 features. Use supported legacy/v0 transactions initially; handle RPC version declarations explicitly.

Verify deterministic generation and instruction data, account order/flags, PDA seeds, enums/options, signed bounds, account/event decoding and actual signing/sending. Anchor's newer prerelease client is not an automatic replacement for stable 1.2.1.

Commit Cargo.lock, pnpm-lock.yaml, packageManager, compiler/platform pins and container/image identity when applicable. CI uses frozen installs. P01 resolves importer/renderer versions, exact remaining patches and prerequisites; a documentation assertion is not a passing compatibility result.

Do not assume Docker Desktop or Compose exists on the user's Apple Silicon machine. Preserve the existing environment. Native processes plus a supported PostgreSQL container are acceptable; use Apple Containers only after checking the required network/volume behavior. Document one reproducible entry point.

## Test layers

| Layer | Tool/environment | Main question |
|---|---|---|
| Economics | Independent rational reference + Rust/proptest | Do transitions conserve cash/exposure/claims, respect entitlements and retain fractions? |
| Program enforcement | LiteSVM with built SBF binaries | Do signer/PDA/owner/alias/epoch/CPI/custody checks reject attacks and roll back? |
| SDK contract | Vitest and isolated Anchor conformance | Do bytes, accounts, flags, errors and values agree across clients? |
| RPC contract | Actual Surfpool HTTP/WS | Can services send, observe, paginate history, backfill and decode the needed operations? |
| Service E2E | Surfpool + real PostgreSQL + actual API/router/indexer/worker/maker processes | Does the whole lifecycle reconcile under success and faults? |
| Browser | Playwright against that same local stack | Does the wallet/UI reflect actual chain outcomes and failures accurately? |
| Cluster parity | Focused real devnet profile | Do deployed dependencies, real verification, wallet/provider behavior and recovery work? |

Signature verification remains enabled in protocol acceptance tests. Setup may mint test tokens, seed oracle fixtures or inject faults; it must not insert fake venue balances/fills directly to make a scenario pass. Keep production client paths on standard RPC; simulator controls stay in test support.

## Required acceptance scenarios

IDs are stable references from the delivery plan/worklog. A finite suite is evidence, not universal safety.

| ID | Scenario | Required observation | Primary phase |
|---|---|---|---|
| A01 | Stack/SDK/RPC loop | Locked build, signed transaction independently fetched/decoded, client parity | P01 |
| A02 | Cash/claims/custody | Golden vectors, deposits/withdrawals, checked bounds, exact reconciliation and authority rejection | P02 |
| A03 | Maker interface | A/B parity, wrong capital/version/alias rejected, cumulative curve not reset | P03 |
| A04 | One/two-maker routes | Required-by-size split and price-beneficial split; full rollback on second failure | P04 |
| A05 | Quote-to-fill races | Current capacity/epoch/health enforced without unauthorized worse terms | P04/P06 |
| A06 | Indexer recovery | Duplicate/reordered/failed logs, disconnect/backfill, fresh DB rebuild and state reconciliation | P05 |
| A07 | Complete lifecycle | Deposit → split fill → cross-maker close → funded settlement → withdrawal through actual services | P06 |
| A08 | Ambiguous submit/restart | No duplicated authorized effect after timeout, expiry, worker kill or retry | P06 |
| A09 | Oracle/source failure | Wrong feed/verifier/stale/future/divergent/depeg input produces correct operation restrictions | P07 |
| A10 | Funding gaps/turnover | Authenticated full-maker sample, bounded valid intervals, no invented gaps, participant-owned fractions | P07 |
| A11 | Persistent orders | Partial/cancel/replace/expiry/withdraw race, correct reserve and cumulative fee | P08 |
| A12 | TP/SL | Shared remainder, no reversal, old generation invalid after close/reopen | P08 |
| A13 | Liquidation | Strict target progress after fees, funded receiver/caps and safe escalation | P09 |
| A14 | Default | Complete cohort, insurance/impairment, deterministic remainder, pagination/restart/omission rejection | P09 |
| A15 | UI and direct exit | Wallet failures/status accuracy, unpaid cash distinction, API-down admissible SDK exit | P10 |
| A16 | Sustained reliability | Whole matrix across services, maker/worker/RPC faults, no unexplained drift | P11 |
| A17 | Load/soak | Declared profile/load, resource headroom, 24-hour reconciled local soak | P12 |
| A18 | Real dependency verification | Actual deployed verifier/update path and mint/authority/source provenance | P13 |
| A19 | Devnet parity | Core lifecycle, real wallet signing/landing and provider backfill/recovery | P14 |
| A20 | Independent maker evidence | Genuine operator records, observed hedges/capital/costs, missing-data labels | P15 |
| A21 | Pilot readiness | Measured risk/capital, external review findings, incident/exit drill and separate go/no-go | P16 |

Early phases use controlled fixtures and supported operations; do not claim A09/A10/A14 pass before implementation. Historical experiment numbers are not transferred.

## RPC and database acceptance

Exercise actual standard shapes:
- submission/reconciliation: getLatestBlockhash, getBlockHeight, simulateTransaction, sendTransaction, getSignatureStatuses, getTransaction;
- state: getAccountInfo, getMultipleAccounts, getProgramAccounts and token balance reads;
- live observation: relevant logs/program/account/signature/slot subscriptions;
- history: paginated getSignaturesForAddress plus getTransaction, including before/until boundaries and failed transactions;
- commitment: explicit provisional/confirmed/finalized handling with repeated reconciliation.

History beyond one page and a new-database rebuild must work for the retained local run. Missing/truncated metadata produces a visible gap. Persist events/projections/checkpoint in one SQL transaction. Never infer committed economic effects from failed transaction logs.

Keep simulator reset/restore separate from worker/database restart. Use a new run identity after chain reset. Test duplicate/reordered observations in a fault harness; do not claim that this recreates real consensus forks.

## Environment profiles

Local deterministic: pinned executables, test mint, fixed fixtures/seeds and declared time/slot behavior. No dependency on changing remote mainnet state.

Dependency integration: actual dependency executables and, where possible, real signed updates. An injected verified-looking account does not prove the update pipeline.

Devnet: separate program/mint/feed IDs, genesis/feature manifest, actual provider and real primary verifier path. If a genuinely independent guard is unavailable, use only an explicitly labeled operator-controlled guard profile. M5b can establish engineering parity for that limited profile; it cannot close G12's independent-source/funded-pilot gate. An injected primary verification account cannot substitute for the real primary update pipeline.

Request secure RPC/API configuration in P13, not earlier. Never put credentials in reports. M5b is focused parity, not a claim about mainnet congestion, throughput or adversarial consensus behavior.

## CI and phase closure

Per PR: compile/type/IDL generation checks; affected financial/program/SDK tests; available RPC contract and short service smoke checks. Before those services exist, mark the later suite Not applicable yet, not Passed.

Broader integration: full economic/fault matrix, seeded stress, competing workers and DB recovery.
M5a: measured resource/load sweeps and the real 24-hour local soak.
M5b: focused actual devnet tests.
Expand testing only for a concrete remaining risk or required gate.

Every evidence report records code commit, binary/IDL/config identities, dependency pins, host, environment, seed, offered load/account mix, actual commands/outcomes and limitations. Phase closure requires evidence on the integrated revision; a passing old branch is insufficient after semantic changes.

## Metrics and initial objectives

| Metric | Definition / use |
|---|---|
| Reconciliation | V vs allocated C/P/I/T; total q; fully accrued claims/fractions vs P. Unexplained mismatch stops operation |
| Quote availability | Eligible full-size requests with executable one/two-maker liquidity, by size/side/source state |
| Fill success | Successful eligible normal-condition submissions / all such submissions, with cause breakdown; separate fault-injection population |
| Execution shortfall | side × (fill VWAP - request-time reference) / reference × 10,000; fees/network costs separate and then all-in |
| Split benefit/regret | Same-size/same-state all-in comparison to feasible single-maker routes and independent bounded optimum; unavailable capacity is not a price |
| Latency | Quote, signing-ready→submit, processed/confirmed/finalized, indexer and UI; p50/p95/p99, wallet wait separate |
| Resources | Transaction bytes/accounts/CU, priority/network costs, hot-account contention and expiry |
| Funding quality | Valid coverage/gaps, cap time, sampling sensitivity, allocation error and retained fractions |
| Maker economics | Actual trading/hedge/funding less actual costs, inventory/capital and subsidies separate; no double-counted markout |
| Cash/exit | Eligible gain→funded credit→withdrawal delay, pending/censored claims, admissible exit success and blocked reasons |
| Liquidation/default | Detection/recovery time, receiver capacity, residual debt, insurance usage, exact complete-cohort allocation |
| Commercial | Returning independent trader volume, concentration/retention, venue collected fees less variable cost/reserve allocation |

Initial engineering objectives retained from the build specification:
- zero unexplained accounting, authority, replay or partial-route violations;
- exact integer quote parity for identical A/B snapshots;
- cached quote p95 <= 200 ms under a declared baseline local profile;
- >=99% eligible normal-condition submitted attempts succeed at that profile's chosen baseline load;
- load sweeps start at 1, 5 and 10 attempted orders/second with declared account mix; report saturation;
- required transactions fit real limits, target >=20% measured CU headroom for declared worst-case fixtures;
- a 24-hour complete local soak with restarts/backfill/maker outages and final reconciliation.

These are targets, not achieved measurements or promises. Report failed/unfilled attempts, unpaid profits and degraded intervals. Do not combine local/devnet latency populations. Tune one measured bottleneck at a time after correctness.


## P04 validation extension

The build additionally creates the default clearing artifact (activation must reject), explicit local-test-profile clearing artifact and a clearly labeled hostile B replacement fixture. Existing external package versions remain pinned; the installed web3.js 3.1.1 ComputeBudgetProgram constructs the 400,000-CU instruction without a new client dependency. Route acceptance requires ≤320,000 measured CU, ≤1,232 serialized bytes and ≤20 message accounts for the declared fixtures. New independent tests compare all legal partitions against per-lot prefix sums with separate health checks. Shared signed scenarios run in LiteSVM and Surfpool; RPC uses actual hostile upgrade/reapproval, real slot expiry, HTTP transaction retrieval and WS notifications, with isolated legacy live event/account decoding. Failed-route event metadata must never count as committed fills. See [P04 contract](P04-ATOMIC-ROUTES.md) and WORKLOG for actual evidence.

D38: retain raw run files locally at their current paths, untracked/ignored; keep concise Markdown reports and necessary bounded regression fixtures in Git. A fresh clone runs ordinary tests without the local captures. Full retained-run auditors require actual local input and must fail if it is unavailable. See [storage policy](EVIDENCE.md). A source-preserving cleanup is not another financial/soak run.
