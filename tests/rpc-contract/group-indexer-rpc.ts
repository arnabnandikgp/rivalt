import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import * as sdk from '@rivalt/sdk';
import {GroupIndexer, type GroupConfig} from '../../packages/indexer/src/group-indexer.js';
import {Store} from '../../packages/indexer/src/store.js';
import {json} from '../../packages/indexer/src/events.js';
import {groupApi} from '../../packages/indexer/src/group-api.js';
import {groupRuntimeHarness} from './group-runtime-harness.js';
import {crossBudgetCases} from './cross-budget-cases.js';
import {groupQueueFault} from './group-queue-fault.js';

const directory = process.env.RIVALT_RUN_DIR!;
const revision = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty = () => execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim() !== '';
const startedDirty = dirty();
const transport = await groupRuntimeHarness(process.env.RIVALT_RPC_URL!, directory);
const setup = await crossBudgetCases(transport.harness, async () => {});
await transport.finalize();
const anchor = transport.checks.find(check => check.label === 'setup clearing group')!.signature;
const config: GroupConfig = {rpcUrl:process.env.RIVALT_RPC_URL!, wsUrl:process.env.RIVALT_WS_URL!, databaseUrl:process.env.RIVALT_DATABASE_URL!,
  runId:'p21-group-indexer', group:setup.fixture.group, anchor, profile:'cross-safety-qualification', pageSize:37};
