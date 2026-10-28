# P30 — canonical maker implementation

Contract: [P29B / D70](P29B-MAKER-CONTRACT.md). Status: In progress; A35/G23
is not complete. New financial execution remains disabled.

The native Rust module in `crates/maker-interface/src/canonical.rs` implements the
checked canonical region/potential arithmetic, quantity bounds, versioned quote
envelope, finite publication life, owner/updater CAS repricing and exact return-data
validation. It does not dispatch from any legacy handler. `ShapeV4`/config/price
payloads and request/response serialization match the frozen byte lengths.

`packages/sdk/src/canonical-quote.ts` provides the same mathematical quote using
integer bigint arithmetic. Neither evaluator is a financial admission check or
reservation. Clearing still must authenticate actual capital/consumption, source
risk, current funding, orders and whole-root health on execution.

`tests/financial/check_maker_curve_parity.py` produces expectations from P29B's
independent cumulative reference and separate per-lot evaluator. It passes the same
bounded Borsh shape vectors through the real Rust implementation and SDK evaluator.
Native and SDK drivers contain no expected prices. Seed3001 includes all small
region/inventory/consumption boundaries, randomized eight-region books, one-sided
reductions, directional caps and maximum legal positions/quantities.

The on-chain implementation now includes profile-4 custody provisioning, six
isolated funded maker instances across BTC/ETH, fixed three-maker registries,
config/price accounts, owner/delegate CAS repricing, restricted controller CPI,
explicit replenishment, quarantine and joint code approval. Events carry separate
payload structs with the account field bytes, without nested account discriminators.
Existing financial activation rejects profile4 even in combined qualification builds.

D71 selects transport by complete serialized size: v0 up to1,232 bytes, then v1 up
to4,096. Single full-shape control is1,222 bytes, curve initialization1,039,
reprice460 and joint approval775 in the two-signature fixture. A real atomic pair
of full-shape controls measures1,896 bytes as v0 and1,854 as v1 (22 loaded keys).
It executed on Surfpool and was independently fetched byte-for-byte and decoded by
web3.js and Kit, with629,056 CU under its800,000 budget. No ALT is needed.

R081 candidate checks: seven native canonical tests, four clearing profile/layout/
event-payload tests in both default and combined feature builds, nine SDK quote
and five transport checks, and26 independent contract tests. Both compiled maker
SBF artifacts pass2,884 independent vectors each (1,481 quotes /1,403 expected
rejections). The fast compiled lifecycle passes123 signed cases,16 expected
rejections, including max-width curves, two-market v1 batching, aliases, permissions,
CAS/shape/depth races, revocation, disable/re-enable and expiry. Isolated Anchor1.2.1
with legacy web3.js1.99.0 matches104 submitted instruction encodings/account lists
across16 distinct instruction APIs and20 actual account decodes. This fast check
has no event-parity claim; finalized RPC event parity is still pending.

Run only the affected gates:

```sh
source ops/env.sh
bash ops/build-canonical-maker.sh
python3 tests/financial/check_maker_curve_parity.py --implementation sbf-a
python3 tests/financial/check_maker_curve_parity.py --implementation sbf-b
node --import tsx tests/rpc-contract/canonical-maker-svm.ts
bash ops/canonical-maker-smoke.sh
```

The SBF parity driver inserts explicitly labelled mathematical config/publication
fixtures only; the lifecycle creates custody, mint, token accounts, deposits and
maker registrations through real signed instructions. All quote requests describe
mathematical inventory: no actual fill, position or funding is claimed in P30.
RPC/WS is an independent runtime gate, not replaced by LiteSVM. Raw output remains
ignored in `.local/canonical-maker/`; no database or archive copies are created.

Remaining A35/G23: finish the corrected full RPC/WS lifecycle and generated event
parity on a pinned revision, report actual resource/latency limits, then submit the
ready stacked PR. A first RPC run exposed Surfpool1.6.1 WS notifications whose
`err:null` disagrees with finalized rejected transactions. The harness retains both
and uses independently fetched finalized status plus account snapshots; a WS hint
never proves financial success. Document that limitation without masking it.

No PostgreSQL rebuild, broad historical regression, demo restart, devnet/funded
deployment or external participant is required for P30 pricing/update acceptance.
The user requests stopping after P30's PR opens; do not start P31 in this run.
