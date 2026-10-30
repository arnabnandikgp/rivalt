import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {getTransactionDecoder,type Address,type Instruction} from '@solana/kit';
import {FailedTransactionMetadata,LiteSVM} from 'litesvm';
import * as sdk from '@rivalt/sdk';
import {type SafetyResourceProbe} from './account-safety-cases.js';
import {type payerKey} from './custody-cases.js';

const value=(limbs:readonly bigint[])=>limbs.reduceRight((total,limb)=>(total<<64n)+limb,0n);
function limbs(number:bigint,length=96):bigint[] {
  const result=Array.from({length},()=>{const limb=number&((1n<<64n)-1n);number>>=64n;return limb;});
  assert.equal(number,0n);return result;
}
const wide=(number:bigint)=>({limbs:limbs(number)});
const json=(input:unknown)=>JSON.stringify(input,(_,item)=>typeof item==='bigint'?item.toString():item,2)+'\n';

/** Resource-only fork. Real signed financial inputs remain byte-identical.
 * Multiplying derived L and rate factor preserves every rational payout but
 * deliberately does NOT preserve canonical denominator provenance. This is not
 * an accepted financial history. No Apply, token movement or authority change
 * is run here; the unmodified parent separately completes genuine acceptance.
 */
export async function contextBudgetProbe(parent:LiteSVM,payer:Awaited<ReturnType<typeof payerKey>>,
  input:SafetyResourceProbe,output:string) {
  const parentBytes=parent.toBytes();
  const checks:{label:string;commonBits:number;rateFactorBits:number;computeUnits:string;bytes:number}[]=[];
  for(const commonBits of [2796,5632]) {
    const svm=LiteSVM.fromBytes(parentBytes).withSigverify(true).withBlockhashCheck(true);
    const account=(key:Address)=>{const result=svm.getAccount(key);assert(result.exists);return result;};
    const read=(key:Address)=>Buffer.from(account(key).data);
    const immutable=Object.fromEntries(input.immutable.map(key=>[key,read(key)]));
    const custodyBefore=sdk.getCustodyDecoder().decode(read(input.custody));
    const header=sdk.getResolutionDecoder().decode(read(input.resolution));
    const work=sdk.getResolutionWorkDecoder().decode(read(input.work));
    assert.equal(header.stage,5);assert.equal(header.cursor,0);assert.equal(work.row,0);
    const maximumClaim=100_300_000_000_000_000_000_000_000n;
    const probeDebt=2n*maximumClaim-1n;
    const commonScale=(((1n<<BigInt(commonBits))-1n)/value(header.common.limbs)/probeDebt)*probeDebt;
    const factorScale=((1n<<186n)-1n)/value(header.rateFactor);
    const scale=commonScale*factorScale;
    assert(commonScale>0n && factorScale>0n);
    const common=value(header.common.limbs)*commonScale,factor=value(header.rateFactor)*factorScale;
    const rates=header.rateNumerators.map(rate=>value(rate.limbs)*scale);
    const denominator=value(header.flowDenominator.limbs)*scale;
    assert.equal(common.toString(2).length,commonBits);assert.equal(factor.toString(2).length,186);
    const proposal=Buffer.alloc(1560);
    [...limbs(rates[0]),...limbs(rates[1]),...limbs(factor,3)].forEach((limb,index)=>proposal.writeBigUInt64LE(limb,index*8));
    svm.setAccount({...account(input.resolution),data:Uint8Array.from(sdk.getResolutionEncoder().encode({...header,
      common:wide(common),stage:4,cursor:0}))});
    const rows=Array.from({length:header.count},(_,id)=>sdk.getResolutionPageDecoder()
      .decode(read(input.pages[Math.floor(id/2)])).rows[id%2]);
    assert(rows.some(row=>row.claimsScaled.every(claim=>claim<0n) && row.cashBefore>0n),
      'exercise the double-debt long-division path');
    const expected=rows.map(row=>{
      const debts=row.claimsScaled.map(claim=>claim<0n?-claim:0n),totalDebt=debts[0]+debts[1];
      const collected=row.cashBefore<totalDebt/1_000_000_000n?row.cashBefore:totalDebt/1_000_000_000n;
      return row.claimsScaled.map((claim,market)=>{
        if(claim>=0n)return claim*rates[market];
        const own=collected*denominator*debts[market]/totalDebt;
        assert.equal(collected*denominator*debts[market]%totalDebt,0n);
        const other=row.claimsScaled[1-market];
        const cap=(-claim-collected*1_000_000_000n)*common*factor;
        const recovered=other>0n?other*rates[1-market]:0n;
        return own+(other>0n?(recovered<cap?recovered:cap):0n);
      });
    });
    async function send(label:string,instruction:Instruction,runtime=svm) {
      runtime.expireBlockhash();
      const {transaction}=await sdk.signInstructions({async getLatestBlockhash(){return {
        blockhash:runtime.latestBlockhash(),lastValidBlockHeight:1_000_000n};}},payer,[sdk.fundingComputeBudget(),instruction]);
      const wire=transaction.serialize();assert(wire.length<=1232);
      const result=runtime.sendTransaction(getTransactionDecoder().decode(wire));
      const meta=result instanceof FailedTransactionMetadata?result.meta():result;
      writeFileSync(`${output}/resource-${commonBits}-${checks.length}.json`,json({label,wire:Buffer.from(wire).toString('base64'),logs:meta.logs()}));
      assert(!(result instanceof FailedTransactionMetadata),`${label}: ${meta.logs().join('\n')}`);
      checks.push({label,commonBits,rateFactorBits:186,computeUnits:meta.computeUnitsConsumed().toString(),bytes:wire.length});
      writeFileSync(`${output}/context-budget.json`,json({scope:'derived-scratch resource fork; no financial application',checks}));
      assert(meta.computeUnitsConsumed()<=960_000n,`${label}: insufficient 20% headroom: ${meta.computeUnitsConsumed()}`);
    }
    const proposalHash=createHash('sha256').update(proposal).digest();
    for(let offset=0;offset<proposal.length;offset+=512)await send('full-context maximum-width proposal',
      input.propose(proposal.subarray(offset,Math.min(proposal.length,offset+512)),offset,proposalHash));
    const prepared=sdk.getResolutionDecoder().decode(read(input.resolution));
    assert.equal(prepared.stage,5);assert.equal(value(prepared.flowDenominator.limbs),denominator);
    // Separate scratch-only extremal inputs cover maximum cash/claim magnitudes,
    // including opposite-sign recovery. They do not match an authenticated root
    // valuation and must never be used as successful financial-history evidence.
    // Only Verify and FlowPlan are invoked; no rate acceptance or Apply follows.
    for(const claims of [[-maximumClaim,-maximumClaim+1n],[-maximumClaim,maximumClaim]] as const) {
      const probe=LiteSVM.fromBytes(svm.toBytes()).withSigverify(true).withBlockhashCheck(true);
      const get=(key:Address)=>{const result=probe.getAccount(key);assert(result.exists);return result;};
      const page=sdk.getResolutionPageDecoder().decode(get(input.pages[0]).data);
      const cash=1_000_000_000_000_000n;
      probe.setAccount({...get(input.pages[0]),data:Uint8Array.from(sdk.getResolutionPageEncoder().encode({...page,
        rows:page.rows.map((row,id)=>id===0?{...row,cashBefore:cash,claimsScaled:[...claims],collected:cash}:row)}))});
      await send(`extremal scratch Verify ${claims[1]<0n?'double debt':'mixed claims'}`,input.advance(5,0,1),probe);
      const verifiedRow=sdk.getResolutionPageDecoder().decode(get(input.pages[0]).data).rows[0];
      const expectedFlows=claims[1]<0n?claims.map(claim=>cash*denominator*(-claim)/probeDebt):[
        cash*denominator+(maximumClaim*rates[1]< (maximumClaim-cash*1_000_000_000n)*common*factor?
          maximumClaim*rates[1]:(maximumClaim-cash*1_000_000_000n)*common*factor),maximumClaim*rates[1]];
      assert.deepEqual(verifiedRow.exactFlowNumerators.map(flow=>value(flow.limbs)),expectedFlows);
      const current=sdk.getResolutionDecoder().decode(get(input.resolution).data);
      probe.setAccount({...get(input.resolution),data:Uint8Array.from(sdk.getResolutionEncoder().encode({...current,stage:6,cursor:0}))});
      await send(`extremal scratch FlowPlan ${claims[1]<0n?'double debt':'mixed claims'}`,input.advance(6,0,1),probe);
      const planned=sdk.getResolutionPageDecoder().decode(get(input.pages[0]).data).rows[0];
      assert.deepEqual(planned.roundedFlows,expectedFlows.map(flow=>flow/denominator));
      assert.equal(planned.cashAfter,(cash*denominator-expectedFlows[0]+(claims[1]<0n?-expectedFlows[1]:expectedFlows[1]))/denominator);
      for(const key of input.immutable)assert.deepEqual(Buffer.from(get(key).data),immutable[key]);
    }
    for(let id=0;id<header.count;id++)await send(`full-context Verify row ${id}`,input.advance(5,id,1));
    for(let id=0;id<header.count;id++) {
      const row=sdk.getResolutionPageDecoder().decode(read(input.pages[Math.floor(id/2)])).rows[id%2];
      assert.deepEqual(row.exactFlowNumerators.map(flow=>value(flow.limbs)),expected[id]);
    }
    await send('full-context complete rate and insurance checks',input.finalize());
    assert.equal(sdk.getResolutionDecoder().decode(read(input.resolution)).stage,6);
    for(let id=0;id<header.count;id++) {
      await send(`full-context FlowPlan row ${id}`,input.advance(6,id,1));
      const row=sdk.getResolutionPageDecoder().decode(read(input.pages[Math.floor(id/2)])).rows[id%2];
      assert.deepEqual(row.roundedFlows,expected[id].map(flow=>flow/denominator));
      const cash=row.cashBefore*denominator+expected[id].reduce((sum,flow,market)=>
        sum+(row.claimsScaled[market]<0n?-flow:flow),0n);
      assert.equal(row.cashAfter,cash/denominator);
    }
    assert.equal(sdk.getResolutionDecoder().decode(read(input.resolution)).stage,7);
    const orders=[0,1].map(market=>rows.map((_,id)=>id).sort((left,right)=>{
      const remainder=(id:number)=>rows[id].claimsScaled[market]>0n?expected[id][market]%denominator:0n;
      return remainder(left)===remainder(right)?left-right:remainder(left)>remainder(right)?-1:1;
    })) as [number[],number[]];
    await send('full-context remainder permutation',input.order(orders));
    for(let start=0;start<2*header.count;start++)await send('full-context remainder verification',
      input.checkOrder(start,orders[Math.floor(start/header.count)][start%header.count]));
    for(let step=0;sdk.getResolutionDecoder().decode(read(input.resolution)).stage===8;step++) {
      assert(step<2000);
      await send('full-context bounded conserving circulation',input.round(sdk.getResolutionDecoder().decode(read(input.resolution)).cursor));
    }
    assert.equal(sdk.getResolutionDecoder().decode(read(input.resolution)).stage,9,'resource branch stops before Apply');
    for(const key of input.immutable)assert.deepEqual(read(key),immutable[key],`${key}: resource probe changed financial state`);
    const custodyAfter=sdk.getCustodyDecoder().decode(read(input.custody));
    assert.deepEqual({...custodyAfter,sequence:custodyBefore.sequence},custodyBefore,'only event sequence advances');
  }
  assert.deepEqual(parent.toBytes(),parentBytes,'resource fork cannot change the genuine signed parent history');
  return checks;
}
