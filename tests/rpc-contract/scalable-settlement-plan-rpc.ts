// Signed construction acceptance. The native helper only transports next-page
// requests; an independent Fraction/graph oracle supplies financial expectations.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {AccountRole,getAddressEncoder,getProgramDerivedAddress,type Address,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import type {ExpectedInstructionError} from './instruction-errors.js';
type Reference={orders:string[][];cash:string[];movements:string[][];floors:string[][];fractions:boolean[][];localOrders:number[][]};
export async function qualifySettlementPlan(options:{h:CanonicalHarness;
  setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>;prepared:Address;rates:Address;epoch:bigint;
  rows:{cash:bigint;claims:bigint[]}[];rowPages:Address[];limbPages:Address[];tracked:Address[];
  reject:(label:string,instruction:Instruction,error?:ExpectedInstructionError)=>Promise<void>}) {
  const {h,setup,prepared,rates,epoch,rows,rowPages,limbPages,tracked,reject}=options;
  const preparedBytes=(await h.read(prepared))!,rateBytes=(await h.read(rates))!;
  const header=sdk.getPreparedSettlementDecoder().decode(preparedBytes),count=BigInt(rows.length);
  const expected=JSON.parse(execFileSync('python3',['tests/financial/settlement_rpc_reference.py'],{
    input:JSON.stringify({rows,pools:header.pools,insurance:header.insurance},(_,value)=>typeof value==='bigint'?String(value):value),encoding:'utf8'
  })).plan as Reference;
  const le64=(value:bigint)=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(value);return bytes;};
  const le32=(value:number)=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
  const pda=async(label:string,...suffix:Uint8Array[])=>(await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,
    seeds:[Buffer.from(label),getAddressEncoder().encode(setup.venue),...suffix]}))[0];
  const plan=await pda('settlement-plan',le64(epoch));tracked.push(plan);
  const common={...setup.safetyCommon,prepared,rates,plan,epoch};
  const state=async()=>sdk.getSettlementPlanDecoder().decode((await h.read(plan))!);
  await h.send('P54C initialize conserving plan',[sdk.getInitializeSettlementPlanInstruction(common)]);
  const pageKeys=new Map<string,Address>();limbPages.forEach((key,register)=>pageKeys.set(`${register}:0`,key));
  const extras:Address[]=[];
  const packed=(length:bigint,words:bigint)=>{const records=256n/words,last=length-1n;return last/records*256n+(last%records+1n)*words;};
  const wide=BigInt(sdk.getSettlementLimbPageDecoder().decode((await h.read(limbPages[0]))!).wordCount);
  const hierarchy=(length:bigint)=>{let words=0n;do{length=(length+63n)/64n;words+=length;}while(length>1n);return words;};
  const capacities=new Map<number,bigint>(Array.from({length:21},(_,index)=>[25+index,wide]));
  for(const [register,capacity] of [[64,packed(count,7n)],[65,packed(count+5n,9n)],[66,4n*(8n*count+6n)],
    [67,8n*count+6n],[68,hierarchy(8n*count+6n)],[69,count],[70,count]] as const)capacities.set(register,capacity);
  for(const [register,capacity] of capacities)for(let index=0n;index<(capacity+255n)/256n;index++) {
    const key=await pda('resolution-limbs',le64(epoch),le32(register),le64(index));
    tracked.push(key);extras.push(key);pageKeys.set(`${register}:${index}`,key);
    await h.send('P54C provision count-derived plan page',[sdk.getInitializeSettlementPlanPageInstruction({...common,page:key,register,pageIndex:index})]);
  }
  const requests=async(ordinal?:bigint)=>{
    const planBytes=(await h.read(plan))!;
    const output=execFileSync('target/debug/examples/settlement-plan-pages',[],{input:
      `${preparedBytes.toString('hex')}|${rateBytes.toString('hex')}|${planBytes.toString('hex')}|${ordinal===undefined?'work':ordinal}`,encoding:'utf8'}).trim();
    return output?output.split('\n').map(line=>{const [register,index,writable]=line.split(',');
      const key=pageKeys.get(`${register}:${index}`);assert(key,'preprovisioned canonical page');return {key,writable:writable==='1'};}):[];
  };
  const instruction=async(ordinal?:bigint)=>{
    const current=await state(),pages=await requests(ordinal);
    const revisions=await Promise.all(pages.map(async page=>sdk.getSettlementLimbPageDecoder().decode((await h.read(page.key))!).revision));
    while(revisions.length<3)revisions.push(0n);
    const args={...common,revision:current.revision,attempt:current.orderAttempt,revisions};
    const base=ordinal===undefined?sdk.getContinueSettlementPlanInstruction({...args,steps:128}):
      sdk.getAcceptSettlementPlanRowInstruction({...args,ordinal,page:rowPages[Number(ordinal/8n)],actor:setup.payer});
    return {base,pages,full:{...base,accounts:[...base.accounts,...pages.map(page=>({address:page.key,role:page.writable?AccountRole.WRITABLE:AccountRole.READONLY}))]}};
  };
  let continuations=0,checkedPages=false;
  const work=async()=>{
    const {base,pages,full}=await instruction();
    if(!checkedPages&&pages.length){
      await reject('plan continuation missing canonical page',base);
      await reject('stale plan revision',{...full,data:sdk.getContinueSettlementPlanInstruction({...common,
        revision:(await state()).revision-1n,attempt:(await state()).orderAttempt,steps:128,revisions:[0n,0n,0n]}).data});
      checkedPages=true;
    }
    await h.send('P54C bounded conserving work',[full]);continuations++;assert(continuations<10_000,'bounded fixture progress');
  };
  while((await state()).stage<3){
    const current=await state();
    if(current.stage===1)await work();else {
      assert([0,2].includes(current.stage));const {full}=await instruction(current.cursor);
      await h.send(current.stage===0?'P54C accept actual frozen flow row':'P54C store verified scalar flow',[full]);
      if(current.cursor===0n&&current.stage===2)await reject('completed flow storage replay',full);
    }
  }
  assert(checkedPages);
  const readFlow=async(ordinal:bigint)=>{
    const key=pageKeys.get(`64:${ordinal/36n}`)!;
    const data=sdk.getSettlementLimbPageDecoder().decode((await h.read(key))!);
    const bytes=Buffer.alloc(2048);data.payload.words.forEach((word,index)=>bytes.writeBigUInt64LE(word,index*8));
    return bytes.subarray(Number(ordinal%36n)*56,Number(ordinal%36n)*56+56);
  };
  for(let ordinal=0;ordinal<rows.length;ordinal++) {
    const bytes=await readFlow(BigInt(ordinal));assert.equal(bytes.readBigUInt64LE(0),BigInt(ordinal));
    assert.deepEqual([16,24,32].map(offset=>bytes.readBigUInt64LE(offset)),expected.floors[ordinal].map(BigInt));
    assert.deepEqual([0,1,2].map(kind=>!!(bytes[42]&(1<<kind))),expected.fractions[ordinal]);
    assert.deepEqual([...bytes.subarray(43,46)],expected.localOrders[ordinal]);
  }
  const begin=async()=>h.send('P54C begin complete market order',[sdk.getBeginSettlementPlanOrderInstruction({...common,
    actor:setup.payer,revision:(await state()).revision})]);
  await begin();let current=await state();
  await h.send('P54C reject early foreign order reset',[sdk.getResetSettlementPlanOrderInstruction({...common,
    actor:setup.traderOwner,revision:current.revision,attempt:current.orderAttempt})],[setup.traderOwner],sdk.CLEARING_ERROR__RESOLUTION);
  const deadline=Date.now()+20_000;
  while(await setup.slot()<current.lastProgressSlot+64n){assert(Date.now()<deadline);await delay(50);}
  await h.send('P54C recover stalled ordering',[sdk.getResetSettlementPlanOrderInstruction({...common,
    actor:setup.traderOwner,revision:current.revision,attempt:current.orderAttempt})],[setup.traderOwner]);
  assert.equal((await state()).stage,3);await begin();
  let checkedDuplicate=false;
  while((await state()).stage===4) {
    current=await state();const checkpoint=Buffer.from(current.work.bytes);
    if(checkpoint[1]===0){
      const position=Number(checkpoint.readBigUInt64LE(32));
      if(!checkedDuplicate&&position===1){
        const duplicate=await instruction(BigInt(expected.orders[current.orderMarket][0]));
        await reject('duplicate order ordinal with current revision',duplicate.full);checkedDuplicate=true;
      }
      const ordinal=BigInt(expected.orders[current.orderMarket][position]);
      const {full}=await instruction(ordinal);await h.send('P54C accept complete canonical order row',[full]);
      if(position===0&&current.orderMarket===0)await reject('order row replay',full);
    } else await work();
  }
  assert(checkedDuplicate);assert.equal((await state()).stage,6);current=await state();
  await reject('construction cannot reset ordering',sdk.getResetSettlementPlanOrderInstruction({...common,
    actor:setup.payer,revision:current.revision,attempt:current.orderAttempt}));
  while((await state()).stage!==8)await work();
  const arc=async(index:bigint)=>{
    const key=pageKeys.get(`66:${index/64n}`)!;
    return sdk.getSettlementLimbPageDecoder().decode((await h.read(key))!).payload.words.slice(Number(index%64n)*4,Number(index%64n)*4+4);
  };
  for(let ordinal=0;ordinal<rows.length;ordinal++){
    const bytes=await readFlow(BigInt(ordinal));assert.equal(bytes[54],3);assert.equal(bytes[55],0);
    const amounts=await Promise.all([0,1,2].map(async kind=>bytes.readBigUInt64LE(16+8*kind)+(await arc(2n*(BigInt(kind)*count+BigInt(ordinal))+1n))[2]));
    assert.equal(amounts[2],BigInt(expected.cash[ordinal]));
    assert.deepEqual(amounts.slice(0,2).map((value,market)=>value*(rows[ordinal].claims[market]<0n?-1n:rows[ordinal].claims[market]>0n?1n:0n)),expected.movements[ordinal].map(BigInt));
  }
  current=await state();
  await reject('ready plan cannot continue',sdk.getContinueSettlementPlanInstruction({...common,revision:current.revision,
    attempt:current.orderAttempt,steps:1,revisions:[0n,0n,0n]}));
  return {plan,extras,continuations,expected,state:current};
}
