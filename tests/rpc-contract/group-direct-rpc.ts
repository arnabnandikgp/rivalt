import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import type {Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {GroupIndexer,type GroupConfig} from '../../packages/indexer/src/group-indexer.js';
import {groupApi} from '../../packages/indexer/src/group-api.js';
import {json} from '../../packages/indexer/src/events.js';
import {groupRuntimeHarness} from './group-runtime-harness.js';
import {groupSafetyCases} from './group-safety-cases.js';
import {eventually} from './wire.js';

const directory=process.env.RIVALT_RUN_DIR!,revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=()=>Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim());
const startedDirty=dirty(),transport=await groupRuntimeHarness(process.env.RIVALT_RPC_URL!,directory);
const setup=await groupSafetyCases(transport.harness,async()=>{},{namespace:'p21-direct',setupOnly:true});
const fixture=setup.fixture;
await setup.certificate();
await transport.send('configure qualified cross SDK test group',[sdk.getActivateCrossGroupV2Instruction({...fixture.safety,authority:fixture.payer})]);
await transport.finalize();
const anchor=transport.checks.find(check=>check.label==='setup clearing group')!.signature;
const config:GroupConfig={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:process.env.RIVALT_DATABASE_URL!,
  runId:'p21-direct-sdk',group:fixture.group,anchor,profile:'cross-safety-qualification'};
