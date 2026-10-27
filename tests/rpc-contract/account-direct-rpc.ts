import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import type {Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {AccountIndexer,type AccountConfig} from '../../packages/indexer/src/account-indexer.js';
import {accountApi} from '../../packages/indexer/src/account-api.js';
import {json} from '../../packages/indexer/src/events.js';
import {accountRuntimeHarness} from './account-runtime-harness.js';
import {accountServiceSetup} from './account-service-setup.js';
import {eventually} from './wire.js';

const directory=process.env.RIVALT_RUN_DIR!,revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=()=>Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim());
const startedDirty=dirty(),transport=await accountRuntimeHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory);
let indexer:AccountIndexer|undefined,replay:AccountIndexer|undefined,app:ReturnType<typeof accountApi>|undefined;
try {
  const setup=await accountServiceSetup(transport.h,'direct-sdk');await transport.finalize();
  const anchor=transport.checks.find(check=>check.label==='setup fresh clearing venue')!.signature as string;
  const config:AccountConfig={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:process.env.RIVALT_DATABASE_URL!,
    runId:'p27-direct-sdk',venue:setup.venue,anchor,profile:'account-safety-qualification'};
  indexer=new AccountIndexer(config);await indexer.open();await indexer.cycle();const {binding}=await indexer.store.snapshot();
  const client=new sdk.AccountUserClient({version:3,chain:'solana:localnet',profile:'account-safety-qualification',rpcUrl:config.rpcUrl,wsUrl:config.wsUrl,
    genesis:binding.genesis,anchor,anchorHash:binding.anchorHash,venue:setup.venue,mint:setup.mint.address,domain:binding.domain});
  app=accountApi(indexer);const url=await app.listen({host:'127.0.0.1',port:0});assert.equal((await fetch(`${url}/v3/venue`)).status,200);
  await app.close();app=undefined;await assert.rejects(()=>fetch(`${url}/v3/venue`));
  const outcomes:{label:string;signature:string;fee:string;bytes:number;computeUnits:number;wire:string;ackLost:boolean}[]=[];
  async function signed(label:string,instructions:Instruction[],owner:Keypair=setup.owner,ackLost=false) {
    const prepared=await client.prepare(label,owner.address,instructions);await prepared.transaction.sign([owner]);
    const intent=await client.signed(prepared,prepared.transaction);writeFileSync(`${directory}/sdk-intent-${outcomes.length}.json`,json(intent));
    const original=client.rpc.call.bind(client.rpc);
    if(ackLost)client.rpc.call=async(method,params)=>{const result=await original(method,params);if(method==='sendTransaction')throw new Error('Injected acknowledgement loss after actual submission');return result;};
    try{if(ackLost)await assert.rejects(()=>client.broadcast(intent),/acknowledgement loss/);else await client.broadcast(intent);}finally{client.rpc.call=original;}
    const reconciled=await eventually(()=>client.reconcile(intent),result=>['failed','finalized'].includes(result.status),label);
    assert.equal(reconciled.status,'finalized',`${label}: ${reconciled.error}`);
    const canonical=await transport.rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(canonical.transaction[0],intent.wire);assert.equal(canonical.meta.err,null);assert.equal(String(canonical.meta.fee),reconciled.fee);
    assert(canonical.meta.computeUnitsConsumed<=320_000,'400k wallet envelope retains 20% headroom');
    writeFileSync(`${directory}/sdk-finalized-${outcomes.length}.json`,json(canonical));
    outcomes.push({label,signature:intent.signature,fee:reconciled.fee!,bytes:Buffer.from(intent.wire,'base64').length,computeUnits:canonical.meta.computeUnitsConsumed,wire:intent.wire,ackLost});
  }
  const baseline=await client.snapshot([setup.cross]),token=setup.operators[0].token.address;
  const tokenAmount=async()=>{const value=await transport.rpc.call('getAccountInfo',[token,{encoding:'base64',commitment:'finalized'}]);return Buffer.from(value.value.data[0],'base64').readBigUInt64LE(64);};
  const initialToken=await tokenAmount();
  await signed('SDK create owner portfolio',[await client.createPortfolio(setup.owner.address,2)]);
  await signed('SDK register cross account',[await client.register(setup.owner.address,2,0)]);
  await signed('SDK register isolated ETH account',[await client.register(setup.owner.address,2,1,1)]);
  const [portfolio]=await sdk.deriveAccountPortfolio(setup.venue,setup.owner.address,2);
  const [cross]=await sdk.findMarginV3Pda(portfolio,0),[isolated]=await sdk.findMarginV3Pda(portfolio,1);
  for(const margin of [cross,isolated])await signed('SDK deposit actual funded cash',[await client.deposit(await client.snapshot([margin]),setup.owner.address,margin,token,50_000n)],setup.owner,margin===cross);
  await setup.qualify();
  for(const [marketIndex,margin] of [[0,cross],[1,isolated]] as const) {
    const snapshot=await client.snapshot([margin]);
    await signed('SDK place market-bound durable order',[await client.manageOrder(snapshot,setup.owner.address,margin,marketIndex,
      sdk.groupOrderAction('Place',{expectedId:1n,terms:{side:0,lots:1n,limit:marketIndex===0?61_000n:31_000n,feeBudget:100n,startSlot:snapshot.slot,
        expirySlot:snapshot.slot+1200n,trigger:0,threshold:0n,reduceOnly:false,generation:0n}}))]);
  }
  let snapshot=await client.snapshot([cross]);const delegate=setup.operators[1].owner;
  await signed('SDK grant account-scoped delegate',[await client.setDelegate(snapshot,setup.owner.address,cross,delegate.address,snapshot.slot+1200n)]);
  await transport.h.advance(21n);
  snapshot=await client.snapshot([cross,isolated]);
  assert(snapshot.marketStates.every(market=>sdk.oracleMode({...market,mode:2},market,snapshot.now,snapshot.slot)==='NoCredibleBounds'));
  for(const [margin,signer] of [[cross,delegate],[isolated,setup.owner]] as const) {
    snapshot=await client.snapshot([margin]);const order=snapshot.roots[margin].book.orders.find(entry=>entry.order.id===1n)!.order;
    await signed('SDK cancellation with API stopped and stale sources',[await client.cancel(snapshot,signer.address,margin,1n,order.version)],signer);
  }
  await signed('SDK revoke account delegate',[await client.setDelegate(await client.snapshot([cross]),setup.owner.address,cross,
    '11111111111111111111111111111111' as typeof cross,0n)]);
  await signed('SDK explicit same-owner allocation',[await client.transfer(await client.snapshot([cross,isolated]),setup.owner.address,cross,isolated,17n)]);
  snapshot=await client.snapshot([cross,isolated]);
  const firstExit=await client.exit(snapshot,setup.owner.address,cross,token,5n);
  const initialSequence=snapshot.custodyState.sequence;
  // A signed ordinary sample advances discovery, but the root-local cash intent
  // remains usable. No source refresh or paused sampling is needed for flat cash.
  await transport.send('unrelated sampler write after cash preparation',[sdk.getSampleAccountOracleV3Instruction(setup.sampleAccounts(0))]);
  await signed('SDK atomic funded exit survives unrelated discovery write',firstExit.instructions);
  assert((await client.snapshot([cross])).custodyState.sequence>initialSequence);
  await signed('SDK isolated atomic funded exit with API stopped',(await client.exit(await client.snapshot([isolated]),setup.owner.address,isolated,token,5n)).instructions);
  snapshot=await client.snapshot([cross,isolated]);
  assert.equal(snapshot.roots[cross].cash,49_978n);assert.equal(snapshot.roots[isolated].cash,50_012n);
  assert.equal(snapshot.actualVault-baseline.actualVault,99_990n);assert.equal(initialToken-await tokenAmount(),99_990n);
  assert.equal(snapshot.custodyState.totalCash-baseline.custodyState.totalCash,99_990n);
  assert.deepEqual(snapshot.ledgerStates,baseline.ledgerStates);
  for(const margin of [cross,isolated]) {
    const root=snapshot.roots[margin];assert.equal(root.reserved,0n);assert(root.positions.every(position=>position.lots===0n&&position.virtualScaled===0n));
    assert(root.book.orders.every(entry=>![1,2].includes(entry.order.state)));
  }
  await transport.finalize();await indexer.cycle();const final=await indexer.store.snapshot(),reconciliation=await indexer.reconcile();
  assert.equal(final.state.roots[cross].cash,'49978');assert.equal(final.state.roots[isolated].cash,'50012');assert(indexer.metrics.notifications>0);
  await indexer.store.pool.query('CREATE DATABASE rivalt_p27_direct_replay');const replayUrl=new URL(config.databaseUrl);replayUrl.pathname='/rivalt_p27_direct_replay';
  replay=new AccountIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p27-direct-replay'});await replay.open();await replay.cycle();
  assert.deepEqual((await replay.store.snapshot()).state,final.state);await replay.reconcile();
  writeFileSync(`${directory}/summary.json`,json({revision,trackedDirty:startedDirty||dirty(),scope:'P27 direct wallet SDK checkpoint; route/economics services remain pending',
    binding,apiStopped:true,staleCancellation:true,atomicFlatStaleExits:true,unrelatedSampleSurvived:true,ackLossRecovered:true,
    outcomes,reconciliation,ws:indexer.metrics.notifications,setup:transport.checks,sdkFees:outcomes.reduce((sum,outcome)=>sum+BigInt(outcome.fee),0n),
    exactCash:{cross:'49978',isolated:'50012',tokenDelta:'99990',vaultDelta:'99990',feesAndInsuranceUnchanged:true},freshReplay:true}));
  console.log(json({stage:'direct-account-sdk-pass',walletTransactions:outcomes.length,reconciliation}));
}finally{await app?.close();await replay?.close();await indexer?.close();transport.close();}