let indexer = new GroupIndexer(config);
let replay: GroupIndexer | undefined;
let app: ReturnType<typeof groupApi> | undefined;
try {
  await indexer.open(); await indexer.cycle();
  const initial = await indexer.reconcile();
  console.log(json({stage:'initial-finalized-projection', ...initial}));
  const legacy = new Store(config.databaseUrl, config.runId);
  try {await assert.rejects(() => legacy.snapshot(), /Incompatible projection schema/);} finally {await legacy.close();}
  const before = await indexer.store.snapshot();
  const deposit = await setup.cashInstruction(setup.fixture.cross, 17n, false);
  // First instruction emits, second uses a stale group sequence and reverts BOTH.
  await transport.send('failed second instruction excludes first deposit event', [deposit,deposit], [setup.fixture.owner], sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);
  await transport.finalize(); await indexer.cycle();
  assert.deepEqual((await indexer.store.snapshot()).state, before.state, 'Reverted event excluded');
  const rejected = transport.checks.at(-1)!;
  assert(rejected.history.meta.innerInstructions.length > 0, 'Retained failed CPI data');
  assert.equal((await indexer.store.pool.query('SELECT count(*) FROM events WHERE run_id=$1 AND signature=$2',[config.runId,rejected.signature])).rows[0].count, '0');

  // Real WS outage; the replacement indexer must backfill the original signature.
  indexer.ws!.close();
  await transport.send('deposit during actual indexer WS disconnection', [await setup.cashInstruction(setup.fixture.cross,17n,false)], [setup.fixture.owner]);
  await transport.finalize();
  await indexer.close(); indexer = new GroupIndexer(config);
  await indexer.open(); await indexer.cycle();
  const recovered = await indexer.store.snapshot();
  assert.equal(BigInt(recovered.state.roots[setup.fixture.cross].cash), BigInt(before.state.roots[setup.fixture.cross].cash) + 17n);
  const depositSignature = transport.checks.at(-1)!.signature;
  assert.equal((await indexer.store.pool.query('SELECT count(*) FROM events WHERE run_id=$1 AND signature=$2',[config.runId,depositSignature])).rows[0].count, '1');
  await indexer.cycle(); assert.deepEqual((await indexer.store.snapshot()).state, recovered.state, 'Idempotent canonical backfill');

  await transport.send('deposit observed on live group subscription', [await setup.cashInstruction(setup.fixture.cross,1n,false)], [setup.fixture.owner]);
  await transport.finalize(); await indexer.cycle();
  assert(indexer.metrics.notifications > 0, 'Actual group WS notification');
  const queueFault=await groupQueueFault({databaseUrl:config.databaseUrl,runId:config.runId,rpcUrl:config.rpcUrl,directory},setup,transport);
  await indexer.cycle();
  const final = await indexer.store.snapshot(), reconciliation = await indexer.reconcile();
  app = groupApi(indexer);
  const apiUrl = await app.listen({host:'127.0.0.1',port:0});
  const readApi = async (path: string) => {const response=await fetch(`${apiUrl}${path}`); assert.equal(response.status,200,path); return response.json();};
  const apiGroup = await readApi('/v2/group');
  assert.deepEqual(apiGroup.state, final.state.group); assert.equal(apiGroup.schemaVersion,2);
  const apiRoot = await readApi(`/v2/accounts/${setup.fixture.cross}`);
  assert.deepEqual(apiRoot.account, final.state.roots[setup.fixture.cross]);
  assert.equal(apiRoot.view.cash, final.state.roots[setup.fixture.cross].cash);
  assert.equal(apiRoot.view.withdrawableCash,null); assert.equal(apiRoot.clockSource,'finalized-rpc-sysvar');
  const apiPortfolio = await readApi(`/v2/portfolios/${setup.fixture.owner.address}`);
  assert(apiPortfolio.portfolios.some((portfolio:any)=>portfolio.accounts.some((account:any)=>account.address===setup.fixture.cross)));
  const apiTrades = await readApi('/v2/trades?limit=100');
  assert(apiTrades.items.length > 0 && apiTrades.items.every((entry:any)=>['group-route','margin-route'].includes(entry.kind)));
  indexer.healthy = false;
  assert.equal((await fetch(`${apiUrl}/v2/group`)).status,503,'No unhealthy projection response');
  indexer.healthy = true;
  const liveSignature = transport.checks.at(-1)!.signature;
  assert.equal((await indexer.store.pool.query("SELECT count(*) FROM observations WHERE run_id=$1 AND signature=$2 AND source='ws-confirmed'",[config.runId,liveSignature])).rows[0].count, '1');
  await assert.rejects(() => indexer.store.pool.query('UPDATE events SET kind=kind WHERE run_id=$1',[config.runId]), /append-only journal/);

  await indexer.store.pool.query('CREATE DATABASE rivalt_p21_replay');
  const replayUrl = new URL(config.databaseUrl); replayUrl.pathname = '/rivalt_p21_replay';
  replay = new GroupIndexer({...config, databaseUrl:replayUrl.toString(), runId:'p21-fresh-replay'});
  await replay.open(); await replay.cycle();
  assert.deepEqual((await replay.store.snapshot()).state, final.state, 'Fresh PostgreSQL database replay');
  const replayReconciliation = await replay.reconcile();
  const counts = (await indexer.store.pool.query(`SELECT
    (SELECT count(*) FROM transactions WHERE run_id=$1) AS transactions,
    (SELECT count(*) FROM events WHERE run_id=$1) AS events,
    (SELECT count(*) FROM outbox WHERE run_id=$1) AS outbox,
    (SELECT count(*) FROM jobs WHERE run_id=$1 AND status IN ('pending','unresolved')) AS unresolved`,[config.runId])).rows[0];
  assert.equal(counts.events, final.state.sequence); assert.equal(counts.outbox, counts.events); assert.equal(counts.unresolved, '0');
  const finishedRevision = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  writeFileSync(`${directory}/summary.json`,json({revision, finishedRevision, trackedDirty:startedDirty || dirty() || revision !== finishedRevision,
    scope:'P21A indexer/API/preview and durable execution checkpoint; financial workers/direct SDK and full A26A remain pending',
    runtime:await transport.rpc.call('getVersion'), binding:final.binding, counts, reconciliation, replayReconciliation,
    ws:indexer.metrics.notifications, queueFault, http:{group:true,account:true,portfolio:true,trades:true,unhealthy503:true}, failedSignature:rejected.signature, recoveredSignature:depositSignature, liveSignature,
    checks:transport.checks.map(({history,...check})=>check), networkFees:transport.checks.reduce((total,check)=>total+BigInt(check.feeLamports),0n)}));
  console.log(json({stage:'fresh-group-postgres-recovery-pass', counts, reconciliation, expectedPhaseStatus:'In progress'}));
} finally {await app?.close(); await replay?.close(); await indexer.close();}
