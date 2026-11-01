import assert from 'node:assert/strict';
import {address,getAddressDecoder,getAddressEncoder,getProgramDerivedAddress,type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from './events.js';
import {integer} from './rpc.js';
import {compareReconciliationRevision} from './reconciliation-progress.js';
import {accountFields,reconcileAccountLedger,type AccountState} from './account-projection.js';
import type {LiquidityBinding} from './liquidity-store.js';
import type {AccountBatch} from './rpc.js';

/** Every entity is pinned to its authenticated journal revision. A second pass
 * fences all chunks before combining their financial fields. A newer relevant
 * revision requests only tail catch-up, never an unrelated historical rescan. */
export async function reconcileAccountSnapshot(state:AccountState,binding:Pick<LiquidityBinding,'venue'|'domain'|'program'>,read:AccountBatch) {
  reconcileAccountLedger(state);
  const venue=address(binding.venue),program=address(binding.program);
  const identities=new Map<string,{bump:number;decoder:{decode(bytes:Uint8Array):unknown};discriminator:ReadonlyUint8Array;expected:unknown}>();
  const expect=async (key:string,derive:Promise<readonly [string,number]>,decoder:{decode(bytes:Uint8Array):unknown},
    discriminator:ReadonlyUint8Array,expected:unknown)=>{
    const [canonical,bump]=await derive;assert.equal(key,canonical,'Canonical schema-7 PDA');
    identities.set(key,{bump,decoder,discriminator,expected});
  };
  const component=(name:Parameters<typeof sdk.deriveVenueComponent>[1])=>sdk.deriveVenueComponent(venue,name,program);
  const [custody]=await component('custody'),[safety]=await component('safety'),[registry]=await component('registry'),[vault,vaultBump]=await component('vault');
  assert.equal(state.venue!.vault,vault);
  await expect(custody,component('custody'),sdk.getCustodyDecoder(),sdk.CUSTODY_DISCRIMINATOR,state.custody);
  await expect(venue,sdk.deriveAccountVenue(Buffer.from(binding.domain,'hex'),program),sdk.getVenueDecoder(),sdk.VENUE_DISCRIMINATOR,state.venue);
  await expect(safety,component('safety'),sdk.getVenueSafetyDecoder(),sdk.VENUE_SAFETY_DISCRIMINATOR,state.safety);
  if(state.membershipVersion!==null)await expect(registry,component('registry'),sdk.getVenueRegistryDecoder(),sdk.VENUE_REGISTRY_DISCRIMINATOR,
    {schemaVersion:7,revision:state.revisions[registry]?.revision,venue,membershipVersion:state.membershipVersion,count:state.members.length,members:state.members});
  for(const [key,value] of Object.entries(state.markets))await expect(key,sdk.deriveAccountMarket(venue,value.index,program),sdk.getMarketDecoder(),sdk.MARKET_DISCRIMINATOR,value);
  for(const [key,value] of Object.entries(state.ledgers))await expect(key,sdk.deriveMarketLedger(address(value.market),program),sdk.getMarketLedgerDecoder(),sdk.MARKET_LEDGER_DISCRIMINATOR,value);
  for(const [key,value] of Object.entries(state.portfolios))await expect(key,sdk.deriveAccountPortfolio(venue,address(value.owner),value.index,program),sdk.getPortfolioDecoder(),sdk.PORTFOLIO_DISCRIMINATOR,value);
  for(const [key,value] of Object.entries(state.roots))await expect(key,sdk.deriveMarginAccount(address(value.portfolio),value.subaccountIndex,program),sdk.getMarginAccountDecoder(),sdk.MARGIN_ACCOUNT_DISCRIMINATOR,value);
  if(state.liquidity) {
    assert.equal(state.venue!.profileVersion,4);
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
    for(let page=0;page<Math.ceil(state.resolution.count/2);page++)resolutionKeys.push((await sdk.findResolutionPagePda(venue,page,program))[0]);
  }
  const descriptors=[
    [sdk.VENUE_DISCRIMINATOR,329],[sdk.CUSTODY_DISCRIMINATOR,59],[sdk.VENUE_SAFETY_DISCRIMINATOR,85],
    [sdk.VENUE_REGISTRY_DISCRIMINATOR,2113],[sdk.PORTFOLIO_DISCRIMINATOR,87],[sdk.MARGIN_ACCOUNT_DISCRIMINATOR,978],
    [sdk.MARKET_DISCRIMINATOR,455],[sdk.MARKET_LEDGER_DISCRIMINATOR,125],[sdk.CAPITAL_BINDING_DISCRIMINATOR,114],
    [sdk.SETTLEMENT_CERTIFICATE_DISCRIMINATOR,234],[sdk.RESOLUTION_DISCRIMINATOR,3652],
    [sdk.RESOLUTION_PAGE_DISCRIMINATOR,3408],[sdk.RESOLUTION_WORK_DISCRIMINATOR,7926],
    [sdk.RETIREMENT_CERTIFICATE_DISCRIMINATOR,80],[sdk.LIQUIDITY_REGISTRY_DISCRIMINATOR,181],
    [sdk.MAKER_REGISTRATION_DISCRIMINATOR,341],[sdk.FUNDING_PUBLISHER_DISCRIMINATOR,148]
  ] as const;
  for(const key of [...identities.keys(),...resolutionKeys])assert(state.revisions[key],`Unjournaled projected account ${key}`);
  const keys=[...new Set([...Object.keys(state.revisions),vault])],observed=new Map<string,{owner:string;data:[string,string]}|null>();
  let minSlot:number|undefined,maxSlot=0;
  for(let pass=0;pass<2;pass++)for(let offset=0;offset<keys.length;offset+=100) {
    const chunk=keys.slice(offset,offset+100),response=await read(chunk);
    integer(response.context.slot);assert.equal(response.value.length,chunk.length);
    minSlot=Math.min(minSlot??response.context.slot,response.context.slot);maxSlot=Math.max(maxSlot,response.context.slot);
    for(const [index,key] of chunk.entries()) {
      const current=response.value[index],entity=state.revisions[key];
      if(entity) {
        assert(current?.owner===program&&current.data[1]==='base64',`Scoped owner/encoding ${key}`);
        const bytes=Buffer.from(current.data[0],'base64'),descriptor=descriptors[entity.kind];
        assert(descriptor&&bytes.length===descriptor[1]&&bytes.subarray(0,8).equals(Buffer.from(descriptor[0])),`Scoped layout ${key}`);
        assert.equal(bytes.readUInt16LE(8),7);
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
    } else if(entity.kind===10||entity.kind===12) {
      const value=(entity.kind===10?sdk.getResolutionDecoder():sdk.getResolutionWorkDecoder()).decode(raw(key));
      const [canonical,bump]=await component(entity.kind===10?'resolution':'resolution-work');
      assert.equal(key,canonical);assert.equal(value.venue,venue);assert.equal(value.bump,bump);
    } else if(entity.kind===11) {
      const value=sdk.getResolutionPageDecoder().decode(raw(key));
      const [canonical,bump]=await sdk.findResolutionPagePda(venue,value.pageIndex,program);
      assert.equal(key,canonical);assert.equal(value.venue,venue);assert.equal(value.bump,bump);
    } else throw new Error(`Missing projected entity kind ${entity.kind}`);
  }
  for(const [key,identity] of identities) {
    const actual=identity.decoder.decode(raw(key,identity.discriminator)) as {bump:number;vaultBump?:number};
    assert.equal(actual.bump,identity.bump,`Bump ${key}`);if(key===venue)assert.equal(actual.vaultBump,vaultBump);
    assert.deepEqual(accountFields(actual),identity.expected,`Financial projection ${key}`);
  }
  if(state.resolution) {
    const expected=state.resolution;
    const header=JSON.parse(json(sdk.getResolutionDecoder().decode(raw(resolutionKeys[0],sdk.RESOLUTION_DISCRIMINATOR))));
    assert.equal(header.bump,(await component('resolution'))[1]);assert.equal(header.schemaVersion,7);assert.equal(header.venue,venue);
    for(const field of ['epoch','stage','cursor','count','registryHash','termsEpoch','configEpochs','sourceObservations','sourceDeadlines','prices','funding','frozenAt',
      'cashBefore','poolsBefore','insuranceBefore','feesBefore','allocatedBefore','budgets','insuranceSpent','evaluation','clippedMask'] as const)
      assert.deepEqual(header[field],expected[field],`Resolution ${field}`);
    if(expected.stage===9)for(const [field,value] of Object.entries({scannedCash:expected.remainingCash,cashApplied:expected.appliedCash,
      remainingLots:expected.remainingLots,remainingGross:expected.remainingGross,remainingClaims:expected.remainingClaims}))assert.deepEqual(header[field],value,`Partial Apply ${field}`);
    for(let index=1;index<resolutionKeys.length;index++) {
      const page=JSON.parse(json(sdk.getResolutionPageDecoder().decode(raw(resolutionKeys[index],sdk.RESOLUTION_PAGE_DISCRIMINATOR))));
      assert.equal(page.bump,(await sdk.findResolutionPagePda(venue,index-1,program))[1]);assert.equal(page.schemaVersion,7);assert.equal(page.venue,venue);assert.equal(page.pageIndex,index-1);
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
  return {cursor:state.sequence,minSlot:String(minSlot),maxSlot:String(maxSlot),accounts:keys.length,members:state.members.length,
    actualVault:actual.toString(),allocatedVault:allocated.toString(),unallocatedSurplus:(actual-allocated).toString(),resolutionStage:state.resolution?.stage??null};
}
