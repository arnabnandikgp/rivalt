// Independent marginal integration from retained authenticated raw accounts.
// Generated decoders parse ABI only; no SDK quote/allocation/funding math is used.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {VersionedTransaction} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';

const directory=process.argv[2],inputs=JSON.parse(readFileSync(`${directory}/publisher-inputs.json`,'utf8'));
const summary=JSON.parse(readFileSync(`${directory}/${existsSync(`${directory}/summary.json`)?'summary.json':'comparison-capture.json'}`,'utf8'));
const hashes=new Map<string,any>(),outcomes:Record<string,number>={};
const abs=(value:bigint)=>value<0n?-value:value;
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const fixture='A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj';
for(const input of inputs) {
  const accounts=new Map<string,any>(input.accounts.map(([key,hash]:[string,string])=>{
    if(!hashes.has(hash)){const raw=readFileSync(`${directory}/publisher-blobs/${hash}.json`,'utf8');assert.equal(digest(raw),hash);hashes.set(hash,JSON.parse(raw));}
    return [key,hashes.get(hash)];}));
  const rows=[...accounts].sort(([left],[right])=>left<right?-1:left>right?1:0).map(([key,value])=>[key,value?[value.owner,value.executable,value.data[0]]:null]);
  assert.equal(digest(JSON.stringify(['rivalt-funding-snapshot-v1',input.contextSlot,rows])),input.inputDigest);
  const report=input.calculation.report;
  const original=summary.serviceReport.intents.find((row:any)=>row.request_id===input.requestId);assert(original);
  const transaction=VersionedTransaction.deserialize(Buffer.from(original.wire,'base64'));
  const instructions=transaction.message.compiledInstructions.filter(instruction=>
    transaction.message.staticAccountKeys[instruction.programIdIndex].address===sdk.CLEARING_PROGRAM_ADDRESS);
  assert.equal(instructions.length,1);
  assert.deepEqual(Buffer.from(instructions[0].data.subarray(0,8)),Buffer.from(sdk.PUBLISH_FUNDING_REPORT_V4_DISCRIMINATOR));
  const [signed,end]=sdk.getPublishFundingReportV4InstructionDataDecoder().read(instructions[0].data,0);
  assert.equal(end,instructions[0].data.length);
  assert.deepEqual(JSON.parse(JSON.stringify(signed.report,(_key,value)=>typeof value==='bigint'?value.toString():
    ArrayBuffer.isView(value)?Buffer.from(value as Uint8Array).toString('hex'):value)),report,'Independent calculation is bound to the persisted signed original');
  const raw=(key:string)=>{const value=accounts.get(key);assert(value&&!value.executable&&value.data[1]==='base64');return Buffer.from(value.data[0],'base64');};
  const market=sdk.getMarketV3Decoder().decode(raw(report.market)),marketIndex=market.index as 0|1;
  const now=BigInt(report.observedTime),slot=BigInt(report.observedSlot),reference=marketIndex===0?60_000n:30_000n,quantity=(6_000_000n+reference-1n)/reference;
  assert.equal(raw(sdk.ACCOUNT_CLOCK).readBigInt64LE(32),now);assert.equal(raw(sdk.ACCOUNT_CLOCK).readBigUInt64LE(0),slot);
  const sourceValid=market.oracle.sources.every((key,position)=>{
    const data=raw(key),value=data.readBigInt64LE(113),published=data.readBigInt64LE(133);
    const expected=position%2===1?1_000_000n:marketIndex===0?60_000_000_000n:3_000_000_000n;
    assert.equal(accounts.get(key).owner,fixture);assert.equal(data.length,142);assert.equal(data.readBigUInt64LE(121),0n);
    assert.equal(data.readInt32LE(129),-6);assert.equal(data[112],2);assert.equal(value,expected);
    return published>0n&&published<=now+2n&&now-published<=20n&&data.readBigUInt64LE(72)>=market.oracle.sourceSequences[position];
  });
  const registrations=[...accounts].filter(([,value])=>value?.owner===sdk.CLEARING_PROGRAM_ADDRESS&&
    Buffer.from(value.data[0],'base64').subarray(0,8).equals(Buffer.from(sdk.MAKER_REGISTRATION_V4_DISCRIMINATOR)))
    .map(([key])=>sdk.getMakerRegistrationV4Decoder().decode(raw(key))).sort((left,right)=>left.instance-right.instance);
  assert.deepEqual(registrations.map(value=>value.instance),[0,1,2]);
  const makers=registrations.map(registration=>{
    assert.equal(registration.market,report.market);
    const config=sdk.makerA.getMakerCurveV4Decoder().decode(raw(registration.config)).state;
    const price=sdk.makerA.getMakerPriceV4Decoder().decode(raw(registration.price)).state;
    const capital=sdk.getMarginAccountV3Decoder().decode(raw(registration.capital));
    assert.equal(config.capital,registration.capital);assert.equal(price.config,registration.config);
    const code=accounts.get(registration.programData);assert(code&&!code.executable);
    const codeValid=digest(Buffer.from(code.data[0],'base64'))===Buffer.from(registration.approvedHash).toString('hex');
    const valid=!registration.quarantined&&codeValid&&config.shape.mode!==0&&price.controlEpoch===config.controlEpoch&&
      price.sequence>0n&&price.updatedSlot<=slot&&price.updatedTime<=now&&slot<price.updatedSlot+BigInt(config.shape.ttlSlots)&&now<price.updatedTime+6n;
    return {registration,config,price,inventory:capital.positions[marketIndex].lots,valid};
  });
  function prices(maker:typeof makers[number],side:0|1) {
    const shape=maker.config.shape,regions=(side===0?shape.asks:shape.bids).slice(0,side===0?shape.askCount:shape.bidCount);
    const consumed=side===0?maker.registration.buyConsumed:maker.registration.sellConsumed;
    const capacity=side===0?shape.shortCap+maker.inventory:shape.longCap-maker.inventory;
    const table:(bigint|null)[]=[0n];let total=0n;
    for(let lots=1n;lots<=quantity;lots++) {
      if(lots>capacity||consumed+lots>regions.at(-1)!.endLots){table.push(null);continue;}
      let start=0n,offset:bigint|undefined;
      for(const region of regions){if(consumed+lots-1n<region.endLots){offset=region.offset+(consumed+lots-1n-start)*region.slope;break;}start=region.endLots;}
      assert(offset!==undefined);
      const current=maker.inventory+(side===0?-(lots-1n):lots-1n),next=current+(side===0?-1n:1n);
      const oldDistance=abs(current-shape.target),newDistance=abs(next-shape.target);
      const skew=(newDistance>oldDistance?oldDistance/shape.skewStep:-(newDistance/shape.skewStep))*shape.skewTick;
      total+=maker.price.anchor+(side===0?offset+skew:-offset-skew);
      table.push(total*10n>=lots*reference*9n&&total*10n<=lots*reference*11n?total:null);
    }
    return table;
  }
  function allocate(side:0|1) {
    const tables=makers.map(maker=>prices(maker,side)),count=Number(quantity);let best:{gross:bigint;quantities:bigint[]}|null=null;
    function consider(quantities:bigint[]){let gross=0n;for(let index=0;index<3;index++){const value=tables[index][Number(quantities[index])];if(value===null)return;gross+=value;}
      if(best===null||(side===0?gross<best.gross:gross>best.gross))best={gross,quantities};}
    for(let index=0;index<3;index++){const quantities=[0n,0n,0n];quantities[index]=quantity;consider(quantities);}
    for(let first=0;first<3;first++)for(let second=first+1;second<3;second++)for(let amount=count-1;amount>0;amount--){const quantities=[0n,0n,0n];quantities[first]=BigInt(amount);quantities[second]=quantity-BigInt(amount);consider(quantities);}
    return best as {gross:bigint;quantities:bigint[]}|null;
  }
  const coverage=makers.every(maker=>maker.valid),bid=sourceValid&&coverage?allocate(1):null,ask=sourceValid&&coverage?allocate(0):null;
  const expected=!sourceValid?1:!coverage?2:!bid||!ask||ask.gross<bid.gross?3:0;
  assert.equal(report.outcome,expected,input.requestId);outcomes[expected]=(outcomes[expected]??0)+1;
  if(expected===0){assert(bid&&ask);assert.equal(BigInt(report.referencePrice),reference);assert.equal(BigInt(report.quantity),quantity);
    assert.equal(BigInt(report.bid),bid.gross);assert.equal(BigInt(report.ask),ask.gross);
    assert.deepEqual(input.calculation.allocations.bid.quantities,bid.quantities.map(String));
    assert.deepEqual(input.calculation.allocations.ask.quantities,ask.quantities.map(String));
    assert.equal(BigInt(report.validUntilSlot),makers.reduce((minimum,maker)=>{const deadline=maker.price.updatedSlot+BigInt(maker.config.shape.ttlSlots);return deadline<minimum?deadline:minimum;},slot+150n));
    assert.equal(BigInt(report.validUntilTime),makers.reduce((minimum,maker)=>maker.price.updatedTime+6n<minimum?maker.price.updatedTime+6n:minimum,now+6n));
  }else for(const field of ['referencePrice','quantity','bid','ask','validUntilSlot','validUntilTime'])assert.equal(BigInt(report[field]),0n);
}
assert(inputs.length>0);assert.equal(inputs.length,summary.serviceReport.retainedReports);
const result={result:'pass',reports:inputs.length,outcomes,independentMarginalIntegration:true,feesOrFinancialAdmissionInFunding:false,
  authorityBoundary:'restricted-publisher-attestation; retained inputs are auditable, not an on-chain completeness proof'};
writeFileSync(`${directory}/independent-publisher-audit.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
