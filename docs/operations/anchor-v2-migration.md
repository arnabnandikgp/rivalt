# Anchor v2 migration plan

Status: **P45–P47 in Review; local qualification and applicable hosted checks pass, 1 November 2026**.
The user accepted this plan. The frozen predecessor remains
`c0bc3aaa3825896fcafbc879fe104362da61c21d`; candidate schemas and clients in the
P46 branch do not qualify a deployment. [STATUS](../STATUS.md) owns actual checks
and integration status. P47’s qualified local promotion is recorded below.

## Recommendation and boundaries

Use the published **Anchor 2.0.0-rc.2** crates and CLI, with a fresh bounded local
deployment and an explicitly revised ABI. First establish a correct serialized
account port; capture its measurements before considering small, justified
zero-copy conversions. Qualify the resulting implementation against the immutable
P44 baseline. Do not promise Anchor's advertised benchmark factors for Rivalt.

This is a framework migration, not another economic redesign. Preserve BTC/ETH,
one classic test mint, isolated/cross accounts, isolated maker capital, two-maker
atomic routes, whole-account funding/reservations, zero positive unpaid-profit
margin credit, 2 bps taker/zero provider fees, exact 25% insurance carry, source
safeguards, complete-cohort market-attributed default and current routing. Preserve
P40–P44 access reductions, scoped authenticated history and durable dispatch.
Do not weaken checks, omit events, shrink fixtures or increase resource limits to
manufacture an improvement. P15B/P16B remain external; 24-hour endurance remains
Deferred. No devnet credential, external wallet, paid service or funded deployment
is needed for this local migration.

The authorized ready, dependent PR sequence is: **P45 plan → P46 port → P47 qualification**.
Implementation stacks on the accepted exact parent without waiting for its merge;
keep the stack open.

## Research and release identity

Read the overall installation, fundamentals, account/context/CPI model, program
development, security, token, client, testing and reference documentation before
the migration guide. Then inspect RC2 release notes and published source because
some overview pages still describe a branch-only alpha.

