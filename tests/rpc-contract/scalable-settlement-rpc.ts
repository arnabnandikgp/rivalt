// P54B controller qualification: actual fills/freeze, no injected financial state.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {AccountRole,getAddressEncoder,getProgramDerivedAddress,type Address,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {getMintToInstruction} from '@solana-program/token';
import {qualifySettlementRates} from './scalable-settlement-rates-rpc.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {denominatorPages} from './settlement-page-plan.js';
const directory=process.env.RIVALT_RUN_DIR!;
const serialize=(value:unknown)=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2)+'\n';
const {h,rpc,ws,checks,conformance,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:label=>label.startsWith('P54')?1_000_000:800_000});
const u64=(value:bigint)=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(value);return bytes;};
const u32=(value:number)=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
const gcd=(left:bigint,right:bigint):bigint=>{while(right!==0n)[left,right]=[right,left%right];return left;};
try {
  const setup=await liquidityExecutionSetup(h,rpc,{verifyRejections:false});
  const {root,guard,route}=executionTestHelpers(h,setup),cross=setup.roots[0],owner=setup.traderOwner;
  for(const marketIndex of [0,1] as const){
    await setup.sample();
    await h.send('P54 create actual cross exposure',[await route({trader:cross,actor:owner,marketIndex,side:0,
      makers:[setup.instances[marketIndex*3]],lots:[50n]})],[owner]);
  }
  await h.send('P54 withdraw admissible cash before adverse price change',[sdk.getWithdrawFundedAccountInstruction({...setup.common,
    btc:setup.markets[0],eth:setup.markets[1],owner,margin:cross,quoteMint:setup.mint.address,userToken:setup.traderToken.address,
    amount:400_000n,guard:await guard(cross)})],[owner]);
  await h.send('P54 mint test-only insurance contribution',[getMintToInstruction({mint:setup.mint.address,
    token:setup.traderToken.address,mintAuthority:setup.payer,amount:3_000_000n})]);
  for(const marketIndex of [0,1] as const)await h.send('P54 seed actual market-specific insurance',[
    sdk.getSeedMarketInsuranceInstruction({...setup.common,reserveAuthority:setup.payer,ledger:setup.ledgers[marketIndex],donor:owner,
      donorToken:setup.traderToken.address,quoteMint:setup.mint.address,marketIndex,amount:[2_000_000n,1_000_000n][marketIndex]})],[owner]);
  setup.sourcePrices.btc=40_000_000_000n;setup.sourcePrices.eth=2_000_000_000n;await setup.fresh();
  const safety=()=>h.read(setup.safety).then(bytes=>sdk.getVenueSafetyDecoder().decode(bytes!));
  const source=()=>h.read(setup.resolution).then(bytes=>sdk.getResolutionDecoder().decode(bytes!));
  const feeds={primaryBtc:setup.feeds[0].feed,primaryCollateral:setup.feeds[1].feed,guardBtc:setup.feeds[2].feed,
    guardCollateral:setup.feeds[3].feed,primaryEth:setup.feeds[4].feed,guardEth:setup.feeds[5].feed};
  await h.send('P54 actual complete-cohort freeze',[sdk.getFreezeAccountsInstruction({...setup.safetyCommon,...feeds,caller:setup.payer,
    target:cross,safetyEpoch:(await safety()).epoch,resolutionEpoch:(await source()).epoch,emergency:false})]);
  const frozen=await source();assert.equal(frozen.stage,2);assert.equal(frozen.cursor,0);
  const registry=sdk.getVenueRegistryDecoder().decode((await h.read(setup.registry))!);const roots=registry.members;
  const rows=await Promise.all(roots.map(async key=>{const value=await root(key);return {key,root:value,cash:value.cash,claims:value.positions.map((position,index)=>
    position.lots*frozen.prices[index]*1_000_000_000n+position.virtualScaled-position.lots*(frozen.funding[index]-position.fundingCheckpointScaled))};}));
  assert(rows.some(row=>row.claims.every(claim=>claim<0n)&&row.cash>0n),'must exercise proportional double debt collection');
  const pda=async(label:string,...suffix:Uint8Array[])=> (await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,
    seeds:[Buffer.from(label),getAddressEncoder().encode(setup.venue),...suffix]}))[0];
  const prepared=await pda('prepared-settlement',u64(frozen.epoch));
  const memberPage=await pda('member-page',u64(0n));
  const nodes=await Promise.all(Array.from({length:15},(_,level)=>pda('member-index',Buffer.from([level]),u64(0n))));
  const rowPages=await Promise.all(Array.from({length:Math.ceil(roots.length/8)},(_,index)=>pda('frozen-margin-page',u64(frozen.epoch),u64(BigInt(index)))));
  const limbPages=await Promise.all([0,1,2].map(register=>pda('resolution-limbs',u64(frozen.epoch),u32(register),u64(0n))));
  const common={...setup.safetyCommon,prepared,epoch:frozen.epoch};
  const header=()=>h.read(prepared).then(bytes=>sdk.getPreparedSettlementDecoder().decode(bytes!));
  const financial=[setup.venue,setup.custody,setup.safety,setup.registry,setup.vault,...setup.markets,...setup.ledgers,...roots,setup.resolution,setup.work,...setup.pages];
  const readAll=(keys:Address[])=>Promise.all(keys.map(async key=>(await h.read(key))?.toString('base64')??null));
  const financialBefore=await readAll(financial),tracked=[...financial,prepared,memberPage,...nodes,...rowPages,...limbPages];
  const reject=async(label:string,instruction:Instruction,error=sdk.CLEARING_ERROR__RESOLUTION)=>{
    const before=await readAll(tracked);await h.send(`P54 reject ${label}`,[instruction],[],error);assert.deepEqual(await readAll(tracked),before,label);
  };
  await reject('stale frozen source revision',sdk.getInitializePreparedSettlementInstruction({...common,sourceRevision:frozen.revision-1n}));
  await h.send('P54 initialize source-bound verification',[sdk.getInitializePreparedSettlementInstruction({...common,sourceRevision:frozen.revision})]);
  for(const level of Array.from({length:15},(_,level)=>level))await h.send('P54 initialize canonical count node',[
    sdk.getInitializePreparedIndexNodeInstruction({...common,level,node:nodes[level],revision:(await header()).revision})]);
  await h.send('P54 initialize complete immutable member page',[sdk.getInitializePreparedMembersInstruction({...common,page:memberPage,revision:(await header()).revision})]);
  for(const [index,page] of rowPages.entries())await h.send('P54 initialize frozen rows',[sdk.getInitializeFrozenMarginPageInstruction({...common,page,pageIndex:BigInt(index)})]);
  for(const [register,page] of limbPages.entries())await h.send('P54 initialize bounded limb register',[sdk.getInitializeSettlementLimbPageInstruction({...common,page,register,pageIndex:0n})]);
  await reject('wrong radix level',sdk.getAdvancePreparedMembershipInstruction({...common,index:nodes[0],revision:(await header()).revision}));
  const first=sdk.getAdvancePreparedMembershipInstruction({...common,index:nodes[14],revision:(await header()).revision});
  await h.send('P54 enter root index',[first]);await reject('stale continuation replay',first);
  for(let level=13;level>=0;level--)await h.send('P54 descend canonical index',[sdk.getAdvancePreparedMembershipInstruction({...common,index:nodes[level],revision:(await header()).revision})]);
  await h.send('P54 enter complete member page',[sdk.getAdvancePreparedMembershipInstruction({...common,index:memberPage,revision:(await header()).revision})]);
  const value=async(index:number)=>sdk.getValuePreparedMemberInstruction({...common,members:memberPage,margin:roots[index],
    page:rowPages[Math.floor(index/8)],revision:(await header()).revision});
  await reject('omitted first root',await value(1));
  let cashPrefix=0n;const positive=[0n,0n],negative=[0n,0n];
  for(const [index,row] of rows.entries()){
    const instruction=await value(index);await h.send('P54 value actual whole-account claims',[instruction]);
    const page=sdk.getFrozenMarginPageDecoder().decode((await h.read(rowPages[Math.floor(index/8)]))!),entry=page.rows[index%8];
    assert.equal(entry.member,row.key);assert.equal(entry.id,BigInt(index));assert.equal(entry.originalRevision,row.root.revision);
    assert.equal(entry.cash,row.cash);assert.deepEqual(entry.claims,row.claims);assert.deepEqual(entry.lots,row.root.positions.map(position=>position.lots));
    const debt=row.claims.reduce((sum,claim)=>sum+(claim<0n?-claim:0n),0n)/1_000_000_000n;
    assert.equal(entry.collected,row.cash<debt?row.cash:debt);
    cashPrefix+=row.cash;for(let market=0;market<2;market++){if(row.claims[market]>=0n)positive[market]+=row.claims[market];else negative[market]-=row.claims[market];}
    const checkpoint=Buffer.from((await header()).state.valuation);assert.equal(checkpoint.readBigUInt64LE(16),BigInt(index+1));
    if(index===0)await reject('duplicate valued root',instruction);
  }
  assert.equal(cashPrefix,frozen.cashBefore);assert.deepEqual(positive,negative.map((value,index)=>value+frozen.poolsBefore[index]*1_000_000_000n));
  for(let level=0;level<15;level++)await h.send('P54 close complete ancestor count',[sdk.getAdvancePreparedMembershipInstruction({...common,index:nodes[level],revision:(await header()).revision})]);
  assert.equal((await header()).stage,2);
  let expectedCommon=1n,accepted=0,continuations=0;
  while((await header()).stage===2){
    const current=await header(),checkpoint=Buffer.from(current.state.denominator);
    if(checkpoint[1]===1){
      const ordinal=Number(checkpoint.readBigUInt64LE(16));assert.equal(ordinal,accepted);
      const row=rows[ordinal],debts=row.claims.map(claim=>claim<0n?-claim:0n),total=debts[0]+debts[1];
      const collected=row.cash<total/1_000_000_000n?row.cash:total/1_000_000_000n;
      const divisor=collected&&debts.every(value=>value>0n)?total/gcd(total,collected*1_000_000_000n*debts[0]):1n;
      expectedCommon=expectedCommon/gcd(expectedCommon,divisor)*divisor;
      await h.send('P54 accept exact next frozen denominator row',[sdk.getAcceptDenominatorRowInstruction({...common,
        revision:current.revision,page:rowPages[Math.floor(ordinal/8)]})]);accepted++;
    }else{
      const requests=denominatorPages(checkpoint);assert(requests.every(request=>request.index===0n),'bounded live fixture uses one page/register');
      const revisions=await Promise.all(requests.map(async request=>sdk.getSettlementLimbPageDecoder().decode((await h.read(limbPages[request.register]))!).revision));
      while(revisions.length<3)revisions.push(0n);
      const instruction=sdk.getContinueSettlementDenominatorInstruction({...common,revision:current.revision,steps:continuations%3===0?1:continuations%3===1?7:128,revisions});
      const full={...instruction,accounts:[...instruction.accounts,...requests.map(request=>({address:limbPages[request.register],role:request.writable?AccountRole.WRITABLE:AccountRole.READONLY}))]};
      if(continuations===0){
        await reject('missing limb page',instruction);
        const before=await readAll(tracked);await h.send('P54 atomic second continuation failure rolls back first',[full,full],[],sdk.CLEARING_ERROR__RESOLUTION);assert.deepEqual(await readAll(tracked),before);
      }
      await h.send('P54 bounded arithmetic continuation',[full]);continuations++;assert(continuations<1000);
    }
    const next=await header(),state=Buffer.from(next.state.denominator);
    if(state[1]===1||state[1]===3){
      const page=sdk.getSettlementLimbPageDecoder().decode((await h.read(limbPages[state[2]]))!);
      const used=Number(state.readBigUInt64LE(24));assert(used<=256);
      assert.equal(page.payload.words.slice(0,used).reduceRight((value,word)=>(value<<64n)+word,0n),expectedCommon);
    }
  }
  assert.equal(accepted,roots.length);assert.equal((await header()).stage,3);
  assert.deepEqual(await readAll(financial),financialBefore,'verification never changes financial ownership');
  const stale=sdk.getAcceptDenominatorRowInstruction({...common,revision:(await header()).revision,page:rowPages[0]});
  await reject('completed denominator cannot replay',stale);
  const rateResult=await qualifySettlementRates({h,setup,prepared,epoch:frozen.epoch,rows,rowPages,limbPages,tracked,reject,expectedCommon});
  assert.deepEqual(await readAll(financial),financialBefore,'rate verification and insurance planning never mutate financial ownership');
  await flush();
  const accountKeys=[{name:'settlementRates',key:rateResult.rates},{name:'preparedSettlement',key:prepared},{name:'memberPage',key:memberPage},
    ...nodes.map(key=>({name:'memberIndexNode',key})),...rowPages.map(key=>({name:'frozenMarginPage',key})),...limbPages.map(key=>({name:'settlementLimbPage',key}))]
    .map(entry=>({program:sdk.CLEARING_PROGRAM_ADDRESS,...entry}));
  const parity=await conformance.finish(directory,accountKeys,h.read);
  const rent=await Promise.all(accountKeys.map(async entry=>({name:entry.name,key:entry.key,lamports:String((await rpc.call('getAccountInfo',[entry.key,{encoding:'base64',commitment:'finalized'}])).value.lamports)})));
  const result={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    trackedDirty:!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),
    build:JSON.parse(readFileSync(`${process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR}/build-manifest.json`,'utf8')),checks,parity,rent,
    count:roots.length,continuations,common:expectedCommon,rows,prepared:await header(),rateResult,limitations:['source bridge <=64','no Apply or expanded trading','no PostgreSQL replay in this verification-only probe']};
  writeFileSync(`${directory}/result.json`,serialize(result));console.log(serialize({checks:checks.length,continuations,rateContinuations:rateResult.continuations,rateEvaluations:rateResult.reference.evaluations.length,common:expectedCommon,parity}));
}finally{await flush();await ws.close();}
