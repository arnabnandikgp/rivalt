# Source audit and supersession
Rivalt · baseline R1 · 20 October 2026

## Finding

The selected sources agree on the central architecture: common clearing, isolated margined providers, cash/claims separation, cross-maker closes and explicit default. They are **not all interchangeable final specifications**. Several are historical research proposals or snapshots of an older native prototype.

This kit resolves those differences into one current implementation contract. Original research remains unchanged as historical evidence outside the working repository. No bulk download/export is required. A worker can consult a specific source for provenance but must not treat an older alternative as permission to expand scope.

## Material consistency findings

| Area | Earlier wording / ambiguity | Final R1 treatment | Destination |
|---|---|---|---|
| Project name | Unselected; Accord suggested | Rivalt selected explicitly by user | PRODUCT, DECISIONS D01 |
| Source restoration | Continuity/M1 required predecessor archives and reproduction | New kit is sufficient to start; reuse already available source or request a targeted item only if needed | README, AGENTS, D14/C07 |
| Architecture alternatives | Provider interface/early financial docs still compare pools and independent contracts | Model A: common clearing with individually margined makers | PRODUCT, PROTOCOL |
| On-chain aggregator | Could be mistaken for a separate routing program | Clearing contains route entry points; three first-party programs total | COMPONENTS |
| Maker authorization | Earlier native prototype uses per-fill maker signatures/RFQs | Standing registry/module/capital authority via bounded CPI; RFQ deferred | PROTOCOL, P03/P04 |
| Immediate orders | Older lifecycle discusses IOC and FOK | Exact-base FOK immediate order; persistent atomic subfills can retain remainder | PRODUCT, PROTOCOL |
| Protection | Research discusses parent-linked growing brackets | Existing-position TP/SL only, two slots/shared allowance/generation; no parent growth | PRODUCT, PROTOCOL |
| Fee status | Older recommendation called fee schedule uncalibrated | 2 bps user-approved MVP tariff; economics remain unproven | PRODUCT |
| Fee rounding/allocation | Cumulative handling required but exact policy/recipient split not fixed | Cumulative ceil at order scope; all fee cash initially T; no implicit reserve percentage | C01/C02, PROTOCOL |
| Maker/taker terminology | A limit order could be mistaken for fee-free liquidity provision | Consuming a maker curve is taker activity regardless of resting intent; aggressive makers also takers | PRODUCT, PROTOCOL |
| Funding implementation | Native adapter has admin-authorized/off-chain sampler and turnover precision limitation | Authenticated on-chain validated full-maker observation; common accumulator and participant-owned fractions | PROTOCOL, P07 |
| Funding price | Older docs leave premium source open | Depth-qualified impact midpoint at common size; not best dust quote or last trade | PROTOCOL |
| Funding/trading outage | One missing maker could be read as preventing every action | Strict configured funding coverage; remaining trade capacity still subject to operation mode, prolonged degradation and source rules | C05, PROTOCOL |
| Risk mark/chart | Possible conflation of last trade, quote midpoint and risk price | Index-derived reference with risk bounds; actual-fill candles; separate labels | PRODUCT, PROTOCOL |
| Settlement fairness | “Eligible gains” does not state ordinary queue priority | First-admissible ordinary settlement from P; separate proportional default allocation; timing dependence disclosed | C03, PROTOCOL |
| Deposits during resolution | Earlier proposal mentions separate post-freeze receipts | Reject deposits/registration while frozen; avoid extra escrow subsystem | C04, PROTOCOL |
| Loss policy | Research compares exposure levy/social loss and unpaid-profit haircut | Complete frozen cohort, dedicated insurance, then unpaid-positive-claim impairment | PROTOCOL, P09 |
| Account layout | Predecessor can scan packed participant arrays | Participant PDAs; deliberate new schema validation; no full-registry normal fill scan | COMPONENTS |
| Prototype/test status | Historical local results can look like MVP completion | New Anchor/modules/services/indexer/UI require new evidence; all P01–P16 start Open | VALIDATION, WORKLOG |
| JS dependency patch | Run 36 chooses 3.1.0 pair | 3.1.1 web3.js and companion adapter starting pair; P01 proves compatibility | STACK, C08 |
| Client compatibility | Same Anchor brand can imply its stable TS client supports v3 | Isolated legacy conformance; generated modern application SDK | STACK |
| Environment | Earlier Compose description could imply Docker Desktop required | Reproducible native/supported-container path; preserve user's local setup | STACK, AGENTS |
| Calibration | Experimental freshness/depeg/funding/insurance numbers | Not promoted; explicit phase gates and test-only labels, production economics M6 | DECISIONS |
| Devnet guard independence | Run-36 permits a declared guard limitation in the engineering profile | Real primary verification is mandatory for M5b; a labeled operator-controlled guard can remain an engineering limitation, with independent-source assurance still required for funded-pilot readiness | G11/G12, P13/P16 |
| Roadmaps | Research chronology and future implementation status mixed | WORKLOG alone owns live implementation status; old roadmap remains historical | README, WORKLOG |

C01–C08 are explicit consolidation decisions, not claims that these exact mechanisms were previously implemented. The user asked for a finalized implementation baseline; this document states where specificity was added.

## Source inventory actually reviewed

Full text was obtained for all 12 selected documents with no remaining read pages. Versions are the values returned during this audit; absent version is not version zero. Native links may resolve later revisions. They are optional provenance references and are not required runtime resources.

