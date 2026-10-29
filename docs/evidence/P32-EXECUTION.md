# P32 scoped canonical execution probe

This is a completed subgate, **not A37/G25 or phase acceptance**.

- Clean client: `8ed4da2c809579c58e33920b9bbc292ff6514991`.
- Clean SBF build: `022f52e80800c22814b2f30f7e819567105fba0d`.
- Commands: `bash ops/build-liquidity-execution.sh`, then
  `bash ops/liquidity-execution-smoke.sh`.
- Local raw evidence: `.local/liquidity-execution/runs/20261029T145011Z-14725/`.
- Fresh offline Surfpool, six actual maker capitals, two trader accounts,
  six authenticated synthetic sources, two publishers, all32 safety pages,
  actual SPL mint/deposits and125 signed finalized RPC/WS outcomes:
  121 success /4 expected rejection.

Every submitted original was independently fetched and decoded by modern/legacy
transports, with byte equality, actual CU/packet/key checks and log/signature WS
observations. Live submissions use confirmed execution while finalization audits
remain in flight; all audits finish before any pass report. Four rejected log-WS
notifications misleadingly report success in Surfpool; finalized fetched status
and unchanged account bytes control acceptance. This is retained as a runtime limit.

| Measured operation | CU | Complete bytes / version | Loaded keys |
|---|---:|---|---:|
| Storage-ready activation | 49,543 | 571 / v0 | 13 |
| Two market reports in one transaction | 60,603–63,161 | 1,226 / v0 | 18 |
| Six source + six maker price updates | 134,856 | 1,874 / v1 | 27 |
| One-maker immediate routes | 349,496–355,677 | 1,080 / v0 | 21 |
| Two makers / two programs | 639,830 | 1,262 / v1 | 26 |
| Permissionless stored subfills | 356,728–357,399 | 933 / v0 | 20 |

No lookup table or extra heap is used. Route limit800k requires≤640k measured;
the two-program case has only170 CU spare below that ceiling. **Full-book and
maximum-shape headroom are unproven and require further work.** Publisher batching
retains200k submitted/160k measured and20-key limits. Freshness/recovery remains
unchanged. Network fees are actual zero-priority test fees:5,000 lamports for the
single-signer order,10,000 for ordinary two-signer routes/reports and20,000 for the
four-signer combined fixture update; CU savings do not erase signature base fees.

Actual checks cover incomplete safety rejection, legacy activation rejection,
canonical activation/replay, one/two-maker current-price fills, repricing after
preparation without depth reset, root-nonce replay rejection, BTC/ETH whole-account
funding and isolated permissionless stored subfills. Independent totals reproduce
13+12=25 order-fee atoms, BTC insurance/protocol/carry19/57/0 and ETH1/6/3;
funded cash plus83 fee atoms equals8,000,000 deposited atoms. All eight roots have
zero net lots and zero aggregate virtual claims at common funding checkpoints.
Legacy Anchor parity covers138 instructions,2 accounts and143 events across the
three first-party programs, including the new nested contexts and actual-leg event.

Earlier failed probes remain recorded in WORKLOG: handler stack lifetime,
invalid test cross-subaccount index and serialized finalization causing Warmup.
They are not counted as successful execution evidence.

Remaining P32 gates include full-book/max-region resources, structural/capacity/
failed-second-leg races, TP/SL, withdrawal/reservation races, affected liquidation/
default/recovery/exits, independent PostgreSQL replay and the pinned comparative
continuation workload. P33/P34, P15B/P16B and deferred endurance remain separate.
