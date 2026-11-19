/** Explicit schema-9 scratch identities. A valid checkpoint is never substituted
 * for financial event history or a reconciled margin account. */
import assert from 'node:assert/strict';
import {address,getAddressEncoder,getProgramDerivedAddress} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from './events.js';
import type {AccountState} from './account-projection.js';
type FrozenRow=NonNullable<AccountState['resolution']>['rows'][string];
export const settlementDescriptors=[
  [sdk.PREPARED_SETTLEMENT_DISCRIMINATOR,1460,sdk.getPreparedSettlementDecoder()],
  [sdk.FROZEN_MARGIN_PAGE_DISCRIMINATOR,1156,sdk.getFrozenMarginPageDecoder()],
  [sdk.MEMBER_INDEX_NODE_DISCRIMINATOR,190,sdk.getMemberIndexNodeDecoder()],
  [sdk.MEMBER_PAGE_DISCRIMINATOR,2699,sdk.getMemberPageDecoder()],
  [sdk.SETTLEMENT_LIMB_PAGE_DISCRIMINATOR,2129,sdk.getSettlementLimbPageDecoder()],
  [sdk.SETTLEMENT_RATES_DISCRIMINATOR,1204,sdk.getSettlementRatesDecoder()],
  [sdk.SETTLEMENT_PLAN_DISCRIMINATOR,1181,sdk.getSettlementPlanDecoder()],
] as const;
export function scopedSchema(kind:number) {
  assert(Number.isInteger(kind)&&kind>=0&&kind<=27&&kind!==11&&kind!==12,'Known scoped kind');
  return sdk.ACCOUNT_SCHEMA;
}
const le64=(value:bigint)=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(value);return bytes;};
const le32=(value:number)=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
export async function reconcileSettlementScratch(key:string,kind:number,bytes:Buffer,state:AccountState,
  binding:{venue:string;program:string;artifactSet?:string},frozenIds:readonly string[]) {
  const descriptor=settlementDescriptors[kind-17];assert(descriptor,'Known settlement kind');
  const allocation=kind===18&&binding.artifactSet===sdk.LINKED_ALLOCATION_ARTIFACT_SET?sdk.getLinkedAllocationPageDecoder():
    kind===18&&binding.artifactSet===sdk.BTC_ALLOCATION_ARTIFACT_SET?sdk.getBtcAllocationPageDecoder():undefined;
  assert.equal(bytes.length,allocation?.fixedSize??descriptor[1]);assert(bytes.subarray(0,8).equals(Buffer.from(descriptor[0])));
  const value=(allocation??descriptor[2]).decode(bytes) as any;
  assert.equal(value.schemaVersion,10);assert.equal(value.venue,binding.venue);
  let label:string,suffix:Uint8Array[];
  switch(kind) {
    case 17:label='prepared-settlement';suffix=[];break;
    case 18:label='frozen-margin-page';suffix=[le64(value.pageIndex)];assert(value.rowCount<=8);break;
    case 19:label='member-index';suffix=[Uint8Array.of(value.level),le64(value.prefix)];assert(value.level<=14);break;
    case 20:label='member-page';suffix=[le64(value.pageIndex)];break;
    case 21:label='resolution-limbs';suffix=[le32(value.register),le64(value.pageIndex)];
      assert(value.wordCount<=256&&(value.epoch===0n||value.wordCount>0));assert(value.register<=45||value.register>=64&&value.register<=70);break;
    case 22:label='settlement-rates';suffix=[];assert(value.stage<=4);break;
    case 23:label='settlement-plan';suffix=[];assert(value.stage<=12);break;
    default:throw new Error('Unsupported scratch');
  }
  const [canonical,bump]=await getProgramDerivedAddress({programAddress:address(binding.program),
    seeds:[Buffer.from(label),getAddressEncoder().encode(address(binding.venue)),...suffix]});
  assert.equal(key,canonical);assert.equal(value.bump,bump);
  const resolution=state.resolution,plan=state.pagedSettlement;
  if(!resolution||value.epoch!==undefined&&value.epoch!==BigInt(resolution.epoch))return;
  if(kind===17) {
    const header=JSON.parse(json(value));
    const pair=sdk.frozenPairReceipt(value);
    const receipt=sdk.btcAllocationReceipt(value), projected=resolution.allocation;
    if(receipt?.committed||projected?.status===1) {
      assert(receipt?.committed&&projected?.status===1,'Missing complete BTC allocation');
      for(const key of ['attempt','debtorId','shortfall','cursor','capacity','recovered'] as const)
        assert.equal(receipt[key].toString(),projected[key],key);
    }
    const linked=sdk.linkedAllocationReceipt(value),projection=resolution.linkedAllocation;
    if(linked || projection?.status===1) {
      assert(linked&&binding.artifactSet===sdk.LINKED_ALLOCATION_ARTIFACT_SET,'Missing linked certificate');
      if(linked.cursor>0n) {
        assert(projection && projection.status===(linked.committed?1:0),'Missing linked scan');
        for(const key of ['attempt','debtorId','cursor','shares','targets','recovered'] as const)
          assert.deepEqual(JSON.parse(json(linked[key])),projection[key],key);
      } else assert(!projection||projection.status===2&&BigInt(projection.attempt)<linked.attempt,'Invalid restarted linked scan');
    } else if(projection)assert.equal(projection.status,2,'Lost linked scan');
    const shared=sdk.sharedInventoryReceipt(value);
    if(shared || resolution.sharedInventory) {
      assert(binding.artifactSet===sdk.SHARED_INVENTORY_ARTIFACT_SET && shared && resolution.sharedInventory,'Missing shared inventory receipt or event');
      assert.deepEqual(JSON.parse(json(shared)),resolution.sharedInventory,'shared inventory terms');
    }
    const foreign=sdk.foreignCreditorReceipt(value);
    if(foreign || resolution.foreignCreditors) {
      assert((binding.artifactSet===sdk.FOREIGN_CREDITOR_ARTIFACT_SET || binding.artifactSet===sdk.SHARED_INVENTORY_ARTIFACT_SET) && foreign && resolution.foreignCreditors,'Missing atomic foreign creditor receipt or event');
      const {members,legs}=foreign;
      assert.deepEqual(JSON.parse(json({members,charges:legs.map(leg=>leg.charge),eligible:legs.map(leg=>leg.eligible),
        matchedLots:legs.map(leg=>leg.matched),basePrices:legs.map(leg=>leg.price),extraTickLots:legs.map(leg=>leg.extra)})),resolution.foreignCreditors);
    }
    const joint=sdk.frozenJointReceipt(value);
    if(resolution.joint || joint?.complete) {
      assert((binding.artifactSet===sdk.LINKED_PAIR_ARTIFACT_SET || binding.artifactSet===sdk.LINKED_FLAT_ARTIFACT_SET || binding.artifactSet===sdk.LINKED_ALLOCATION_ARTIFACT_SET) && joint?.complete && resolution.joint,
        'Missing verified joint receipt or event');
      const {debtor,shares,legs}=joint;
      assert.deepEqual(JSON.parse(json({debtorId:debtor,shares,winners:legs.map(leg=>leg.winner),
        charges:legs.map(leg=>leg.charge),eligible:legs.map(leg=>leg.eligible),matchedLots:legs.map(leg=>leg.matched),
        basePrices:legs.map(leg=>leg.price),extraTickLots:legs.map(leg=>leg.extra)})),resolution.joint,'joint terms');
    }
    if(resolution.pair||pair) {
      assert(pair&&resolution.pair,'Missing verified pair receipt or event');
      const {epoch,...terms}=JSON.parse(json(pair));assert.equal(epoch,resolution.epoch);assert.deepEqual(terms,resolution.pair);
    }
    for(const [field,expected] of Object.entries({count:String(resolution.count),registryHash:resolution.registryHash,
      prices:resolution.prices,funding:resolution.funding,allocated:resolution.allocatedBefore,pools:resolution.poolsBefore,
      insurance:resolution.insuranceBefore,fees:resolution.feesBefore}))assert.deepEqual(header[field],expected,`Prepared ${field}`);
    const source=Object.entries(state.revisions).find(([,entry])=>entry.kind===10);assert(source);assert.equal(header.source,source[0]);
    if(plan)assert.equal(BigInt(header.sourceRevision)+1n,BigInt(plan.adoptionRevision));
  }
  if(kind===18&&!plan&&resolution.linkedAllocation) {
    const scan=resolution.linkedAllocation;
    for(let offset=0;offset<value.rowCount;offset++) {
      const row=value.rows[offset],charge=scan.charges[String(row.id)];
      if(charge)assert.deepEqual(row.linkedCharges.map(String),charge,'Scored frozen charges');
    }
  }
  if(kind===18&&plan) {
    for(let within=0;within<value.rowCount;within++) {
      const ordinal=value.pageIndex*8n+BigInt(within),row=value.rows[within];
      assert(ordinal<BigInt(frozenIds.length),'Complete frozen row');
      const id=frozenIds[Number(ordinal)],frozen:FrozenRow=resolution.rows[id];
      const actual=JSON.parse(json(row));
      if(resolution.linkedAllocation?.status===1)assert.deepEqual(actual.linkedCharges,resolution.linkedAllocation.charges[id],'Frozen linked charges');
      if(resolution.allocation?.status===1)assert.equal(actual.btcCharge,resolution.allocation.charges[id],'Frozen allocated BTC charge');
      for(const [field,expected] of Object.entries({id,member:frozen.member,cash:frozen.cashBefore,
        lots:frozen.lots,generations:frozen.generations,claims:frozen.claimsScaled,collected:frozen.collected,
        activationGeneration:frozen.activationGeneration,originalRevision:frozen.originalRevision}))assert.deepEqual(actual[field],expected,`Frozen ${field}`);
    }
  }
  if(kind===23&&plan) {
    assert.equal(key,plan.plan);const actual=JSON.parse(json(value));
    for(const [field,expected] of Object.entries({epoch:plan.epoch,stage:plan.stage,cursor:plan.cursor,adoptionRevision:plan.adoptionRevision,
      originalCashRemaining:plan.remainingCash,cashApplied:plan.appliedCash,marketMovements:plan.marketMovements,insuranceSpent:plan.insuranceSpent}))
      assert.deepEqual(actual[field],expected,`Plan ${field}`);
  }
  if(kind===21&&value.register===64&&plan) {
    const words:bigint[]=value.payload.words;
    for(let offset=0;offset+7<=value.wordCount;offset+=7) {
      const ordinal=value.pageIndex*36n+BigInt(offset/7);
      if(ordinal>=BigInt(plan.count))break;
      assert(ordinal<BigInt(frozenIds.length),'Complete frozen flow');
      const id=frozenIds[Number(ordinal)],row:FrozenRow=resolution.rows[id];
      const flags=Buffer.alloc(16);flags.writeBigUInt64LE(words[offset+5]);flags.writeBigUInt64LE(words[offset+6],8);
      assert.equal(words[offset],BigInt(id));assert.equal(words[offset+1],BigInt(row.cashBefore));
      assert.equal(flags[15],row.applied?1:0);
      if(row.applied)assert.deepEqual(words.slice(offset+2,offset+5).map(String),[...row.flows!,row.cashAfter!]);
    }
  }
}
