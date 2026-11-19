// Matched two-trader bursts on the pinned successor. Examine the finalized signed messages.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import type {Address} from '@solana/kit';
import {getTokenDecoder} from '@solana-program/token';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {conflicts,transactionLocks,type LockSet} from '../performance/lock-model.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {verifyProfitBuild} from './profit-attribution-build.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const directory=process.env.RIVALT_RUN_DIR!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const build=verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,false,false,false,false,'multi');
const payers=new Map<string,Keypair>();
let broadcast:((label:string)=>Promise<void>)|undefined;
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,{
  deferFinality:true,payerFor:label=>payers.get(label),beforeBroadcast:async label=>{if(payers.has(label))await broadcast!(label);},
});
type Workload='shared maker'|'distinct makers'|'distinct markets';
type Receipt={signature:string;slot:number;cu:number;bytes:number;fee:number;locks:LockSet;confirmedMs:number;finalizedMs:number};
const bursts:{workload:Workload;round:number;side:number;elapsedMs:number;overlap:string[];receipts:Receipt[]}[]=[];
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined;
try {
  const setup=await liquidityExecutionSetup(h,rpc,{independentTraders:true,traderCount:3,marginLayout:'sponsored-profit',shape:symmetricPayoutShape,verifyRejections:false});
  const {root,route,guard}=executionTestHelpers(h,setup);
  assert.equal(new Set(setup.traderOwners.map(owner=>owner.address)).size,3);
  await flush();
  const token=async(key:Address)=>getTokenDecoder().decode((await h.read(key))!).amount;
  const originalVault=await token(setup.vault),walletBefore=await token(setup.traderToken.address);
  const accounts=[...setup.roots,...setup.instances.map(maker=>maker.capital)];
  const cash=new Map(accounts.map(key=>[key,1_000_000n]));
  const virtual=new Map(accounts.map(key=>[key,[0n,0n]]));
  const fees=[0n,0n];
  const labels=new Map<string,string>([...setup.markets.map((key,i)=>[key,i===0?'BTC market':'ETH market'] as const),
    ...setup.ledgers.map((key,i)=>[key,i===0?'BTC ledger':'ETH ledger'] as const),
    ...setup.instances.flatMap((maker,i)=>[[maker.capital,`maker ${i} capital`],[maker.registration,`maker ${i} registration`]] as [string,string][])]);
  const workloads:Workload[]=['shared maker','distinct makers','distinct markets'];
  for(let round=0;round<3;round++)for(let offset=0;offset<3;offset++){
    const workload=workloads[(round+offset)%3];
    const markets=workload==='distinct markets'?[0,1] as const:[0,0] as const;
    const traders=workload==='distinct markets'?[0,2]:[0,1];
    const makerIndices=[0,workload==='shared maker'?0:workload==='distinct makers'?1:3];
    for(const side of [0,1] as const){
      await setup.sample(); // Fresh signed oracle and maker reports before each measured pair.
      const names=traders.map((_,index)=>`paired route ${round} ${workload} ${side} ${index}`);
      const instructions=await Promise.all(traders.map(async(trader,index)=>{
        const actor=setup.traderOwners[trader];payers.set(names[index],actor);
        return route({actor,trader:setup.roots[trader],marketIndex:markets[index],side,
          makers:[setup.instances[makerIndices[index]]],lots:[1n],minimalMarkets:true});
      }));
      let arrivals=0,start=0;
      let release!:()=>void,refuse!:(error:Error)=>void;
      const gate=new Promise<void>((resolve,reject)=>{release=resolve;refuse=reject;});
      void gate.catch(()=>{});
      const timeout=setTimeout(()=>refuse(new Error('Both signed originals must reach the broadcast barrier')),10_000);
      broadcast=async()=>{if(++arrivals===2){start=performance.now();release();}await gate;};
      try {
        const sends=traders.map((trader,index)=>h.send(names[index],[instructions[index]],[setup.traderOwners[trader]]).catch(error=>{
          refuse(error instanceof Error?error:new Error(String(error)));throw error;
        }));
        const outcomes=await Promise.allSettled(sends);
        for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason;
      } finally {clearTimeout(timeout);}
      const elapsedMs=performance.now()-start;
      assert.equal(arrivals,2);
      await flush();
      const receipts=await Promise.all(names.map(async(label,index)=>{
        const check=checks.find(row=>row.label===label)!;
        assert(check && check.error===null && check.ws && check.signatureWsError===null);
        const signature=String(check.signature);
        const finalized=await rpc.call('getTransaction',[signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
        assert.equal(finalized.meta.err,null);
        const wire=Buffer.from(finalized.transaction[0],'base64'),locks=transactionLocks(wire);
        assert(locks.write.includes(setup.traderOwners[traders[index]].address));
        return {signature,slot:finalized.slot,cu:finalized.meta.computeUnitsConsumed,bytes:wire.length,fee:finalized.meta.fee,
          locks,confirmedMs:Number(check.signedToConfirmedMs),finalizedMs:Number(check.signedToFinalizedMs)};
      }));
      const overlap=conflicts(receipts[0].locks,receipts[1].locks).map(conflict=>{
        assert.equal(conflict.kind,'write/write');return labels.get(conflict.address)??conflict.address;
      }).sort();
      const expected=workload==='distinct markets'?[]:['BTC market','BTC ledger',...(workload==='shared maker'?['maker 0 capital','maker 0 registration']:[])];
      assert.deepEqual(overlap,expected.sort());
      for(const [index,trader] of traders.entries()){
        const market=markets[index],mark=market===0?60_000n:30_000n;
        const quote=mark+(side===0?2n:-2n),cost=(quote+4999n)/5000n;
        const traderRoot=setup.roots[trader],makerRoot=setup.instances[makerIndices[index]].capital;
        cash.set(traderRoot,cash.get(traderRoot)!-cost);fees[market]+=cost;
        const amount=(side===0?-1n:1n)*quote*1_000_000_000n;
        virtual.get(traderRoot)![market]+=amount;virtual.get(makerRoot)![market]-=amount;
      }
      bursts.push({workload,round,side,elapsedMs,overlap,receipts});
      writeFileSync(directory+'/paired-signed-routes.json',json(bursts));
    }
  }
  for(const market of [0,1]){
    const snapshot=await setup.marketState(market);
    assert.equal(snapshot.grossLots,0n);
    assert.equal(snapshot.fundingIndexScaled,0n,'Constant symmetric quotes must have zero funding premium');
  }
  for(const key of accounts){const member=await root(key);assert.equal(member.cash,cash.get(key));
    assert.deepEqual(member.positions.map(position=>position.lots),[0n,0n]);
    assert.deepEqual(member.positions.map(position=>position.virtualScaled),virtual.get(key));}
  for(const [index,key] of setup.ledgers.entries()){
    const ledger=sdk.getMarketLedgerDecoder().decode((await h.read(key))!);
    assert.deepEqual([ledger.insurance,ledger.fees,BigInt(ledger.insuranceFeeRemainder)],[fees[index]/4n,fees[index]-fees[index]/4n,fees[index]%4n]);
  }
  assert.equal(await token(setup.vault),originalVault);
  await setup.sample();
  await h.send('withdraw funded cash following matched routes',[sdk.getWithdrawFundedAccountInstruction({...setup.common,
    btc:setup.markets[0],eth:setup.markets[1],owner:setup.traderOwner,margin:setup.roots[0],quoteMint:setup.mint.address,
    userToken:setup.traderToken.address,guard:await guard(setup.roots[0]),amount:1n})],[setup.traderOwner]);
  assert.deepEqual([await token(setup.vault),await token(setup.traderToken.address),(await root(setup.roots[0])).cash],
    [originalVault-1n,walletBefore+1n,cash.get(setup.roots[0])!-1n]);
  await flush();
  journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  const routes=journal.initialEvents.filter(event=>event.type==='LiquidityRouteExecutedV4');
  const signed=bursts.flatMap(burst=>burst.receipts.map(receipt=>receipt.signature));
  assert.deepEqual(routes.map(event=>event.signature).sort(),[...signed].sort());
  await journal.checkpoint('route-bursts-and-exit',true);
  const replay=await journal.finish();
  const result={revision,sbf:build.revision,bursts,fees,originalVault,freshEvents:replay.events,harnessChecks:checks.length};
  writeFileSync(directory+'/successor-route-locks.json',json(result));
  console.log(json({offered:signed.length,landed:signed.length,freshEvents:replay.events}));
} finally {await journal?.close();try{await flush();}finally{ws.close();}}
