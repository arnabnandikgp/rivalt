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

Current working-tree checks: five focused Rust tests; nine focused SDK tests;
2,884 parity vectors per implementation (1,481 exact quotes,1,403 expected
rejections); focused TypeScript checking, rustfmt/diff checks and four CI-scope
tests. Hosted jobs are configured to run native and SDK parity separately without
installing Node into the financial job. No hosted result is inferred.

Remaining P30 acceptance:

- Fresh profile-4 custody provisioning with financial execution still gated.
- Real maker config/price account instructions in both deployments, owner/controller
  permissions, structural controls and clearing-owned registry/consumption lifecycle.
- Generated IDL/SDK and isolated legacy-Anchor parity for the affected ABI.
- Signed compiled-program and actual Surfpool RPC/WS quote/update/permission/race
  cases, independently fetched/decoded, with packet/CU/latency measurements.
- Phase report, ready stacked PR and verified publication. No partial acceptance is
  promoted to Review; integration into `main` remains separately authorized.

No PostgreSQL rebuild, broad historical financial suite, demo restart, devnet/funded
deployment or external participant is needed for this arithmetic checkpoint.
