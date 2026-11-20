// Reconstruct all work from the checkpoint after a client restart. No clearing
// account is writable. The independent actor/charge model supplies witnesses only.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {AccountRole,address,getAddressEncoder,getProgramDerivedAddress,type Address,type Instruction} from '@solana/kit';
import {deriveFrozenMarginPage} from '@rivalt/sdk';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {payerKey} from './harness.js';
type Witness={rates:string[][];orders:string[][]};
const dir=process.env.RIVALT_RUN_DIR!,phase=process.argv[2];
assert(phase==='start'||phase==='resume');
const dest=dir+'/search-'+phase;mkdirSync(dest);
const input=JSON.parse(readFileSync(dir+'/search-input.json','utf8')) as {
  venue:Address;prepared:Address;resolution:Address;epoch:string;revision:string;members:Address[];
  comparison:{coverage:Record<string,{witness:Witness;recovery:string|null;beatsInferior?:boolean}>;radices:number[];
    terminal:{movements:string[][];remainingInsurance:string[];retainedFees:string[]};
    tieTest?:{best:number;inferior:number;ranges:Record<string,number>};
    witnesses:Witness[];cash:Record<string,string>;assignments:number;charges:number[]}
};
const program=address('92GA4Cm7NZq8GEwY5r7zLwdLeYLuQYa79Ut9f3gAQ8U7');
const readonly=(address:Address)=>({address,role:AccountRole.READONLY});
const tag=(s:string)=>createHash('sha256').update(s).digest().subarray(0,8);
const u64=(s:string|number|bigint)=>{const out=Buffer.alloc(8);out.writeBigUInt64LE(BigInt(s));return out;};
const u128=(n:number)=>Buffer.concat([u64(n),u64(0)]);
const read128=(buf:Buffer,at:number)=>buf.readBigUInt64LE(at)+(buf.readBigUInt64LE(at+8)<<64n);
function encode(value:Witness){
  assert.equal(value.rates.length,1);assert(value.orders.every(row=>row.length===8));
  return Buffer.concat([...value.rates[0].map(u64),...value.orders.map(row=>Buffer.from(row.map(Number)))]);
}
const {h,ws,checks}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,dest,
  {instructionConformance:()=>false,heapSize:()=>256*1024,computeUnitLimit:()=>1_400_000});
