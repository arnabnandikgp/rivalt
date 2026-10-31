// Verified actual durable originals, fees and queue/observation timings.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {receiptMetrics,observedDistribution,type ProgramContract} from './receipt-metrics.js';
const directory=process.argv[2];assert(directory);
const raw=readFileSync(`${directory}/operator-receipts.json`),capture=JSON.parse(raw.toString());
const summary=JSON.parse(readFileSync(`${directory}/summary.json`,'utf8'));assert.equal(summary.trackedDirty,false);assert.equal(capture.revision,summary.revision);
const contracts:ProgramContract[]=['clearing','maker_a','maker_b'].map(name=>({...JSON.parse(readFileSync(`packages/sdk/idl/${name}.json`,'utf8')),name}));
const events=readdirSync(directory).filter(name=>name.startsWith('executor-')&&name.endsWith('.log')).flatMap(name=>
  readFileSync(`${directory}/${name}`,'utf8').split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)));
const timing=(signature:string,created:number)=>{
  const rows=events.filter(event=>event.signature===signature),first=(predicate:(row:any)=>boolean)=>rows.filter(predicate).map(row=>Number(row.at)).sort((a,b)=>a-b)[0];
  const broadcast=first(row=>row.event==='executor-broadcast'),confirmed=first(row=>row.event==='executor-observed'&&['confirmed','finalized'].includes(row.commitment)),finalized=first(row=>row.event==='executor-observed'&&row.commitment==='finalized');
  return {persistedToBroadcastMs:broadcast===undefined?null:broadcast-created,persistedToObservedConfirmedMs:confirmed===undefined?null:confirmed-created,
    persistedToObservedFinalizedMs:finalized===undefined?null:finalized-created};
};
const originals=capture.originals.map((original:any)=>{
  assert(['finalized','failed'].includes(original.status));const measured=receiptMetrics(original.transaction,Buffer.from(original.wire,'base64'),contracts);
  assert.equal(measured.signature,original.signature);assert.equal(original.status==='finalized',measured.outcome==='success');
  assert(original.ws.some((notice:any)=>notice.params?.result?.value?.signature===original.signature),'Actual WS discovery');
  return {...measured,requestId:original.request_id,role:original.budget??'wallet',timing:timing(original.signature,Date.parse(original.created_at))};
});
const stats=(values:(number|null)[])=>{const present=values.filter((value):value is number=>value!==null);assert(present.every(value=>value>=0));return present.length?observedDistribution(present):null;};
const roles=[...new Set(originals.map((original:any)=>original.role))].map(role=>{
  const rows=originals.filter((original:any)=>original.role===role);
  return {role,originals:rows.length,finalizedSuccess:rows.filter((row:any)=>row.outcome==='success').length,finalizedFailure:rows.filter((row:any)=>row.outcome==='rejected').length,
    feeLamports:rows.reduce((sum:bigint,row:any)=>sum+BigInt(row.feeLamports),0n).toString(),
    computeUnits:stats(rows.map((row:any)=>row.computeUnits)),wireBytes:stats(rows.map((row:any)=>row.wireBytes)),
    persistedToBroadcastMs:stats(rows.map((row:any)=>row.timing.persistedToBroadcastMs)),persistedToObservedConfirmedMs:stats(rows.map((row:any)=>row.timing.persistedToObservedConfirmedMs)),
    persistedToObservedFinalizedMs:stats(rows.map((row:any)=>row.timing.persistedToObservedFinalizedMs))};
});
const result={revision:capture.revision,captureSha256:createHash('sha256').update(raw).digest('hex'),originals:originals.length,roles,
  caveats:['Persisted originals are not all offered/declined worker polls; no offered-availability denominator is inferred',
    'Timing starts at SQL persistence, not signing. Observations include executor polling, fault injection, resource reservations and process restarts',
    'First broadcast is a local pre-send timestamp; confirmed/finalized means executor observation, not exact validator landing time',
    'Failure fees are included; actor costs exclude unrelated setup, rent, infrastructure and hypothetical external hedges']};
writeFileSync(`${directory}/operator-metrics.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
