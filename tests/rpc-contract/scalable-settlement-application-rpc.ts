import assert from 'node:assert/strict';
import {AccountRole,getAddressEncoder,getProgramDerivedAddress,type Address,type Instruction} from '@solana/kit';
import {getTokenDecoder} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import type {ExpectedInstructionError} from './instruction-errors.js';

type Setup=Awaited<ReturnType<typeof liquidityExecutionSetup>>;
export async function qualifySettlementApplication(input:{h:CanonicalHarness;setup:Setup;prepared:Address;rates:Address;plan:Address;
  epoch:bigint;rowPages:Address[];rows:{key:Address;root:sdk.MarginAccount;cash:bigint;claims:bigint[]}[];
  expected:{cash:string[];movements:string[][]};tracked:Address[];
  reject:(label:string,instruction:Instruction,error?:ExpectedInstructionError)=>Promise<void>;
  checkpoint:(name:string)=>Promise<void>}) {
  const {h,setup,prepared,rates,plan,epoch,rowPages,rows,expected,tracked,reject,checkpoint}=input;
  const common={...setup.safetyCommon,prepared,rates,plan,epoch};
  const state=async()=>sdk.getSettlementPlanDecoder().decode((await h.read(plan))!);
  const source=async()=>sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const safety=async()=>sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!);
  const ledgers=async()=>Promise.all(setup.ledgers.map(async key=>sdk.getMarketLedgerDecoder().decode((await h.read(key))!)));
  const {root,guard}=executionTestHelpers(h,setup);
  const readAll=()=>Promise.all(tracked.map(async key=>(await h.read(key))?.toString('base64')??null));
  const le64=(value:bigint)=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(value);return bytes;};
  const le32=(value:number)=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
  const pageKey=async(register:number,index:bigint)=>(await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,
    seeds:[Buffer.from('resolution-limbs'),getAddressEncoder().encode(setup.venue),le64(epoch),le32(register),le64(index)]}))[0];
  const before=await source(),buckets=await ledgers();
  const initial=await state();assert.equal(initial.stage,8);
  await reject('stale adoption revision',sdk.getAdoptSettlementPlanInstruction({...common,revision:initial.revision-1n}));
  const adoption=sdk.getAdoptSettlementPlanInstruction({...common,revision:initial.revision});
  await h.send('P54C adopt exclusive verified plan',[adoption]);
  assert.equal((await source()).stage,14);assert.equal((await state()).adoptionRevision,before.revision+1n);
  await reject('adoption replay',adoption);
  await reject('legacy Apply after paged adoption',{...sdk.getAdvanceAccountResolutionInstruction({...setup.safetyCommon,
    page:setup.pages[0],epoch,stage:9,start:0,length:1}),accounts:[...sdk.getAdvanceAccountResolutionInstruction({...setup.safetyCommon,
      page:setup.pages[0],epoch,stage:9,start:0,length:1}).accounts,{address:rows[0].key,role:AccountRole.WRITABLE}]});
  await reject('order reset after adoption',sdk.getResetSettlementPlanOrderInstruction({...common,actor:setup.payer,
    revision:(await state()).revision,attempt:initial.orderAttempt}));
  await reject('distribution before all roots',sdk.getCompleteSettlementApplicationInstruction({...common,revision:(await state()).revision}));
  const make=async(ordinal:number)=>{
    const current=await state(),count=BigInt(rows.length);
    const indexes=[...new Set([0n,1n,2n].map(kind=>(2n*(kind*count+BigInt(ordinal))+1n)/64n))].sort((a,b)=>a<b?-1:1);
    const pages=await Promise.all(indexes.map(index=>pageKey(66,index)));
    const revisions=await Promise.all(pages.map(async key=>sdk.getSettlementLimbPageDecoder().decode((await h.read(key))!).revision));
    while(revisions.length<3)revisions.push(0n);
    const instruction=sdk.getApplySettlementMarginInstruction({...common,revision:current.revision,ordinal:BigInt(ordinal),
      page:rowPages[Math.floor(ordinal/8)],margin:rows[ordinal].key,flowPage:await pageKey(64,BigInt(Math.floor(ordinal/36))),revisions});
    return {bare:instruction,full:{...instruction,accounts:[...instruction.accounts,...pages.map(address=>({address,role:AccountRole.READONLY}))]}};
  };
  let remainingCash=before.cashBefore,appliedCash=0n;const movements=[0n,0n],gross=[...before.remainingGross];
  for(let ordinal=0;ordinal<rows.length;ordinal++) {
    const {bare,full}=await make(ordinal);
    if(ordinal===0) {
      await reject('missing application graph page',bare);
      await reject('skipped first application', (await make(1)).full);
      const saved=await readAll();
      await h.send('P54C atomic duplicate Apply rolls back both',[full,full],[],sdk.CLEARING_ERROR__RESOLUTION);
      assert.deepEqual(await readAll(),saved);
    }
    await h.send('P54C apply authenticated atom owner',[full]);
    await reject('applied root replay',full);
    const actual=await root(rows[ordinal].key),previous=rows[ordinal].root;
    assert.equal(actual.cash,BigInt(expected.cash[ordinal]));
    for(const field of ['nonce','stateVersion','delegateEpoch','revision'] as const)assert.equal(actual[field],previous[field]+1n);
    assert.equal(actual.book.lastOrderId,previous.book.lastOrderId);assert.equal(actual.book.lastGroupId,previous.book.lastGroupId);
    assert.equal(actual.reserved,0n);assert.equal(actual.delegateExpirySlot,0n);
    for(let market=0;market<2;market++) {
      const position=actual.positions[market];assert.equal(position.lots,0n);assert.equal(position.virtualScaled,0n);
      if(actual.mode===1&&actual.isolatedMarketIndex!==market)assert.deepEqual(position,{lots:0n,virtualScaled:0n,fundingCheckpointScaled:0n,generation:0n});
      else{assert.equal(position.fundingCheckpointScaled,before.funding[market]);assert.equal(position.generation,previous.positions[market].generation+1n);}
      movements[market]+=BigInt(expected.movements[ordinal][market]);
      const lots=previous.positions[market].lots;gross[market]-=lots<0n?-lots:lots;
    }
    remainingCash-=previous.cash;appliedCash+=actual.cash;
    const progress=await state();assert.equal(progress.cursor,BigInt(ordinal+1));assert.equal(progress.originalCashRemaining,remainingCash);
    assert.equal(progress.cashApplied,appliedCash);assert.deepEqual(progress.marketMovements,movements);
    assert.deepEqual((await Promise.all([0,1].map(setup.marketState))).map(market=>market.grossLots),gross);
    assert.deepEqual(await ledgers(),buckets,'partial Apply cannot spend buckets');
    if(ordinal===0)await checkpoint('partial-application');
  }
  assert.deepEqual(movements,before.poolsBefore.map((pool,index)=>pool+initial.insuranceSpent[index]));
  const distribution=sdk.getCompleteSettlementApplicationInstruction({...common,revision:(await state()).revision});
  await h.send('P54C distribute only complete verified market supplies',[distribution]);
  await reject('distribution replay',distribution);
  for(const [market,ledger] of (await ledgers()).entries()) {
    assert.equal(ledger.settlement,0n);assert.equal(ledger.insurance,buckets[market].insurance-initial.insuranceSpent[market]);
    assert.equal(ledger.fees,buckets[market].fees);assert.equal(ledger.insuranceFeeRemainder,buckets[market].insuranceFeeRemainder);
  }
  await checkpoint('distributed-before-reconciliation');
  await reject('terminal completion before complete reconciliation',sdk.getCompleteSettlementPlanInstruction({...common,revision:(await state()).revision}));
  for(let ordinal=0;ordinal<rows.length;ordinal++) {
    const instruction=sdk.getReconcileSettlementMarginInstruction({...common,revision:(await state()).revision,ordinal:BigInt(ordinal),
      page:rowPages[Math.floor(ordinal/8)],margin:rows[ordinal].key,flowPage:await pageKey(64,BigInt(Math.floor(ordinal/36)))});
    await h.send('P54C reconcile actual applied root',[instruction]);await reject('reconciliation replay',instruction);
  }
  const complete=sdk.getCompleteSettlementPlanInstruction({...common,revision:(await state()).revision});
  await h.send('P54C complete actual vault and cohort reconciliation',[complete]);await reject('terminal plan replay',complete);
  assert.equal((await source()).stage,11);assert.equal((await safety()).mode,3);assert.equal((await state()).stage,12);
  const token=async(key:Address)=>getTokenDecoder().decode((await h.read(key))!).amount;
  const exits=[];
  for(let ordinal=0;ordinal<rows.length;ordinal++) {
    const account=await root(rows[ordinal].key);if(account.cash===0n)continue;
    const signer=account.owner===setup.traderOwner.address?setup.traderOwner:setup.owner;
    assert.equal(account.owner,signer.address);
    const userToken=signer.address===setup.traderOwner.address?setup.traderToken.address:setup.token.address;
    const prior=[await token(setup.vault),await token(userToken)];
    await h.send('P54C withdraw real post-default SPL collateral',[sdk.getWithdrawFundedAccountInstruction({...setup.common,
      btc:setup.markets[0],eth:setup.markets[1],owner:signer,margin:rows[ordinal].key,userToken,quoteMint:setup.mint.address,
      amount:1n,guard:await guard(rows[ordinal].key)})],[signer]);
    assert.equal(await token(setup.vault),prior[0]-1n);assert.equal(await token(userToken),prior[1]+1n);
    assert.equal((await root(rows[ordinal].key)).cash,BigInt(expected.cash[ordinal])-1n);exits.push({ordinal,amount:'1'});
  }
  const sources={primaryBtc:setup.feeds[0].feed,primaryCollateral:setup.feeds[1].feed,guardBtc:setup.feeds[2].feed,
    guardCollateral:setup.feeds[3].feed,primaryEth:setup.feeds[4].feed,guardEth:setup.feeds[5].feed};
  const recover=(resume:boolean)=>sdk.getRecoverAccountsInstruction({...setup.safetyCommon,...sources,caller:setup.payer,epoch,resume});
  await reject('early resume cannot bypass recovery hold',recover(true));
  setup.sourcePrices.btc=60_000_000_000n;setup.sourcePrices.eth=3_000_000_000n;
  for(let sample=0;sample<4;sample++) {
    await setup.waitUntil(await setup.now()+2n);await setup.fresh();
    await h.send('P54C sustained independent source recovery',[recover(false)]);
  }
  await h.send('P54C explicit owner resume to custody',[recover(true)]);
  assert.equal((await source()).stage,12);assert.equal((await safety()).mode,0);
  await checkpoint('recovered-with-token-exits');
  return {exits,insuranceSpent:initial.insuranceSpent,appliedCash,movements,finalPlan:await state(),finalSource:await source()};
}
