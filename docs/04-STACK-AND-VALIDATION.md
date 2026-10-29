# Stack, validation and measurement
Rivalt · baseline R1 · 20 October 2026

D69's [P29–P34 roadmap](P29-MAKER-LIQUIDITY-ROADMAP.md) retains the installed
stack and scopes checks by phase. A34A is documentation validation; A34B is an
independent contract/reference, not implementation evidence. A35–A39 require fresh
affected program/quote/routing/safety and RPC/WS/PostgreSQL evidence. Freeze numeric
comparison tolerances and workloads in G22 before measurement; keep zero unexplained
financial differences, packet fit and at least 20% measured compute headroom.
P32 is the integrated prototype continuation gate. No 24-hour run is added.
D70 authorizes implementation; [G22's pinned contract](P29B-MAKER-CONTRACT.md)
defines three-maker bounds, compute/headroom and
packet limits, 240-offer prototype and 600-offer final comparison populations.
Run `python3 tests/financial/test_maker_curve_contract.py` for the independent
contract checks; these do not substitute for P30–P34 compiled/RPC acceptance.
D71 supersedes mandatory lookup tables: use measured v0≤1,232 bytes or
v1≤4,096 bytes with explicit resource headers. [P30 evidence](evidence/P30.md)
qualifies the scoped curve/update lifecycle and records Surfpool log-status
disagreement; signature notifications and fetched finalized status remain decisive.
[P31 evidence](evidence/P31.md) records 415 independent allocation cases, 47 focused
SDK checks, 24 actual quote comparisons / 73 signed RPC/WS outcomes and 1,000
maximum-width searches. These qualify pricing/preview only; P32 must prove changed
financial execution and PostgreSQL integration separately.

P32's scoped sampler probe records historical compute/heap failures and a D74
successful100-lot transaction that still fails required CU headroom; see
[its implementation record](P32-LIQUIDITY-EXECUTION.md#d74-published-depth-resource-result).
Native prepared-admission equivalence does not replace the unchanged compiled
full-coverage/full-book/headroom gates. Do not classify a simulated failure as a
submitted transaction or successful sample.

D74 explicitly supersedes financial eligibility inside profile-4 funding samples.
Requalify the published-depth sampler at 100/600 lots, including actual zero-cash
makers, while proving execution margin checks remain effective. Retain complete
authenticated coverage, stale/disabled/index-band failures, declared capacity,
causal accrual and unchanged resource ceilings. The pre-D74 equivalence cases
remain historical regression coverage, not the new funding contract.

D75 replaces per-update on-chain funding search with restricted publisher reports.
Use [the revised P32–P34 acceptance](P32-FUNDING-PUBLISHER.md): independently test
backend calculation/complete-input handling and on-chain report acceptance as
distinct trust boundaries. Freeze the smaller resource target before benchmarking;
measure real signed reports, authority/replay/expiry/recovery, actual financial
effects and PostgreSQL reconstruction. Historical sampler probes cannot qualify
this new authority path. No test or gate is closed by this planning amendment.

D63 records [P25 cash/claim implementation](P25-ACCOUNT-CASH.md): atomic own-account
funded exits and separate complete market payment certificates. Acceptance remains
phase-owned, and the candidate build does not satisfy P26 safety.

D62 records [P24's candidate trading interface](P24-ACCOUNT-TRADING.md): scoped
account/safety/maker authority, current relevant risk and exact per-market fee
allocation. It remains a separate qualification artifact pending P26 safety.


D60 completes the schema-3 [financial/state/authority contract](P22B-EXECUTABLE-CONTRACT.md)
and supersedes the earlier P22B-incomplete wording below. The exact normal
settlement, bounded terminal arithmetic and layouts apply only to the new profile.
[A27B evidence](evidence/P22B.md) and WORKLOG own acceptance; no new runtime
activation or inherited qualification follows from contract completion.


D56's [P22–P28 roadmap](P22-ACCOUNT-CENTRIC-CLEARING.md) retains the existing locked
stack. A27A is documentation validation; A27B is independent contract/model work,
not implementation acceptance. A28–A33 require fresh affected program, RPC/WS,
PostgreSQL and browser evidence, with exits under continuous normal sampling,
explicit outcome denominators and transaction/contention measurements. Neither
Phoenix research nor prior P16A/P21B results qualify the changed implementation.
No new 24-hour requirement or funded/external gate waiver is introduced.

P22B's targeted command is `python3 tests/financial/test_account_contract.py`.
It checks independent exact arithmetic/counterexamples, including a bounded
withdrawal enumeration; it does not call the Rust/SDK implementation or establish
program acceptance. The restricted market-default example rejects mixed-sign
accounts rather than pretending to solve cross-market cycles. `ops/financial.sh`
includes this suite for hosted financial CI; local P22B iteration runs only the
affected Python suite. Actual executed revisions/results belong in WORKLOG.

For D58's reserve allocation changes, run only
`python3 tests/financial/test_account_contract.py InsuranceReserveContract` locally.
Its independent cases cover the selected 25% split, per-market carry, fragmented
fee collection, seed/manual allocation distinction, exhaustion and fractional
residual debt. The reference imports no production code. P23–P28 must separately
qualify actual custody, fee debit/rollback, default stages, ABI and RPC/WS/PostgreSQL
reconstruction; passing these arithmetic checks does not satisfy those gates.

D59's separate target is `python3 tests/financial/test_clearing_network.py`.
It checks the complete-cohort rational benchmark and the whole-atom output candidate
against literal and independent closed-form mixed-sign/cyclic cases, including
fractional-insurance clipping and per-market conserving rounding. Arbitrary-size
rational internals do not establish bounded executable encoding or signed financial
acceptance. The hosted financial command includes the new target; local iteration
does not rerun unrelated suites.

P17–P21 retain these pinned tools. [P17](P17-MARGIN-CONTRACT.md) defines fresh
successor golden cases, versioned layout/authority tests, whole-account funding,
reservation/transfer/protection checks and complete-group liquidation/default
qualification. A22–A26 in the delivery plan are new evidence gates; prior A01–A21
or the proposal's arithmetic checks do not qualify changed economic behavior.
Use actual signed SBF and Surfpool/RPC/WS/PostgreSQL integration where required;
record bounded load, transaction budgets and group/root contention. D42's full-day
deferral and separate P15B/P16B external gates remain unchanged.

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

P05 pins Fastify 5.12.7, pg/@types/pg 8.23.1 and PostgreSQL 18.6. The official arm64 image is pinned by digest and runs through existing Apple container CLI 1.4.1 with loopback publishing and a bound per-run data volume; the host PostgreSQL 14 installation is untouched. [INDEXER](P05-INDEXER.md) specifies SQL atomicity, runtime configuration and the actual restart/rebuild/reset acceptance contract. `ops/rpc-smoke.sh` is the targeted service harness; full `pnpm smoke` still rebuilds and verifies all inherited code.

P10 pins React/react-dom and their types to 19.3.0, Vite to the existing locked 7.3.7, and Playwright core to 1.64.1. It retains wallet-adapter 3.1.1 and the modern SDK graph. Browser acceptance uses the installed Chrome executable in an isolated headless profile against actual Surfpool/WS/PostgreSQL and real signed Wallet Standard requests. The private test keys stay in the Node fixture. Browser version and source identity are captured per run; installed-browser behavior is not an external-provider/devnet claim. [TRADER](P10-TRADER.md) defines the public configuration and direct exit contract; WORKLOG owns actual acceptance status.

Primary references:
- [PostgreSQL macOS distributions](https://www.postgresql.org/download/macosx/)
- [node-postgres transaction contract](https://node-postgres.com/features/transactions)
- [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
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
| A17 | Load/soak | Declared load/resources, D35 bounded qualification, >10,000 actual RPC history replay and final exit | P12 |
| A18 | Real dependency verification | Actual deployed verifier/update path and mint/authority/source provenance | P13 |
| A19 | Devnet parity | Core lifecycle, real wallet signing/landing and provider backfill/recovery | P14 |
| A20A | Maker kit/tooling | Fresh operator qualification over actual RPC/WS/PostgreSQL; independent economics and labelled hedge assumptions | P15A |
| A21A | Engineering reliability | Explicit availability populations/reasons, targeted bounded checks for actionable fixes, affected recovery/reconciliation/exit and measured limits; 24-hour endurance deferred (D42) | P16A |
| A20B (original A20) | Independent maker evidence | Genuine operator records, observed hedges/capital/costs, missing-data labels; A20A cannot substitute | P15B |
| A21B | External/funded readiness | Independent review/source assurance, measured funded risk/capital and separately authorized go/no-go; A21A cannot substitute | P16B |

D37 scopes A18/A19 to bounded engineering checks with intermittent sponsored devnet feeds. Record availability and notification gaps; do not require continuous feed availability or repeat a soak. An actual original-signature WS recovery plus independently finalized RPC history may qualify a missed live A18 notification while retaining the original failure. A19 still requires the focused service/wallet lifecycle and provider/backfill recovery. Neither accounting/authentication failures nor unresolved signed outcomes can be waived. P13's accepted trade uses 20-second source age; the approved 30-second devnet-only configuration must be separately implemented/tested before use.

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

Request secure RPC configuration in P13 only when needed. D36 selects sponsored Pyth Core account reads without Pyth API credentials: actual sponsor update/verification transactions plus Rivalt consumption must be independently evidenced. Preserve stale-source rejection and disclose measured availability; neither fixture data nor account existence alone closes A18. Never put credentials in reports. M5b is focused parity, not a claim about mainnet congestion, throughput or adversarial consensus behavior.

## CI and phase closure

Per PR: compile/type/IDL generation checks; affected financial/program/SDK tests; available RPC contract and short service smoke checks. Before those services exist, mark the later suite Not applicable yet, not Passed.

23 October scope clarification: select these checks by the changed behavior and the owning phase's acceptance contract, rather than running every inherited suite before each PR. An unchanged program does not require a new unrelated financial matrix for a UI change. Prefer supported CI for broad regression; a workflow definition or queued job is not passing evidence. P11's consolidated A01–A16 run and P12's D35 load/bounded qualification and large-history replay remain required deliverables. Retain completed partial results and explicitly label intentional cancellation/not-run stages.

Broader integration: full economic/fault matrix, seeded stress, competing workers and DB recovery.
M5a: measured resource/load sweeps, D35 real 1,800-second qualification, affected recovery and >10,000-transaction fresh PostgreSQL reconstruction.
M5b: focused actual devnet tests.
Expand testing only for a concrete remaining risk or required gate.

P11 implements the explicit matrix/report contract in [P11-MATRIX](P11-MATRIX.md). `pnpm test:matrix` (also `pnpm smoke`) records A01–A16 on one committed revision and six fresh service environments; `--stage` is a labeled partial reproduction, not full acceptance. Independent Python checks reject stale/dirty evidence, binary/report drift and exact cash/exposure/fractional-claim mismatches. The PR workflow selects hosted fast checks by the actual parent diff. No supported full-runtime CI runner is currently configured; local matrix execution and hosted CI outcomes are recorded separately.

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
- under D35, >=50% normal offered availability and real 1,800-second local qualification with affected recovery, final withdrawal and >10,000-transaction RPC reconstruction;
- a continuous 24-hour endurance run with restarts/backfill/maker outages and final reconciliation remains deferred under D42 and is not required for current P16A completion; future funded-readiness assessment must revisit it separately.

These are targets, not achieved measurements or promises. Report failed/unfilled attempts, unpaid profits and degraded intervals. Do not combine local/devnet latency populations. Tune one measured bottleneck at a time after correctness.


## P04 validation extension

The build additionally creates the default clearing artifact (activation must reject), explicit local-test-profile clearing artifact and a clearly labeled hostile B replacement fixture. Existing external package versions remain pinned; the installed web3.js 3.1.1 ComputeBudgetProgram constructs the 400,000-CU instruction without a new client dependency. Route acceptance requires ≤320,000 measured CU, ≤1,232 serialized bytes and ≤20 message accounts for the declared fixtures. New independent tests compare all legal partitions against per-lot prefix sums with separate health checks. Shared signed scenarios run in LiteSVM and Surfpool; RPC uses actual hostile upgrade/reapproval, real slot expiry, HTTP transaction retrieval and WS notifications, with isolated legacy live event/account decoding. Failed-route event metadata must never count as committed fills. See [P04 contract](P04-ATOMIC-ROUTES.md) and WORKLOG for actual evidence.


## P06 validation extension

The same pinned stack builds the new clearing cohort/settlement instructions and isolated legacy ABI comparison. Signed compiled-program tests cover partial/reordered/foreign cohorts, sequence and observation invalidation, distress, entitlement, replay, post-withdrawal margin, owner checks and real SPL withdrawal. `ops/lifecycle-smoke.sh` starts an isolated real Surfpool/PostgreSQL environment and distinct service processes. A thin wallet harness checks independent fill/fee/claim vectors, actual maker epoch renewal/outage/return, durable pre-broadcast bytes, lost acknowledgement plus executor kill, competing/restarted settlement workers, real blockhash expiry, unresolved absent history and exact operator fee reconciliation. Full `pnpm smoke` runs both the inherited acceptance environment and this service lifecycle; WORKLOG records the actual run/revision/results. No soak, browser-wallet, independent-operator, devnet or production claim follows from local acceptance.


## P07 validation extension

The pinned build adds a local signed oracle fixture dependency, with no new npm/crate release pins. `pnpm test:oracle` runs real signed SBF source, funding, turnover, coverage and direct-exit cases. `ops/oracle-smoke.sh` deploys that fixture and the three first-party programs, then runs separate funding/executor/maker services, signed fixture publication, HTTP wallet routes and real RPC/WS/PostgreSQL recovery. The local oracle profile declares its source and module trust limits; no upstream verification or guard independence follows. Acceptance requires clean committed full regression, isolated legacy ABI/account/event parity, largest reference quantity resource measurements and exact reconstruction; WORKLOG owns results.


## P08 validation extension

`pnpm test:orders` executes signed SBF authority, partial-prefix, all-in/fee, both race orderings, protective-generation and price-shock reservation cases. Independent literal arithmetic and partition bounds test reserve conservatism. `ops/orders-smoke.sh` deploys the real local programs, then exercises order races over RPC and restarts a discovery worker after persistence and before broadcast. Competing discovery processes share exact durable identities. PostgreSQL reconstruction, actual payer fees and isolated legacy decoding of the live Participant/order/route events must reconcile. The 400,000-CU route declaration retains the ≤320,000 measured CU / ≤1,232 bytes / ≤20 accounts acceptance gate, including both makers with all bounded order records populated. Funding retains its separate P07 budget. No real-wallet browser, soak or devnet claim follows from these tests.

### P09 acceptance contract

`pnpm test:resolution` exercises all legal page sizes from independent signed economic setups, actual 64-member registry traversal, source-emergency entry and deterministic full-cohort payouts. Expected payments, insurance, impairment and terminal fractions come from `tests/financial/resolution-reference.py`, an independent Python Fraction oracle consuming pre-freeze account snapshots. A separate pure handler-state test covers derived valuation headroom and terminal generation bounds, serializing after every page; it is not claimed as a real traded chain scenario. All five new instruction families require isolated legacy Anchor parity.

`ops/resolution-smoke.sh` deploys actual local programs and uses standard RPC/WS plus PostgreSQL. Acceptance includes risk receiver capacity, exact signed retry bytes, competing discovery, process kill between pages, frozen and final database rebuild, no invented price during an actual source outage, authorized recovery and independently fetched network fees. Resolution declares 1,200,000 CU and requires ≤960,000 measured CU, ≤1,232 bytes and ≤20 message accounts. Development caught and corrected an SBF heap limit at 64 members; acceptance must retain that maximum cohort. Actual verified results belong in WORKLOG/evidence, not this command contract.

P10 runtime acceptance refinement: full integrated acceptance uses `RIVALT_SLOT_TIME=50`. Local program deployment/upgrade provisioning permits at most 20 CLI blockhash signing attempts after observed upload exhaustion at the default five. This allowance is limited to program/buffer uploads; durable financial retries retain their original signature rules. A separately passing 100 ms browser profile does not validate sequential manual funding harnesses at 100 ms, which can violate the unchanged six-second recovery-gap condition.

P12 verification is scoped to its resource options, measurement logic, actual offered-load sweep, D35 bounded qualification and actual large-history replay; unchanged financial programs retain P11 evidence. [LOAD-SOAK](P12-LOAD-SOAK.md) defines complete offered/submitted populations and the explicit local fee/history profile. A short sweep alone is not A17 and a raised recovery bound is not proof of a large replay. D35 explicitly supersedes the blocking P12 full-day duration; it does not claim full-day endurance passed.

D38: retain raw run files locally at their current paths, untracked/ignored; keep concise Markdown reports and necessary bounded regression fixtures in Git. A fresh clone runs ordinary tests without the local captures. Full retained-run auditors require actual local input and must fail if it is unavailable. See [storage policy](EVIDENCE.md). A source-preserving cleanup is not another financial/soak run.

D41 separates engineering and external evidence: P15A supplies reproducible internal operator qualification and exact economics tooling; P16A supplies explicit availability denominators/classification and bounded, change-focused operational verification; D42 supersedes D41's full-day requirement. A20B/A21B retain the independent-participant/review/funded gates. No new full-body checks are required for unrelated changes; continuous 24-hour qualification stays explicitly Deferred, not passed or replaced by a bounded check.


## P18B scoped primitive verification

Use `bash ops/build-group-trading.sh` for the three changed default/successor
programs and required signed local source fixture. Each SBF command fails the
wrapper immediately on a 4,096-byte stack diagnostic. The generator retains
legacy flattened arguments deliberately; isolated Anchor comparisons cover the
new envelopes, optional accounts and order variants as well as affected V1 route
and maker interfaces. `pnpm typecheck` checks the integrated client surface.

`cargo test -p financial-core --test margin --test market_oracle --locked` and
`cargo test -p clearing --lib instructions::group_trading::tests --features
successor-test-profile --locked` exercise actual Rust candidates with independent
expected results. `node --import tsx tests/rpc-contract/group-trading-svm.ts` sends
real signed transactions to compiled programs, including four separately funded
maker roots, six signed fixture sources and compile-time trading rejection.
It compares actual account bytes with isolated legacy Anchor, then runs the
independent Python raw-byte auditor and six adverse byte mutations.

Declare 1,200,000 CU for complete-maker source samples and 400,000 CU for the other
setup/quote scenarios; require 20% measured CU headroom and at most 1,232 packet
bytes. Report actual accounts and populations. These are neither activated route
budgets nor RPC/WS/PostgreSQL service qualification; P18C/P21 own those checks.
Retain raw files in unique ignored `.local/group-trading/` run directories and
scoped build artifacts/logs in `.local/successor-p18b/`. No V1 history/load/soak
rerun is required by this phase.

## P18C scoped safety verification

`bash ops/build-group-safety.sh` builds default/successor clearing and A/B plus the
unchanged source fixture with the pinned SBF frame guard and regenerated clients.
Development iterations may rebuild only changed clearing; final acceptance must
record all exact program hashes and generated-output parity. `pnpm typecheck`
covers the changed public interfaces. Legacy Anchor remains isolated.

Run `cargo test -p financial-core --test margin_safety --locked --offline` and
`cargo test -p clearing --lib instructions::group_ --features successor-test-profile
--locked --offline` for actual safety/trading candidates, plus the changed
`state::v2::tests` codec bounds and `event_cpi` wire-parity test. Use
`CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0` for bounded local build storage.
`node --import tsx tests/rpc-contract/group-safety-svm.ts` submits signed, verified
transactions to compiled programs and writes unique ignored `.local/group-safety/`
runs. `python3 tests/financial/group-safety-reference.py RUN_DIRECTORY` independently
decodes cash/exposure/funding/default ownership and rejects six byte mutations.
Counts include setup/source observations and exact rejection cases, not distinct
financial vectors. Failed runs stay local with their transaction/log capture.

The local candidate declares 600,000 CU for group routes, 1,200,000 for full-source
sampling/default pages and 400,000 otherwise; acceptance requires 20% measured
headroom and <=1,232 bytes. These are provisional envelopes, not throughput or
contention results. The default 32 KiB SBF heap is retained. `bash ops/group-safety-smoke.sh` deploys
fresh local programs and verifies both-market lifecycle over real RPC/WS, fetching
every original signature finalized. The auditor
`python3 tests/financial/group-safety-reference.py RUN_DIRECTORY --ordinary`
uses literal maker-curve and cash expectations and rejects four mutations.
[A23C/G14](evidence/P18C.md) records committed acceptance on `b43261f`, including
orders, emergency recovery and legacy account/event parity. P21 owns
PostgreSQL/UI/services and new bounded contention qualification.

## P21B scoped UI and contention qualification

`bash ops/group-indexer-smoke.sh --browser` uses actual Wallet Standard signing,
RPC/WS and PostgreSQL; `--workload` is the separate 300-second/150-offer population
on a clean revision with the unchanged qualified binaries. Independent auditors
under `tests/financial/group-{browser,workload}-reference.py` read retained captures
without regenerating financial runs. The PostgreSQL history regression executes
`tests/rpc-contract/group-history-postgres.ts` against an isolated actual database.
[The report](evidence/P21B.md) preserves command failures, corrected standalone audit
attribution, all denominators and the 0/3 busy versus 3/3 quiescent exit distinction.
No source/sequence guards are relaxed and no continuous 24-hour test is implied.

P23 adds [schema-3 custody](P23-ACCOUNT-CUSTODY.md) under D61: real owner cash
allocation and market-attributed insurance seed/classification, with trading and
all unfinished financial paths disabled. Its own signed/ABI/RPC acceptance is
recorded in WORKLOG and [P23 evidence](evidence/P23.md), not inherited from V2.

## P28 concurrent account qualification

The [P28 report](evidence/P28.md) pins the actual browser and workload/recovery
revisions. `bash ops/account-indexer-smoke.sh --qualification` runs the combined
fresh local browser/workload/default/replay gate; `--workload` uses signed SDK
provisioning when only the workload/recovery portion changes. Preserve the
[predeclared schedule](P28-ACCOUNT-QUALIFICATION.md), every refused/unsubmitted
intent, raw original bytes, independent economic audit and fresh PostgreSQL replay.
The 150 scheduled / 123 actual quote / 115 submitted denominators are distinct.
Six own-cash withdrawals succeed after unrelated fills and sampler advances.

A bounded-history fix found by this gate has 12 focused transport regressions and
actual integration recovery. It retries no financial/identity error and exposes
no partial candidate. No new V1/V2 runtime, SBF build or devnet qualification is
inferred; broad consumer regression remains assigned to scoped hosted CI. Neither
internal makers nor a five-minute workload close P15B/P16B or deferred endurance.


P28A verifies only its new interactive launcher/wallet lifecycle: fresh real local
programs, RPC/WS/PostgreSQL, actual browser signatures/original RPC history, owned
stop/reset and current deployment identity. Use focused wallet/faucet boundary
checks plus typecheck/build. Qualified P26 binaries and P27/P28 financial acceptance
retain their existing pins; no inherited full suite or endurance rerun is implied.