const payer=await payerKey(),source=[readonly(input.prepared),readonly(input.resolution)];
const page=readonly((await deriveFrozenMarginPage(input.venue,0n))[0]);
const {radices,tieTest}=input.comparison;
const lastRadix=radices.at(-1)!;
const count=radices.reduce((product,radix)=>product*radix,1);
assert.equal(count,input.comparison.assignments);
const [btc,eth]=input.comparison.charges;
const best=tieTest?.best??btc*lastRadix+eth;
const inferior=tieTest?.inferior??best-1;
try{
  for(const proposed of [best,inferior]){
    const [search]=await getProgramDerivedAddress({programAddress:program,seeds:[
      Buffer.from('search'),getAddressEncoder().encode(payer.address),u64(proposed)]});
    const writable={address:search,role:AccountRole.WRITABLE};
    const ix=(name:string,accounts:NonNullable<Instruction['accounts']>,...args:Uint8Array[]):Instruction=>({
      programAddress:program,accounts,data:Buffer.concat([tag('global:'+name),...args])});
    const action=(name:string,...args:Uint8Array[])=>ix(name,[writable,...source],...args);
    const name=(label:string)=>label+' proposal '+proposed;
    const raw=async()=>{const value=(await h.read(search))!;assert(value);assert.deepEqual(value.subarray(0,8),tag('account:RecoverySearch'));return value;};
    const refuse=async(label:string,instruction:Instruction,code:number)=>{
      const prior=await raw();await h.send(name(label),[instruction],[],code);assert.deepEqual(await raw(),prior);};
    const winnerWitness=input.comparison.coverage[proposed];
    assert(winnerWitness.recovery);
    const [num,den='1']=winnerWitness.recovery.split('/');
    if(phase==='start'){
      await h.send(name('open independent search'),[ix('open_search',[
        {address:payer.address,role:AccountRole.WRITABLE_SIGNER},writable,...source,readonly(address('11111111111111111111111111111111'))],
        u64(proposed),u64(input.epoch),u128(proposed),encode(input.comparison.witnesses[0]))]);
      for(const [i,member] of input.members.entries()){
        await h.send(name('capture original '+i),[ix('capture_member',[writable,...source,page,readonly(member)],u64(i))]);
      }
      await h.send(name('derive all opposing pairs and debtor budgets'),[action('derive_pairs')]);
      assert.equal(read128(await raw(),72),BigInt(count));
      if(proposed===best){
        await refuse('forged incumbent rates',action('verify_incumbent',encode({...winnerWitness.witness,rates:[['1','0','0']]})),6007);
      }
      await h.send(name('verify exact incumbent'),[action('verify_incumbent',encode(winnerWitness.witness))]);
      const state=await raw();assert.equal(state[104],3);
      assert.equal(read128(state,105),BigInt(num));assert.equal(read128(state,121),BigInt(den));
      if(proposed===best){
        await refuse('premature financial verdict',action('seal_search'),6005);
        await refuse('range containing a possible winner',action('cover_range',u128(0),u128(count-1)),6006);
      }
      await h.send(name('cover initial zero-BTC prefix'),[action('cover_range',u128(0),u128(lastRadix-1))]);
    }else{
      let cursor=Number(read128(await raw(),88));assert.equal(cursor,lastRadix);
      if(proposed===best)await refuse('replayed first range',action('cover_range',u128(0),u128(lastRadix-1)),6001);
      let badRateChecked=false,defeated=false;
      while(cursor<count){
        const btcDigit=Math.floor(cursor/lastRadix);
        // Keep each interval inside its own BTC digit. Clearing calculates its
        // bound independently from both endpoints and the frozen radices.
        let end=tieTest?.ranges[cursor]??cursor-1;
        while(!tieTest && end+1<(btcDigit+1)*lastRadix && BigInt(btcDigit+(end+1)%lastRadix)*BigInt(den)<BigInt(num))end++;
        if(end>=cursor){
          await h.send(name('prove range '+cursor+' through '+end),[action('cover_range',u128(cursor),u128(end))]);
          cursor=end+1;continue;
        }
        const candidate=input.comparison.coverage[cursor];assert(candidate);
        const leaf=(w:Witness)=>action('cover_plan',u128(cursor),encode(w));
        if(proposed===best && !badRateChecked && cursor!==proposed){
          await refuse('invalid challenger rates cannot discard a schedule',leaf({...candidate.witness,rates:[['1','0','0']]}),6007);
          badRateChecked=true;
        }
        const [otherNum,otherDen='1']=(candidate.recovery??'0').split('/');
        const better=tieTest?proposed===inferior && candidate.beatsInferior:
          candidate.recovery!==null && BigInt(otherNum)*BigInt(den)>=BigInt(num)*BigInt(otherDen);
        if(cursor!==proposed && better){
          assert.notEqual(proposed,best);
          await refuse('better challenger defeats the proposed payout',leaf(candidate.witness),6006);
          defeated=true;break;
        }
        await h.send(name('check schedule '+cursor),[leaf(candidate.witness)]);cursor++;
      }
      if(proposed===best){
        assert(badRateChecked);
        await h.send(name('seal verified financial winner'),[action('seal_search')]);
        const state=await raw();assert.equal(state[104],4);
        assert.equal(read128(state,88),BigInt(count));
        const memberCount=input.members.length, cashOffset=137, movementsOffset=cashOffset+8*memberCount;
        const insuranceOffset=movementsOffset+16*memberCount;
        assert.deepEqual(input.members.map((_,i)=>String(state.readBigUInt64LE(cashOffset+i*8))),input.members.map(id=>input.comparison.cash[id]));
        const movements=input.members.map((_,i)=>[0,1].map(market=>String(state.readBigInt64LE(movementsOffset+16*i+8*market))));
        assert.deepEqual(movements,input.comparison.terminal.movements);
        const reserves=(offset:number)=>[0,1].map(market=>String(state.readBigUInt64LE(offset+8*market)));
        assert.deepEqual(reserves(insuranceOffset),input.comparison.terminal.remainingInsurance);
        assert.deepEqual(reserves(insuranceOffset+16),input.comparison.terminal.retainedFees);
      }else{
        assert(defeated);
        await refuse('outscored result stays unsealed',action('seal_search'),6005);
      }
    }
  }
  writeFileSync(dest+'/checks.json',JSON.stringify(checks,null,2));
}finally{ws.close();}