| Source | Observed version | Role in consolidation |
|---|---|---|
| [perp-amm-research-roadmap.md](https://chatgpt.com/api/library/files/libfile_50363cf4de448191ad4cf91a8c314b45/download) | 29 | Current checkpoint and history; implementation status moves to WORKLOG. |
| [perp-mvp-build-specification.md](https://chatgpt.com/api/library/files/libfile_d1eb3ad22c3c81918caa7e30d82fea0d/download) | 1 | Primary run-36 implementation baseline; preserved scope with explicit R1 supersessions. |
| [perp-financial-rules.md](https://chatgpt.com/api/library/files/libfile_6e652ec31d2c8191acfd743a0494490a/download) | Not returned | Cash/claims, margin, funding, settlement and loss rules. |
| [perp-research-recommendation.md](https://chatgpt.com/api/library/files/libfile_f51f7d1e6180819185ad5107a0cf6d94/download) | Not returned | Architecture rationale; earlier alternatives and broader order stages are historical. |
| [perp-integration-results.md](https://chatgpt.com/api/library/files/libfile_ef1539fdb95481918b74683aee26d675/download) | 1 | Evidence limits and native predecessor results; not new-code validation. |
| [perp-fees-maker-onboarding-recommendation.md](https://chatgpt.com/api/library/files/libfile_2b3b1293aa7c8191b2c4e76ae736b37a/download) | 1 | Approved 2 bps tariff, maker roles/onboarding, illustrative economics distinguished. |
| [perp-order-lifecycle.md](https://chatgpt.com/api/library/files/libfile_4c4a243babc48191b043996e79d4b0f8/download) | Not returned | Reservations, version races and generation semantics; broader IOC/entry brackets narrowed. |
| [perp-provider-quote-contract.md](https://chatgpt.com/api/library/files/libfile_877e4976899481918ca0d4cfd028d281/download) | Not returned | Capital/quote authority and cumulative consumption; select registered modules. |
| [perp-architecture-specifications.md](https://chatgpt.com/api/library/files/libfile_80c41d57c03c8191ae7ea9f00280e8d1/download) | Not returned | Selected model A invariants/transitions/full-cohort resolution; alternatives excluded. |
| [perp-pricing-controls-evidence.md](https://chatgpt.com/api/library/files/libfile_8329510cd7a4819194647d338c6f3983/download) | Not returned | Price roles, operation-specific modes and authority boundaries. |
| [perp-adapter-funding-experiment.md](https://chatgpt.com/api/library/files/libfile_f60af1b14458819192c1a03454dda33b/download) | Not returned | Fixture/real-oracle and fractional-funding limitations; parameters not adopted as launch values. |
| [perp-implementation-continuity.md](https://chatgpt.com/api/library/files/libfile_537146d4e5dc8191bd8c7f95599ccf58/download) | Not returned | Superseded entry point; mandatory bulk restoration and unselected name no longer apply. |

No claim is made that all 52 research records or any ZIP source archive was revalidated in this task. The 15 historical evidence archives remain outside this handoff.

## Remaining implementation decisions are bounded

The kit does not claim final deployment IDs, cryptographic keys, exact binary layouts, compiler lockfiles, fixed-point bounds or safe production leverage. Those are named G01–G12 gates with owning phases. They are not hidden architecture questions or a reason to postpone all coding.

The 20-slot/20-second freshness example, ±5% collateral band and 100 bps funding cap from run 32 were experimental. They are not adopted deployment parameters. The 0.4 bps reserve contribution and illustrative operating budgets in the fee research were arithmetic examples, not selected allocations.

The predecessor's local test counts, native compute measurements and injected Pyth-format fixtures remain evidence about that predecessor. They are not proof of new Anchor binaries, real upstream oracle verification, mainnet throughput, independent maker profitability or PMF.

## Fresh external checks

- Anchor 1.2.1 release notes confirm the release and mutually exclusive Solana dependency families.
- Stable Anchor TS documentation states legacy web3.js compatibility.
- Solana JavaScript documentation distinguishes Kit-compatible web3.js v3 from the legacy token/client stack.
- The official web3.js releases page lists 3.1.1 and its companion wallet adapter, released 19 October 2026. This supersedes the previous 3.1.0 starting pair.
- Surfpool's overview remains available; fetching the exact selected 1.6.1 release page failed in this audit. Keep the prior selected candidate subject to P01 install/provenance and RPC checks.

These are documentation checks, not an executed dependency build. Primary links are in STACK-AND-VALIDATION.

## Packaging validation

See the final validation record appended below. Only documentation structure, cross-references and arithmetic examples are validated in this task. No implementation acceptance ID is marked passed.

## Historical status handling

The previous continuity guide is superseded as an agent entry point by this kit. The old research roadmap's run-36 status is preserved as a historical checkpoint. The implementation roadmap is now WORKLOG, initialized with R000 and 16 Open phases. This avoids creating another apparently current copy of the research chronology in the local repository.


## Validation record — 20 October 2026

- 11 Markdown documents; every relative document link resolves and fenced blocks are balanced.
- P01–P16 appear once each as phase specifications and once each in the live phase table; all start Open.
- All 21 acceptance IDs A01–A21 and all 12 configuration gates G01–G12 are defined and mapped to the plan.
- Independent exact-rational arithmetic checks confirm the numerical results of V01–V04 and the remaining-allowance arithmetic of V05. No SVM rollback or generation test was executed.
- Semantic review reconciled names, scope, fee roles, archive policy, funding/guard trust boundaries, status ownership and milestone dependencies across the kit.
- The new kit is the implementation entry point; historical source documents are referenced for provenance only.
- No protocol code, build, deployment, performance result, soak or commercial evidence was produced in this documentation task.
