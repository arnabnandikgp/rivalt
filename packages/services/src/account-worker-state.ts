import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getAddressEncoder,getProgramDerivedAddress,type Address,type Decoder,type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {Rpc} from '../../indexer/src/rpc.js';

export function decodeAccountWorker<Value>(account:any,discriminator:ReadonlyUint8Array,decoder:Decoder<Value>&{fixedSize?:number}):Value {
  assert(account?.owner===sdk.CLEARING_PROGRAM_ADDRESS&&!account.executable&&account.data?.[1]==='base64','Missing or foreign account worker input');
  const bytes=Buffer.from(account.data[0],'base64');
  assert(sdk.hex(bytes.subarray(0,8))===sdk.hex(discriminator),'Wrong account worker schema');
  if(decoder.fixedSize!==undefined)assert(bytes.length===decoder.fixedSize,'Wrong account worker size');
  return decoder.decode(bytes);
}

export async function accountWorkerKeys(venue:Address) {
  const [[registry],[resolution],[storage],[prepared],[rates],[plan],[eventAuthority]]=await Promise.all([
    sdk.deriveVenueComponent(venue,'registry'),sdk.deriveVenueComponent(venue,'resolution'),sdk.deriveRecoveryStorage(venue),
    sdk.deriveSettlementWorkspace(venue,'prepared'),sdk.deriveSettlementWorkspace(venue,'rates'),sdk.deriveSettlementWorkspace(venue,'plan'),
    getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds:[Buffer.from('__event_authority')]})]);
  return {registry,resolution,storage,prepared,rates,plan,eventAuthority,program:sdk.CLEARING_PROGRAM_ADDRESS};
}

export function financialMembershipHash(registry:sdk.VenueRegistry) {
  return createHash('sha256').update('rivalt-financial-membership-v1').update(Buffer.from(getAddressEncoder().encode(registry.venue)))
    .update(Buffer.from(getAddressEncoder().encode(registry.liveIndex))).update(sdk.memberIndexBytes(registry.membershipEpoch))
    .update(sdk.memberIndexBytes(registry.financialCount)).digest();
}

/** Fixed-size coherent continuation. Frozen rows/limbs are fetched only for the
 * next bounded request; ordinary liquidation never downloads the full cohort. */
export async function readAccountResolution(rpc:Pick<Rpc,'call'>,venue:Address) {
  const keys=await accountWorkerKeys(venue);
  const fields=['registry','resolution','storage','prepared','rates','plan'] as const;
  const response=await rpc.call('getMultipleAccounts',[fields.map(field=>keys[field]),{encoding:'base64',commitment:'confirmed'}]);
  assert(response.value?.length===fields.length,'Incomplete resolution continuation');
  const descriptors=[
    [sdk.VENUE_REGISTRY_DISCRIMINATOR,sdk.getVenueRegistryDecoder()],
    [sdk.RESOLUTION_DISCRIMINATOR,sdk.getResolutionDecoder()],
    [sdk.RECOVERY_STORAGE_DISCRIMINATOR,sdk.getRecoveryStorageDecoder()],
    [sdk.PREPARED_SETTLEMENT_DISCRIMINATOR,sdk.getPreparedSettlementDecoder()],
    [sdk.SETTLEMENT_RATES_DISCRIMINATOR,sdk.getSettlementRatesDecoder()],
    [sdk.SETTLEMENT_PLAN_DISCRIMINATOR,sdk.getSettlementPlanDecoder()],
  ] as const;
  const decoded=descriptors.map(([tag,decoder],index)=>decodeAccountWorker(response.value[index],tag,decoder as Decoder<any>));
  const [registry,header,storage,prepared,rates,plan]=decoded as [sdk.VenueRegistry,sdk.Resolution,sdk.RecoveryStorage,sdk.PreparedSettlement,sdk.SettlementRates,sdk.SettlementPlan];
  const bumps=await Promise.all([sdk.deriveVenueComponent(venue,'registry'),sdk.deriveVenueComponent(venue,'resolution'),sdk.deriveRecoveryStorage(venue),
    sdk.deriveSettlementWorkspace(venue,'prepared'),sdk.deriveSettlementWorkspace(venue,'rates'),sdk.deriveSettlementWorkspace(venue,'plan')]);
  decoded.forEach((value,index)=>assert(value.schemaVersion===10&&value.venue===venue&&value.bump===bumps[index][1]&&value.revision>0n,'Foreign resolution continuation'));
  assert(registry.financialCount<=registry.registeredCount&&registry.registeredCount<=registry.nextId&&registry.membershipEpoch>0n
    &&registry.liveIndex===(await sdk.deriveMemberIndex(venue,14,0n))[0],'Invalid Financial registry');
  if([1,2,14,15,16].includes(header.stage)) {
    assert(header.count>0n&&header.count===registry.financialCount&&header.membershipEpoch===registry.membershipEpoch&&header.liveIndex===registry.liveIndex
      &&sdk.hex(header.registryHash)===sdk.hex(financialMembershipHash(registry))&&storage.lockedEpoch===header.epoch
      &&storage.readyCapacity>=header.count,'Frozen membership/workspace mismatch');
  }
  return {...keys,registryState:registry,header,storageState:storage,preparedState:prepared,ratesState:rates,planState:plan,
    raw:response.value.map((value:any)=>Buffer.from(value.data[0],'base64')),contextSlot:BigInt(response.context.slot)};
}

export function accountRiskSources(snapshot:sdk.AccountSnapshot) {
  const btc=snapshot.marketStates[0].oracle.sources,eth=snapshot.marketStates[1].oracle.sources;
  return {primaryBtc:btc[0],primaryCollateral:btc[1],guardBtc:btc[2],guardCollateral:btc[3],primaryEth:eth[0],guardEth:eth[2]};
}

/** Frozen work selects no live financial candidate: its canonical source and
 * cursor already bind the complete cohort. Do not make it depend on read-API
 * publication freshness. The program authenticates every derived account again. */
export async function accountDefaultContext(rpc:Pick<Rpc,'call'>,state:Awaited<ReturnType<typeof readAccountResolution>>) {
  const venue=state.registryState.venue;
  assert([2,14,15,16].includes(state.header.stage),'No authenticated frozen continuation');
  const [[custody],[safety],[vault],[btc],[eth]]=await Promise.all([
    sdk.deriveVenueComponent(venue,'custody'),sdk.deriveVenueComponent(venue,'safety'),sdk.deriveVenueComponent(venue,'vault'),
    sdk.deriveAccountMarket(venue,0),sdk.deriveAccountMarket(venue,1)]);
  const [[btcLedger],[ethLedger]]=await Promise.all([sdk.deriveMarketLedger(btc),sdk.deriveMarketLedger(eth)]);
  const slot=await rpc.call('getSlot',[{commitment:'confirmed',minContextSlot:Number(state.contextSlot)}]);
  assert(Number.isSafeInteger(slot)&&BigInt(slot)>=state.contextSlot,'Default clock predates continuation');
  return {...state,venue,custody,safety,vault,btc,eth,btcLedger,ethLedger,slot:BigInt(slot)};
}
