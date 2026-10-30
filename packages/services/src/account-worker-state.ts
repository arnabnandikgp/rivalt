import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getProgramDerivedAddress,type Address,type Decoder,type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {Rpc} from '../../indexer/src/rpc.js';

export function decodeAccountWorker<Value>(account:any,discriminator:ReadonlyUint8Array,decoder:Decoder<Value>&{fixedSize?:number}):Value {
  assert(account?.owner===sdk.CLEARING_PROGRAM_ADDRESS&&account.data?.[1]==='base64','Missing or foreign account worker input');
  const bytes=Buffer.from(account.data[0],'base64');
  assert(sdk.hex(bytes.subarray(0,8))===sdk.hex(discriminator),'Wrong account worker schema');
  if(decoder.fixedSize!==undefined)assert(bytes.length===decoder.fixedSize,'Wrong account worker size');
  return decoder.decode(bytes);
}

export async function accountWorkerKeys(venue:Address) {
  const [[registry],[resolution],[work],[eventAuthority]]=await Promise.all([
    sdk.deriveVenueComponent(venue,'registry'),sdk.deriveVenueComponent(venue,'resolution'),
    sdk.deriveVenueComponent(venue,'resolution-work'),
    getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds:[Buffer.from('__event_authority')]})]);
  return {registry,resolution,work,eventAuthority,program:sdk.CLEARING_PROGRAM_ADDRESS};
}

/** Complete frozen continuation in one batch. Ordinary trading and own-cash
 * exits never use this registry/page scan. No retained evidence is an input. */
export async function readAccountResolution(rpc:Pick<Rpc,'call'>,venue:Address) {
  const keys=await accountWorkerKeys(venue);
  const [[,registryBump],[,resolutionBump],[,workBump],pages]=await Promise.all([
    sdk.deriveVenueComponent(venue,'registry'),sdk.deriveVenueComponent(venue,'resolution'),
    sdk.deriveVenueComponent(venue,'resolution-work'),
    Promise.all(Array.from({length:32},(_,index)=>sdk.findResolutionPagePda(venue,index)))]);
  const response=await rpc.call('getMultipleAccounts',[[keys.registry,keys.resolution,keys.work,...pages.map(([key])=>key)],
    {encoding:'base64',commitment:'confirmed'}]);
  assert(response.value?.length===35,'Incomplete resolution continuation');
  const registry=decodeAccountWorker(response.value[0],sdk.VENUE_REGISTRY_DISCRIMINATOR,sdk.getVenueRegistryDecoder());
  const header=decodeAccountWorker(response.value[1],sdk.RESOLUTION_DISCRIMINATOR,sdk.getResolutionDecoder());
  const work=decodeAccountWorker(response.value[2],sdk.RESOLUTION_WORK_DISCRIMINATOR,sdk.getResolutionWorkDecoder());
  assert(registry.schemaVersion===5&&registry.venue===venue&&registry.bump===registryBump&&registry.count>0&&registry.count<=64&&
    registry.members.length===registry.count&&new Set(registry.members).size===registry.count,'Invalid complete resolution registry');
  assert(header.schemaVersion===5&&header.venue===venue&&header.bump===resolutionBump&&
    work.schemaVersion===5&&work.venue===venue&&work.bump===workBump,'Foreign resolution continuation');
  const rows:sdk.ResolutionRow[]=[];
  if(header.stage>=2&&header.stage<=11) {
    assert(header.count===registry.count&&work.epoch===header.epoch,'Resolution epoch/count mismatch');
    const hash=createHash('sha256').update(sdk.getVenueRegistryEncoder().encode(registry).slice(8)).digest();
    assert(sdk.hex(hash)===sdk.hex(header.registryHash),'Frozen membership hash mismatch');
    for(let index=0;index<Math.ceil(header.count/2);index++) {
      const page=decodeAccountWorker(response.value[3+index],sdk.RESOLUTION_PAGE_DISCRIMINATOR,sdk.getResolutionPageDecoder());
      assert(page.schemaVersion===5&&page.venue===venue&&page.bump===pages[index][1]&&page.pageIndex===index,'Foreign resolution page');
      // Future pages in Value still contain the previous/precreated epoch.
      if(header.stage>2)assert(page.epoch===header.epoch&&page.rowCount===Math.min(2,header.count-2*index),'Incomplete frozen page');
      rows.push(...page.rows.slice(0,Math.min(2,header.count-2*index)));
    }
    if(header.stage>2)assert(rows.every((row,index)=>row.member===registry.members[index]),'Wrong frozen row order');
  }
  return {...keys,registryState:registry,header,workState:work,pages:pages.map(([key])=>key),rows};
}

export function accountRiskSources(snapshot:sdk.AccountSnapshot) {
  const btc=snapshot.marketStates[0].oracle.sources,eth=snapshot.marketStates[1].oracle.sources;
  return {primaryBtc:btc[0],primaryCollateral:btc[1],guardBtc:btc[2],guardCollateral:btc[3],primaryEth:eth[0],guardEth:eth[2]};
}

export function accountRemainderOrders(rows:sdk.ResolutionRow[],denominator:bigint):[number[],number[]] {
  assert(rows.length>0&&rows.length<=64&&denominator>0n,'Invalid remainder inputs');
  const orders=[0,1].map(market=>{
    const remainders=rows.map(row=>{
      if(row.claimsScaled[market]<=0n)return 0n;
      const numerator=row.exactFlowNumerators[market].limbs.reduceRight((total,limb)=>(total<<64n)+limb,0n);
      const remainder=numerator-row.roundedFlows[market]*denominator;
      assert(remainder>=0n&&remainder<denominator,'Invalid verified flow remainder');return remainder;
    });
    return rows.map((_,index)=>index).sort((left,right)=>remainders[left]===remainders[right]?left-right:remainders[left]>remainders[right]?-1:1);
  });
  return [orders[0],orders[1]];
}
