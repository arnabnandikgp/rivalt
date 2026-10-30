import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as sdk from '@rivalt/sdk';
import {JournalStore} from '../../packages/indexer/src/store.js';
import { json } from '../../packages/indexer/src/events.js';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';
import { liquidityExecutionSetup } from './liquidity-execution-setup.js';
import { executionTestHelpers } from './liquidity-execution-helpers.js';
import {LiquidityStore} from '../../packages/indexer/src/liquidity-store.js';
import {digestEvents,fetchScopedHistory,journalBinding,initializationSignature} from './liquidity-journal.js';

const runDir = process.env.RIVALT_RUN_DIR!, databaseUrl = process.env.RIVALT_DATABASE_URL!;
assert(databaseUrl, 'Owned real PostgreSQL is required');
const { h, rpc, ws, checks, flush } = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, runDir, {
  deferFinality: true,
  computeUnitLimit: label => label.startsWith('P32 route') ? 800_000 : label.startsWith('P32 publisher') ? 200_000 : 400_000,
  maxLoadedAccounts: label => label.startsWith('P32 publisher') ? 20
    : label.startsWith('P32 route') || label.startsWith('refresh independent') ? 32 : undefined,
});
let store: LiquidityStore | undefined, replay: LiquidityStore | undefined;
try {
  const setup = await liquidityExecutionSetup(h, rpc), margin = setup.roots[0], owner = setup.traderOwner;
  const { root, guard, route } = executionTestHelpers(h, setup);
  const trade = async () => route({ trader: margin, actor: owner, marketIndex: 0, side: 0, makers: [setup.instances[0]], lots: [1n] });
  await setup.sample(); await h.send('P32 route journal first actual fill', [await trade()], [owner]);
  await flush();
  const anchor=await initializationSignature(rpc,checks.map(check=>String(check.signature)),setup.deployment.eventAuthority);
  const history=()=>fetchScopedHistory(rpc,anchor,setup.deployment.eventAuthority,setup.venue,setup.domain.toString('hex'));
  const initial = await history(), binding = await journalBinding(rpc, anchor, initial, setup.venue, setup.domain.toString('hex'));
  store = new LiquidityStore(databaseUrl, 'p40b-journal'); await store.migrate(); await store.bind(binding);
  const corrupt=structuredClone(initial.invocations);corrupt[0].events[0].data.totalCash='1';
  await assert.rejects(()=>store!.commit(initial.blocks,corrupt,initial.head,null),/authenticated invocation/);
  // Force a real SQL error after block/transaction insertion; every journal,
  // projection, revision and outbox write must roll back in the same transaction.
  await store.pool.query(`CREATE FUNCTION reject_journal_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected journal failure'; END $$;
    CREATE TRIGGER reject_journal_test BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION reject_journal_test()`);
  await assert.rejects(()=>store!.commit(initial.blocks,initial.invocations,initial.head,null),/injected journal failure/);
  assert.equal((await store.snapshot()).state.sequence,'0');
  assert.equal((await store.pool.query('SELECT count(*) FROM transactions WHERE run_id=$1',[store.runId])).rows[0].count,'0','SQL batch rolled back');
  await store.pool.query('DROP TRIGGER reject_journal_test ON events; DROP FUNCTION reject_journal_test()');
  await store.commit(initial.blocks,initial.invocations,initial.head,null);
  const storedDigest=async()=>digestEvents((await store!.pool.query('SELECT bytes FROM events WHERE run_id=$1 ORDER BY sequence',[store!.runId])).rows);
  assert.equal(await storedDigest(),initial.digest);
  const legacy = new JournalStore(databaseUrl,store.runId,{schema:3,empty:()=>({sequence:'0',revisions:{}}),apply:()=>{throw new Error('Wrong-schema projection must never run');}});
  try { await assert.rejects(() => legacy.snapshot(), /Incompatible projection schema/); } finally { await legacy.close(); }
  // Close the actual SQL lease/pool. The next fill must be recovered from RPC,
  // even though the prototype journal was not present to observe its WS hint.
  await store.close(); store = undefined;
  await setup.qualify();
  await h.send('P32 route actual fill during journal shutdown', [await trade()], [owner]);
  const withdrawal = sdk.getWithdrawFundedAccountInstruction({ ...setup.common, owner,
    btc: setup.markets[0], eth: setup.markets[1], margin, quoteMint: setup.mint.address,
    userToken: setup.traderToken.address, guard: await guard(margin), amount: 1n });
  const before = await root(margin);
  await h.send('reverted withdrawal event must stay non-economic', [withdrawal, withdrawal], [owner], sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);
  assert.deepEqual(await root(margin), before);
  await flush();
  const failed = checks.find(check => check.label === 'reverted withdrawal event must stay non-economic')!.signature as string;
  const recovered = await history();
  const failedHistory = recovered.transactions.find(item => item.signature === failed)!;
  assert(failedHistory.tx.meta.innerInstructions.length > 0, 'Actual reverted CPI bytes retained');
  assert(!recovered.events.some(event => event.signature === failed), 'Reverted event never projected');
  store = new LiquidityStore(databaseUrl, 'p40b-journal'); await store.migrate(); await store.bind(binding);
  const previous = await store.snapshot();
  for (const notice of ws.notifications) {
    const signature = notice.params?.result?.value?.signature;
    if (signature && recovered.transactions.some(item => item.signature === signature)) await store.observe('ws-confirmed', signature, notice);
  }
  await store.commit(recovered.blocks, recovered.invocations, recovered.head, previous.checkpoint);
  const snapshot = await store.snapshot(); assert.equal(await storedDigest(), recovered.digest);
  assert.equal(BigInt(snapshot.state.revisions[setup.custody].revision),sdk.getCustodyDecoder().decode((await h.read(setup.custody))!).revision);
  await store.commit(recovered.blocks, recovered.invocations, recovered.head, snapshot.checkpoint);
  assert.deepEqual((await store.snapshot()).state, snapshot.state, 'Idempotent finalized backfill');
  const conflict=structuredClone(recovered.invocations);conflict[0].footerBytes=Buffer.from('different finalized payload').toString('base64');
  await assert.rejects(()=>store!.commit(recovered.blocks,conflict,recovered.head,snapshot.checkpoint),/authenticated invocation/);
  await assert.rejects(() => store!.pool.query('UPDATE events SET kind=kind WHERE run_id=$1', [store!.runId]), /append-only journal/);
  await store.pool.query('CREATE DATABASE rivalt_p40b_replay');
  const replayUrl = new URL(databaseUrl); replayUrl.pathname = '/rivalt_p40b_replay';
  replay = new LiquidityStore(replayUrl.toString(), 'p40b-fresh-replay'); await replay.migrate(); await replay.bind(binding);
  const refetched = await history();
  await replay.commit(refetched.blocks, refetched.invocations, refetched.head, null);
  assert.deepEqual((await replay.snapshot()).state, snapshot.state, 'Fresh PostgreSQL database from actual RPC history');
  const counts = (await store.pool.query(`SELECT
    (SELECT count(*) FROM transactions WHERE run_id=$1) AS transactions,
    (SELECT count(*) FROM transactions WHERE run_id=$1 AND failed) AS failed,
    (SELECT count(*) FROM events WHERE run_id=$1) AS events,
    (SELECT count(*) FROM outbox WHERE run_id=$1) AS outbox,
    (SELECT count(*) FROM jobs WHERE run_id=$1 AND status IN ('pending','unresolved')) AS unresolved`, [store.runId])).rows[0];
  assert.equal(counts.events, snapshot.state.sequence); assert.equal(counts.outbox, counts.events); assert.equal(counts.unresolved, '0');
  const roots = await Promise.all([...setup.roots, ...setup.instances.map(maker => maker.capital)].map(root));
  const markets = await Promise.all([0, 1].map(setup.marketState));
  for (const index of [0, 1]) {
    assert.equal(roots.reduce((sum, account) => sum + account.positions[index].lots, 0n), 0n);
    assert.equal(roots.reduce((sum, account) => { const position = account.positions[index]; return sum + position.virtualScaled
      - position.lots * (markets[index].fundingIndexScaled - position.fundingCheckpointScaled); }, 0n), 0n);
  }
  const ledger = sdk.getMarketLedgerDecoder().decode((await h.read(setup.ledgers[0]))!);
  assert.deepEqual([ledger.insurance, ledger.fees, ledger.insuranceFeeRemainder], [6n, 20n, 2]);
  assert.equal(roots.reduce((sum, account) => sum + account.cash, 0n) + 26n, 8_000_000n);
  writeFileSync(`${runDir}/summary.json`, json({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    trackedDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== '',
    build: JSON.parse(readFileSync('.local/liquidity-execution/build-manifest.json', 'utf8')), checks, binding, counts,
    state: snapshot.state, failed, roots, markets, ledger, scope:'Schema-5 complete block journal and financial projection', phaseAcceptance: false }));
  console.log(json({ stage:'p40b-scoped-journal-pass', counts, financialFees: '26', phaseAcceptance: false }));
} finally { await replay?.close(); await store?.close(); try { await flush(); } finally { ws.close(); } }
