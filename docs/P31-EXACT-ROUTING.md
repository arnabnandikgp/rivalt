# P31 — authenticated snapshots and exact bounded allocation

Status: A36/G24 passes within the bounded preview scope; see [pinned acceptance](evidence/P31.md).
P31 is Review with ready PR publication pending; financial activation remains disabled.
Branch `phase/p31-canonical-router` includes exact P30 head `b7e76e3` / PR #45.
The user resumes P31–P34 in R082 after the P30 transport discussion. Keep phase PRs
ready and stacked, without merging them.

## Implementation boundary

`readLiquidityTradeSnapshot` discovers the selected market's three sealed
registrations, then reads immutable root identities. One final `getMultipleAccounts`
batch contains custody, vault/mint, safety, both markets/ledgers, Clock, the selected
root, all three isolated maker capitals and their portfolios, unique capital
bindings, registry/registrations, curves/prices and both executable/ProgramData
accounts. Context slots cannot go backwards. Discovery supplies keys only; final
bytes supply all quoted financial and pricing values.

The final discovery read has a hard ceiling of 48 distinct RPC keys. This includes
unselected candidates and code authentication and is **not** an increase to G22's
32 loaded-account ceiling for a submitted transaction. Profile 3 readers/builders
remain separate and reject profile 4. No new executable financial instruction or
activation path is added in P31.

`authenticateLiquidityMarket` checks exact owners/layouts, canonical PDAs, sealed
membership, one capital per instance, isolated-market ownership, controller/domain
and authority bindings, admitted capability and full approved ProgramData hashes.
Two instances may use the same pricing program; instance identity is independent
of A/B program identity. Unsupported capabilities or malformed bindings reject the
snapshot. Quarantined, unapproved, disabled and stale/invalid publications remain
visible as classified candidates. Returned pricing and capital objects are frozen;
requests get independent domain bytes.

The canonical adapter exposes exact gross quotes, depth hints and fully bound pure
quote requests. Depth hints describe price capacity, not financial feasibility.
`allocateLiquidityRoute` searches all singletons and every unordered pair with
positive integer quantities summing to the full requested size. Each leg is at
most 4,096 lots and the request at most 4,608. It never executes three capitals,
partially fills the request or prunes maker health as a monotone prefix. Zero
mathematical capacity is classified separately from no feasible financial quote.

`prepareLiquidityMargin` uses the existing whole-account balance/reservation
engine. Both positions accrue funding, all negative claims and relevant sources
count, positive unpaid claims get zero margin credit, and active order reserves
refresh after the proposed fill. Stored prefixes and shared TP/SL allowance are
updated in the candidate only. A below-IM trader reduction must strictly improve
the whole-account maintenance deficit after fees; makers still require IM.

The objective is minimum buy cost or maximum sell proceeds after the **single**
2 bps aggregate/prefix-difference fee. Ties prefer fewer legs, lexicographically
smaller ordered instance IDs, then more quantity on the first instance. A candidate
dominated by an already feasible result needs no repeated trader health calculation.
Every potentially superior candidate still receives full trader admission. This
guarantees the best admissible result only within the authenticated candidate set
and snapshot. Actual landing may differ and P32 must revalidate it on chain.

`previewLiquidityRoute` binds the pure allocator to the coherent profile-4 reader
and authenticated source/funding policy. It does not generate a trade transaction.
The 2 bps/zero-provider fee, insurance share, loss ownership and V1–V3 economics
are unchanged. P15B/P16B remain Open; continuous 24-hour endurance remains Deferred.

## Scoped acceptance commands

- `pnpm typecheck`
- `pnpm exec vitest run packages/sdk/src/liquidity-adapter.test.ts packages/sdk/src/liquidity-allocation.test.ts packages/sdk/src/account-client.test.ts packages/sdk/src/account-route.test.ts`
- `python3 tests/financial/check_liquidity_allocation.py`: independent per-lot
  pricing and exhaustive whole-state financial oracle against the actual SDK.
- `RIVALT_BENCHMARK_REPORT=<ignored-local-path> node --import tsx packages/sdk/test-support/liquidity-benchmark.ts`:
  24 warmups and 1,000 full-width searches, eight-region shapes, complete books,
  both-market risk/funding and feasible/infeasible traders. G24 requires p95≤250ms,
  p99≤500ms. The configured maximum actual compositions is 12,288; G22 conservatively
  allows 12,291. At most 12,288 distinct nonzero maker quantities are priced.
- `bash ops/canonical-maker-smoke.sh --adapters`: fresh owned offline Surfpool,
  unchanged P30 binaries, actual signed provisioning, coherent discovery and pure
  quote transactions fetched/decoded over RPC with real WS observations. The
  provisioner/harness is shared with P30; its unrelated lifecycle cases are skipped.

No new PostgreSQL/service/browser flow belongs to P31. P32 owns their first changed
financial integration. Broad inherited SDK regression and the independent oracle
are included in CI; this local run scopes checks to changed interfaces and gates.
Raw reports remain ignored under their existing local evidence paths.

Surfpool compatibility follows the previously recorded R019 behavior: its reported
RPC commitment context may lag the fetched Clock. Preserve both values separately;
expiry/source calculations use actual Clock, never the older reported context.
Discovery/final RPC contexts must still be monotone. Live reports retain both, and
only independently fetched finalized transaction results count as executed quotes.
