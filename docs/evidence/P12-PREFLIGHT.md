# P12 scoped preflight — historical checkpoint

This report preserves the earlier checkpoint. [D35 acceptance](P12.md) supersedes its next-action/status statements without changing these historical results.

Clean source: `2e76c7b674ac523a6f419e224d9acc497aea3f44` above P11 PR #13. Command: `source ops/env.sh && pnpm test:load --final-check-seconds 180 --rates 1`. Run: `.local/load/20261023T003724Z-58126`; result `pass`. Actual 181.924-second offered load is **not a 24-hour soak**. P12 and M5a remain In progress; no P12 PR yet.

Complete report (local: `docs/evidence/p12/preflight/load.json`) retains source/binary/config/UI identities, full normal/unavailable populations, resource samples, fee budgets, final balances and replay metrics. SHA-256 manifest (local: `docs/evidence/p12/preflight/sha256.json`) binds the public reports. Raw signatures/logs/captures remain in the local run; private fixture keys and database credentials are excluded.

| Check | Actual result |
|---|---|
| Offered/submitted/finalized | 181 / 60 / 60; 121 unsigned unavailable retained |
| Quote / dispatch p95 | 27.439 ms / 30 ms |
| Largest observed route | 298,161 CU / 884 bytes / 18 accounts |
| Independent per-lot reference | 60 inputs, three split quotes, zero optimum regret, 234 atoms feasible same-state split benefit |
| Actual API/UI visibility | 60/60, zero censored; p95 463 / 1,508 ms; zero page errors |
| Final actual withdrawal | One atom; certificate/current-binding checks pass |
| Numeric API/candles | 178 events / 60 trades / four candles pass independent ordering and exact-rational checks |
| Fresh PostgreSQL database replay | 189 transactions fetched; sequence 178; no replay failures |
| Final vault / allocated | 1,400,000,000 / 1,400,000,000 atoms |
| Fee accountability | Actual payer deltas match; zero outstanding commitments/source errors |

This mode repeats no fault windows or stored-order scenarios. The earlier scoped exercises retain their own passing subchecks and failures in WORKLOG; they do not combine into a continuous soak. Unchanged SBF worst-case evidence remains in P11. Hosted broad regression is pending P12 publication.

Capacity preflight (local: `docs/evidence/p12/preflight/capacity.json`) records AC power, 16 GiB physical RAM, 4.707 GB free after reclaiming only inactive test databases, and a short-run projection of approximately 1.043 GB primary PostgreSQL data / 2.347 GB including replay reserve. The selected full-day rate is 0.25 offers/s. Projection is uncertain; actual minute disk/DB/process/host counters and the reserved-space gate govern acceptance. The final probe's summed owned RSS ranged around 4.5–4.9 GiB and may double-count shared pages; the PostgreSQL VM cap is separately 512 MiB.

Exact next action: run `pnpm test:load --soak-seconds 86400 --rates 0.25` on clean committed source, then inspect full-duration continuity, all six outages, financial reconciliation and >10,000-transaction fresh-database replay before ready PR publication.
