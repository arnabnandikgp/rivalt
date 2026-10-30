import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import * as sdk from '@rivalt/sdk';
import {LiquidityIndexer,type LiquidityConfig} from '../../packages/indexer/src/liquidity-indexer.js';
import {accountApi} from '../../packages/indexer/src/account-api.js';
import {AccountStore} from '../../packages/indexer/src/account-store.js';
import {json} from '../../packages/indexer/src/events.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';

const runDir=process.env.RIVALT_RUN_DIR!,databaseUrl=process.env.RIVALT_DATABASE_URL!;
assert(databaseUrl,'Owned real PostgreSQL required');
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,runDir,{
  deferFinality:true,computeUnitLimit:label=>label.startsWith('P33 route')?800_000:label.startsWith('P32 publisher')?200_000:400_000,
  maxLoadedAccounts:label=>label.startsWith('P32 publisher')?20:label.startsWith('P33 route')||label.startsWith('refresh independent')?32:undefined,
});
let indexer:LiquidityIndexer|undefined,replay:LiquidityIndexer|undefined;
try {
  const setup=await liquidityExecutionSetup(h,rpc),margin=setup.roots[0],owner=setup.traderOwner;
  const {root,guard,route}=executionTestHelpers(h,setup);
  const trade=()=>route({trader:margin,actor:owner,marketIndex:0,side:0,makers:[setup.instances[0]],lots:[1n]});
  await setup.sample();await h.send('P33 route first actual indexed fill',[await trade()],[owner]);await flush();
  // Select the exact successful initialization event, without relying on labels.
  let init:string|undefined;
  for(const check of checks) {
    const tx=await rpc.call('getTransaction',[check.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    if(!tx||tx.meta.err!==null)continue;
    const payloads=(await import('../../packages/indexer/src/events.js')).eventPayloads(String(check.signature),tx,setup.deployment.eventAuthority);
    if(payloads.some(({payload})=>Buffer.from(payload.subarray(0,8)).equals(Buffer.from(sdk.ACCOUNT_CUSTODY_CHANGED_EVENT_DISCRIMINATOR))
      &&sdk.getAccountCustodyChangedEventDecoder().decode(payload).kind===0)){init=String(check.signature);break;}
  }
  assert(init,'Actual initialization signature');
  const config:LiquidityConfig={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl,
    runId:'p33-indexer',venue:setup.venue,anchor:init,profile:'liquidity-execution-qualification',pageSize:37};
  indexer=new LiquidityIndexer(config);await indexer.open();await indexer.cycle();
  const initial=await indexer.store.snapshot();assert.equal(Object.keys(initial.state.liquidity!.makers).length,6);
  const legacy=new AccountStore(databaseUrl,config.runId);
  try{await assert.rejects(()=>legacy.snapshot(),/Incompatible projection schema/);}finally{await legacy.close();}
  await indexer.close();indexer=undefined;
  await setup.qualify();await h.send('P33 route fill while indexer stopped',[await trade()],[owner]);
  const withdrawal=sdk.getWithdrawFundedAccountInstruction({...setup.common,owner,btc:setup.markets[0],eth:setup.markets[1],margin,
    quoteMint:setup.mint.address,userToken:setup.traderToken.address,guard:await guard(margin),amount:1n});
  const before=await root(margin);
  await h.send('P33 reverted CPI excludes provisional withdrawal',[withdrawal,withdrawal],[owner],sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);
  assert.deepEqual(await root(margin),before);await flush();
  indexer=new LiquidityIndexer(config);await indexer.open();await indexer.cycle();
  const snapshot=await indexer.store.snapshot(),reconciliation=await indexer.reconcile();
  await indexer.cycle();assert.deepEqual((await indexer.store.snapshot()).state,snapshot.state);
  const api=accountApi(indexer);
  try {
    assert.equal((await api.inject({url:'/v3/venue'})).statusCode,404);
    const venue=await api.inject({url:'/v4/venue'});assert.equal(venue.statusCode,200);
    assert.equal(venue.json().schemaVersion,4);assert.equal(venue.json().fundingTrust,'restricted-publisher-attestation');
    const fills=await api.inject({url:'/v4/trades?latest=true'});assert.equal(fills.statusCode,200);assert.equal(fills.json().items.length,2);
    indexer.healthy=false;assert.equal((await api.inject({url:'/v4/venue'})).statusCode,503);indexer.healthy=true;
  }finally{await api.close();}
  await indexer.store.pool.query('CREATE DATABASE rivalt_p33_replay');
  const replayUrl=new URL(databaseUrl);replayUrl.pathname='/rivalt_p33_replay';
  replay=new LiquidityIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p33-fresh-replay'});
  await replay.open();await replay.cycle();assert.deepEqual((await replay.store.snapshot()).state,snapshot.state);
  const counts=(await indexer.store.pool.query(`SELECT
    (SELECT count(*) FROM transactions WHERE run_id=$1) AS transactions,
    (SELECT count(*) FROM transactions WHERE run_id=$1 AND failed) AS failed,
    (SELECT count(*) FROM events WHERE run_id=$1) AS events,
    (SELECT count(*) FROM outbox WHERE run_id=$1) AS outbox,
    (SELECT count(*) FROM jobs WHERE run_id=$1 AND status IN ('pending','unresolved')) AS unresolved`,[config.runId])).rows[0];
  assert.equal(counts.events,snapshot.state.sequence);assert.equal(counts.outbox,counts.events);assert.equal(counts.unresolved,'0');
  // Independently expected two one-lot fills: cumulative 26-atom fees, 6 reserve,
  // 20 protocol and remainder 2. This is not an implementation-derived oracle.
  const ledger=snapshot.state.ledgers[setup.ledgers[0]];
  assert.deepEqual([ledger.insurance,ledger.fees,ledger.insuranceFeeRemainder],['6','20',2]);
  assert.equal(Object.values(snapshot.state.roots).reduce((sum,value)=>sum+BigInt(value.cash),0n)+26n,8_000_000n);
  const summary={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    trackedDirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',
    build:JSON.parse(readFileSync('.local/liquidity-execution/build-manifest.json','utf8')),checks,
    binding:snapshot.binding,counts,reconciliation,state:snapshot.state,metrics:indexer.metrics,replayMetrics:replay.metrics,
    scope:'P33 finalized projection slice; durable workers and browser acceptance remain separate',phaseAcceptance:false};
  writeFileSync(`${runDir}/summary.json`,json(summary));console.log(json({stage:'p33-indexer-pass',counts,reconciliation,phaseAcceptance:false}));
}finally{await replay?.close();await indexer?.close();try{await flush();}finally{ws.close();}}
