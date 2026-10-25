# P20 — whole-account liquidation and complete-group default

[A25/G15 acceptance](evidence/P20.md) passes above verified P19 PR #28 (`c0b7898`).
The explicit local cross profile is qualified; ordinary isolated/default/devnet
profiles retain their gates. WORKLOG owns Review/integration status. P21 service,
PostgreSQL, UI and contention qualification remains separate.

## Safety contract

- One canonical BTC/ETH snapshot values every target/receiver position and pending
  funding. A consenting funded non-maker receiver must pass full post-fill IM and
  refreshed remaining reservations. Both root modes use the same financial engine.
- Target absolute selected exposure strictly decreases without flip, and the
  whole-account MM deficit strictly decreases after the actual bounded liquidation
  fee. The existing receiver-fee transfer has no additional 2 bps taker charge.
  Conflicting target risk orders cancel only with a successful atomic candidate.
- Preserve credible-bound liquidation during degraded source mode. Every exposed
  target market and every relevant receiver position/order requires credible bounds;
  a risk order cancelled by liquidation cannot make an unrelated empty market a
  new price dependency. No source deadline, fee, margin or progress rule is relaxed.
- Default uses economic net equity, not loss-only risk equity. Value both terminal
  claims once per root and include every isolated/cross/maker member. Preserve the
  complete registry, both funding endpoints, missing-price AwaitValuation, ordered
  pages, exact insurance/impairment/rounding and no sibling-cash seizure.
- Complete-group exit certification checks every relevant combination of both held
  funding endpoints. Normal settlement, reservations, transfers and owner exits
  must use the complete root after cross activation. Frozen state remains immutable
  outside its explicit resolution transitions.

## Acceptance boundary

Independent G05–G08/G12 candidates/ledger, signed cross lifecycle/default and
fresh Surfpool RPC/WS acceptance now have their own [evidence](evidence/P20.md).
Maximum-book/receiver transactions meet the measured 20% headroom requirement.
Page state is restored across every host boundary; actual durable service-process
restart, PostgreSQL replay, UI and concurrent contention remain P21's gates.
Neither prior P16A nor P19 results substitute for this new qualification.

P15B/P16B remain external Open gates, and 24-hour endurance remains Deferred.

## Qualified local implementation boundary

The ordinary `successor-test-profile`, default and devnet builds still disable
cross trading. `cross-safety-qualification` retains its historical feature name
and selects the A25-qualified local cross profile. Its explicitly named
`clearing-cross-qualification.so` is the byte-verified artifact for P20/P21 fresh
local groups. The build script restores the ordinary isolated artifact in
`target/deploy` even on failure. Cross launches must select their deployment
configuration explicitly. No devnet or funded deployment is authorized.

The authority-only `activate_cross_group_v2` entrypoint remains release-gated in
ordinary builds. In the qualified cross profile it requires isolated mode, a current complete
group certificate, both markets Normal and an idle or resumed resolution. It
materializes both pending funding prefixes without resetting their causal history,
advances the group sequence and emits financial event kind 6. No account layout or
authority changes. Recovery deliberately returns to isolated mode; cross requires
fresh Normal observations, complete certification and explicit authority activation.

Normal claim settlement, cash and transfers refresh the complete order book;
exit certificates check all four combinations of held funding endpoints in both
financial modes. The exact ledger accepts both root modes internally, while its
external member/profile checks retain the release gate. Economic default and
emergency eligibility are separate from loss-only risk admission.

The focused `cross-budget` harness fills every order slot and both position slots
before measuring an owner transfer plus two-maker open, standalone reduction and
a two-market liquidation receiver with four surviving orders. Use
`groupTransferRouteComputeBudget()` (700,000 CU) for the combined transfer/trade;
`groupRouteComputeBudget()` remains 600,000 for a standalone route. The lower
combined budget executed successfully but failed the required 20% headroom check.
This client-only change does not alter risk or fee economics.
