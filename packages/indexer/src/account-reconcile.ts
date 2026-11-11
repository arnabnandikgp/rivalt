import {membershipDescriptors,reconcileMembershipStorage,requireMembershipCoverage} from './membership-reconcile.js';
import assert from 'node:assert/strict';
import {scopedSchema,settlementDescriptors,reconcileSettlementScratch} from './settlement-reconcile.js';
import {address,getAddressDecoder,getAddressEncoder,getProgramDerivedAddress,type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from './events.js';
import {integer} from './rpc.js';
import {compareReconciliationRevision} from './reconciliation-progress.js';
import {accountFields,reconcileAccountLedger,type AccountState} from './account-projection.js';
import type {LiquidityBinding} from './liquidity-store.js';
import type {AccountBatch} from './rpc.js';

type AccountValue=Awaited<ReturnType<AccountBatch>>['value'][number];
export type CapturedAccount={slot:number;value:AccountValue};

/** Find a genuinely common historical revision fence, rather than assuming a
 * later overwritten snapshot proves an earlier version's financial fields. */
export async function captureAccountReconciliation(state:AccountState,binding:Pick<LiquidityBinding,'venue'|'domain'|'program'>,
  read:AccountBatch,minimumSlot:number) {
  const venue=address(binding.venue),program=address(binding.program);
  const [custody]=await sdk.deriveVenueComponent(venue,'custody',program),[vault]=await sdk.deriveVenueComponent(venue,'vault',program);
  // Custody and the token account must share one actual bank observation. This
  // binds controlled vault transfers to the same scoped custody revision.
  const keys=[...new Set([custody,vault,...Object.keys(state.revisions)])];
  const captured=new Map<string,CapturedAccount>(),revisions=new Map<string,bigint>();
  let maxSlot=minimumSlot;
  for(let offset=0;offset<keys.length;offset+=100) {
    const chunk=keys.slice(offset,offset+100),response=await read(chunk);
    const slot=integer(response.context.slot);
    assert(slot>=minimumSlot,'Captured account bank precedes candidate');assert.equal(response.value.length,chunk.length);
    maxSlot=Math.max(maxSlot,slot);
    for(const [index,key] of chunk.entries()) {
      const value=response.value[index];captured.set(key,{slot,value:structuredClone(value)});
      if(key===vault)continue;
      assert(value?.owner===program&&value.data[1]==='base64',`Captured scoped owner ${key}`);
      const bytes=Buffer.from(value.data[0],'base64');assert(bytes.length>=18&&bytes.readUInt16LE(8)===scopedSchema(state.revisions[key].kind),'Captured scoped schema');
      assert(bytes.readBigUInt64LE(10)>=BigInt(state.revisions[key].revision),'Captured finalized revision behind candidate');
      revisions.set(key,bytes.readBigUInt64LE(10));
    }
  }
  return {maxSlot,captured,
    matches:(candidate:AccountState)=>Object.entries(candidate.revisions).every(([key,entity])=>revisions.get(key)===BigInt(entity.revision)),
    verify:(candidate:AccountState)=>reconcileAccountSnapshot(candidate,binding,read,captured)};
}

/** Every entity is pinned to its authenticated journal revision. A second pass
 * fences all chunks before combining their financial fields. A newer relevant
 * revision requests only tail catch-up, never an unrelated historical rescan. */
export async function reconcileAccountSnapshot(state:AccountState,binding:Pick<LiquidityBinding,'venue'|'domain'|'program'>,read:AccountBatch,
  captured?:ReadonlyMap<string,CapturedAccount>) {
  reconcileAccountLedger(state);
  const venue=address(binding.venue),program=address(binding.program);
  const identities=new Map<string,{bump:number;decoder:{decode(bytes:Uint8Array):unknown};discriminator:ReadonlyUint8Array;expected:unknown}>();
  const expect=async (key:string,derive:Promise<readonly [string,number]>,decoder:{decode(bytes:Uint8Array):unknown},
    discriminator:ReadonlyUint8Array,expected:unknown)=>{
    const [canonical,bump]=await derive;assert.equal(key,canonical,'Canonical schema-9 PDA');
    identities.set(key,{bump,decoder,discriminator,expected});
  };
  const component=(name:Parameters<typeof sdk.deriveVenueComponent>[1])=>sdk.deriveVenueComponent(venue,name,program);
  const [custody]=await component('custody'),[safety]=await component('safety'),[registry]=await component('registry'),[vault,vaultBump]=await component('vault');
  assert.equal(state.venue!.vault,vault);
  await expect(custody,component('custody'),sdk.getCustodyDecoder(),sdk.CUSTODY_DISCRIMINATOR,state.custody);
  await expect(venue,sdk.deriveAccountVenue(Buffer.from(binding.domain,'hex'),program),sdk.getVenueDecoder(),sdk.VENUE_DISCRIMINATOR,state.venue);
  await expect(safety,component('safety'),sdk.getVenueSafetyDecoder(),sdk.VENUE_SAFETY_DISCRIMINATOR,state.safety);
  if(state.membershipVersion!==null)await expect(registry,component('registry'),sdk.getVenueRegistryDecoder(),sdk.VENUE_REGISTRY_DISCRIMINATOR,
    {schemaVersion:9,revision:state.revisions[registry]?.revision,venue,membershipEpoch:state.membershipVersion,nextId:state.nextMemberId,
      registeredCount:state.registeredCount,financialCount:String(state.members.length),liveIndex:(await sdk.deriveMemberIndex(venue,14,0n,program))[0]});
  for(const [key,value] of Object.entries(state.markets))await expect(key,sdk.deriveAccountMarket(venue,value.index,program),sdk.getMarketDecoder(),sdk.MARKET_DISCRIMINATOR,value);
  for(const [key,value] of Object.entries(state.ledgers))await expect(key,sdk.deriveMarketLedger(address(value.market),program),sdk.getMarketLedgerDecoder(),sdk.MARKET_LEDGER_DISCRIMINATOR,value);
  for(const [key,value] of Object.entries(state.portfolios))await expect(key,sdk.deriveAccountPortfolio(venue,address(value.owner),value.index,program),sdk.getPortfolioDecoder(),sdk.PORTFOLIO_DISCRIMINATOR,value);
  for(const [key,value] of Object.entries(state.roots))await expect(key,sdk.deriveMarginAccount(address(value.portfolio),value.subaccountIndex,program),sdk.getMarginAccountDecoder(),sdk.MARGIN_ACCOUNT_DISCRIMINATOR,value);
  for(const [key,value]of Object.entries(state.tombstones))await expect(key,sdk.deriveMarginAccount(address(value.portfolio),value.child,program),sdk.getMarginTombstoneDecoder(),sdk.MARGIN_TOMBSTONE_DISCRIMINATOR,value);
  for(const [key,value]of Object.entries(state.storageTombstones)) {
    const prefix=({17:'prepared-settlement',18:'frozen-margin-page',21:'resolution-limbs',22:'settlement-rates',23:'settlement-plan'} as Record<number,string>)[value.originalKind];
    assert(prefix,'retired workspace kind');
    const suffix=value.originalKind===21?[sdk.namespaceIndexBytes(value.register),sdk.memberIndexBytes(BigInt(value.pageIndex))]:
      value.originalKind===18?[sdk.memberIndexBytes(BigInt(value.pageIndex))]:[];
    await expect(key,getProgramDerivedAddress({programAddress:program,seeds:[Buffer.from(prefix),getAddressEncoder().encode(venue),...suffix]}),
      sdk.getStorageTombstoneDecoder(),sdk.STORAGE_TOMBSTONE_DISCRIMINATOR,value);
  }
  await requireMembershipCoverage(state,venue,program);
  if(state.liquidity) {
    assert.equal(state.venue!.profileVersion,5);
    for(const [key,value] of Object.entries(state.liquidity.registries))await expect(key,sdk.findLiquidityRegistryPda({market:address(value.market)},{programAddress:program}),sdk.getLiquidityRegistryDecoder(),sdk.LIQUIDITY_REGISTRY_DISCRIMINATOR,value);
    for(const [key,value] of Object.entries(state.liquidity.makers))await expect(key,getProgramDerivedAddress({programAddress:program,
      seeds:[Buffer.from('maker-v4'),getAddressEncoder().encode(address(value.market)),Uint8Array.of(value.instance)]}),sdk.getMakerRegistrationDecoder(),sdk.MAKER_REGISTRATION_DISCRIMINATOR,value);
    for(const [key,value] of Object.entries(state.liquidity.publishers))await expect(key,sdk.findFundingPublisherPda({market:address(value.market)},{programAddress:program}),sdk.getFundingPublisherDecoder(),sdk.FUNDING_PUBLISHER_DISCRIMINATOR,value);
  }
  for(const [key,value] of Object.entries(state.backing))await expect(key,sdk.deriveSettlementCertificate(venue,value.marketIndex,program),sdk.getSettlementCertificateDecoder(),sdk.SETTLEMENT_CERTIFICATE_DISCRIMINATOR,value);
  if(state.retirement){const [key]=await component('retirement');await expect(key,component('retirement'),sdk.getRetirementCertificateDecoder(),sdk.RETIREMENT_CERTIFICATE_DISCRIMINATOR,state.retirement);}
  const resolutionKeys:string[]=[];
  if(state.resolution) {
    resolutionKeys.push((await component('resolution'))[0]);

  }
  const descriptors=[
    [sdk.VENUE_DISCRIMINATOR,329],[sdk.CUSTODY_DISCRIMINATOR,59],[sdk.VENUE_SAFETY_DISCRIMINATOR,85],
    [sdk.VENUE_REGISTRY_DISCRIMINATOR,115],[sdk.PORTFOLIO_DISCRIMINATOR,91],[sdk.MARGIN_ACCOUNT_DISCRIMINATOR,995],
    [sdk.MARKET_DISCRIMINATOR,455],[sdk.MARKET_LEDGER_DISCRIMINATOR,125],[sdk.CAPITAL_BINDING_DISCRIMINATOR,114],
    [sdk.SETTLEMENT_CERTIFICATE_DISCRIMINATOR,790],[sdk.RESOLUTION_DISCRIMINATOR,572],
    null,null,
    [sdk.RETIREMENT_CERTIFICATE_DISCRIMINATOR,636],[sdk.LIQUIDITY_REGISTRY_DISCRIMINATOR,181],
    [sdk.MAKER_REGISTRATION_DISCRIMINATOR,341],[sdk.FUNDING_PUBLISHER_DISCRIMINATOR,148],
    ...settlementDescriptors,...membershipDescriptors
  ] as const;
  for(const key of [...identities.keys(),...resolutionKeys])assert(state.revisions[key],`Unjournaled projected account ${key}`);
  const keys=[...new Set([...Object.keys(state.revisions),vault])],observed=new Map<string,{owner:string;data:[string,string]}|null>();
  let minSlot:number|undefined,maxSlot=0;
  for(let pass=0;pass<(captured?1:2);pass++)for(let offset=0;offset<keys.length;offset+=100) {
    const chunk=keys.slice(offset,offset+100),response=captured?undefined:await read(chunk);
    if(response){integer(response.context.slot);assert.equal(response.value.length,chunk.length);}
    for(const [index,key] of chunk.entries()) {
      const observation=captured?.get(key);if(captured)assert(observation,`Missing captured account ${key}`);
      const slot=observation?.slot??response!.context.slot;
      minSlot=Math.min(minSlot??slot,slot);maxSlot=Math.max(maxSlot,slot);
      const current=observation?observation.value:response!.value[index],entity=state.revisions[key];
      if(entity) {
        assert(current?.owner===program&&current.data[1]==='base64',`Scoped owner/encoding ${key}`);
        const bytes=Buffer.from(current.data[0],'base64'),descriptor=descriptors[entity.kind];
        assert(descriptor&&bytes.length===descriptor[1]&&bytes.subarray(0,8).equals(Buffer.from(descriptor[0])),`Scoped layout ${key}`);
        assert.equal(bytes.readUInt16LE(8),scopedSchema(entity.kind));
        compareReconciliationRevision(bytes.readBigUInt64LE(10),BigInt(entity.revision));
        if(pass)assert.equal(current.data[0],observed.get(key)?.data[0],`Account changed without revision ${key}`);
      }
      if(!pass||key===vault)observed.set(key,current);
    }
  }
  const raw=(key:string,discriminator?:ReadonlyUint8Array,owner:string=program)=>{
    const account=observed.get(key);assert(account?.owner===owner&&account.data[1]==='base64',`Missing/foreign account ${key}`);
    const bytes=Buffer.from(account.data[0],'base64');if(discriminator)assert(bytes.subarray(0,8).equals(Buffer.from(discriminator)),`Discriminator ${key}`);return bytes;
  };
  for(const [key,entity] of Object.entries(state.revisions)) {
    if(identities.has(key))continue;
    if(entity.kind===8) {
      const value=sdk.getCapitalBindingDecoder().decode(raw(key,sdk.CAPITAL_BINDING_DISCRIMINATOR));
      assert.equal(value.venue,venue);assert.equal(key,(await sdk.findCapitalBindingPda({capital:value.capital},{programAddress:program}))[0]);
      assert.equal(state.liquidity?.makers[value.registration]?.capital,value.capital,'Capital registration binding');
    } else if(entity.kind===10) {
      const value=sdk.getResolutionDecoder().decode(raw(key));
      const [canonical,bump]=await component('resolution');
      assert.equal(key,canonical);assert.equal(value.venue,venue);assert.equal(value.bump,bump);
    } else if([19,20,24,25].includes(entity.kind))await reconcileMembershipStorage(key,entity.kind,raw(key),state,binding,raw);
    else if(entity.kind>=17&&entity.kind<=23)await reconcileSettlementScratch(key,entity.kind,raw(key),state,binding);
    else throw new Error(`Missing projected entity kind ${entity.kind}`);
  }
  for(const [key,identity] of identities) {
    const actual=identity.decoder.decode(raw(key,identity.discriminator)) as {bump:number;vaultBump?:number};
    assert.equal(actual.bump,identity.bump,`Bump ${key}`);if(key===venue)assert.equal(actual.vaultBump,vaultBump);
    assert.deepEqual(accountFields(actual),identity.expected,`Financial projection ${key}`);
  }
  if(state.resolution) {
    const expected=state.resolution;
    const header=JSON.parse(json(sdk.getResolutionDecoder().decode(raw(resolutionKeys[0],sdk.RESOLUTION_DISCRIMINATOR))));
    assert.equal(header.bump,(await component('resolution'))[1]);assert.equal(header.schemaVersion,9);assert.equal(header.venue,venue);
    for(const field of ['epoch','stage','cursor','count','registryHash','termsEpoch','configEpochs','sourceObservations','sourceDeadlines','prices','funding','frozenAt',
      'cashBefore','poolsBefore','insuranceBefore','feesBefore','allocatedBefore'] as const)
      assert.deepEqual(header[field],expected[field],`Resolution ${field}`);
    if(expected.stage===14)reconcileFrozenSourceDuringApply(header,expected);
    assert.equal(header.membershipEpoch,expected.membershipEpoch);
    assert.equal(header.liveIndex,(await sdk.deriveMemberIndex(venue,14,0n,program))[0]);
  }

  const token=raw(vault,undefined,'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  assert.equal(token.length,165);assert.equal(token[108],1);
  assert.equal(getAddressDecoder().decode(token.subarray(0,32)),state.venue!.quoteMint);assert.equal(getAddressDecoder().decode(token.subarray(32,64)),venue);
  const actual=token.readBigUInt64LE(64),allocated=BigInt(state.custody!.allocatedVault);assert(actual>=allocated,'Vault deficit');
  return {cursor:state.sequence,minSlot:String(minSlot),maxSlot:String(maxSlot),accounts:keys.length,members:state.members.length,
    actualVault:actual.toString(),allocatedVault:allocated.toString(),unallocatedSurplus:(actual-allocated).toString(),resolutionStage:state.resolution?.stage??null};
}

/** The adopted source remains the freeze certificate until complete settlement.
 * Partial ownership belongs to SettlementPlan + authenticated applied roots;
 * reconcileSettlementScratch independently compares every plan cash counter. */
export function reconcileFrozenSourceDuringApply(header:Record<string,unknown>,expected:NonNullable<AccountState['resolution']>) {
  const gross=[0n,0n];
  const rows=Object.values(expected.rows);assert.equal(BigInt(rows.length),BigInt(expected.count),'Complete original cohort');
  for(const row of rows)for(const market of [0,1]){const lots=BigInt(row.lots[market]);gross[market]+=lots<0n?-lots:lots;}
  const frozen={scannedCash:'0',cashApplied:'0',remainingLots:['0','0'],remainingGross:gross.map(String),
    remainingClaims:expected.poolsBefore.map(pool=>(BigInt(pool)*1_000_000_000n).toString())};
  for(const [field,value] of Object.entries(frozen))assert.deepEqual(header[field],value,`Adopted frozen source ${field}`);
}