| Source | Consequence for Rivalt |
|---|---|
| [Architecture and fundamentals](https://v2.anchor-lang.com/docs/v2/fundamentals/) | Pinocchio account views, trait-based validation, mutable context references and typed CPI handles replace much of the v1 runtime machinery. This changes ownership/borrowing assumptions, not just imports. |
| [Account and program model](https://v2.anchor-lang.com/docs/v2/programs/) | Default accounts are directly borrowed Pod data. Serialized `BorshAccount<T>` remains available; it is the initial port for existing ordered fields and bounded variable records. |
| [Security](https://v2.anchor-lang.com/docs/v2/security/) and [reference](https://v2.anchor-lang.com/docs/v2/reference/) | Retain guardrails and checked arithmetic. Do not use duplicate-mutable opt-outs, unchecked entrypoints or disabled validation as optimizations. |
| [Tokens](https://v2.anchor-lang.com/docs/v2/tokens/), [clients](https://v2.anchor-lang.com/docs/v2/clients/) and [testing](https://v2.anchor-lang.com/docs/v2/testing/) | Port SPL wrappers and CPI borrowing; preserve our generated client and real RPC/WS/PG harness. New profiling helpers are optional diagnostics, not replacement acceptance. |
| [Migration guide](https://v2.anchor-lang.com/docs/v2/get-started/migrating-from-v1/) | Map `Pubkey`/`AccountInfo`, context lifetimes, account models, constraints, serialization and errors deliberately. A dependency bump alone is insufficient. |
| [RC2 release notes](https://v2.anchor-lang.com/docs/updates/release-notes/2-0-0-rc-2/) | RC2 also publishes a Kit-based TypeScript client; Wincode has documented differences from Borsh. Its Agave-compatible Rust dependencies do not themselves require changing our RPC runtime or transaction policy. |

Downloaded crate archives were checksum-verified without installing/building them.
All four inspected RC2 Rust packages report source commit
**`a20660219882af5f199d56ea3f9326f387f89d8b`**. Exact registry identities:

| Package | Version | Published archive SHA-256 |
|---|---|---|
| `anchor-lang` | `=2.0.0-rc.2` | `356811863224722c5eff648869b67ea8d769b0da8c4924cc38cc242ced617e38` |
| `anchor-spl` | `=2.0.0-rc.2` | `94269c342b12e11d285282d9fffca54e46b9abbac13708ccee9b6f1a2f27c6eb` |
| `anchor-cli` | `2.0.0-rc.2` | `8f964048fd32b7156fd7ab8cee79f3a69cd4be9cd40aad0cfa4fb90bd487f759` |
| `anchor-derive-accounts` | `=2.0.0-rc.2` | `18c5bd235119ae47e37190da06b9c0961a686aa9e31986ccab207b1234540e4f` |

Primary package metadata: [lang](https://crates.io/api/v1/crates/anchor-lang/2.0.0-rc.2),
[SPL](https://crates.io/api/v1/crates/anchor-spl/2.0.0-rc.2),
[CLI](https://crates.io/api/v1/crates/anchor-cli/2.0.0-rc.2),
[derive](https://crates.io/api/v1/crates/anchor-derive-accounts/2.0.0-rc.2).
Retained research is ignored under `.local/anchor-v2-planning/`; it is not execution
evidence and need not be archived or committed.

The website's installation example uses floating `anchor-next`; do not follow that
pin. Published RC2 features also differ from v1: `anchor-lang` provides `alloc`,
`guardrails` and `idl-build`, but no `event-cpi` feature; `anchor-spl` has
`guardrails`/`metadata`, not `token`, `token_2022`, `solana-v3` or `idl-build` feature
flags. Event macros and token modules still exist. Remove obsolete feature
forwarding explicitly, rather than losing their behavior.

Proposed direct workspace dependencies (transitives still require a generated,
reviewed lockfile):

```toml
anchor-lang = { version = "=2.0.0-rc.2", default-features = false, features = ["alloc", "guardrails"] }
anchor-spl = { version = "=2.0.0-rc.2", default-features = false, features = ["guardrails"] }
```

Keep `const-rent` and `testing` out of deployable features; audit Cargo feature
unification across fixtures/dev dependencies. Use `compat` only for a documented
required adapter, not a blanket excuse to retain old imports. Preserve release
overflow checks and optimization settings for the matched comparison.

The docs advertise newer default SBF tools, while RC2's
[CLI source](https://github.com/otter-sec/anchor/blob/a20660219882af5f199d56ea3f9326f387f89d8b/cli/src/lib.rs)
contains a `build-sbf --tools-version v1.52` command. Inspect the installed CLI's
actual arguments/help and build output; neither website defaults nor that helper
alone prove the compiler used. Start with Rivalt's explicit platform-tools v1.52,
SBPF v0, host Rust 1.97.1, Agave CLI 4.1.2 and Surfpool 1.7.0. The existing
[validation pins](local-development.md#pinned-toolchain) otherwise stay fixed.
Dependency resolution and SBF compatibility have **not** yet been proved.

Install the CLI later into a separate ignored repository tool root, for example
`cargo install anchor-cli --version 2.0.0-rc.2 --locked --root .tools/anchor-v2-rc2`.
Verify the resulting version and record any host-only build workaround. Do not
replace the globally installed CLI or use a moving branch. Preserve v1 binaries,
lockfiles through Git, retained test data and keys. Check disk headroom before
installation/builds; no automatic deletion of databases or external compiler caches.

## Explicit ABI choice

Source/IDL inspection finds **61 public instructions**: clearing 53 and each maker
four. All 61 deliberately use historical eight-byte discriminators rather than
the hash of their current canonical name. Clearing's 17 account and 28 event
discriminators already use canonical hashes. Both makers' two account and two
event types retain custom historical discriminators.

RC2's published
[derive implementation](https://github.com/otter-sec/anchor/blob/a20660219882af5f199d56ea3f9326f387f89d8b/lang-v2/derive/src/lib.rs)
accepts arbitrary discriminator arrays for **interface-only** declarations, but
executable custom instruction discriminators must be one byte. Its account/event
attributes do not accept our v1 custom-discriminator arguments. Consequently a
stock macro port cannot preserve our entire existing eight-byte ABI.

| Alternative | Benefit | Cost / recommendation |
|---|---|---|
| Fresh bounded ABI using stock RC2 and canonical eight-byte hashes | Canonical readable names, standard generated dispatch, no framework fork; unchanged discriminator width | Requires coordinated clients, maker CPI, event decoding and fresh state. **Recommended for this unfunded local prototype.** |
| Preserve every historical byte through compatibility code | Existing instruction/account identifiers survive | Requires a framework patch/custom dispatch or historical-name adapters, plus explicit account/event support and independent validation. Not an ordinary macro migration; retain only if compatibility becomes a real requirement. |

The recommended P46 delta is precise; freeze it in machine-checked comparison
before accepting regenerated fixtures:

| Surface | Proposed new contract |
|---|---|
| 61 instruction identifiers | Eight bytes `SHA256("global:" + canonical instruction name)[0:8]`; no one-byte optimization. Verify uniqueness and no accidental old/new cross-dispatch. |
| Clearing accounts/events | Keep their canonical eight-byte hashes. Clearing-owned account schema advances **7 → 8**, field width/order unchanged. |
| Maker accounts/events | `MakerCurve`, `MakerPrice`, `MakerPriceUpdated`, `MakerShapeUpdated` use canonical `account:`/`event:` hashes in both programs. Maker-owned account schema advances **4 → 5**. |
| Maker protocol and funding report versions | Preserve current request/response/report encodings and version numbers. Separate the maker account-schema constant from any shared protocol-version constant; do not blindly change `canonical::VERSION`. |
| Layouts, seeds, instruction arguments, ordered metas and protocol errors | Preserve existing field encoding/lengths, PDA seed bytes, signer/writable requirements, optional-account meaning and custom error numbers. Record any necessary exception before implementation; no blanket fixture recapture. |
| Deployment, SDK and journal | New genesis/domain/mint/test state and artifact/IDL bindings; `accountSchema: 8` required end to end. API/profile version 4 and journal format 2 can stay only if their envelope semantics remain unchanged. Never select schema by trying alternative decoders. |
| Signed originals and replay | Old instructions are not reinterpreted; old journal bindings, account schemas and prepared transactions reject. New instruction IDs also update scoped-history instruction authentication and every maker CPI caller. |

This deliberately supersedes P36's retained instruction and maker-owned
discriminators **only for the new deployment**, plus the current schema-7/4 client
selection. It does not supersede the financial, authority, event-completeness,
PDA-seed or access contracts. P46 updates the affected current specifications and
records the actual ABI manifest alongside D90; P45 only proposes this boundary.

There is no in-place account/fund/database migration in scope. Stop old producers,
drain definitive outcomes with the pinned old executor, and preserve unresolved
originals/unknown-fee reservations under their old binding. Start a separate empty
qualification chain and database. The same program keys may be used on separate
local chains for matched experiments, never as permission to overwrite retained
deployed state. Rollback means selecting the preserved old artifacts and explicit
old configuration in their own environment, not decoding new accounts as old ones.

## Code-to-migration map

| Current implementation | Required change | Acceptance |
|---|---|---|
| Workspace `Cargo.toml`, `Cargo.lock`, program/fixture manifests, `Anchor.toml`, `ops/env.sh`, `ops/build-liquidity-execution.sh` | Exact RC2 dependencies/CLI, correct feature forwarding, explicit compiler/architecture, isolated candidate artifacts and lockfile | Locked clean build; feature graph proves guards enabled and no test-only/const-rent leakage; default and qualification binaries separately identified |
| `programs/clearing/src/lib.rs`, `programs/maker-canonical.rs`, instruction contexts | Mutable `Context` references, `Address`/`AccountView` interfaces, lifetime changes, account/constraint validation | All handlers/fixtures compile; signer/owner/PDA/executable/rent checks and ordered access are compared; no duplicate-write opt-outs |
| `programs/clearing/src/state/accounts/layouts.rs`, `state/liquidity.rs`, maker state | Explicit `#[account(borsh)]` and `BorshAccount<T>` initially; controlled schema/discriminator delta | Independent bytes, size/offset and malformed-buffer tests for every owned account; IDL/client decoding agrees |
| `programs/clearing/src/state/records.rs` | Replace the Borsh-specific custom cohort decoder with a bounded RC2/Wincode codec | u32 length is checked against 64 **before allocation**; oversized/truncated/foreign members reject; exact existing wire shape |
| `programs/clearing/src/state/accounts/resolution.rs` | Preserve heap-backed `Wide` and fixed 96-limb encoding; adapt serialization traits without stack copies | 768 bytes per wide record; maximum page/work allocation and stack/heap limits; actual compiled wide arithmetic/default checks |
| `programs/clearing/src/event_cpi.rs`, `scoped_history.rs`, events | Port bounded borrowed serializers and self-CPI; change instruction IDs; preserve revision semantics | Same ordered payloads, final authenticated footer, rollback, event authority and independent journal replay; no log-only substitute |
| Maker route/approval and SPL custody CPI paths | Typed handles, proper borrow release/reacquisition; raw adapters only where required | Complete maker ProgramData authentication and return-data producer/length checks; no vault signer/arbitrary clearing writes reach makers; token balance re-read after CPI |
| Oracle adapter and fixture programs | `AccountView` access and foreign-owner decoding with exact data/range checks | Existing source freshness/confidence/identity rejection and retained Pyth Core decoding; default/devnet stay gated |
| `crates/financial-core`, `crates/maker-interface` and program boundary helpers | Keep financial math independent; adapt serialization and `core`/`alloc` APIs where RC2 requires them | No rounding/rate/quantity changes; checked overflow behavior and independent expected vectors remain; no hidden dependency on the host runtime |
| `ops/generate-sdk.ts`, `packages/sdk/idl`, generated SDK, `ops/wire_contract.py` | Generate actual RC2 IDLs, bounded approved ABI delta, deterministic current Codama output | All 61 builders/metas/arguments and all accounts/events/errors compared; generated output cannot bless its own changed expected bytes |
| SDK, gateway, router, publisher, maker kit, indexer and UI | Explicit clearing-schema-8 and maker-schema-5/artifact bindings; projection binding 8 and SQL journal format 2; revised discriminators and preserved original-byte submission | Old config/original/journal refusal, real signing and finalized RPC/WS/PG replay, API-independent cash exits |
| `tests/performance/full-baseline.ts`, `receipt-metrics.ts` | Add a separate candidate reader/comparator parameterized by pinned IDLs/artifacts | Frozen B remains reproducible; same scenario pairs with explicit permitted byte deltas; no comparison of mismatched populations |

Existing helper functions already take mutable contexts in some places, but public
handlers and account wrappers still use v1 interfaces. There are 33 clearing and
four per-maker protocol error definitions to preserve. Framework errors may change
representation or precedence; classify them separately and prove the same invalid
action rejects without financial/event effects. Do not weaken typed ownership
checks to reproduce an old framework error number.

### Serialized state first, selective zero-copy second

RC2's serialized path uses Wincode under a Borsh-compatible configuration; that is
not a blanket byte-compatibility guarantee. Our integers, arrays, enums, options,
canonical booleans, custom bounded vector and boxed wide records need independent
round trips and invalid-input tests. No financial float/map/set encoding is added.

The first checkpoint, **C0**, uses serialized wrappers for all Rivalt-owned state.
SPL wrappers use RC2's intended implementation. Preserve schema at offset 8 and
revision at offset 10, and all current lengths except explicitly approved changes.
The 7,926-byte ResolutionWork, 3,652-byte Resolution, 3,408-byte ResolutionPage and
bounded registry must not become large stack-resident `Copy` values.

After C0, measure whether small fixed hot accounts justify a **C1** conversion
within P46: prioritize MakerPrice, MakerCurve and small frequently accessed ledger/
control records. Use alignment-one little-endian Pod scalar wrappers and explicit
layout checks if preserving packed bytes. Native integer alignment/padding is not
the Borsh layout. RC2 `PodBool` treats nonzero as true; preserve canonical 0/1
validation rather than accepting previously invalid state. `PodVec`'s u16 length
and slab layouts are not substitutes for our u32 bounded registry encoding.

Each conversion needs a separate reviewable commit and C0/C1 comparison, not a
new protocol design. Keep it only when actual uninstrumented costs improve with
unchanged semantics, access and resource fit. If gains are negligible or the port
requires broad financial adapters, retain serialized state and document that limit.
Do not turn P46 into an unbounded account rewrite. Large resolution state stays
serialized unless separately justified; no assembly or custom entrypoint work.

### Borrowing, CPI and history checks

Audit every CPI boundary, including SPL transfers, maker calls and event self-CPI.
`BorshAccount` caches data while Pod accounts expose live bytes. For the actual
handle APIs, establish whether outgoing dirty state is flushed, release the
required borrow, then reacquire/reload before reading modified state. Revalidate
owner/discriminator/size where the callee can alter them. A stale cached token
balance or revision must not survive a CPI. Read-only shared accounts and legitimate
optional sentinels remain supported; duplicate mutable financial roots reject.

Preserve P40B's deliberate distinction between predecessor-revision event bodies
and the final revision footer. Direct zero-copy mutation must not silently change
when the borrowed event sees a revision, serialize a post-footer body, or lose
rollback behavior. Retain the bounded event emitter's 8,192-byte payload cap,
limited payload count and self-CPI provenance. A new fast `emit!` log cannot
replace authenticated durable events. Treat failed/partial CPI, wrong return-data
producer, duplicate accounts, short data, forged owner/executable, invalid boolean
and noncanonical optional dependencies as negative acceptance cases.
Port the emitter's `std::io::Write` helpers to an appropriate bounded serialization
adapter if needed; the replacement must enforce the same byte count before writing.

### Independent clients and dependency isolation

Keep production TypeScript on the existing pinned modern SDK/Codama stack. First
try RC2 IDLs through the current generator; if a generator update is required,
pin the smallest justified change and compare bytes/metas rather than hand-editing
generated files. Preserve the isolated legacy `tests/anchor-conformance` process
and its v1 dependencies as an independent codec oracle for retained encodings.

RC2's published `@anchor-lang/core@2.0.0-rc.2` uses Kit ^8.3.0 and Node >=22.12;
[registry metadata](https://registry.npmjs.org/@anchor-lang%2fcore/2.0.0-rc.2) confirms
the release. Add a separate exact-locked RC2 conformance client for new IDLs, not
a production SDK rewrite. Compare literal vectors, generated SDK, legacy retained
encoding and RC2 encoding. Generated Rust builders supply another structural
comparison. None substitutes for independently fetched signed on-chain results.
Do not add the unpublished `anchor-v2-testing` crate or change LiteSVM just for
profiling; retain the existing harness first. Optional diagnostics require exact
source/tool pins and are excluded from headline binary/CU measurements.

## Phases and acceptance

| Phase / PR | Work | Exit evidence |
|---|---|---|
| **P45 — migration contract** | This research, gap map, proposed ABI/deployment choice, phase and measurement plan; D90 and STATUS | Source/registry identities and 61-entrypoint inventory checked; links/whitespace/source paths valid; no migration/build claims. Ready planning PR, then pause for the user's plan review. |
| **P46 — RC2 implementation** | Isolated exact tools, all three programs and support fixtures, serialized C0 port, generated clients/adapters and fresh-domain binding; measured selective C1 only if justified | Clean default/qualification SBF and IDL builds; no unsafe stack diagnostics; explicit ABI delta; independent codecs/economics and hostile rollback; scoped real signed deposit/route/funding/liquidation/default/exit with RPC/WS/PG replay. Capture C0 before any C1. No claim of full qualification yet. |
| **P47 — complete post-migration qualification** | Pin final uninstrumented C, cover every public entrypoint/scenario family, run service/browser/fault/load/default acceptance and publish B/C comparisons | Full matrix below, per-transaction/scenario cost table, exact reconciliation, measured limits/regressions, updated operating envelope and reproducible bounded summary. Only this evidence qualifies the new local artifacts for normal demo/operator selection. |

Implement P46 on top of P45 only after the plan is accepted. Use one cohesive PR
per phase, `gh stack` and `gh stack submit --auto --open`; keep the stack open until
separately instructed to merge. Review is not Closed. Update STATUS/specifications
at each substantive run; HISTORY records integration, not research/test diaries.

P46 may execute its unfinished candidate only in the explicitly selected local
qualification harness. Default/devnet activation remains disabled. The current
demo/normal operator configuration must not start pointing at new binaries merely
because compilation succeeds. P47 promotion requires all safety acceptance; if a
material economic/authority change is needed, stop that path and document it.

## Measurement contract

The immutable **B** summary is
[`p44-pre-v2.json`](../../tests/performance/baselines/p44-pre-v2.json), built from
SBF source `fb5d0c546a417796ce615e0d3d3575545c96c178`, with exact IDL/artifact hashes.
It covers 61/61 entrypoints and 2,871 unique harness originals (2,721 success,
150 rejection). Operator, browser and load populations are separate. Preserve B
and its raw captures; these are comparison inputs, never new qualification.

The accepted plan required artifact destinations to be parameterized before any
RC2 build: the pre-migration script wrote `.local/liquidity-execution/` unconditionally.
Use a separate candidate root and immutable C0/final manifests. Preserve old SBF
files and approved maker hashes; new approval hashes come only from verified new
artifacts. Do not point the B replay script at candidate IDLs. Provide explicit
baseline/candidate contract readers instead of weakening its frozen assertions.

Compare **B → C0** for framework/codec/ABI adaptation and **C0 → C1**, if present,
for selected zero-copy changes. First keep compiler, SBPF architecture, runtime,
feature set, financial inputs, transaction formats and resource bids fixed. If
RC2 cannot build on the old compiler/architecture, capture a v1 bridge **B′** on
the required candidate toolchain where possible: B → B′ is toolchain impact;
B′ → C0 is migration impact. If a bridge is impossible, label the combined change;
do not attribute its entire effect to Anchor. Do not change architecture silently.

Match economic starting state, actors, quantities, maker count, book occupancy,
clock/source/funding inputs and scripted action order. Only the declared schema,
identifier and fresh-deployment binding differences may be normalized. Compare
all roots, pools, fee/reserve carries, unpaid/fractional claims, funding checkpoints,
orders and revisions, not just aggregate cash. Changes to allocator results,
write privileges, event bodies or financial outcomes are regressions to explain.

| Measurement | Required record / interpretation |
|---|---|
| Every instruction and transaction | Caller; scenario dimensions; successful/reverted population; inclusive invocation CU and whole-transaction CU separately; p50/p95/max where population supports them. Do not add nested CPI CU twice. |
| Resources | Requested and consumed CU, heap request/observed failures, stack diagnostics, signed wire bytes, transaction version, signatures, loaded key count, ordered read/write set and loaded data bytes if returned. Missing RPC metrics stay null, not guessed. |
| Program/build | Uninstrumented binary bytes and hashes, exact source/lockfile/CLI/compiler/architecture/features/runtime. Diagnostic tracing artifacts never supply headline cost or size. |
| Economics | Actual base/priority fee and payer, rent/deposit funding separately, per-fill/per-update/per-report costs and transparent workload/fee assumptions. Lower consumed CU alone does not prove lower paid fees. |
| Scheduling | Build/simulation/dispatch/confirmation/finality/indexing latency; worker queue conflicts, rejects, expiry/unknowns and recovery. Lower CU does not remove unchanged write locks. |
| Maker scaling | One/two selected capitals, same/different maker program, registry scans and complete published-depth input. More unselected makers must not be confused with more executed route legs. Stay within current on-chain bounds. |
| Safety scaling | Maximum current orders/protections/regions, two-market account states, 64-member cohort and separate wide-arithmetic stress. Do not describe flat filler members as 64 nonflat creditors. |

Keep the existing transaction v0/v1 selection policy. At equal requested resources
and bids, distinguish cheaper execution from cheaper fees: v0 priority uses its
requested CU/price policy and v1 explicit lamport policy remains explicit. Test
smaller CU reservations only **after** correctness and matched measurement, with
recorded maximum-case headroom and rejection tests. Do not use a smaller budget
or a smaller loaded-data allowance to truncate a necessary financial path.

Report absolute CU/bytes/lamports and relative deltas for each matched scenario;
show regressions and unavailable comparisons. Binary-size savings may reduce the
cost of our full maker ProgramData hash; retain that authentication and distinguish
this effect from account-decoding savings. Preserve P44's classified availability
denominators rather than interpreting only successful receipts as offered uptime.

## Complete qualification matrix

| Family | Fresh implementation evidence |
|---|---|
| Wire/build/activation | 61 successful public entrypoints across compiled programs; default/devnet negative gates; all account/event/argument codecs, PDA/meta/error checks; schema/old-original rejection; actual stack/heap/CU fit |
| Financial semantics | Independent expected vectors against actual execution: whole-account funding and held windows; cash transfers/withdrawals; reservations, replace/cancel and TP/SL; funded versus unpaid/fractional claims; insurance/fee carry; explicit flat netting; liquidation progress after fees and consenting receiver health |
| Execution/funding safety | One/two-maker routes and full books; alias/authority/epoch/source/repricing races; hostile CPI rollback; publisher rotation/revocation, outage/recovery and causal funding. Keep quote admission distinct from funded executable admission. |
| Settlement/default/exit | Complete-member freeze/scan/plan/apply/rounding/recovery and independent balance audit; scratch-wide cases labelled separately; all cash/payment/certificate/retirement transitions and terminal exits |
| Services and durability | Real Surfpool RPC/WS plus PostgreSQL, separate role payers, immutable original recovery, lost acknowledgement and real SIGKILL after admission/after send; actual expiry witness and unknown-fee retention; fresh replay identical to live final state |
| SDK/UI | Real signed create/deposit/trade/order/cancel/close/withdraw, reload recovery and direct cancel/cash exit with APIs blocked; explicit new deployment binding. Instrumented local wallet only, no new external-wallet claim |
| Load/cost | Reproduce P44's bounded workload classes/rates with the same duration/concurrency/slot settings; record offered, eligible, constructed, submitted, finalized, rejected, expired, unresolved and unsubmitted reasons; fresh reconciliation and live-indexer progress. No sustained TPS/24-hour claim |

Use scoped checks while implementing P46. Run the complete new implementation
matrix once on pinned final artifacts in P47, repeating only affected constituents
after fixes. Broad supported host regression belongs in CI. A framework-wide
account/CPI change justifies this final matrix; it does not justify rerunning it
after every intermediate compile fix. Preserve unsuccessful attempts and describe
their cause, rather than replacing receipts or weakening the acceptance driver.

Current performance summaries total 129,626 bytes against a 128 KiB aggregate
limit. P47 should explicitly raise only that bounded-summary budget to **256 KiB**,
retaining the **64 KiB per-file** limit, to retain B plus compact C0/final comparison
records. Do not delete or rewrite B to make space; do not admit raw transactions,
archives or logs into Git. Reuse the performance/validation documents for results.

## Completion and unresolved evidence

Migration is complete only when new compiled code, generated clients, services and
qualification agree, all financial/authority invariants hold and the B/C cost
report is reproducible on recorded pins. There is no promised percentage saving.
Any material CU/wire/heap increase must be investigated; no formerly supported
scenario may exceed its accepted resource envelope unnoticed. If correctness or
resource fit fails, keep the candidate unqualified and the current profile intact.

At the P45 planning checkpoint, the following were still unproved: RC2 locked
SBF build on v1.52/v0, custom bounded/boxed codecs, actual IDL/Codama compatibility,
CPI borrow sequencing, candidate financial equivalence and all post-port costs.
P46/P47 now supply that implementation evidence in [validation](validation.md);
planning conclusions themselves remain distinct from actual runtime acceptance.


## P46 implementation notes

The serialized C0 port uses `BorshAccount` for owned state and a `RegistryCodec`
which rejects a u32 member prefix above 64 before Wincode allocation. SPL wrappers
use RC2's native token handles. Foreign upgradeable program metadata uses an explicit
loader owner, four-byte enum discriminator and program-header link; executable code
remains included in the full maker hash. Native malformed-buffer tests cover those
adapters. Scoped events retain bounded borrowed encoders and authenticated self-CPI.

RC2's `no-entrypoint` still exports `__anchor_dispatch` on SBF. Linking the clearing
and oracle-fixture libraries into makers collides at that symbol. A `state-only`
feature suppresses only the `#[program]` module for these data-type dependencies;
standalone programs retain their normal dispatch. No custom runtime or upstream
fork is introduced. All deployable feature graphs must exclude `state-only` on the
selected root program; imported state dependencies intentionally enable it.

The generated IDL has the same ordered wire fields, privileges and numeric protocol
errors after D90's identifier changes. RC2 flattens nested contexts, spells byte
vectors as `vec<u8>`, lists imported clearing accounts in maker IDLs and exposes the
foreign `ProgramData` type. It omits state-field/nested/dynamic-program PDA hints and
adds fixed BTC/ETH/event-authority hints. Some dynamic address constraints appear as
expression strings. `ops/anchor_rc2_wire_contract.py` checks these bounded metadata
differences against immutable predecessor IDLs, separately from wire bytes. Codama
receives explicit inputs for those dynamic addresses and a byte-vector normalization;
the checked-in IDLs remain actual RC2 output. Missing hints are not proof of runtime
constraint enforcement: negative signed SBF cases remain required.

The CLI installs under `.tools/anchor-v2-rc2` through `ops/install-anchor-rc2.sh`.
P46 candidate binaries used `.local/anchor-rc2/candidate`, never the frozen P44
artifact directory, and required explicit candidate selection. After P47 acceptance,
normal builds/probes/demo use `.local/anchor-rc2/current`; exact admitted hashes
and fresh-domain checks remain mandatory. Frozen B/C0 files stay untouched.
Default builds retain a staging directory and check the fixed SDK allowlist before
copying binaries into `current`. Explicit alternate build destinations are only
candidates. The shared runtime/continuation/smoke preflight checks actual file
lengths/hashes and both account schemas against the SDK pins before deployment;
a self-consistent manifest alone is insufficient.
Isolated conformance processes use unchanged core 1.2.1/web3.js 1.99.0
and new core 2.0.0-rc.2/Kit 8.3.0 respectively. Production stays on Kit 8.5.0.

The first actual signed custody run exposed `AccountBorrowFailed` at the token CPI.
RC2's generic `AnchorAccount` implementation for `Box<T>` does not forward the
native wrapper's CPI borrow override. Manual CPI construction now uses
`ToCpiHandle` / `ToCpiHandleMut` forwarding (`to_cpi_handle` /
`try_to_cpi_handle_mut`) throughout clearing. This preserves the native token
wrapper's borrow protocol without unchecked CPI or disabled guardrails. Exact
framework rejections are asserted using RPC/LiteSVM typed instruction errors;
protocol custom codes and failed-transaction rollback remain exact.

## P47 qualification and promotion

Uninstrumented serialized C0 remains source `366c7ab` with platform-tools v1.52 /
SBPF v0; no C1 is needed for the observed envelope. [Validation](validation.md#anchor-rc2-qualification-p47)
records all 61 successful entrypoints, full books, complete 64-member default,
independent financial audits, actual services/RPC/WS/PG fault replay and browser/
demo exits. Default/devnet gates remain closed. [Performance](performance.md#rc2-qualification-measurements-p47)
records complete caller/scaling costs, B/C field comparison and classified load.
Clock/slot/deployment witnesses are explicit; paired CU changes are not a pure
framework microbenchmark or proof of lower paid fees. Continuous indexed readiness,
external maker economics, independent review and deferred endurance remain unproved.
P47 qualifies the bounded local artifact selection; PR integration remains open.
