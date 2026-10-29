# P32 — scoped restricted-publisher evidence

This passes the D76 publisher probe, **not A37/G25 or P32 as a whole**.
New financial trading remains disabled. No PostgreSQL, active financial execution,
endurance, CI, external review or deployment qualification is claimed here.

- Tested source and SBF build: clean `4f4e47d6a2555c7858fd98ba723737b2a9f93200`.
- Commands: `bash ops/build-liquidity-execution.sh`, then
  `bash ops/funding-publisher-smoke.sh`.
- Local runtime: Surfpool1.6.1 / Solana core4.2.1, actual RPC and WebSocket.
- Raw local evidence:
  `.local/liquidity-execution/runs/20261029T104949Z-86844/summary.json`;
  original signed wire bytes, simulations, independently fetched transactions,
  WS notifications and complete publisher input snapshots are beside it.
- Build SHA256 for clearing:
  `793330ca199400bbe8b0b5f1fa6bc34262feef85397eee377c65ebbbecbb45c2`.
  The local build manifest/summary records the other three binaries.

## Actual results

84 signed outcomes finalize:75 successes and9 expected rejections. All original
transaction bytes equal independent RPC fetches and decode through both transports.
Isolated legacy Anchor parity passes for75 instructions,2 accounts and73 events.
Eight accepted reports cover100/600-lot optima, actual zero-cash makers, rotated
authority, a fresh zero-cap required input, expired zero-cap coverage, invalid
independent sources and insufficient complete depth. Literal expected prices are
independent of the SDK allocator.

| Operation | Actual CU | Complete bytes | Loaded keys | Submitted CU |
|---|---:|---:|---:|---:|
| Publisher initialization | 29,380 | 537 | 11 | 200,000 |
| Available100-lot report | 30,511 | 871 | 14 | 200,000 |
| Available600-lot / zero-cash report | 30,571 | 871 | 14 | 200,000 |
| Unavailable report | 27,315–29,936 | 871 | 14 | 200,000 |
| Rotate/revoke/reauthorize | 22,699–22,704 | 479 | 9 | 200,000 |
| Tested full-shape maker controls | 296,374–318,874 | 1,222 | 17 | 400,000 |

All are v0 without lookup tables and use the default32-KiB heap. The maximum report
is97.7% less CU than the historical1,334,329-CU D74 sampler, but the trust boundary
has changed: maker coverage/authentication/optimality are backend attestations.
Independent index and bounded funding checks remain on-chain. This does not prove
many-maker scaling or an equivalent reduction in fees. These reports use separate
publisher and fee-payer signatures and pay10,000 test lamports at zero priority fee.

Replay, foreign domain/market, future observation, incorrect index quantity, old
signer/epoch and pre-control report transactions reject without market/publisher/
custody/maker mutations. The retired sampler also rejects without mutation.
RPC finalized status is authoritative: Surfpool log WS reports`err:null` for all9
rejected transactions; retain that known discrepancy rather than counting them as
successful state transitions. Every transaction also has a signature notification.

## Independent checks and limitations

Seven native publisher tests check exact140/203-byte layouts, mutation/fence/expiry
rejections, index-derived quantity and bands, both signed50-bps funding caps and
literal old-interval/new-landing accrual. Four existing causal tests cover gaps,
controls, slot expiry, catchup and inactive modes. One control-result test corrupts
all691 encoded bytes and owner/layout/executable status; all mismatches reject.
Six SDK cases check literal prices, disconnected quantity sets, two-leg limits,
source validity and snapshot digests. Clearing IDL generation, SDK generation/check
and TypeScript checking pass. Existing IDL definitions are unchanged; only the
three publisher instructions, account, events/types and error are added.

The first clean candidate stopped before signing a report because Surfpool's Clock
slot is one ahead of its RPC context; a10-read diagnostic confirmed this. The
client now uses authenticated Clock for observations and RPC context for read
ordering, retaining all on-chain fences. The second probe reached seven reports
but failed a shape-control headroom gate at337,446CU. Full pre-CPI authentication
is retained; exact owner/layout/complete expected-state verification replaces
redundant post-CPI PDA searches. The final measured maximum318,874CU passes320,000
but leaves only1,126CU below that threshold. Active/full-book controls and all
remaining financial paths require their own P32 measurements.

The runtime is stopped. Raw evidence stays local and ignored. P32 remains
In progress; P33/P34, P15B/P16B and deferred24-hour endurance are unchanged.
