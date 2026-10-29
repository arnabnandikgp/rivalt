# P32 canonical full-book resource checkpoint

Scoped pass, not A37/G25 or phase completion. Command:
`bash ops/liquidity-resource-smoke.sh`.

- Clean client `038f31a19999441b79be7cc3a2b0a3078fcedf64` and clean SBF build
  `6437f7d7b5d941dd29e3da7aeaccb4401722aa2d`.
- Local raw run `.local/liquidity-execution/runs/20261029T154240Z-31201/`:
  `summary.json`, signed originals, simulations, fetched finalized transactions,
  signature/log WS notifications and isolated legacy Anchor conformance.
- 147 finalized outcomes:141 success,6 expected rejection. Every original signed
  transaction is independently fetched and decoded through both transports.
  Legacy parity:186 instruction encodings,2 accounts and189 events across clearing
  and the two maker programs. No ALT or extra heap.

| Actual case | CU | Complete bytes / format | Unique keys |
|---|---:|---:|---:|
| Two-program seed against eight-region curves |593,528|1,262 / v1|26|
| Maximum4608-lot two-program route, all three full books |615,334|1,262 / v1|26|
| Maximum4096-lot singleton, full books and skew-target crossing |340,927|1,072 / v0|21|
| Zero-cash second-maker rollback |376,401|1,198 / v1|24|
| Oversized total quantity rejected |539,654|1,262 / v1|26|
| Prepared route after structural depth change rejected |261,659|1,072 / v0|21|

Routes retain the800k submitted/640k measured ceiling. The maximum legal pair
leaves24,666CU below that ceiling:23.08% of the submitted budget is unused. Both
providers have separately authenticated complete ProgramData and separate quote
CPIs; full financial admission remains. The trader and both providers each carry
four live orders and two protection groups, created through actual instructions.
Each2304-lot leg visits all eight regions. The singleton visits the full4096 depth.

Independent per-lot accumulation gives pair gross281,760,290 (140,880,145 each)
and fee56,353. Singleton sell gross237,401,500 gives fee47,481. Including the seed
fee49, total collected fees are103,883; BTC insurance/protocol/carry are
25,970/77,913/3, ETH remains zero. Exact funding-adjusted claim deltas, all eight
accounts' zero aggregate lots/claims, and cash+fees=307,000,000 reconcile against
308,000,000 actual deposits less a1,000,000 actual provider withdrawal. Failed
routes leave every watched financial/book/consumption account byte unchanged.

Repricing preserves consumed prefixes. The extreme inventory distribution creates
crossed published liquidity (funding report outcome3), which is recorded explicitly;
the harness does not publish a fictitious available report. The singleton executes
under the still-valid prior qualification and unchanged fresh-source checks. This
probe does not claim continuous funding availability at that inventory.

Previous failures remain in WORKLOG R089:641,820CU for the initial eight-region
seed; an oversized test intent;659,622CU for the first legal full-book route; and
the incorrect test assumption that the resulting publication stayed uncrossed.
Checked native-width intermediates, direct marginal endpoints and avoiding one
duplicate immutable-shape validation reduce resource use without changing quote
semantics. The12 scoped native cases and3172 independent reference vectors pass.

Stack-frame scan passes for all four artifacts. The prior4344-byte handler offset
was resolved by non-inlined quote/root construction and removal of temporary root
copies; contexts were already boxed. No zero-copy layout or account migration was
needed. [Affected safety](P32-SAFETY.md) and [PostgreSQL replay](P32-JOURNAL.md) now pass
on their recorded pins; continuation remains pending. No CI, endurance or external
qualification is implied.


Ordinary-entry and stored-order full books also pass on clean client
`df70e7c51ae6df2cc08bb041934cbf11668f46f5` / unchanged SBF `6437f7d`:

| Variant / command prefix | Local run | Outcomes | Maximum pair CU / bytes | Singleton CU |
|---|---|---:|---:|---:|
| `RIVALT_RESOURCE_BOOK=entry` | `20261029T161757Z-40728` | 165 | 614,030 / 1,262 v1 | 342,822 |
| `RIVALT_RESOURCE_BOOK=stored` | `20261029T161758Z-40744` | 165 | 615,433 / 1,165 v0 | 341,532 |

Each invokes `bash ops/liquidity-resource-smoke.sh` on an independent empty
Surfpool deployment; the second uses RPC/WS ports 18951/18952. Each has 159 success
and six intended rejections, 234 instruction / two account / 237 event parity.
Ordinary books contain four live entry reservations per root. The stored variant
executes the complete 4,608-lot order permissionlessly with both provider books
full; only that completed trader order leaves the active set. All independent
price, funding, cash, fee, failed-state and consumption assertions above pass.
The maximum across these variants and protection books is 615,433 CU, leaving
24,567 CU below the unchanged 640k ceiling. No program or budget change was needed.
