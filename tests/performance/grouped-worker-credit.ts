// Check the idle debtor's economic condition from finalized fills and oracle reports,
// independently of the worker, the program's group bounds and its coverage logs.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import * as sdk from '@rivalt/sdk';
import {eventPayloads,json} from '../../packages/indexer/src/events.js';
import {LiquidityStore} from '../../packages/indexer/src/liquidity-store.js';
import {signedResourcePolicy} from './resource-policy.js';
import {verifyReceiptWire} from './receipt-metrics.js';

const dir=process.argv[2];assert(dir,'Pass a completed grouped worker run');
const read=(name:string)=>JSON.parse(readFileSync(join(dir,name),'utf8'));
const summary=read('worker-result.json');
const [authority]=await sdk.findEventAuthorityPda();
const snapshots=new Map<number,sdk.MarketSnapshot>();
let idle:sdk.MarginAccountSnapshot|undefined;
const headrooms=new Map<string,{cash:bigint;adverseClaimAtoms:bigint[];remaining:bigint}>();
let withdrawals=0,refusals=0;
const scale=1_000_000_000n;
for(const file of readdirSync(dir).filter(name=>/^wire-\d+\.json$/.test(name)).sort((a,b)=>parseInt(a.slice(5))-parseInt(b.slice(5)))){
  const wire=read(file),label=wire.label;
  if(!['cross ETH 9','P32 publisher available two-market reports','blocked payout','ordinary withdraw','recovered withdraw'].includes(label))continue;
  const receipt=read(file.replace('wire-','transaction-'));
  verifyReceiptWire(receipt,Buffer.from(wire.wireBase64,'base64'));
  if(label==='blocked payout'){
    assert.deepEqual(receipt.meta.err.InstructionError[1],{Custom:sdk.CLEARING_ERROR__EXIT_COHORT});
    assert(headrooms.get('40000')!.remaining<0n);refusals++;continue;
  }
  assert.equal(receipt.meta.err,null);
  if(label.endsWith(' withdraw')){
    const deltas=receipt.meta.postTokenBalances.map((post:{accountIndex:number;uiTokenAmount:{amount:string}})=>{
      const pre=receipt.meta.preTokenBalances.find((row:{accountIndex:number})=>row.accountIndex===post.accountIndex);
      return BigInt(post.uiTokenAmount.amount)-BigInt(pre.uiTokenAmount.amount);
    }).filter((n:bigint)=>n!==0n).sort((a:bigint,b:bigint)=>a<b?-1:1);
    assert.deepEqual(deltas,[-40n,40n]);withdrawals++;continue;
  }
  for(const {payload} of eventPayloads(wire.signature,receipt,authority)){
    const tag=payload.subarray(0,8);
    if(label==='cross ETH 9' && tag.equals(Buffer.from(sdk.LIQUIDITY_ROUTE_FEE_RECORDED_EVENT_DISCRIMINATOR))){
      const {rootStates}=sdk.getLiquidityRouteFeeRecordedEventDecoder().decode(payload);
      idle=rootStates.find(row=>row.role===0);
      assert(idle);assert.deepEqual(idle.positions.map(pos=>pos.lots),[2n,1n]);
    }
    if(tag.equals(Buffer.from(sdk.FUNDING_REPORT_ACCEPTED_EVENT_DISCRIMINATOR))){
      const {state}=sdk.getFundingReportAcceptedEventDecoder().decode(payload);
      snapshots.set(state.index,state);
    }
  }
  const btc=snapshots.get(0);
  if(!idle || !btc || snapshots.size!==2 || ![40_000n,48_000n].includes(btc.referencePrice))continue;
  const adverseClaimAtoms=idle.positions.map((position,market)=>{
    const state=snapshots.get(market)!;
    assert.equal(state.fundingIndexScaled,0n);assert.equal(state.oracle.premiumScaled,0n);
    const claim=position.virtualScaled+position.lots*(state.lower*scale+position.fundingCheckpointScaled);
    assert.equal(claim%scale,0n);return claim/scale;
  });
  const remaining=adverseClaimAtoms.reduce((cash,claim)=>cash+(claim<0n?claim:0n),idle.cash);
  assert(adverseClaimAtoms[1]<0n && -adverseClaimAtoms[0]*2n>idle.cash);
  assert.equal(remaining<0n,btc.referencePrice===40_000n);
  headrooms.set(String(btc.referencePrice),{cash:idle.cash,adverseClaimAtoms,remaining});
}
assert.equal(headrooms.size,2);assert.equal(withdrawals,2);assert.equal(refusals,1);
const resources=[];
if(process.argv[3]==='--journal'){
  const database=process.env.RIVALT_DATABASE_URL;assert(database,'Owned qualification database required');
  const store=new LiquidityStore(database,'p55b2-application');
  try {
    const {rows}=await store.pool.query(`SELECT i.wire,i.signature,i.request_id,t.payload
      FROM service_intents i JOIN transactions t USING(run_id,signature) WHERE i.run_id=$1 ORDER BY t.slot,t.transaction_index`,[store.runId]);
    assert.equal(rows.length,summary.receipts.length);
    for(const row of rows){
      const wire=Buffer.from(row.wire,'base64'),tx=row.payload;
      const {message,locks}=verifyReceiptWire(tx,wire),entry=summary.receipts.find((item:{signature:string})=>item.signature===row.signature);
      assert(entry);assert.equal(tx.meta.computeUnitsConsumed,entry.cu);assert.deepEqual(tx.meta.err,entry.error);
      const policy=signedResourcePolicy(message);
      resources.push({id:row.request_id,signature:row.signature,bytes:wire.length,keys:message.staticAccountKeys.length,
        writable:locks.write.length,fee:tx.meta.fee,cu:entry.cu,limit:entry.limit,heapBytes:policy.heapBytes??32*1024});
    }
  }finally{await store.close();}
}
const audit={population:summary.population,debtorId:idle!.id,headrooms:Object.fromEntries(headrooms),withdrawals,resources};
if(resources.length)writeFileSync(join(dir,'worker-audit.json'),json(audit));
console.log(json(audit));