const indexer=new GroupIndexer(config);let replay:GroupIndexer|undefined,app:ReturnType<typeof groupApi>|undefined;
try{
  await indexer.open();await indexer.cycle();
  const {binding}=await indexer.store.snapshot();
  const client=new sdk.GroupUserClient({version:2,chain:'solana:localnet',profile:'cross-safety-qualification',rpcUrl:config.rpcUrl,wsUrl:config.wsUrl,
    genesis:binding.genesis,anchor,anchorHash:binding.anchorHash,group:fixture.group,mint:fixture.mint.address,domain:binding.domain});
  app=groupApi(indexer);const url=await app.listen({host:'127.0.0.1',port:0});
  assert.equal((await fetch(`${url}/v2/group`)).status,200);await app.close();app=undefined;
  await assert.rejects(()=>fetch(`${url}/v2/group`));
  const outcomes:{label:string;signature:string;fee:string;bytes:number;computeUnits:number;wire:string}[]=[];
  async function signed(label:string,instructions:Instruction[],owner:Keypair=fixture.owner){
    const prepared=await client.prepare(label,owner.address,instructions);
    await prepared.transaction.sign([owner]);const intent=await client.signed(prepared,prepared.transaction);
    // Save the exact signed message before any direct broadcast.
    writeFileSync(`${directory}/sdk-intent-${outcomes.length}.json`,json(intent));
    await client.broadcast(intent);
    const reconciled=await eventually(()=>client.reconcile(intent),result=>['failed','finalized'].includes(result.status),label);
    assert.equal(reconciled.status,'finalized',`${label}: ${reconciled.error}`);
    const canonical=await transport.rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(canonical.transaction[0],intent.wire);assert.equal(canonical.meta.err,null);assert.equal(String(canonical.meta.fee),reconciled.fee);
    writeFileSync(`${directory}/sdk-finalized-${outcomes.length}.json`,json(canonical));
    outcomes.push({label,signature:intent.signature,fee:reconciled.fee!,bytes:Buffer.from(intent.wire,'base64').length,computeUnits:canonical.meta.computeUnitsConsumed,wire:intent.wire});
  }
  const baseline=await client.snapshot(),token=fixture.operators[0].token.address;
  const tokenAmount=async()=>{
    const value=await transport.rpc.call('getAccountInfo',[token,{encoding:'base64',commitment:'finalized'}]);
    return Buffer.from(value.value.data[0],'base64').readBigUInt64LE(64);
  };
  const initialToken=await tokenAmount();
  await signed('SDK create owner portfolio',[await client.createPortfolio(fixture.owner.address,2)]);
  await signed('SDK register cross account',[await client.register(fixture.owner.address,2,0)]);
  await signed('SDK register isolated ETH account',[await client.register(fixture.owner.address,2,1,1)]);
  const [portfolio]=await sdk.findPortfolioPda({group:fixture.group,owner:fixture.owner.address,index:2});
  const [cross]=await sdk.findMarginPda({portfolio,subaccountIndex:0}),[isolated]=await sdk.findMarginPda({portfolio,subaccountIndex:1});
  for(const margin of [cross,isolated])await signed('SDK deposit funded cash',[await client.deposit(await client.snapshot(),fixture.owner.address,margin,token,50_000n)]);
  // Fixture publishers provide real signed sources; user actions still use the direct SDK.
  await fixture.qualify();
  for(const [marketIndex,margin] of [[0,cross],[1,isolated]] as const){
    const snapshot=await client.snapshot();
    await signed('SDK place market-bound durable order',[await client.manageOrder(snapshot,fixture.owner.address,margin,marketIndex,
      sdk.groupOrderAction('Place',{expectedId:1n,terms:{side:0,lots:1n,limit:marketIndex===0?61_000n:31_000n,feeBudget:100n,startSlot:snapshot.slot,
        expirySlot:snapshot.slot+1200n,trigger:0,threshold:0n,reduceOnly:false,generation:0n}}))]);
  }
  let snapshot=await client.snapshot();
  await signed('SDK grant account-scoped delegate',[await client.setDelegate(snapshot,fixture.owner.address,cross,fixture.operators[1].owner.address,snapshot.slot+1200n)]);
  await transport.harness.advance(21n);
  snapshot=await client.snapshot();
  assert(snapshot.marketStates.every(market=>sdk.groupSourceMode(snapshot.state,market,snapshot.now,snapshot.slot)==='NoCredibleBounds'));
  const crossOrder=snapshot.roots[cross].book.orders.find(entry=>entry.order.id===1n)!.order;
  await signed('SDK delegated cross cancellation with API stopped and sources stale',[
    await client.cancel(snapshot,fixture.operators[1].owner.address,cross,1n,crossOrder.version)],fixture.operators[1].owner);
  snapshot=await client.snapshot();const isolatedOrder=snapshot.roots[isolated].book.orders.find(entry=>entry.order.id===1n)!.order;
  await signed('SDK isolated cancellation with API stopped and sources stale',[await client.cancel(snapshot,fixture.owner.address,isolated,1n,isolatedOrder.version)]);
  await signed('SDK revoke trading delegate',[await client.setDelegate(await client.snapshot(),fixture.owner.address,cross,
    '11111111111111111111111111111111' as typeof cross,0n)]);
  for(let attempts=0;;attempts++){
    assert(attempts<4,'Bounded complete-group allocation proof');snapshot=await client.snapshot();
    const plan=await client.transfer(snapshot,fixture.owner.address,cross,isolated,17n);
    await signed(plan.verificationOnly?'SDK complete-group allocation page':'SDK explicit same-owner cash allocation',plan.instructions);
    if(!plan.verificationOnly)break;
  }
  for(const margin of [cross,isolated]){
    for(let attempts=0;;attempts++){
      assert(attempts<4,'Bounded complete-group exit proof');snapshot=await client.snapshot();
      const plan=await client.exit(snapshot,fixture.owner.address,margin,token,5n);
      await signed(plan.verificationOnly?'SDK complete-group exit page':'SDK funded cash withdrawal with API stopped',plan.instructions);
      if(!plan.verificationOnly)break;
    }
  }
  snapshot=await client.snapshot();
  // Literal arithmetic independent of preview and event projection: 50,000 each,
  // explicit 17 atom allocation and 5 atoms of withdrawal per account; no fills.
  assert.equal(snapshot.roots[cross].cash,49_978n);assert.equal(snapshot.roots[isolated].cash,50_012n);
  assert.equal(snapshot.actualVault-baseline.actualVault,99_990n);assert.equal(initialToken-await tokenAmount(),99_990n);
  assert.equal(snapshot.state.totalCash-baseline.state.totalCash,99_990n);
  assert.equal(snapshot.state.settlement,baseline.state.settlement);assert.equal(snapshot.state.fees,baseline.state.fees);
  for(const margin of [cross,isolated]){
    assert.equal(snapshot.roots[margin].reserved,0n);assert(snapshot.roots[margin].positions.every(position=>position.lots===0n&&position.virtualScaled===0n));
    assert(snapshot.roots[margin].book.orders.every(entry=>![1,2].includes(entry.order.state)));
  }
  await transport.finalize();await indexer.cycle();const final=await indexer.store.snapshot(),reconciliation=await indexer.reconcile();
  assert.equal(final.state.roots[cross].cash,'49978');assert.equal(final.state.roots[isolated].cash,'50012');
  assert(indexer.metrics.notifications>0);
  await indexer.store.pool.query('CREATE DATABASE rivalt_p21_direct_replay');
  const replayUrl=new URL(config.databaseUrl);replayUrl.pathname='/rivalt_p21_direct_replay';
  replay=new GroupIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p21-direct-replay'});await replay.open();await replay.cycle();
  assert.deepEqual((await replay.store.snapshot()).state,final.state);await replay.reconcile();
  const finishedRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  writeFileSync(`${directory}/summary.json`,json({revision,finishedRevision,trackedDirty:startedDirty||dirty()||revision!==finishedRevision,
    scope:'P21A direct SDK account/order/cash checkpoint, no route/default-worker or P21B acceptance',binding,
    apiStopped:true,staleCancellation:true,flatStaleFundedExit:true,outcomes,reconciliation,ws:indexer.metrics.notifications,
    oracleFixtureAndSetup:transport.checks.map(({history,...check})=>check),sdkFees:outcomes.reduce((sum,outcome)=>sum+BigInt(outcome.fee),0n),
    exactCash:{cross:'49978',isolated:'50012',tokenDelta:'99990',vaultDelta:'99990',venueFees:'0'},freshReplay:true}));
  console.log(json({stage:'direct-sdk-group-lifecycle-pass',walletTransactions:outcomes.length,reconciliation}));
}finally{await app?.close();await replay?.close();await indexer.close();}
