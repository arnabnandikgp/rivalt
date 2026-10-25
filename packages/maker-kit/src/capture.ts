import assert from 'node:assert/strict';
import type { Runtime } from '@rivalt/services';
import type { PoolClient } from 'pg';
import { makerEconomics, type EconomicsInput, type EconomicsSnapshot } from './economics.js';

type RuntimeSnapshot = Awaited<ReturnType<Runtime['store']['snapshot']>>;
function snapshot(row: RuntimeSnapshot, capital: string): EconomicsSnapshot {
  const participant = row.state.participants[capital]; assert(participant, 'Maker participant missing');
  const risk = row.state.risk;
  // The captured reference is historical finalized state, not a new live price
  // authorization. Conservatively label it stale in this offline report.
  return { sequence: row.state.sequence, fundingIndexScaled: row.state.market.fundingIndexScaled,
    referenceAtomsPerLot: risk?.referencePrice ?? null, referenceStatus: risk ? 'stale' : 'absent',
    participant: { cash: participant.cash, lots: participant.lots, virtualScaled: participant.virtualScaled,
      fundingCheckpointScaled: participant.fundingCheckpointScaled } };
}
export async function economicsCheckpoint(runtime: Runtime, capital: string, owner: string) {
  return consistentCapture(runtime, async (client, row) => {
  assert.equal(row.state.participants[capital]?.owner, owner); assert.equal(row.error, null);
  const transactions = (await client.query('SELECT signature FROM transactions WHERE run_id=$1 AND slot<=$2',
    [runtime.runId, row.checkpoint_slot])).rows.map(row => row.signature as string);
  return { schemaVersion: 1, runId: runtime.runId, market: row.binding.market, domain: row.binding.domain, capital, owner,
    checkpointSlot: row.checkpoint_slot, snapshot: snapshot(row, capital), transactions };
  });
}
export async function economicsCapture(runtime: Runtime, opening: Awaited<ReturnType<typeof economicsCheckpoint>>, assumedHedgeBps = '0') {
  assert.equal(opening.runId, runtime.runId);
  return consistentCapture(runtime, async (client, row) => {
  assert.equal(row.error, null);
  assert.equal(row.binding.market, opening.market); assert.equal(row.binding.domain, opening.domain);
  assert.equal(row.state.participants[opening.capital]?.owner, opening.owner);
  const events = (await client.query('SELECT signature,kind,payload FROM events WHERE run_id=$1 AND sequence>$2 AND sequence<=$3 ORDER BY sequence',
    [runtime.runId, opening.snapshot.sequence, row.state.sequence])).rows;
  const priorTransactions = new Set(opening.transactions);
  const transactions = (await client.query('SELECT signature,payload,failed FROM transactions WHERE run_id=$1 AND slot<=$2 ORDER BY slot,signature',
    [runtime.runId, row.checkpoint_slot])).rows.filter(transaction => !priorTransactions.has(transaction.signature)).map(transaction => {
    assert(Number.isSafeInteger(transaction.payload.meta.fee) && transaction.payload.meta.fee >= 0);
    return { signature: transaction.signature, feePayer: transaction.payload.transaction.message.accountKeys[0],
      feeLamports: String(transaction.payload.meta.fee), failed: transaction.failed };
  });
  const budgets = (await client.query('SELECT committed::text FROM service_budgets WHERE run_id=$1 AND wallet=$2', [runtime.runId, opening.owner])).rows;
  const input: EconomicsInput = { version: 1, operatorClass: 'internal-reference', market: opening.market, domain: opening.domain,
    capital: opening.capital, owner: opening.owner, opening: opening.snapshot, closing: snapshot(row, opening.capital), events, transactions,
    pendingFeeReservationLamports: budgets.reduce((sum, budget) => sum + BigInt(budget.committed), 0n).toString(),
    hedge: { kind: 'not-observed', assumedBps: assumedHedgeBps, description: 'Explicit scenario assumption only; no hedge transactions or external prices observed' } };
  return { input, report: makerEconomics(input) };
  });
}

// The indexer may commit while a report is read. Keep the projection, events,
// transaction fees and reservations in one database snapshot, including slots
// with more than one transaction.
async function consistentCapture<T>(runtime: Runtime, read: (client: PoolClient, row: RuntimeSnapshot) => Promise<T>): Promise<T> {
  const client = await runtime.store.pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const row = (await client.query('SELECT * FROM runs WHERE run_id=$1', [runtime.runId])).rows[0] as RuntimeSnapshot;
    assert(row?.checkpoint_slot, 'A finalized indexer checkpoint is required');
    const result = await read(client, row);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
