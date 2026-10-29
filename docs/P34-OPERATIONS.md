# P34 — bounded canonical-liquidity operations

This guide concerns the explicit local `liquidity-execution-qualification` profile.
It does not authorize default/devnet activation, independent maker onboarding or a
funded pilot. The reference makers are internal. No external hedge was executed.
P15B/P16B remain external gates; continuous 24-hour endurance remains Deferred.

## Reproduce only the relevant qualification

Start from the recorded clean revision, exact installed stack in `ops/env.sh`,
frozen dependencies and the explicitly pinned qualified V3/V4 artifacts. The
loaders verify binary hashes before deployment. They deploy fresh programs and
provision real accounts/collateral through signed instructions. Do not configure a
service from an acceptance dump.

```sh
source ops/env.sh
bash ops/liquidity-qualification-smoke.sh
bash ops/liquidity-operations-smoke.sh
for variant in protected entry stored; do
  RIVALT_CONTINUATION_PROFILE=treatment \
  RIVALT_CONTINUATION_ENTRY=tests/rpc-contract/liquidity-resource-rpc.ts \
  RIVALT_RESOURCE_BOOK="$variant" bash ops/liquidity-continuation-smoke.sh
done
```

The comparison has three sequential 300-second/600-offer windows, plus fresh
provisioning, finalization, independent audits and structural/depletion supplements.
It is not a 24-hour test. Keep the host available and avoid competing load while
measuring. Do not edit tracked files or move HEAD during a pinned run.

The PostgreSQL launchers require the existing Apple container runtime and use
separate fresh run/replay databases. Optional `RIVALT_PG_REUSE_DIR` names a stopped,
owned qualification cluster under `.local/liquidity-execution/qualification/`;
existing databases remain intact. Runtime passwords and signer files are private
local configuration, never source or report content. PostgreSQL retains normal
fsync/durability and manages bounded WAL through checkpointing. Do not delete
active database files to reclaim space. Each wrapper stops only its owned runtime.

Run `tests/load/p34_report.py` with the three summary paths for financial,
population, fee/resource and comparative checks. Run
`tests/load/p34-publisher-reference.ts` against each canonical directory for
independent retained-input marginal-price integration. The operational wrapper
runs the raw-account complete-cohort financial reference separately;
`tests/load/p34_operations_report.py` checks its actual receipts and resource limits.
Exact commands,
code pins and measured values belong in `evidence/P34.md`.

## Availability and recovery boundaries

Every scheduled offer stays in the denominator. A cross account requires usable
sources for its existing exposures as well as the selected market; a healthy ETH
source alone does not make an account with BTC exposure eligible. Reprice TTL,
quarantine and structural epochs remain binding. Legacy A/B epochs expire after
3,600 slots in this comparison and are not renewed or given a fake depth reset.
These differences explain offered availability; they are not allocator speedups.

Publisher coverage is an authenticated backend attestation over complete fresh
published liquidity, not a guarantee of executable maker margin. Clearing keeps
independent source/risk bounds and causal accrual. Missing coverage expires the
held interval, skips uncovered time and requires the existing recovery interval.
Maker updates cannot restore consumed depth; an authorized replenishment is separate.

Keep the signed original, inspect finalized status/history and reconcile before
replacing an ambiguous intent. Authority proofs establish economic nonexecution
only under their documented conditions; absent history never establishes zero
network fees. R094 adds a registered maker-price sequence proof for new reprice
originals. After finalized blockhash expiry, the exact authenticated owner/schema/
PDA bindings and unchanged sequence permit a new, separately reserved retry.
Unavailable or advanced state remains unresolved. The old wire and unknown-fee
reservation stay intact, and handover still waits for actual fee history. Repeated
history gaps can exhaust the bounded budget. Previously persisted null-authority
originals are not rewritten; restore historical RPC evidence for those. Never
delete a queue row, invent a receipt or release an unknown fee reservation.
See [the service contract](P33-LIQUIDITY-SERVICES.md#r094-review-correction--maker-expiry-proof)
for the exact distinction; the new proof requires its own scoped qualification.

Full default uses the complete registered cohort, deterministic accounting and
bounded resumable stages. Permissionless checks do not authorize final resumption;
the venue authority must resume after complete resolution and sustained valid
source recovery. Flat funded cash exits are distinct from payment of unpaid profit.
An exit certificate for unpaid claims can require coordination with ongoing market
mutations; no guaranteed instant profit payout follows from this qualification.

## Measurement interpretation

Route/reprice confirmation latencies use the harness monotonic clock. Durable
publisher receipt latency uses one PostgreSQL clock; simulated chain blockTime
must not be subtracted from host timestamps. Report populations and observation
points explicitly. Wire/compute checks use actual fetched finalized transactions,
not successful simulation alone. Retain rejected originals and their actual fees.

Shared custody/market writes and maker price read/write overlap remain contention
boundaries. Surfpool measurements at two scheduled offers per second do not prove
validator throughput, production priority-fee demand or absence of lock contention.
Constant synthetic index markouts describe controlled execution costs; the stated
one-basis-point hedge assumption is illustrative, unexecuted and not deducted from
funded cash or presented as measured profitability.
