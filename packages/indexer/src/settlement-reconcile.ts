/** Explicit schema-9 scratch identities. A valid checkpoint is never substituted
 * for financial event history or a reconciled margin account. */
import assert from 'node:assert/strict';
import {address,getAddressEncoder,getProgramDerivedAddress} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from './events.js';
import type {AccountState} from './account-projection.js';
export const settlementDescriptors=[
  [sdk.PREPARED_SETTLEMENT_DISCRIMINATOR,1463,sdk.getPreparedSettlementDecoder()],
  [sdk.FROZEN_MARGIN_PAGE_DISCRIMINATOR,1156,sdk.getFrozenMarginPageDecoder()],
  [sdk.MEMBER_INDEX_NODE_DISCRIMINATOR,190,sdk.getMemberIndexNodeDecoder()],
  [sdk.MEMBER_PAGE_DISCRIMINATOR,2699,sdk.getMemberPageDecoder()],
  [sdk.SETTLEMENT_LIMB_PAGE_DISCRIMINATOR,2129,sdk.getSettlementLimbPageDecoder()],
  [sdk.SETTLEMENT_RATES_DISCRIMINATOR,1204,sdk.getSettlementRatesDecoder()],
  [sdk.SETTLEMENT_PLAN_DISCRIMINATOR,1181,sdk.getSettlementPlanDecoder()],
] as const;
export function scopedSchema(kind:number) {
  assert(Number.isInteger(kind)&&kind>=0&&kind<=23,'Known scoped kind');
  return kind>=17?9:8;
}
const le64=(value:bigint)=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(value);return bytes;};
const le32=(value:number)=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
export async function reconcileSettlementScratch(key:string,kind:number,bytes:Buffer,state:AccountState,
  binding:{venue:string;program:string}) {
  const descriptor=settlementDescriptors[kind-17];assert(descriptor,'Known settlement kind');
  assert.equal(bytes.length,descriptor[1]);assert(bytes.subarray(0,8).equals(Buffer.from(descriptor[0])));
  const value=descriptor[2].decode(bytes) as any;
  assert.equal(value.schemaVersion,9);assert.equal(value.venue,binding.venue);
  let label:string,suffix:Uint8Array[];
  switch(kind) {
    case 17:label='prepared-settlement';suffix=[le64(value.epoch)];break;
    case 18:label='frozen-margin-page';suffix=[le64(value.epoch),le64(value.pageIndex)];assert(value.rowCount<=8);break;
    case 19:label='member-index';suffix=[Uint8Array.of(value.level),le64(value.prefix)];assert(value.level<=14);break;
    case 20:label='member-page';suffix=[le64(value.pageIndex)];break;
    case 21:label='resolution-limbs';suffix=[le64(value.epoch),le32(value.register),le64(value.pageIndex)];
      assert(value.wordCount>0&&value.wordCount<=256);assert(value.register<=45||value.register>=64&&value.register<=70);break;
    case 22:label='settlement-rates';suffix=[le64(value.epoch)];assert(value.stage<=4);break;
    case 23:label='settlement-plan';suffix=[le64(value.epoch)];assert(value.stage<=12);break;
    default:throw new Error('Unsupported scratch');
  }
  const [canonical,bump]=await getProgramDerivedAddress({programAddress:address(binding.program),
    seeds:[Buffer.from(label),getAddressEncoder().encode(address(binding.venue)),...suffix]});
  assert.equal(key,canonical);assert.equal(value.bump,bump);
  const resolution=state.resolution,plan=state.pagedSettlement;
  if(!resolution||value.epoch!==undefined&&value.epoch!==BigInt(resolution.epoch))return;
  if(kind===17) {
    const header=JSON.parse(json(value));
    for(const [field,expected] of Object.entries({count:String(resolution.count),registryHash:resolution.registryHash,
      prices:resolution.prices,funding:resolution.funding,allocated:resolution.allocatedBefore,pools:resolution.poolsBefore,
      insurance:resolution.insuranceBefore,fees:resolution.feesBefore}))assert.deepEqual(header[field],expected,`Prepared ${field}`);
    const source=Object.entries(state.revisions).find(([,entry])=>entry.kind===10);assert(source);assert.equal(header.source,source[0]);
    if(plan)assert.equal(BigInt(header.sourceRevision)+1n,BigInt(plan.adoptionRevision));
  }
  if(kind===18&&plan) {
    for(let within=0;within<value.rowCount;within++) {
      const ordinal=value.pageIndex*8n+BigInt(within),row=value.rows[within];
      const frozen:NonNullable<AccountState['resolution']>['rows'][number]|undefined=Object.entries(resolution.rows).find(([id])=>BigInt(id)===ordinal)?.[1];assert(frozen,'Complete frozen row');
      const actual=JSON.parse(json(row));
      for(const [field,expected] of Object.entries({id:ordinal.toString(),member:frozen.member,cash:frozen.cashBefore,
        lots:frozen.lots,generations:frozen.generations,claims:frozen.claimsScaled,collected:frozen.collected,
        activationGeneration:'1',originalRevision:frozen.originalRevision}))assert.deepEqual(actual[field],expected,`Frozen ${field}`);
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
      const row:NonNullable<AccountState['resolution']>['rows'][number]|undefined=Object.entries(resolution.rows).find(([id])=>BigInt(id)===ordinal)?.[1];assert(row);
      const flags=Buffer.alloc(16);flags.writeBigUInt64LE(words[offset+5]);flags.writeBigUInt64LE(words[offset+6],8);
      assert.equal(words[offset],ordinal);assert.equal(words[offset+1],BigInt(row.cashBefore));
      assert.equal(flags[15],row.applied?1:0);
      if(row.applied)assert.deepEqual(words.slice(offset+2,offset+5).map(String),[...row.flows!,row.cashAfter!]);
    }
  }
}
