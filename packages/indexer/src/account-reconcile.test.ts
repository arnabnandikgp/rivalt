import {expect,it} from 'vitest';
import {getAddressDecoder,getAddressEncoder,type Address,type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {emptyLiquidity} from './liquidity-projection.js';
import {accountFields} from './account-projection.js';
import {reconcileAccountSnapshot} from './account-reconcile.js';
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
  const venueState={...empty(sdk.getVenueDecoder()),schemaVersion:7,revision:1n,profileVersion:4,domain,quoteMint:mint,vault,bump:venueBump,vaultBump};
  const custodyState={...empty(sdk.getCustodyDecoder()),schemaVersion:7,revision:1n,venue,bump:custodyBump};
  const safetyState={...empty(sdk.getVenueSafetyDecoder()),schemaVersion:7,revision:1n,venue,epoch:1n,bump:safetyBump};
  state.venue=accountFields(venueState);state.custody=accountFields(custodyState);state.safety=accountFields(safetyState);
  for(const [key,kind] of [[venue,0],[custody,1],[safety,2]] as const)state.revisions[key]={kind,revision:'1'};
  put(venue,sdk.getVenueEncoder().encode(venueState));put(custody,sdk.getCustodyEncoder().encode(custodyState));put(safety,sdk.getVenueSafetyEncoder().encode(safetyState));
  const portfolios:Address[]=[];
  for(let index=0;index<105;index++) {
    const owner=getAddressDecoder().decode(Buffer.alloc(32,index+1)),[key,bump]=await sdk.deriveAccountPortfolio(venue,owner,0);
    const value={schemaVersion:7,revision:1n,venue,owner,index:0,children:0,bump};
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
