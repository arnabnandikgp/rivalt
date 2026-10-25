# P20 — whole-account liquidation and complete-group default

In progress above verified P19 PR #28 (`c0b7898`). P19's core acceptance remains
separate. Cross release stays disabled while safety candidates and their independent
cases are implemented; no P20 deployment or A25 pass is claimed.

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

## Acceptance still required

Recreate G05–G08/G12 with independent literal/Rational expectations against the real
candidates and paginated ledger. Then qualify signed cross routes, netting, pending
funding, TP/SL, transfers/withdrawal races, liquidation, mixed 64-member default,
interruption/resumption and missing-price recovery over actual SBF and Surfpool
RPC/WS. Recheck default/devnet rejection and measure full cross packet/CU/account
bounds, preserving at least 20% CU headroom. P21 owns PostgreSQL/services/UI and
fresh contention qualification. Prior P16A or P19 results do not close A25.

P15B/P16B remain external Open gates, and 24-hour endurance remains Deferred.
