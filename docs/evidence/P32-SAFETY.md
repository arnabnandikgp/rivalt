# P32 affected safety checkpoint

Scoped pass on clean client `5d265614773f879c9f2c607899be9e5da824ecde` and unchanged
clean SBF `6437f7d7b5d941dd29e3da7aeaccb4401722aa2d`:
`bash ops/liquidity-safety-smoke.sh`.

Raw evidence remains local at
`.local/liquidity-execution/runs/20261029T155705Z-35376/`.
The run records 290 finalized signed RPC/WS outcomes: 267 success and 23 intended
rejections, with original-wire equality and measured resource gates. Legacy parity
covers 409 instruction encodings, two accounts and 412 events across clearing/A/B.

Actual existing-position SL and TP fills preserve shared allowance, current-position
eligibility and generation invalidation. A manual reduction clips eligible size
without consuming the stored group allowance. An attempted excess protective fill,
replayed prefix, untriggered TP, stale withdrawal guard and reserved-cash withdrawal
all reject with byte-identical economic state. A same-owner funded transfer succeeds.

Actual two-program BTC and ETH positions create the cross-account stress case.
Full-book liquidation rejects deficit-worsening and target-flipping attempts, then
executes a consenting 10-lot transfer at 52,000. Receiver reservations survive;
target orders are cleared. The independent raw-byte audit verifies exact whole-account
funding, liquidation fee and strictly improved post-fee maintenance deficit.

Bankruptcy at BTC 40,000 / ETH 20,000 freezes all eight registered accounts.
Complete valuation, exact rate equations, insurance floors, stable remainder order,
atom circulation, application and final reconciliation run through signed instructions.
Omitted/reordered members, premature finalization, oversized verification batches,
duplicate remainder entries and replayed application reject. No subset can complete.

The independent Python Fraction model reads original account bytes, reconstructs all
eight payouts and confirms exact atom owners. It exercises two circulation augmentations
and rejects ten corrupted captures, including a conserving transfer to the wrong owner.
Pre-default cash is 7,598,852; settlement pools are zero. BTC/ETH insurance 186/85 is
spent exactly. Final planned cash, in registry order, is:
`[1255555, 1000000, 1252511, 1108537, 1000000, 1108536, 0, 873984]`.
Positions/claims/reservations are cleared and protocol fees remain separate.

An actual 100-atom token withdrawal succeeds after sources have become stale.
Recovery grants no credit for stale sources, requires sustained fresh independent
sources, returns only to custody, then requires separate complete publisher/maker
qualification and explicit reactivation. Funding history survives; replay rejects.

| Operation | CU | Complete bytes | Keys |
|---|---:|---:|---:|
| Whole-account liquidation, full receiver book | 101,766 | 781 | 15 |
| Complete-cohort freeze | 223,788 | 885 | 22 |
| Largest measured safety instruction: atom planning | 386,398 | — | — |
| Deterministic atom circulation | 204,517 | 646 | 15 |
| Resolved stale-source cash exit | 63,032 | 806 | 17 |
| Recovery / reactivation | 96,471 / 96,736 | 811 / 810 | 20 |

Safety instructions retain their inherited 1.2m submitted / 960k measured ceiling;
all measured transactions satisfy 20% headroom, without extra heap or ALT. This is
fresh changed-profile evidence, not a new 64-member qualification, retirement
matrix, endurance run or external review. P32's continuation gate still controls
phase publication and P33 enablement. The owned runtime is stopped.
