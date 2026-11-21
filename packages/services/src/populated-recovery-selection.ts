// Build untrusted proposals from the budgets, lot rates and foreign charge caps
// that clearing has already sealed. No candidate schedule or payout comes from a fixture.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getAddressEncoder,type Address} from '@solana/kit';
import {frozenMemberRank} from '@rivalt/sdk/frozen-order';
import {allocationCutoff} from './btc-allocation.js';
import {proposeAccountRates} from './account-rate-proposal.js';

export type PopulatedRow={
  id:bigint;cash:bigint;collected:bigint;claims:bigint[];lots:bigint[];
  originalDebtorBudgets:readonly bigint[];recoveryLotRates:readonly (readonly bigint[])[];
};
type Entry={ordinal:bigint;memberId:bigint;lots:bigint;rate:bigint[];atoms:bigint};
type Holder={id:bigint;capacity:bigint;linked:boolean;priority:Buffer;lotsFor:(charge:bigint)=>bigint};
type Cutoff={unit:bigint;capacity:bigint;memberId:bigint};
const abs=(value:bigint)=>value<0n?-value:value;
const min=(a:bigint,b:bigint)=>a<b?a:b;
const sum=(values:bigint[])=>values.reduce((total,value)=>total+value,0n);
const zeroCutoff=():Cutoff=>({unit:0n,capacity:0n,memberId:0n});
const scale=1_000_000_000n;
function word(value:bigint,signed=false) {
  const data=Buffer.alloc(8);
  if(signed)data.writeBigInt64LE(value);else data.writeBigUInt64LE(value);
  return data;
}
function digest(...parts:(Buffer|Uint8Array|string)[]) {
  const hash=createHash('sha256');
  for(const part of parts)hash.update(part);
  return hash.digest();
}
function allocate(venue:Address,epoch:bigint,holders:Holder[],total:bigint) {
  assert(total>=0n && sum(holders.map(holder=>holder.capacity))>=total,'Insufficient eligible gain for the populated proof');
  if(total===0n)return holders.map(()=>0n);
  // The on-chain cutoff reconstructs ties by episode priority with extra lots set to zero.
  const [unit,capacity,,member]=allocationCutoff(venue,epoch,total,holders);
  const last=holders.find(holder=>holder.id===member)!;
  return holders.map(holder=>{
    const product=(2n*unit-1n)*holder.capacity;
    const equal=product%capacity===0n && (product/capacity)%2n===1n;
    let count=(product/capacity+1n)/2n;
    const order=Buffer.compare(holder.priority,last.priority);
    if(equal && (order>0 || order===0 && holder.id>last.id))count--;
    return min(holder.capacity,count);
  });
}
function lastCutoff(holders:Holder[],charges:bigint[],linked:boolean) {
  let last:Holder|undefined,cutoff=zeroCutoff();
  holders.forEach((holder,index)=>{
    const unit=charges[index];
    if(holder.linked!==linked || !unit)return;
    const difference=(2n*unit-1n)*cutoff.capacity-(2n*cutoff.unit-1n)*holder.capacity;
    if(!last || difference>0n || difference===0n && (Buffer.compare(holder.priority,last.priority)>0 ||
      holder.priority.equals(last.priority) && holder.id>last.id)) {
      last=holder;cutoff={unit,capacity:holder.capacity,memberId:holder.id};
    }
  });
  return cutoff;
}

