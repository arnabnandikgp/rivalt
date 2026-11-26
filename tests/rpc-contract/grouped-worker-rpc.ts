import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {getTokenDecoder} from '@solana-program/token';
import type {Address,Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {registerTestMarginForActivation} from './account-membership-setup.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {coverageProvisioning,appendCoverage} from './coverage-provisioning.js';
import {routerBuild} from './execution-router-build.js';
import {groupedWorkerDriver} from './grouped-worker-driver.js';
import {payerKey} from './harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {initializationSignature} from './liquidity-journal.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const url=process.env.RIVALT_RPC_URL!,wsUrl=process.env.RIVALT_WS_URL!,dir=process.env.RIVALT_RUN_DIR!;
const population=Number(process.env.RIVALT_GROUPED_WORKER_MEMBERS??1000);
assert([64,1000].includes(population));
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const build=routerBuild(),payer=await payerKey();
assert.equal(build.artifactSet,sdk.GROUPED_CREDIT_ARTIFACT_SET);
const payers=new Map<string,typeof payer>();
const {rpc,ws,h:transport,checks,flush}=await openCanonicalRpcHarness(url,wsUrl,dir,{
  deferFinality:true,payerFor:label=>payers.get(label),heapSize:()=>128*1024,
  computeUnitLimit:label=>label.startsWith('cross ') ? 600_000 : label==='blocked payout' ? 1_400_000 : undefined});
const {h,members}=coverageProvisioning(transport,payer);
let worker:Awaited<ReturnType<typeof groupedWorkerDriver>>|undefined;
let traffic:Promise<void>|undefined,offer=false;
try {
  const traderCount=population-6;
  const setup=await liquidityExecutionSetup(h,rpc,{traderCount,recoveryCapacity:population+1,
    shape:symmetricPayoutShape,marginLayout:'ledger-lanes',marketCheckpoints:true,verifyRejections:false,
    makerCash:100_000_000n,traderDeposits:Array.from({length:traderCount},(_,i)=>i>0&&i%9===0?32_000n:1_000_000n)});
  const {roots,markets,venue,ledgers,traderOwners}=setup;
  const maker=setup.instances[3], recipient=maker.capital, common={...setup.common,btc:markets[0],eth:markets[1]};
  const {root,guard,route,withCheckpoints}=executionTestHelpers(h,setup);
  const scale=1_000_000_000n, gain=40n;
  const balance=async(key:Address)=>getTokenDecoder().decode((await h.read(key))!).amount;
  const pool=async()=>sdk.getMarketLedgerDecoder().decode((await h.read(ledgers[1]))!).settlement;
  const walletStart=await balance(maker.token.address),cashStart=(await root(recipient)).cash;
  const [certificate]=await sdk.deriveSettlementCertificate(venue,1);
  async function trade(label:string,index:number,market:0|1,side:0|1,lots:bigint,provider:number,serial=false) {
    const actor=traderOwners[index],margin=roots[index],counter=setup.instances[provider];
    const ix=await route({trader:margin,actor,marketIndex:market,side,lots:[lots],makers:[counter],marketLane:!serial,minimalMarkets:true});
    payers.set(label,actor);
    await h.send(label,[...serial?(await withCheckpoints(ix)).slice(0,-1):[],
      appendCoverage(ix,[members.get(margin)!,members.get(counter.capital)!])],[actor]);
  }
  const finance=async(ix:Instruction,margin:Address)=>[...(await withCheckpoints(ix)).slice(0,-1),appendCoverage(ix,[members.get(margin)!])];
  async function withdraw(label:string,margin:Address,owner:typeof payer,token:Address,amount:bigint) {
    payers.set(label,owner);
    await h.send(label,await finance(sdk.getWithdrawFundedAccountInstruction({...common,owner,margin,userToken:token,
      quoteMint:setup.mint.address,guard:await guard(margin),amount}),margin),[owner]);
  }
  async function closeClaim(label:string) {
    await trade(label+' open',0,1,0,10n,3);
    await trade(label+' close',0,1,1,10n,3);
    const closedAt=Date.now();
    const earned=(await root(recipient)).positions[1];
    assert.deepEqual([earned.lots,earned.virtualScaled],[0n,gain*scale]);
    return closedAt;
  }
  await flush();
  const anchor=await initializationSignature(rpc,checks.map(row=>String(row.signature)),setup.deployment.eventAuthority);
  worker=await groupedWorkerDriver(url,wsUrl,process.env.RIVALT_DATABASE_URL!,venue,anchor,payer,rpc,ws);
  await worker.ready();console.log('Published',population,'financial members');
  const service=worker;
  let refreshed=0;
  async function refresh(){await setup.sample();refreshed=Date.now();}
  const timings:{phase:string;closedAt:number;fundedAt:number;eligibleAt:number;creditedAt:number;withdrawnAt:number}[]=[];
  async function tickUntil(label:string,condition:()=>Promise<boolean>,onTick?:()=>Promise<void>){
    const deadline=Date.now()+120_000;
    while(!await condition()){
      assert(Date.now()<deadline,label+' timed out: '+json({turns:service.turns.slice(-8),probes:service.probes.slice(-3)}));
      if(Date.now()-refreshed>2500)await refresh();
      await service.tick();await onTick?.();await delay(100);
    }
  }
  async function autoExit(phase:string,closedAt:number,eligibleAt?:number) {
    let fundedAt=await pool()>=gain?Date.now():0;
    await tickUntil(phase,async()=>(await root(recipient)).cash===cashStart+gain,async()=>{
      if(!fundedAt && await pool()>=gain)fundedAt=Date.now();
    });
    const creditedAt=Date.now();
    assert(fundedAt,'Missed observation of funded pool');
    assert.equal((await root(recipient)).positions[1].virtualScaled,0n);
    await withdraw(phase+' withdraw',recipient,maker.owner,maker.token.address,gain);
    const withdrawnAt=Date.now();
    assert.equal(await balance(maker.token.address),walletStart+gain*BigInt(timings.length+1));
    assert.equal((await root(recipient)).cash,cashStart);
    timings.push({phase,closedAt,fundedAt,eligibleAt:eligibleAt??fundedAt,creditedAt,withdrawnAt});
    console.log('Worker to wallet',timings.at(-1));
  }
  await setup.qualify();
  const first=await closeClaim('ordinary');
  // Independent owner and capital. Finite offers keep their original arrival times.
  offer=true;
  let trafficError:unknown;
  traffic=(async()=>{
    for(let i=0;i<30 && offer;i++){
      await trade('traffic '+i,37,0,0,1n,2);await delay(400);
    }
  })().catch(error=>{trafficError=error;});
  await autoExit('ordinary',first);offer=false;await traffic;if(trafficError)throw trafficError;
  await flush();
  const receipt=async(label:string)=>{
    const row=checks.find(check=>check.label===label);assert(row,label);
    return rpc.call('getTransaction',[row.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
  };
  const opening=await receipt('ordinary close'),exit=await receipt('ordinary withdraw');
  const fills=await Promise.all(checks.filter(row=>String(row.label).startsWith('traffic ')).map(row=>receipt(String(row.label))));
  assert(fills.some(tx=>tx.meta.err===null && tx.slot>opening.slot && tx.slot<exit.slot),'No interior competing fill');
  const second=await closeClaim('shock');
  await h.send('fund shock claim',await finance(sdk.getCollectAccountLossInstruction({...common,actor:payer,margin:roots[0],
    marketIndex:1,amount:gain}),roots[0]));
  const fundedAt=Date.now();assert.equal(await pool(),gain);
  // Different physical lane groups miss their conservative half-cash bound at 48k.
  // At 40k each selected account actually owes more than its funded cash.
  const groups=new Set<string>();let idle:Address|undefined;
  for(let index=9;index<roots.length && groups.size<40;index+=9){
    const account=await root(roots[index]),group=String(account.id%8n)+'/'+String(account.id/128n);
    if(groups.has(group))continue;
    if(groups.size%8===0)await refresh();
    await trade('cross BTC '+index,index,0,0,2n,0);
    await trade('cross ETH '+index,index,1,0,1n,4,true);
    groups.add(group);idle??=roots[index];
  }
  assert(idle && groups.size>=4);
  const frozenDebtor=await h.read(idle);
  setup.sourcePrices.btc=40_000_000_000n;await setup.qualify();refreshed=Date.now();
  const credit=await sdk.directClosedProfitCredit({actor:payer,artifactSet:build.artifactSet,margin:await root(recipient),marketIndex:1,amount:gain});
  await h.send('blocked payout',credit,[],sdk.CLEARING_ERROR__EXIT_COHORT);
  const refused=()=>service.probes.filter(probe=>probe.log?.endsWith('covered=0') && probe.error).length;
  await tickUntil('worker sees underfunded debtor',async()=>refused()>0);
  await service.restart();
  const applicant=traderOwners.at(-1)!,portfolio=(await root(roots.at(-1)!)).portfolio;
  const [candidate]=await sdk.deriveMarginAccount(portfolio,8);
  await registerTestMarginForActivation(h,setup.common,payer,{owner:applicant,portfolio,margin:candidate,subaccountIndex:8,mode:1,isolatedMarketIndex:0,role:0});
  const departing=roots.slice(1,9).find(margin=>members.get(margin)===members.get(candidate))!;
  assert(departing);
  await refresh();
  await withdraw('vacate idle seat',departing,setup.traderOwner,setup.traderToken.address,(await root(departing)).cash);
  const change=async(margin:Address,owner:typeof payer,join:boolean)=>{
    await flush();
    const state=await sdk.readMarginMembership(rpc,venue,owner.address,margin,true,setup.identity.marginLayout);
    const input={...common,...state,owner};
    const ix=join?sdk.getActivateMarginInstruction(input):sdk.getDeactivateMarginInstruction(input);
    const instruction={...ix,accounts:[...ix.accounts,...state.remaining]};
    await h.send(join?'activate replacement':'remove empty seat',[join?instruction:appendCoverage(instruction,[members.get(margin)!])],[owner]);
  };
  await change(departing,setup.traderOwner,false);await change(candidate,applicant,true);
  const previous=refused();await tickUntil('worker checks replacement cohort',async()=>refused()>previous);
  assert.equal((await root(candidate)).lifecycle,sdk.MEMBER_FINANCIAL);
  assert.equal((await root(recipient)).cash,cashStart);assert.equal((await root(recipient)).positions[1].virtualScaled,gain*scale);
  assert(await pool()>=gain);assert.deepEqual(await h.read(idle),frozenDebtor);
  setup.sourcePrices.btc=48_000_000_000n;await setup.qualify();refreshed=Date.now();
  const recoveredAt=Date.now();
  await autoExit('recovered',second,recoveredAt);
  timings[1].fundedAt=fundedAt;
  const receipts=await service.drain();await flush();
  const paid=receipts.filter(row=>row.amount===gain && !row.error).sort((a,b)=>a.slot-b.slot);
  assert.equal(paid.length,2);assert(new Set(paid.map(row=>row.signature)).size===2);
  const exact=Number(/exact=(\d+) covered=1/.exec(paid[1].coverage??'')?.[1]);
  assert(paid[0].slot<paid[1].slot && exact>0);
  if(population===1000)assert(exact>128 && paid[1].cu>400_000 && Number(paid[1].limit)>400_000,'Many-group automatic sizing missing');
  const refusal=await receipt('blocked payout');
  assert(refusal.meta.logMessages.some((line:string)=>line.includes('members='+population) && line.endsWith('covered=0')));
  assert.equal(await h.read(certificate),null);
  const results={revision,program:build.revision,population,groups:groups.size,timings,receipts,turns:service.turns,
    probes:service.probes,metrics:service.metrics,competingSlots:fills.map(tx=>tx.slot),exact};
  writeFileSync(dir+'/worker-financial.json',json(results));
  await worker.close();worker=undefined;
  const journal=await openSettlementJournal(rpc,setup,checks.map(row=>String(row.signature)),build);
  const replay=await journal.finish(undefined,128);
  assert.equal(replay.state.members.length,population);assert(replay.state.members.includes(candidate));
  assert(!replay.state.members.includes(departing));
  assert.equal(BigInt(replay.state.roots[recipient].cash),cashStart);
  writeFileSync(dir+'/worker-result.json',json({...results,events:replay.events}));
  console.log('Verified automatic payout, restart, owner withdrawal and PostgreSQL replay',replay.events);
} finally {
  offer=false;await traffic;try{await worker?.close();}finally{await ws.close();}
}
