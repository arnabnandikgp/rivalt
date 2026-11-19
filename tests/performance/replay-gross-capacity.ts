// Reuse the finalized fee qualification captures. Decode actual signed route effects
// and compare gross capacity after every fill with its signed post-fill market.
// The final replay state must also match the independently captured frozen roots.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {getProgramDerivedAddress} from '@solana/kit';
import {hasAggregateFees,CLEARING_PROGRAM_ADDRESS} from '@rivalt/sdk';
import {decodeAccountInvocations} from '../../packages/indexer/src/account-events.js';

const snapshotPath=process.argv[2];
assert(snapshotPath,'Supply the frozen SQL snapshot from the aggregate fee run.');
const directory=dirname(snapshotPath);
const {binding,state}=JSON.parse(readFileSync(snapshotPath,'utf8'));
assert(hasAggregateFees(binding.artifactSet));
assert.equal(binding.program,CLEARING_PROGRAM_ADDRESS);
assert.equal(state.resolution.stage,2);
const [eventAuthority]=await getProgramDerivedAddress({programAddress:CLEARING_PROGRAM_ADDRESS,seeds:[Buffer.from('__event_authority')]});
const fills=[];
for(const filename of readdirSync(directory).filter(name=>/^transaction-\d+\.json$/.test(name))){
  const tx=JSON.parse(readFileSync(join(directory,filename),'utf8'));
  const invocations=decodeAccountInvocations(tx.transaction.signatures[0],tx,0,{...binding,eventAuthority});
  fills.push(...invocations.flatMap(row=>row.events.filter(event=>event.type==='LiquidityRouteFeeRecorded')));
}
// Each market's ledger version increases on every fill. Verify event order and
// coverage independently using the signed post-fill totals and frozen custody.
fills.sort((left,right)=>{
  const market=left.data.market.localeCompare(right.data.market);
  if(market)return market;
  const leftVersion=BigInt(left.data.ledger.version),rightVersion=BigInt(right.data.ledger.version);
  return leftVersion<rightVersion?-1:leftVersion>rightVersion?1:0;
});
const positions=new Map<string,bigint>(),versions=new Map<string,bigint>(),fees=new Map<string,bigint>();
const lines=[];
for(const {data} of fills){
  const marketIndex=state.venue.markets.indexOf(data.market);
  assert(marketIndex===0||marketIndex===1);
  const version=BigInt(data.ledger.version);
  assert(version>(versions.get(data.market)??0n));
  versions.set(data.market,version);
  const row=[marketIndex,data.legs[0].instance,data.marketState.grossLots];
  for(const root of data.rootStates){
    const key=data.market+'-'+root.id,next=BigInt(root.positions[marketIndex].lots);
    row.push(positions.get(key)??0n,next);
    positions.set(key,next);
  }
  fees.set(data.market,(fees.get(data.market)??0n)+BigInt(data.fee));
  lines.push(row.join(' '));
}
for(const [index,market] of state.venue.markets.entries()){
  const owned=state.liquidity.feeAccounting[market];
  assert.equal(fees.get(market)??0n,BigInt(owned?.classified??0)+BigInt(owned?.pending??0));
  let gross=0n;
  for(const root of Object.values(state.roots) as {id:string;positions:{lots:string}[]}[]){
    const actual=BigInt(root.positions[index].lots);
    assert.equal(positions.get(market+'-'+root.id)??0n,actual);
    gross+=actual<0n?-actual:actual;
  }
  assert.equal(gross,BigInt(state.markets[market].grossLots));
}
process.stdout.write(execFileSync('target/debug/examples/gross_capacity_replay',[],{input:lines.join('\n')+'\n',encoding:'utf8'}));


// Hypothetical proof-account addresses for these signed roots. This reports
// contention from backing maintenance only. Gross rights, funding, fees and
// all other account accesses need separate qualification on a real deployment.
const paired=join(directory,'paired-signed-routes.json');
if(existsSync(paired)){
  const bySignature=new Map(fills.map(event=>[event.signature,event.data]));
  for(const width of [1,2,3,4,8,16]){
    const collisions:Record<string,number>={};
    for(const pair of JSON.parse(readFileSync(paired,'utf8'))){
      const keys=pair.receipts.map(({signature}:{signature:string})=>{
        const fill=bySignature.get(signature);
        assert(fill && new Set(fill.rootStates.map((root:{id:string})=>root.id)).size===fill.rootStates.length);
        return new Set<string>(fill.rootStates.map((root:{id:string})=>fill.market+'-'+(BigInt(root.id)%BigInt(width))));
      }) as Set<string>[];
      assert.equal(keys.length,2);
      const overlap=[...keys[0]].some(key=>keys[1].has(key));
      collisions[pair.workload]=(collisions[pair.workload]??0)+Number(overlap);
    }
    console.log(JSON.stringify({width,overlappingPairs:collisions}));
  }
}