export function populatedMarketOrder(venue:Address,epoch:bigint,rows:PopulatedRow[],market:number,cap:bigint,total:bigint) {
  const holders=rows.map((row):Holder=>{
    const lots=row.lots[market],[num,den]=row.recoveryLotRates[market];
    assert(den>0n);
    const eligible=sum(rows.filter(other=>other.originalDebtorBudgets[market]>0n && lots*other.lots[market]<0n &&
      min(abs(lots),abs(other.lots[market]))*num>=den).map(other=>abs(other.lots[market])));
    const capacity=row.claims[market]>0n?min(row.claims[market]/scale,min(eligible,abs(lots))*num/den):0n;
    return {id:row.id,capacity,linked:row.claims[market]>0n && row.claims[1-market]< -row.collected*scale,
      priority:frozenMemberRank(venue,epoch,row.id),lotsFor:()=>0n};
  });
  assert.equal(sum(rows.map(row=>row.originalDebtorBudgets[market])),total);
  let charges=allocate(venue,epoch,holders,total);
  if(sum(charges.filter((_,index)=>holders[index].linked))>cap) {
    charges=holders.map(()=>0n);
    for(const linked of [false,true]) {
      const indices=holders.flatMap((holder,index)=>holder.linked===linked?[index]:[]);
      const split=allocate(venue,epoch,indices.map(index=>holders[index]),linked?cap:total-cap);
      indices.forEach((index,i)=>{charges[index]=split[i];});
    }
  }
  assert.equal(sum(charges),total);
  const cutoffs=[lastCutoff(holders,charges,false),lastCutoff(holders,charges,true)];
  const order=holders.map((_,ordinal)=>ordinal).sort((left,right)=>Buffer.compare(holders[left].priority,holders[right].priority)||left-right);
  const pages:{index:bigint;role:number;entries:Entry[];next:Buffer}[]=[];
  const locations=new Map<number,{role:number;slot:bigint}>();
  for(const role of [0,1]) {
    const entries:Entry[]=[];
    for(const ordinal of order) {
      const row=rows[ordinal],atoms=role===0?charges[ordinal]:row.originalDebtorBudgets[market];
      if(atoms===0n)continue;
      assert(!locations.has(ordinal),'Conflicting pair roles');
      locations.set(ordinal,{role,slot:BigInt(entries.length)});
      entries.push({ordinal:BigInt(ordinal),memberId:row.id,lots:row.lots[market],rate:role===0?[...row.recoveryLotRates[market]]:[0n,1n],atoms});
    }
    for(let start=0;start<entries.length;start+=8)pages.push({index:BigInt(start/8),role,entries:entries.slice(start,start+8),next:Buffer.alloc(32)});
  }
  let root:Buffer=Buffer.alloc(32);
  for(const page of [...pages].reverse()) {
    page.next=root;
    root=digest('Rivalt/pair-order-page/v1\0',Buffer.from([page.role,page.entries.length]),
      ...page.entries.flatMap(row=>[word(row.ordinal),word(row.memberId),word(row.lots,true),word(row.rate[0]),word(row.rate[1]),word(row.atoms)]),root);
  }
  let prefix=digest('Rivalt/winner-targets/v1\0',Buffer.from(getAddressEncoder().encode(venue)),word(epoch),Buffer.from([market]));
  const openings=[];
  for(let start=0;start<rows.length;start+=8) {
    const prior=prefix;
    const members=rows.slice(start,start+8).map((row,i)=>{
      const weight=holders[start+i].capacity,charge=charges[start+i];
      prefix=digest(prefix,word(row.id),word(weight),word(charge));
      return {weight,charge,location:locations.get(start+i)};
    });
    openings.push({prior,members});
  }
  return {cutoffs,charges,openings,pages,root,finalDigest:prefix};
}
export function populatedRecoveryProposal(venue:Address,epoch:bigint,rows:PopulatedRow[],caps:bigint[],totals:bigint[],
  pools:bigint[],insurance:bigint[]) {
  assert(rows.length && rows.every((row,index)=>index===0 || rows[index-1].id<row.id),'Invalid ordered frozen membership');
  const markets=[0,1].map(m=>populatedMarketOrder(venue,epoch,rows,m,caps[m],totals[m]));
  const effective=rows.map((row,index)=>{
    const claims=(market:number)=>row.claims[market]+scale*(row.originalDebtorBudgets[market]-markets[market].charges[index]);
    return {cash:row.cash,claims:[claims(0),claims(1)] as [bigint,bigint],originalClaims:[row.claims[0],row.claims[1]] as [bigint,bigint]};
  });
  let budgets:[bigint,bigint]=[insurance[0],insurance[1]];
  const proposals=[];
  for(let round=0;round<3;round++) {
    const proposal=proposeAccountRates({rows:effective,pools:[pools[0],pools[1]],budgets});
    proposals.push({factor:proposal.factorWords,rates:proposal.numeratorWords});
    if(!proposal.fractional.some(Boolean))return {markets,proposals};
    budgets=budgets.map((available,m)=>proposal.fractional[m]?proposal.insuranceSpent[m]:available) as [bigint,bigint];
  }
  throw new Error('Populated joint payments exceed the two-market insurance bound');
}
