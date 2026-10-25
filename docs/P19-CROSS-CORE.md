# P19 — bounded whole-account core

Implementation is in progress above verified P18C PR #27. This phase implements
P17's shared engine, complete funding/reservation dependencies, explicit flat
netting and per-root trade delegation. Cross trading remains hard-disabled until
P20's liquidation/default acceptance. No P19 deployment or A24 pass is claimed.

## Contract and ordinary implementation choices

- Keep schema-2 account sizes and immutable group/portfolio/root identities.
  One root cash balance is authoritative; both position slots retain their own
  claim, funding checkpoint and generation. Makers remain isolated per market.
- Authenticate canonical BTC and ETH dependencies in group order for whole-root
  operations, with one Clock snapshot. Relevance controls price availability:
  exposure, surviving active authority and the selected operation require current
  source checks; an unrelated empty position cannot require a fresh price.
  Missing, substituted, duplicated and reordered dependencies reject.
- Accrue both allowed slots before exposure or cash admission. Sum each negative
  adverse market claim, additive IM/MM and all remaining order reserves. No positive
  unpaid claim funds another open loss. Keep existing paired fill and fee arithmetic.
- Transfers retain same-owner/group and distinct-root authority. Donor health and
  reservations pass after transfer; recipient funding is accrued and its cash is
  added once. The recipient may still be unhealthy. A following fill must separately
  pass admission in the same atomic transaction; no intermediate donor bypass.
- Flat netting is owner-only, cross-only, same root/group and explicit. Both slots
  must be flat and fully accrued, with no active order/protection authority.
  Cancel opposite claims in exact scaled units; C/P/I/T and aggregate claims stay
  unchanged. Zero cancellation rejects. Retain fractions and slot generations.
- Delegate scope is trading/order management on one named root. Owner changes
  increment the delegate epoch and route nonce, invalidating old immediate intents
  even if the same key is later granted again. Revocation uses zero key/expiry;
  a grant has exclusive future expiry bounded by the existing 216,000-slot order
  lifetime. No withdrawal, transfer, netting, redelegation or maker-config authority.
- Owner orders retain epoch zero. Delegate-created orders retain the grant epoch;
  revocation/expiry prevents execution and safe cleanup releases reservations.
  Cancellation makes a protection inactive when it has no live child; a historical
  allowance field alone cannot grant authority. TP/SL stays market/generation-bound.
- Grants require a qualified unfrozen financial group; custody/frozen modes reject.
  Owner revocation remains available during pause. Dormant cross roots may hold a
  grant without exposure/order rights or loss of their guarded owner cash exit.
  Owner replacement reauthorizes epoch zero; delegate replacement adopts its epoch.

These choices implement D45–D48 and D51. They do not change 2 bps taker/zero provider
fees, oracle safeguards, default ownership or external-gate authorization.

## Current implementation and remaining acceptance

`financial-core::margin` now has candidate-only whole-account transfers and exact
flat-claim netting. Six independent literal host cases exercise shared cash,
uncredited open gains, pending ETH funding on BTC actions/withdrawals, the reserved
donor boundary, fractions through net/reopen and divided funding ownership.
Owner/group/order authority remains a clearing-handler responsibility and is not
claimed by those arithmetic tests.

The shared book and isolated authority handlers now use both-market candidate
machinery, with per-root grants and critical events. Twenty-eight affected clearing
host tests pass during development, including the unchanged cross gate. Signed
runtime and new generated ABI verification are still pending.

Next implement the complete two-market route/netting handlers and remaining
independent G01–G04/G09–G11 checks. Verify legacy/generated ABI, bounded default and
successor builds, signed isolated/delegation regression and both cross-activation
negative profiles. P20 owns signed enabled-cross safety and transaction budgets;
P21 owns fresh services/PostgreSQL/UI/contention qualification. No old P16A result
qualifies these changes. P15B/P16B remain Open; endurance remains Deferred.
