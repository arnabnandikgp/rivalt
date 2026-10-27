import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {type Address,type Decoder,type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {Rpc} from '../../indexer/src/rpc.js';
import {integer} from '../../indexer/src/rpc.js';
import {proposeAccountRates,type AccountRateInputs} from './account-rate-proposal.js';

/** Current canonical frozen pages, not projected or retained acceptance data.
 * One final batch includes header/registry/safety and the complete <=32 pages.
 * The service's environment additionally authenticates genesis/anchor/artifacts. */
export async function readAccountRateProposal(rpc:Pick<Rpc,'call'>,venue:Address,epoch:bigint) {
  const component=(name:Parameters<typeof sdk.findVenueComponentV3Pda>[1])=>sdk.findVenueComponentV3Pda(venue,name);
  const [[resolution,resolutionBump],[safety,safetyBump],[registry,registryBump]]=await Promise.all([component('resolution'),component('safety'),component('registry')]);
  const decode=<Value>(account:any,discriminator:ReadonlyUint8Array,decoder:Decoder<Value>&{fixedSize?:number})=>{
    assert(account?.owner===sdk.CLEARING_PROGRAM_ADDRESS&&account.data?.[1]==='base64','Foreign/missing frozen proposal dependency.');
    const bytes=Buffer.from(account.data[0],'base64');assert(sdk.hex(bytes.subarray(0,8))===sdk.hex(discriminator),'Wrong frozen proposal schema.');
    if(decoder.fixedSize!==undefined)assert(bytes.length===decoder.fixedSize,'Wrong frozen proposal account size.');
    return decoder.decode(bytes);
  };
  const discovery=await rpc.call('getAccountInfo',[resolution,{encoding:'base64',commitment:'confirmed'}]);
  const discovered=decode(discovery.value,sdk.RESOLUTION_V3_DISCRIMINATOR,sdk.getResolutionV3Decoder());
  assert(discovered.schemaVersion===3&&discovered.venue===venue&&discovered.epoch===epoch&&discovered.stage===4&&
    discovered.count>0&&discovered.count<=64,'No complete frozen cohort awaiting proposal.');
  const pages=await Promise.all(Array.from({length:Math.ceil(discovered.count/2)},(_,index)=>sdk.findResolutionPageV3Pda(venue,index)));
  const keys=[venue,safety,registry,resolution,...pages.map(([key])=>key)];
  const response=await rpc.call('getMultipleAccounts',[keys,{encoding:'base64',commitment:'confirmed',minContextSlot:integer(discovery.context.slot)}]);
  assert(response.value?.length===keys.length&&integer(response.context.slot)>=integer(discovery.context.slot),'Incomplete frozen proposal snapshot.');
  const venueState=decode(response.value[0],sdk.VENUE_V3_DISCRIMINATOR,sdk.getVenueV3Decoder());
  const safetyState=decode(response.value[1],sdk.SAFETY_V3_DISCRIMINATOR,sdk.getSafetyV3Decoder());
  const registryState=decode(response.value[2],sdk.VENUE_REGISTRY_V3_DISCRIMINATOR,sdk.getVenueRegistryV3Decoder());
  const header=decode(response.value[3],sdk.RESOLUTION_V3_DISCRIMINATOR,sdk.getResolutionV3Decoder());
  const [canonicalVenue,venueBump]=await sdk.deriveAccountVenue(Uint8Array.from(venueState.domain));
  assert(canonicalVenue===venue&&venueState.bump===venueBump&&venueState.schemaVersion===3&&venueState.profileVersion===3&&
    venueState.marketCount===2&&venueState.insuranceFeeShareBps===2500,'Foreign proposal venue/profile.');
  assert(safetyState.schemaVersion===3&&safetyState.venue===venue&&safetyState.bump===safetyBump&&safetyState.mode===2&&safetyState.paused&&
    safetyState.resolutionEpoch===epoch&&safetyState.epoch===header.safetyEpoch,'Proposal venue is not in the expected freeze.');
  assert(header.schemaVersion===3&&header.venue===venue&&header.bump===resolutionBump&&header.epoch===epoch&&header.stage===4&&
    header.cursor===0&&header.evaluation<3&&header.termsEpoch===venueState.termsEpoch&&header.count===discovered.count,'Frozen proposal stage/epoch changed.');
  assert(registryState.schemaVersion===3&&registryState.venue===venue&&registryState.bump===registryBump&&registryState.count===header.count&&
    registryState.members.length===header.count&&new Set(registryState.members).size===header.count&&
    registryState.members.every(member=>member!=='11111111111111111111111111111111'),'Incomplete or duplicate frozen registry.');
  const registryHash=createHash('sha256').update(sdk.getVenueRegistryV3Encoder().encode(registryState).slice(8)).digest();
  assert(sdk.hex(registryHash)===sdk.hex(header.registryHash),'Frozen registry hash mismatch.');
  const rows:AccountRateInputs['rows']=[];
  for(const [index,[,bump]] of pages.entries()) {
    const page=decode(response.value[4+index],sdk.RESOLUTION_PAGE_V3_DISCRIMINATOR,sdk.getResolutionPageV3Decoder());
    const count=Math.min(2,header.count-2*index);
    assert(page.schemaVersion===3&&page.venue===venue&&page.bump===bump&&page.epoch===epoch&&page.pageIndex===index&&page.rowCount===count,
      'Incomplete or foreign frozen page.');
    for(let offset=0;offset<count;offset++) {
      const row=page.rows[offset];assert(row.member===registryState.members[2*index+offset]&&!row.applied,'Wrong frozen member/order/application state.');
      const debts=row.claimsScaled.reduce((total,value)=>total+(value<0n?-value:0n),0n)/1_000_000_000n;
      assert(row.collected===(row.cashBefore<debts?row.cashBefore:debts),'Frozen collection mismatch.');
      rows.push({cash:row.cashBefore,claims:[row.claimsScaled[0],row.claimsScaled[1]]});
    }
  }
  assert(rows.reduce((total,row)=>total+row.cash,0n)===header.cashBefore&&
    header.budgets.every((budget,index)=>budget<=header.insuranceBefore[index]),'Frozen cash/insurance mismatch.');
  for(const market of [0,1])assert(rows.reduce((total,row)=>total+(row.claims[market]>0n?row.claims[market]:0n),0n)===header.positiveScaled[market],
    'Frozen positive-claim aggregate mismatch.');
  const proposal=proposeAccountRates({rows,pools:[header.poolsBefore[0],header.poolsBefore[1]],budgets:[header.budgets[0],header.budgets[1]]});
  assert(header.common.limbs.reduceRight((total,limb)=>(total<<64n)+limb,0n)===proposal.common,'Frozen common denominator mismatch.');
  return {resolution,header,registry:registryState,pages:pages.map(([key])=>key),proposal,contextSlot:integer(response.context.slot)};
}
