import {expect,it} from 'vitest';
import {getAddressDecoder,getAddressEncoder,type Address,type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {emptyLiquidity} from './liquidity-projection.js';
import {accountFields} from './account-projection.js';
import {captureAccountReconciliation,reconcileAccountSnapshot} from './account-reconcile.js';
import {ReconciliationAhead} from './reconciliation-progress.js';

/** Transport/snapshot fixture, not signed financial evidence. Enough independent
 * empty portfolios force multiple RPC chunks; all expected funded balances are 0. */
async function fixture() {
  const domain=Buffer.alloc(32,91),program=sdk.CLEARING_PROGRAM_ADDRESS;
  const [venue,venueBump]=await sdk.deriveAccountVenue(domain),[custody,custodyBump]=await sdk.deriveVenueComponent(venue,'custody'),
    [safety,safetyBump]=await sdk.deriveVenueComponent(venue,'safety'),[vault,vaultBump]=await sdk.deriveVenueComponent(venue,'vault');
  const mint=getAddressDecoder().decode(Buffer.alloc(32,92)),state=emptyLiquidity();
  const accounts=new Map<string,{owner:string;data:[string,string]}>();
  const put=(key:string,data:ReadonlyUint8Array,owner:string=program)=>accounts.set(key,{owner,data:[Buffer.from(data).toString('base64'),'base64']});
  const empty=<T>(decoder:{fixedSize:number;decode(bytes:Uint8Array):T})=>decoder.decode(Buffer.alloc(decoder.fixedSize));
  const venueState={...empty(sdk.getVenueDecoder()),schemaVersion:9,revision:1n,profileVersion:5,domain,quoteMint:mint,vault,bump:venueBump,vaultBump};
  const custodyState={...empty(sdk.getCustodyDecoder()),schemaVersion:9,revision:1n,venue,bump:custodyBump};
  const safetyState={...empty(sdk.getVenueSafetyDecoder()),schemaVersion:9,revision:1n,venue,epoch:1n,bump:safetyBump};
  state.venue=accountFields(venueState);state.custody=accountFields(custodyState);state.safety=accountFields(safetyState);
  for(const [key,kind] of [[venue,0],[custody,1],[safety,2]] as const)state.revisions[key]={kind,revision:'1'};
  put(venue,sdk.getVenueEncoder().encode(venueState));put(custody,sdk.getCustodyEncoder().encode(custodyState));put(safety,sdk.getVenueSafetyEncoder().encode(safetyState));
  const portfolios:Address[]=[];
  for(let index=0;index<105;index++) {
    const owner=getAddressDecoder().decode(Buffer.alloc(32,index+1)),[key,bump]=await sdk.deriveAccountPortfolio(venue,owner,0);
    const value={schemaVersion:9,revision:1n,venue,owner,index:0,activeChildren:0,bump};
    state.portfolios[key]=accountFields(value);state.revisions[key]={kind:4,revision:'1'};put(key,sdk.getPortfolioEncoder().encode(value));portfolios.push(key);
  }
  const token=Buffer.alloc(165);Buffer.from(getAddressEncoder().encode(mint)).copy(token);Buffer.from(getAddressEncoder().encode(venue)).copy(token,32);token[108]=1;
  put(vault,token,'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  let calls=0;const chunks:string[][]=[];
  const read=async(keys:string[])=>{calls++;chunks.push(keys);return {context:{slot:100+calls},value:structuredClone(keys.map(key=>accounts.get(key)??null))};};
  const mutate=(key:string,revision:bigint,corrupt=false)=>{
    const account=accounts.get(key)!,bytes=Buffer.from(account.data[0],'base64');bytes.writeBigUInt64LE(revision,10);if(corrupt)bytes[84]^=1;put(key,bytes);
  };
  return {state,binding:{venue,domain:domain.toString('hex'),program},read,calls:()=>calls,chunks,portfolios,mutate};
}
it('reconciles multiple chunks at authenticated entity revisions despite advancing unrelated RPC slots',async()=>{
  const test=await fixture(),result=await reconcileAccountSnapshot(test.state,test.binding,test.read);
  expect(result).toMatchObject({cursor:'0',accounts:109,members:0,actualVault:'0',allocatedVault:'0'});
  expect(test.chunks.map(keys=>keys.length)).toEqual([100,9,100,9]);
});
it('detects an earlier chunk advancing while a later chunk is fetched',async()=>{
  const test=await fixture();
  await expect(reconcileAccountSnapshot(test.state,test.binding,async keys=>{
    const result=await test.read(keys);if(test.calls()===2)test.mutate(test.portfolios[0],2n);return result;
  })).rejects.toBeInstanceOf(ReconciliationAhead);
  expect(test.calls()).toBe(3);expect(test.state.revisions[test.portfolios[0]].revision).toBe('1');
});
it('rejects unversioned data mutation and older finalized accounts without treating them as catch-up',async()=>{
  const test=await fixture();
  await expect(reconcileAccountSnapshot(test.state,test.binding,async keys=>{
    const result=await test.read(keys);if(test.calls()===2)test.mutate(test.portfolios[0],1n,true);return result;
  })).rejects.toThrow(/without revision/);
  test.mutate(test.portfolios[0],0n);
  await expect(reconcileAccountSnapshot(test.state,test.binding,test.read)).rejects.toThrow(/behind candidate/);
});

it('captures custody and vault together and verifies a common historical revision vector across chunks',async()=>{
  const test=await fixture(),witness=await captureAccountReconciliation(test.state,test.binding,test.read,100);
  expect(witness.maxSlot).toBe(102);expect(test.chunks.map(keys=>keys.length)).toEqual([100,9]);
  expect(test.chunks[0].slice(0,2)).toEqual([
    (await sdk.deriveVenueComponent(test.binding.venue,'custody'))[0],(await sdk.deriveVenueComponent(test.binding.venue,'vault'))[0]]);
  expect(witness.matches(test.state)).toBe(true);
  test.mutate(test.portfolios[0],2n); // Subsequent writes do not invalidate captured historical bytes.
  expect(await witness.verify(test.state)).toMatchObject({accounts:109,actualVault:'0'});
  expect(test.calls()).toBe(2);
  const later=structuredClone(test.state);later.revisions[test.portfolios[0]].revision='2';
  expect(witness.matches(later)).toBe(false);
  later.revisions['uncaptured-account']={kind:4,revision:'1'};expect(witness.matches(later)).toBe(false);
});
it('rejects captured wrong financial bodies even when revisions match',async()=>{
  const test=await fixture();test.mutate(test.portfolios[0],1n,true);
  const witness=await captureAccountReconciliation(test.state,test.binding,test.read,100);
  expect(witness.matches(test.state)).toBe(true);await expect(witness.verify(test.state)).rejects.toThrow(/Financial projection/);
});
it('rejects stale captured bank contexts and finalized revisions',async()=>{
  const test=await fixture();
  await expect(captureAccountReconciliation(test.state,test.binding,test.read,200)).rejects.toThrow(/precedes candidate/);
  test.mutate(test.portfolios[0],0n);
  await expect(captureAccountReconciliation(test.state,test.binding,test.read,100)).rejects.toThrow(/behind candidate/);
});

it('reconciles the unchanged freeze source separately from partial plan ownership',async()=>{
  const {reconcileFrozenSourceDuringApply}=await import('./account-reconcile.js');
  // Original: two +/-7 lot counterparties, 3 atoms already in the market pool.
  // Partial Apply: one original root remains; source counters have not moved.
  const expected={count:'2',poolsBefore:['3','0'],remainingCash:'7198048',appliedCash:'2301952',
    remainingGross:['7','0'],remainingLots:['-7','0'],remainingClaims:['19','0'],rows:{
      '0':{lots:['7','0']},'65':{lots:['-7','0']}}} as unknown as NonNullable<import('./account-projection.js').AccountState['resolution']>;
  const header={scannedCash:'0',cashApplied:'0',remainingLots:['0','0'],remainingGross:['14','0'],remainingClaims:['3000000000','0']};
  expect(()=>reconcileFrozenSourceDuringApply(header,expected)).not.toThrow();
  for(const patch of [{scannedCash:'7198048'},{cashApplied:'2301952'},{remainingGross:['7','0']},{remainingClaims:['0','0']}])
    expect(()=>reconcileFrozenSourceDuringApply({...header,...patch},expected)).toThrow(/Adopted frozen source/);
  const omitted=structuredClone(expected);delete omitted.rows['65'];
  expect(()=>reconcileFrozenSourceDuringApply(header,omitted)).toThrow(/Complete original cohort/);
});
