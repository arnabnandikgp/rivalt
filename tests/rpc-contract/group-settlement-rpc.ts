/** Fresh P21A mixed-mode funding/ordinary settlement; all collateral and actors are test-only. */
import assert from 'node:assert/strict';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {createWriteStream,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {AccountRole,type Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {GroupIndexer,type GroupConfig} from '../../packages/indexer/src/group-indexer.js';
import {GroupRuntime} from '../../packages/services/src/group-runtime.js';
import {json} from '../../packages/indexer/src/events.js';
import {groupRuntimeHarness} from './group-runtime-harness.js';
import {groupSafetyCases} from './group-safety-cases.js';
import {eventually} from './wire.js';

const SCALE=1_000_000_000n,directory=process.env.RIVALT_RUN_DIR!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=()=>Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()),startedDirty=dirty();
const transport=await groupRuntimeHarness(process.env.RIVALT_RPC_URL!,directory);
const setup=await groupSafetyCases(transport.harness,async()=>{},{namespace:'p21-settlement',setupOnly:true}),fixture=setup.fixture;
await setup.certificate();await transport.send('activate cross service test group',[sdk.getActivateCrossGroupV2Instruction({...fixture.safety,authority:fixture.payer})]);
await transport.send('fund cross settlement account',[await setup.cashInstruction(fixture.cross,1_000_000n,false)],[fixture.owner]);
async function route(index:0|1,side:0|1,root:Address){
  const quoted=await setup.route(index,side,[5n,5n],side===1,root);
  const {intent}=sdk.getExecuteGroupRouteV2InstructionDataDecoder().decode(quoted.instruction.data!);
  await transport.send(`actual ${root===fixture.cross?'cross':'isolated'} ${index} ${side===0?'open':'close'}`,[{...quoted.instruction,
    accounts:[...quoted.instruction.accounts!,{address:fixture.markets[1-index],role:AccountRole.WRITABLE}],
    data:sdk.getExecuteMarginRouteV2InstructionDataEncoder().encode({...await fixture.stamp(),intent})}],[fixture.owner]);
}
await route(0,0,fixture.cross);await route(1,0,fixture.cross);await route(1,0,fixture.operators[0].capital[1]);
const beforeFunding=await transport.harness.read(fixture.cross);
await fixture.qualify();await transport.harness.advance(2n);
assert.deepEqual(await transport.harness.read(fixture.cross),beforeFunding,'Sampling never writes the funded cross root');
await transport.finalize();
const anchor=transport.checks.find(check=>check.label==='setup clearing group')!.signature;
const config:GroupConfig={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:process.env.RIVALT_DATABASE_URL!,
  runId:'p21-settlement',group:fixture.group,anchor,profile:'cross-safety-qualification'};
const indexer=new GroupIndexer(config),runtime=new GroupRuntime(config.databaseUrl,config.runId,config.rpcUrl);
let replay:GroupIndexer|undefined;const children:ChildProcess[]=[];
const stop=async(child:ChildProcess,signal:NodeJS.Signals='SIGTERM')=>{if(child.exitCode!==null||child.signalCode!==null)return;child.kill(signal);
  await eventually(async()=>child.exitCode!==null||child.signalCode!==null,Boolean,'owned settlement service stop');};
const signerPath=`${directory}/settlement-signer.json`;writeFileSync(signerPath,JSON.stringify(Array.from(fixture.payer.secretKey)),{mode:0o600});
function start(role:'settlement'|'executor'){
  const child=spawn(process.execPath,['--import','tsx',`packages/services/src/${role==='executor'?'group-executor-main':'group-worker-main'}.ts`],{
    cwd:process.cwd(),env:{...process.env,RIVALT_RUN_ID:config.runId,RIVALT_GROUP_ROLE:role,RIVALT_SIGNER_PATH:signerPath},stdio:['ignore','pipe','pipe']});
  const output=createWriteStream(`${directory}/${role}-${children.length}.log`);child.stdout!.pipe(output,{end:false});child.stderr!.pipe(output,{end:false});
  child.once('exit',()=>output.end());children.push(child);return child;
}
try{
  await indexer.open();await indexer.cycle();await runtime.open();
  const {binding}=await indexer.store.snapshot();
  const client=new sdk.GroupUserClient({version:2,chain:'solana:localnet',profile:'cross-safety-qualification',rpcUrl:config.rpcUrl,wsUrl:config.wsUrl,
    genesis:binding.genesis,anchor,anchorHash:binding.anchorHash,group:fixture.group,mint:fixture.mint.address,domain:binding.domain});
  const funded=await client.snapshot('confirmed'),raw=funded.roots[fixture.cross];
  const preview=client.balance(funded,fixture.cross);
  // Independent current-held-interval arithmetic. These observed source inputs
  // do not requalify the oracle's premium derivation; they qualify client accrual.
  let expectedEquity=raw.cash*SCALE;
  const fundingProof=raw.positions.map((position,index)=>{
    const market=funded.marketStates[index],observation=market.oracle;
    assert.equal(observation.status,2);assert.equal(observation.heldEpoch,market.configEpoch);
    assert(funded.slot<observation.heldSlot&&funded.now>=observation.sampledAt&&funded.now-observation.sampledAt<=30n);
    const end=funded.now<observation.heldUntil?funded.now:observation.heldUntil;
    const funding=observation.fundingBase+observation.premiumScaled*(end-observation.sampledAt)/3600n;
    const debit=position.lots*(funding-position.fundingCheckpointScaled);
    const riskClaim=position.virtualScaled-debit+position.lots*(position.lots<0n?market.upper:market.lower)*SCALE;
    expectedEquity+=riskClaim<0n?riskClaim:0n;
    assert.equal(preview.positions[index].pendingFundingDebitScaled,debit.toString());
    return {marketIndex:index,premium:observation.premiumScaled,funding,debit,checkpoint:position.fundingCheckpointScaled};
  });
  assert(fundingProof.some(proof=>proof.debit!==0n));assert.equal(preview.riskEquityScaled,expectedEquity.toString());
  assert.deepEqual(await transport.harness.read(fixture.cross),beforeFunding,'Preview also never writes root funding');
  await route(0,1,fixture.cross);await route(1,1,fixture.cross);await route(1,1,fixture.operators[0].capital[1]);
  const before=await client.snapshot('confirmed');assert(Object.values(before.roots).every(root=>root.positions.every(position=>position.lots===0n)));
  assert(Object.values(before.roots).some(root=>root.positions.some(position=>position.virtualScaled%SCALE!==0n)),'Real funding leaves owned fractions');
  // Independently derive exact permitted flat cash/claim changes, in stable
  // membership order. Whole atoms only; no positive/negative claim netting.
  const expected=structuredClone(before.roots);let pool=before.state.settlement;
  for(const margin of before.members)for(const position of expected[margin].positions){
    const root=expected[margin];if(position.virtualScaled>-SCALE)continue;
    const loss=-position.virtualScaled/SCALE,amount=loss<root.cash?loss:root.cash;
    root.cash-=amount;position.virtualScaled+=amount*SCALE;pool+=amount;
  }
  for(const margin of before.members)for(const position of expected[margin].positions){
    if(position.virtualScaled<SCALE)continue;
    const gain=position.virtualScaled/SCALE,amount=gain<pool?gain:pool;
    expected[margin].cash+=amount;position.virtualScaled-=amount*SCALE;pool-=amount;
  }
  await transport.harness.advance(21n);const stale=await client.snapshot('confirmed');
  assert(stale.marketStates.every(market=>sdk.groupSourceMode(stale.state,market,stale.now,stale.slot)==='NoCredibleBounds'));
  const firstWorker=start('settlement');
  const original=await eventually<{request_id:string;signature:string;wire:string;status:string}|undefined>(async()=>(await runtime.store.pool.query('SELECT request_id,signature,wire,status FROM service_intents WHERE run_id=$1 ORDER BY created_at LIMIT 1',[config.runId])).rows[0],value=>Boolean(value),'durable settlement intent before broadcast');assert(original);
  await stop(firstWorker,'SIGKILL');
  assert.deepEqual((await client.snapshot('confirmed')).roots,before.roots,'No executor means no fabricated settlement');
  const restarted=start('settlement');start('executor');
  const complete=(snapshot:sdk.GroupSnapshot)=>{
    if(snapshot.state.settlement!==pool||snapshot.certificate?.sequence!==snapshot.state.sequence||snapshot.certificate?.next!==snapshot.members.length)return false;
    return snapshot.members.every(margin=>snapshot.roots[margin].cash===expected[margin].cash&&snapshot.roots[margin].positions.every((position,index)=>position.virtualScaled===expected[margin].positions[index].virtualScaled));
  };
  let settled=await client.snapshot('confirmed');const settlementDeadline=Date.now()+90_000;
  while(!complete(settled)){
    assert(Date.now()<settlementDeadline,'Bounded mixed-mode settlement and complete proof');
    await delay(100);
    try{settled=await client.snapshot('confirmed');}catch(error){
      if(!(error instanceof Error)||error.message!=='Group changed during snapshot; refresh.')throw error;
    }
  }
  await stop(restarted);
  assert.equal(settled.state.allocatedVault,before.state.allocatedVault);assert.equal(settled.actualVault,before.actualVault);
  assert.equal(settled.state.fees,before.state.fees);assert.equal(settled.state.insurance,before.state.insurance);
  for(const margin of before.members){
    const initial=before.roots[margin],final=settled.roots[margin];
    assert.equal(final.cash*SCALE+final.positions.reduce((sum,position)=>sum+position.virtualScaled,0n),initial.cash*SCALE+initial.positions.reduce((sum,position)=>sum+position.virtualScaled,0n));
    final.positions.forEach((position,index)=>assert.equal(position.virtualScaled%SCALE,initial.positions[index].virtualScaled%SCALE));
  }
  const intents=(await runtime.store.pool.query('SELECT request_id,signature,wire,status,budget,result FROM service_intents WHERE run_id=$1 ORDER BY created_at',[config.runId])).rows;
  const transactions=[];let fees=0n;
  for(const intent of intents){
    const result=await eventually(()=>runtime.queue.get(intent.request_id),row=>['finalized','failed'].includes(row?.status),'settlement original finality');
    assert.equal(result.status,'finalized');
    const transaction=await transport.rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(transaction.transaction[0]===intent.wire,true);assert.equal(transaction.meta.err,null);
    fees+=BigInt(transaction.meta.fee);transactions.push({requestId:intent.request_id,signature:intent.signature,fee:transaction.meta.fee,units:transaction.meta.computeUnitsConsumed,bytes:Buffer.from(intent.wire,'base64').length});
  }
  assert.equal(intents.filter(intent=>intent.signature===original.signature).length,1);
  assert.equal(intents.find(intent=>intent.signature===original.signature)!.wire===original.wire,true);
  const budget=(await runtime.store.pool.query("SELECT cap::text,committed::text,spent::text FROM service_budgets WHERE run_id=$1 AND name='group-settlement'",[config.runId])).rows[0];
  assert.deepEqual(budget,{cap:'5000000',committed:'0',spent:fees.toString()});
  await transport.finalize();await indexer.cycle();const final=await indexer.store.snapshot(),reconciliation=await indexer.reconcile();
  await indexer.store.pool.query('CREATE DATABASE rivalt_p21_settlement_replay');const replayUrl=new URL(config.databaseUrl);replayUrl.pathname='/rivalt_p21_settlement_replay';
  replay=new GroupIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p21-settlement-replay'});await replay.open();await replay.cycle();
  assert.deepEqual((await replay.store.snapshot()).state,final.state);await replay.reconcile();
  const finishedRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  writeFileSync(`${directory}/summary.json`,json({revision,finishedRevision,trackedDirty:startedDirty||dirty()||revision!==finishedRevision,
    scope:'P21A mixed-mode pending funding and ordinary settlement checkpoint; live contention, risk/default workers and full A26A pending',
    binding,fundingProof,preview,before,expected,settled,transactions,budget,reconciliation,freshReplay:true,ws:indexer.metrics.notifications,
    workerRestart:{killed:firstWorker.pid,restarted:restarted.pid,original:original.signature},fixtureOutcomes:transport.checks.map(({history,...check})=>check)}));
  console.log(json({stage:'group-settlement-pass',transactions:transactions.length,fees,reconciliation}));
}finally{
  for(const child of children)await stop(child).catch(()=>child.kill('SIGKILL'));
  await replay?.close();await indexer.close();await runtime.close();
}
