import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import type {Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {AccountIndexer,type AccountConfig} from '../../packages/indexer/src/account-indexer.js';
import {json} from '../../packages/indexer/src/events.js';
import {accountRuntimeHarness} from './account-runtime-harness.js';
import {accountServiceSetup} from './account-service-setup.js';
import {eventually} from './wire.js';

const directory=process.env.RIVALT_RUN_DIR!,revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=()=>Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim());
const startedDirty=dirty(),transport=await accountRuntimeHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory);
let indexer:AccountIndexer|undefined,replay:AccountIndexer|undefined;
try {
  const setup=await accountServiceSetup(transport.h,'sdk-route');await transport.finalize();
  const anchor=transport.checks.find(check=>check.label==='setup fresh clearing venue')!.signature as string;
  const config:AccountConfig={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:process.env.RIVALT_DATABASE_URL!,
    runId:'p27-sdk-route',venue:setup.venue,anchor,profile:'account-safety-qualification'};
  indexer=new AccountIndexer(config);await indexer.open();await indexer.cycle();const {binding}=await indexer.store.snapshot();
  const client=new sdk.AccountUserClient({version:3,chain:'solana:localnet',profile:'account-safety-qualification',rpcUrl:config.rpcUrl,wsUrl:config.wsUrl,
    genesis:binding.genesis,anchor,anchorHash:binding.anchorHash,venue:setup.venue,mint:setup.mint.address,domain:binding.domain});
  const outcomes:unknown[]=[],captures:unknown[]=[];
  async function wallet(label:string,instructions:Instruction[],afterPrepare?:()=>Promise<void>) {
    const prepared=await client.prepare(label,setup.owner.address,instructions);await prepared.transaction.sign([setup.owner]);
    const intent=await client.signed(prepared,prepared.transaction);writeFileSync(`${directory}/wallet-intent-${outcomes.length}.json`,json(intent));
    await afterPrepare?.();await client.broadcast(intent);
    const result=await eventually(()=>client.reconcile(intent),value=>['failed','finalized'].includes(value.status),label);
    assert.equal(result.status,'finalized',`${label}: ${result.error}`);
    const history=await transport.rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(history.transaction[0],intent.wire);assert.equal(history.meta.err,null);
    const routing=instructions.some(instruction=>sdk.hex(instruction.data?.slice(0,8)??[])===sdk.hex(sdk.EXECUTE_ACCOUNT_ROUTE_DISCRIMINATOR));
    assert(history.meta.computeUnitsConsumed<=(routing?480_000:320_000),'20% measured compute headroom');
    outcomes.push({label,signature:intent.signature,bytes:Buffer.from(intent.wire,'base64').length,computeUnits:history.meta.computeUnitsConsumed,fee:result.fee});
    writeFileSync(`${directory}/wallet-finalized-${outcomes.length}.json`,json(history));
  }
  await wallet('SDK funds cross trading account',[await client.deposit(await client.snapshot([setup.cross]),setup.owner.address,setup.cross,setup.operators[0].token.address,2_000_000n)]);
  await setup.qualify();
  async function refresh() {
    // Deliberate signed sampler interleaving plus finalization may leave a >6s
    // gap. Observe the real six-second recovery instead of assuming one sample
    // restores Normal or relaxing the program's cadence/source requirements.
    for(let attempt=0;attempt<5;attempt++) {
      await transport.h.advance(2n);for(let feed=0;feed<6;feed++)await setup.publish(feed);
      for(const marketIndex of [0,1])await transport.send('refresh source and common funding between SDK routes',[sdk.getSampleAccountOracleInstruction(setup.sampleAccounts(marketIndex))]);
      const snapshot=await client.snapshot([setup.cross],'confirmed');
      writeFileSync(`${directory}/latest-recovery-snapshot.json`,json(snapshot));
      if(snapshot.marketStates.every(market=>sdk.accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot)==='Normal'))return;
    }
    throw new Error('Bounded real source recovery did not reach Normal');
  }
  // Literal independent A/B marginal sums at authenticated prices 60,000/30,000.
  // Inventory stays below each strategy's skew step, so closes use the same spread.
  const vectors=[
    {marketIndex:0 as const,side:0 as const,lots:100n,gross:6_002_790n,fee:1201n,legs:[[0,21n,1_260_420n],[1,79n,4_742_370n]] as const},
    {marketIndex:1 as const,side:1 as const,lots:1n,gross:29_990n,fee:6n,legs:[[0,1n,29_990n]] as const},
    {marketIndex:0 as const,side:1 as const,lots:100n,gross:5_997_210n,fee:1200n,legs:[[0,21n,1_259_580n],[1,79n,4_737_630n]] as const},
    {marketIndex:1 as const,side:0 as const,lots:1n,gross:30_010n,fee:7n,legs:[[0,1n,30_010n]] as const},
  ];
  for(const [index,vector] of vectors.entries()) {
    if(index>0)await refresh();
    let snapshot=await client.tradeSnapshot(setup.cross,vector.marketIndex);
    assert.equal(snapshot.marketStates[vector.marketIndex].referencePrice,vector.marketIndex===0?60_000n:30_000n);
    let stored:sdk.AccountAllocationInput['stored'];
    if(index===2) {
      const position=snapshot.roots[setup.cross].positions[0];
      await wallet('SDK installs existing-position take-profit',[await client.manageOrder(snapshot,setup.owner.address,setup.cross,0,
        sdk.groupOrderAction('Place',{expectedId:1n,terms:{side:1,lots:100n,limit:59_000n,feeBudget:10_000n,startSlot:snapshot.slot,
          expirySlot:snapshot.slot+1200n,trigger:1,threshold:59_999n,reduceOnly:true,generation:position.generation}}))]);
      snapshot=await client.tradeSnapshot(setup.cross,0);const order=snapshot.roots[setup.cross].book.orders.find(entry=>entry.order.id===1n)!.order;
      stored={id:1n,version:order.version,filled:order.filled};
    }
    writeFileSync(`${directory}/route-input-${index}.json`,json({vector,snapshot,stored}));
    const quote=await client.route({snapshot,trader:setup.cross,marketIndex:vector.marketIndex,side:vector.side,lots:vector.lots,
      maxFee:10_000n,allInLimit:vector.side===0?100_000_000n:0n,reduceOnly:index>=2,stored},stored?setup.payer.address:setup.owner.address);
    assert(quote,'Actual SDK route must be available');
    assert.equal(quote.allocation.grossQuote,vector.gross);assert.equal(quote.allocation.fee,vector.fee);
    assert.deepEqual(quote.allocation.legs.map(leg=>[leg.makerId,leg.lots,leg.grossQuote]),vector.legs);
    if(stored)await transport.send('SDK permissionless stored take-profit fill',quote.instructions.slice(1));
    else await wallet('SDK independently allocated owner route',quote.instructions,index===0?async()=>{
      // Advance only unrelated ETH discovery after the original has been signed.
      await transport.h.advance(2n);for(let feed=0;feed<6;feed++)await setup.publish(feed);
      await transport.send('unrelated ETH sampler after signed BTC route',[sdk.getSampleAccountOracleInstruction(setup.sampleAccounts(1))]);
    }:undefined);
    const after=await client.tradeSnapshot(setup.cross,vector.marketIndex),beforeRoot=snapshot.roots[setup.cross],afterRoot=after.roots[setup.cross];
    assert.equal(afterRoot.cash,beforeRoot.cash-vector.fee);assert.equal(after.custodyState.totalCash,snapshot.custodyState.totalCash-vector.fee);
    assert.equal(after.actualVault,snapshot.actualVault);
    const beforeLedger=snapshot.ledgerStates[vector.marketIndex],afterLedger=after.ledgerStates[vector.marketIndex];
    const insurance=(vector.fee+BigInt(beforeLedger.insuranceFeeRemainder))/4n;
    assert.equal(afterLedger.insurance,beforeLedger.insurance+insurance);assert.equal(afterLedger.fees,beforeLedger.fees+vector.fee-insurance);
    assert.equal(afterLedger.insuranceFeeRemainder,Number((vector.fee+BigInt(beforeLedger.insuranceFeeRemainder))%4n));
    const changes=[{key:setup.cross,lots:vector.side===0?vector.lots:-vector.lots,quote:vector.side===0?-vector.gross:vector.gross},
      ...vector.legs.map(([makerId,lots,gross])=>({key:snapshot.makers.find(maker=>maker.makerId===makerId)!.registrationState.capital,
        lots:vector.side===0?-lots:lots,quote:vector.side===0?gross:-gross}))];
    for(const change of changes) {
      const before=snapshot.roots[change.key],next=after.roots[change.key];
      if(change.key!==setup.cross)assert.equal(next.cash,before.cash,'Zero provider fee');
      for(const marketIndex of [0,1]) {
        const previous=before.positions[marketIndex],position=next.positions[marketIndex],selected=marketIndex===vector.marketIndex;
        assert.equal(position.lots,previous.lots+(selected?change.lots:0n));
        // Independent conservation equation using actual materialized funding,
        // not the route allocator or its risk preview as expected output.
        const funded=previous.virtualScaled-previous.lots*(position.fundingCheckpointScaled-previous.fundingCheckpointScaled);
        assert.equal(position.virtualScaled,funded+(selected?change.quote*1_000_000_000n:0n));
      }
    }
    const balance=client.balance(after,setup.cross);assert.equal(balance.positiveUnpaidMarginCredit,'0');assert.equal(balance.correlationDiscount,'0');
    assert.equal(balance.withdrawalStatus,'RequiresAtomicAccountChecksAndSimulation');
    captures.push({vector,before:snapshot,after,balance});
    writeFileSync(`${directory}/route-financial-capture.json`,json(captures));
  }
  const finalSnapshot=await client.snapshot([setup.cross]),root=finalSnapshot.roots[setup.cross];
  assert.equal(root.cash,1_997_586n);assert(root.positions.every(position=>position.lots===0n));assert.equal(root.reserved,0n);
  assert(root.book.orders.every(stored=>![1,2].includes(stored.order.state)));
  // Real stale maker-consumption guard, without changing user authority/economics.
  await refresh();const snapshot=await client.tradeSnapshot(setup.cross,0);
  const quote=await client.route({snapshot,trader:setup.cross,marketIndex:0,side:0,lots:1n,maxFee:100n,allInLimit:100_000n},setup.owner.address);assert(quote);
  const instruction=quote.instructions[1],data=sdk.getExecuteAccountRouteInstructionDataDecoder().decode(instruction.data!);
  await setup.reject('SDK stale maker consumed prefix rejected',[{...instruction,data:sdk.getExecuteAccountRouteInstructionDataEncoder().encode({
    ...data,legs:data.legs.map(leg=>({...leg,expectedConsumed:leg.expectedConsumed+1n}))})}],[setup.owner],6112);
  await transport.finalize();await indexer.cycle();const final=await indexer.store.snapshot(),reconciliation=await indexer.reconcile();
  assert.equal(final.state.roots[setup.cross].cash,'1997586');assert.equal(final.state.roots[setup.cross].positions[0].lots,'0');assert(indexer.metrics.notifications>0);
  await indexer.store.pool.query('CREATE DATABASE rivalt_p27_route_replay');const replayUrl=new URL(config.databaseUrl);replayUrl.pathname='/rivalt_p27_route_replay';
  replay=new AccountIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p27-route-replay'});await replay.open();await replay.cycle();
  assert.deepEqual((await replay.store.snapshot()).state,final.state);await replay.reconcile();
  writeFileSync(`${directory}/route-financial-capture.json`,json(captures));
  writeFileSync(`${directory}/summary.json`,json({revision,trackedDirty:startedDirty||dirty(),scope:'P27 direct route/risk SDK checkpoint; durable services remain pending',binding,
    outcomes,checks:transport.checks,reconciliation,ws:indexer.metrics.notifications,independentFillVectors:4,storedTpFill:true,unrelatedSamplerSurvived:true,
    makerPrefixRejected:true,finalCash:'1997586',freshReplay:true}));
  console.log(json({stage:'account-route-sdk-pass',walletTransactions:outcomes.length,independentFillVectors:4,reconciliation}));
}finally{await replay?.close();await indexer?.close();transport.close();}
