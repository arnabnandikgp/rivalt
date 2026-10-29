import assert from 'node:assert/strict';
import {address,getAddressDecoder,getAddressEncoder,getProgramDerivedAddress,type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from './events.js';
import {integer} from './rpc.js';
import {compareReconciliationSequence} from './reconciliation-progress.js';
import {accountFields,reconcileAccountLedger,type AccountState} from './account-projection.js';
import type {AccountBinding} from './account-store.js';
import type {AccountBatch} from './group-reconcile.js';

/** Every <=100-key chunk includes the custody sequence. A newer finalized prefix
 * requests backfill; no different economic snapshots are silently combined. */
export async function reconcileAccountSnapshot(state:AccountState,binding:Pick<AccountBinding,'venue'|'domain'|'program'>,read:AccountBatch) {
  reconcileAccountLedger(state);
  const venue=address(binding.venue),program=address(binding.program);
  const identities=new Map<string,{bump:number;decoder:{decode(bytes:Uint8Array):unknown};discriminator:ReadonlyUint8Array;expected:unknown}>();
  const expect=async (key:string,derive:Promise<readonly [string,number]>,decoder:{decode(bytes:Uint8Array):unknown},
    discriminator:ReadonlyUint8Array,expected:unknown)=>{
    const [canonical,bump]=await derive;assert.equal(key,canonical,'Canonical schema-3 PDA');
    identities.set(key,{bump,decoder,discriminator,expected});
  };
  const component=(name:Parameters<typeof sdk.findVenueComponentV3Pda>[1])=>sdk.findVenueComponentV3Pda(venue,name,program);
  const [custody]=await component('custody'),[safety]=await component('safety'),[registry]=await component('registry'),[vault,vaultBump]=await component('vault');
  assert.equal(state.venue!.vault,vault);
  await expect(custody,component('custody'),sdk.getCustodyV3Decoder(),sdk.CUSTODY_V3_DISCRIMINATOR,state.custody);
  await expect(venue,sdk.deriveAccountVenue(Buffer.from(binding.domain,'hex'),program),sdk.getVenueV3Decoder(),sdk.VENUE_V3_DISCRIMINATOR,state.venue);
  await expect(safety,component('safety'),sdk.getSafetyV3Decoder(),sdk.SAFETY_V3_DISCRIMINATOR,state.safety);
  if(state.membershipVersion!==null)await expect(registry,component('registry'),sdk.getVenueRegistryV3Decoder(),sdk.VENUE_REGISTRY_V3_DISCRIMINATOR,
    {schemaVersion:3,venue,membershipVersion:state.membershipVersion,count:state.members.length,members:state.members});
  for(const [key,value] of Object.entries(state.markets))await expect(key,sdk.findMarketV3Pda(venue,value.index,program),sdk.getMarketV3Decoder(),sdk.MARKET_V3_DISCRIMINATOR,value);
  for(const [key,value] of Object.entries(state.ledgers))await expect(key,sdk.findLedgerV3Pda(address(value.market),program),sdk.getMarketLedgerV3Decoder(),sdk.MARKET_LEDGER_V3_DISCRIMINATOR,value);
  for(const [key,value] of Object.entries(state.portfolios))await expect(key,sdk.deriveAccountPortfolio(venue,address(value.owner),value.index,program),sdk.getPortfolioV3Decoder(),sdk.PORTFOLIO_V3_DISCRIMINATOR,value);
  for(const [key,value] of Object.entries(state.roots))await expect(key,sdk.findMarginV3Pda(address(value.portfolio),value.subaccountIndex,program),sdk.getMarginAccountV3Decoder(),sdk.MARGIN_ACCOUNT_V3_DISCRIMINATOR,value);
  for(const [key,value] of Object.entries(state.makers))await expect(key,sdk.findAccountMakerV3Pda(address(value.market),value.makerId,program),sdk.getMakerRegistrationV3Decoder(),sdk.MAKER_REGISTRATION_V3_DISCRIMINATOR,value);
  if(state.liquidity) {
    assert.equal(state.venue!.profileVersion,4);
    for(const [key,value] of Object.entries(state.liquidity.registries))await expect(key,sdk.findLiquidityRegistryV4Pda({market:address(value.market)},{programAddress:program}),sdk.getLiquidityRegistryV4Decoder(),sdk.LIQUIDITY_REGISTRY_V4_DISCRIMINATOR,value);
    for(const [key,value] of Object.entries(state.liquidity.makers))await expect(key,getProgramDerivedAddress({programAddress:program,
      seeds:[Buffer.from('maker-v4'),getAddressEncoder().encode(address(value.market)),Uint8Array.of(value.instance)]}),sdk.getMakerRegistrationV4Decoder(),sdk.MAKER_REGISTRATION_V4_DISCRIMINATOR,value);
    for(const [key,value] of Object.entries(state.liquidity.publishers))await expect(key,sdk.findFundingPublisherV4Pda({market:address(value.market)},{programAddress:program}),sdk.getFundingPublisherV4Decoder(),sdk.FUNDING_PUBLISHER_V4_DISCRIMINATOR,value);
  }
  for(const [key,value] of Object.entries(state.backing))await expect(key,sdk.findBackingV3Pda(venue,value.marketIndex,program),sdk.getSettlementCertificateV3Decoder(),sdk.SETTLEMENT_CERTIFICATE_V3_DISCRIMINATOR,value);
  if(state.retirement){const [key]=await component('retirement');await expect(key,component('retirement'),sdk.getRetirementCertificateV3Decoder(),sdk.RETIREMENT_CERTIFICATE_V3_DISCRIMINATOR,state.retirement);}
  const resolutionKeys:string[]=[];
  if(state.resolution) {
    resolutionKeys.push((await component('resolution'))[0]);
    for(let page=0;page<Math.ceil(state.resolution.count/2);page++)resolutionKeys.push((await sdk.findResolutionPageV3Pda(venue,page,program))[0]);
  }
  const keys=[...identities.keys(),vault,...resolutionKeys],observed=new Map<string,{owner:string;data:[string,string]}|null>();
  let reference:string|undefined,minSlot:number|undefined,maxSlot=0;
  for(let offset=1;offset<keys.length;offset+=99) {
    const chunk=[custody,...keys.slice(offset,offset+99)],response=await read(chunk);
    integer(response.context.slot);assert.equal(response.value.length,chunk.length);
    const current=response.value[0];assert(current?.owner===program&&current.data[1]==='base64','Custody owner/encoding');
    const bytes=Buffer.from(current.data[0],'base64');assert(bytes.subarray(0,8).equals(Buffer.from(sdk.CUSTODY_V3_DISCRIMINATOR)));
    const decoded=sdk.getCustodyV3Decoder().decode(bytes);assert.equal(decoded.schemaVersion,3);assert.equal(decoded.venue,venue);
    compareReconciliationSequence(decoded.sequence,BigInt(state.sequence));
    if(reference)assert.equal(reference,current.data[0],'Custody changed within reconciliation');reference=current.data[0];
    minSlot=Math.min(minSlot??response.context.slot,response.context.slot);maxSlot=Math.max(maxSlot,response.context.slot);
    chunk.forEach((key,index)=>observed.set(key,response.value[index]));
  }
  const raw=(key:string,discriminator?:ReadonlyUint8Array,owner:string=program)=>{
    const account=observed.get(key);assert(account?.owner===owner&&account.data[1]==='base64',`Missing/foreign account ${key}`);
    const bytes=Buffer.from(account.data[0],'base64');if(discriminator)assert(bytes.subarray(0,8).equals(Buffer.from(discriminator)),`Discriminator ${key}`);return bytes;
  };
  for(const [key,identity] of identities) {
    const actual=identity.decoder.decode(raw(key,identity.discriminator)) as {bump:number;vaultBump?:number};
    assert.equal(actual.bump,identity.bump,`Bump ${key}`);if(key===venue)assert.equal(actual.vaultBump,vaultBump);
    assert.deepEqual(accountFields(actual),identity.expected,`Financial projection ${key}`);
  }
  if(state.resolution) {
    const expected=state.resolution;
    const header=JSON.parse(json(sdk.getResolutionV3Decoder().decode(raw(resolutionKeys[0],sdk.RESOLUTION_V3_DISCRIMINATOR))));
    assert.equal(header.bump,(await component('resolution'))[1]);assert.equal(header.schemaVersion,3);assert.equal(header.venue,venue);
    for(const field of ['epoch','stage','cursor','count','registryHash','termsEpoch','configEpochs','sourceObservations','sourceDeadlines','prices','funding','frozenAt',
      'cashBefore','poolsBefore','insuranceBefore','feesBefore','allocatedBefore','budgets','insuranceSpent','evaluation','clippedMask'] as const)
      assert.deepEqual(header[field],expected[field],`Resolution ${field}`);
    if(expected.stage===9)for(const [field,value] of Object.entries({scannedCash:expected.remainingCash,cashApplied:expected.appliedCash,
      remainingLots:expected.remainingLots,remainingGross:expected.remainingGross,remainingClaims:expected.remainingClaims}))assert.deepEqual(header[field],value,`Partial Apply ${field}`);
    for(let index=1;index<resolutionKeys.length;index++) {
      const page=JSON.parse(json(sdk.getResolutionPageV3Decoder().decode(raw(resolutionKeys[index],sdk.RESOLUTION_PAGE_V3_DISCRIMINATOR))));
      assert.equal(page.bump,(await sdk.findResolutionPageV3Pda(venue,index-1,program))[1]);assert.equal(page.schemaVersion,3);assert.equal(page.venue,venue);assert.equal(page.pageIndex,index-1);
      for(let within=0;within<2;within++) {
        const row=expected.rows[2*(index-1)+within];if(!row)continue;
        assert.equal(page.epoch,expected.epoch);assert(page.rowCount>within);
        const actual=page.rows[within];
        for(const field of ['member','cashBefore','lots','generations','claimsScaled','collected'] as const)assert.deepEqual(actual[field],row[field],`Frozen row ${field}`);
        assert.equal(actual.applied,row.applied??false);
        if(row.applied){assert.deepEqual(actual.roundedFlows,row.flows);assert.equal(actual.cashAfter,row.cashAfter);}
      }
    }
  }
  const token=raw(vault,undefined,'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  assert.equal(token.length,165);assert.equal(token[108],1);
  assert.equal(getAddressDecoder().decode(token.subarray(0,32)),state.venue!.quoteMint);assert.equal(getAddressDecoder().decode(token.subarray(32,64)),venue);
  const actual=token.readBigUInt64LE(64),allocated=BigInt(state.custody!.allocatedVault);assert(actual>=allocated,'Vault deficit');
  return {sequence:state.sequence,minSlot:String(minSlot),maxSlot:String(maxSlot),accounts:keys.length,members:state.members.length,
    actualVault:actual.toString(),allocatedVault:allocated.toString(),unallocatedSurplus:(actual-allocated).toString(),resolutionStage:state.resolution?.stage??null};
}
