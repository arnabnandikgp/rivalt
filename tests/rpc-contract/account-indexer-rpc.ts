import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import * as sdk from '@rivalt/sdk';
import {AccountIndexer,type AccountConfig} from '../../packages/indexer/src/account-indexer.js';
import {GroupStore} from '../../packages/indexer/src/group-store.js';
import {json} from '../../packages/indexer/src/events.js';
import {accountApi} from '../../packages/indexer/src/account-api.js';
import {accountRuntimeHarness} from './account-runtime-harness.js';
import {accountSafetyCases} from './account-safety-cases.js';
import {fixtureKey,addresses} from './custody-cases.js';

const directory=process.env.RIVALT_RUN_DIR!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=()=>execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='';
const startedDirty=dirty();
const transport=await accountRuntimeHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory);
const [venue]=await sdk.deriveAccountVenue(createHash('sha256').update('rivalt/p26/account-safety').digest());
let indexer:AccountIndexer|undefined,replay:AccountIndexer|undefined,app:ReturnType<typeof accountApi>|undefined,config:AccountConfig;
const checkpoints:unknown[]=[];
try {
  const result=await accountSafetyCases(transport.h,{maximumCohort:process.env.RIVALT_ACCOUNT_MAXIMUM_COHORT==='1',liquidation:true,fullBooks:true,
    checkpoint:async label=>{
      await transport.finalize();
      if(!indexer) {
        const anchor=transport.checks.find(check=>check.label==='setup fresh clearing venue')!.signature as string;
        config={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:process.env.RIVALT_DATABASE_URL!,
          runId:'p27-account-indexer',venue,anchor,profile:'account-safety-qualification',pageSize:37};
        indexer=new AccountIndexer(config);await indexer.open();
      }
      await indexer.cycle();const before=await indexer.store.snapshot();
      const reconciliation=await indexer.reconcile();
      // Close the WS and PostgreSQL lease/pool, then reconstruct from the durable
      // database. This is an indexer restart, not a risk-worker process restart.
      await indexer.close();indexer=new AccountIndexer(config);await indexer.open();await indexer.cycle();
      assert.deepEqual((await indexer.store.snapshot()).state,before.state,'Persisted stage rebuild');
      checkpoints.push({label,reconciliation});console.log(json({stage:label,reconciliation}));
    }});
  assert(indexer);await transport.finalize();await indexer.cycle();
  // The independent P26 raw-byte reference can audit this new signed financial
  // history at its original terminal capture, before the extra journal faults.
  writeFileSync(`${directory}/financial-capture.json`,json({...result,checks:transport.checks}));
  execFileSync('python3',['tests/financial/account-safety-reference.py',`${directory}/financial-capture.json`],{stdio:'inherit'});
  const legacy=new GroupStore(config!.databaseUrl,config!.runId);
  try{await assert.rejects(()=>legacy.snapshot(),/Incompatible projection schema/);}finally{await legacy.close();}
  const before=await indexer.store.snapshot(),owner=await fixtureKey('p24-trader');
  const root=sdk.getMarginAccountDecoder().decode((await transport.h.read(result.roots[0]))!);
  const safety=sdk.getVenueSafetyDecoder().decode((await transport.h.read(result.safety))!);
  const currentVenue=sdk.getVenueDecoder().decode((await transport.h.read(venue))!);
  assert(root.cash>1n);
  const deployment=await addresses();
  const withdrawal=sdk.getWithdrawFundedAccountInstruction({venue,custody:result.custody,safety:result.safety,vault:result.vault,
    btc:result.markets[0],eth:result.markets[1],btcLedger:result.ledgers[0],ethLedger:result.ledgers[1],
    owner,margin:result.roots[0],quoteMint:result.mint,userToken:result.userTokens[0],eventAuthority:deployment.eventAuthority,program:deployment.program,
    amount:1n,guard:{safetyEpoch:safety.epoch,venueTermsEpoch:currentVenue.termsEpoch,nonce:root.nonce,stateVersion:root.stateVersion}});
  await transport.send('reverted first withdrawal event remains non-economic',[withdrawal,withdrawal],[owner],6122);
  await transport.finalize();await indexer.cycle();
  assert.deepEqual((await indexer.store.snapshot()).state,before.state,'Reverted event excluded');
  const failed=transport.checks.at(-1)!.signature;
  const rejected=await transport.rpc.call('getTransaction',[failed,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  assert(rejected.meta.innerInstructions.length>0,'Failed CPI capture retained');
  assert.equal((await indexer.store.pool.query('SELECT count(*) FROM events WHERE run_id=$1 AND signature=$2',[config!.runId,failed])).rows[0].count,'0');
  indexer.ws!.close();
  await transport.send('funded exit during actual indexer WS outage',[withdrawal],[owner]);await transport.finalize();
  const recoveredSignature=transport.checks.at(-1)!.signature;
  await indexer.close();indexer=new AccountIndexer(config!);await indexer.open();await indexer.cycle();
  const recovered=await indexer.store.snapshot();
  assert.equal(BigInt(recovered.state.roots[result.roots[0]].cash),BigInt(before.state.roots[result.roots[0]].cash)-1n);
  await indexer.cycle();assert.deepEqual((await indexer.store.snapshot()).state,recovered.state,'Idempotent backfill');
  assert.equal((await indexer.store.pool.query('SELECT count(*) FROM events WHERE run_id=$1 AND signature=$2',[config!.runId,recoveredSignature])).rows[0].count,'1');
  assert.equal((await indexer.store.pool.query('SELECT count(*) FROM transactions WHERE run_id=$1 AND signature=$2 AND failed',[config!.runId,failed])).rows[0].count,'1');
  app=accountApi(indexer);const base=await app.listen({host:'127.0.0.1',port:0});
  const get=async(path:string)=>{const response=await fetch(base+path);assert.equal(response.status,200,path);return response.json();};
  assert.deepEqual((await get('/v3/venue')).custody,recovered.state.custody);
  assert.deepEqual((await get(`/v3/accounts/${result.roots[0]}`)).account,recovered.state.roots[result.roots[0]]);
  assert((await get(`/v3/portfolios/${owner.address}`)).portfolios.length>0);
  assert((await get('/v3/trades')).items.every((item:any)=>item.kind==='AccountRouteExecutedV3'));
  indexer.healthy=false;assert.equal((await fetch(base+'/v3/venue')).status,503);indexer.healthy=true;
  await assert.rejects(()=>indexer!.store.pool.query('UPDATE events SET kind=kind WHERE run_id=$1',[config!.runId]),/append-only journal/);
  await indexer.store.pool.query('CREATE DATABASE rivalt_p27_replay');
  const replayUrl=new URL(config!.databaseUrl);replayUrl.pathname='/rivalt_p27_replay';
  replay=new AccountIndexer({...config!,databaseUrl:replayUrl.toString(),runId:'p27-fresh-replay'});
  await replay.open();await replay.cycle();assert.deepEqual((await replay.store.snapshot()).state,recovered.state,'Fresh PostgreSQL replay');
  const reconciliation=await indexer.reconcile(),replayReconciliation=await replay.reconcile();
  const counts=(await indexer.store.pool.query(`SELECT
    (SELECT count(*) FROM transactions WHERE run_id=$1) AS transactions,
    (SELECT count(*) FROM events WHERE run_id=$1) AS events,
    (SELECT count(*) FROM outbox WHERE run_id=$1) AS outbox,
    (SELECT count(*) FROM jobs WHERE run_id=$1 AND status IN ('pending','unresolved')) AS unresolved`,[config!.runId])).rows[0];
  assert.equal(counts.events,recovered.state.sequence);assert.equal(counts.outbox,counts.events);assert.equal(counts.unresolved,'0');
  writeFileSync(`${directory}/summary.json`,json({revision,trackedDirty:startedDirty||dirty(),scope:'P27 indexer/API checkpoint; direct SDK and workers remain pending',
    binding:recovered.binding,counts,checkpoints,reconciliation,replayReconciliation,checks:transport.checks,failed,recoveredSignature,
    financialCapture:'financial-capture.json',wsNotifications:transport.notifications().length,state:recovered.state}));
  console.log(json({stage:'schema-3-postgres-replay-pass',counts,reconciliation,phaseStatus:'In progress'}));
}finally{await app?.close();await replay?.close();await indexer?.close();transport.close();}
