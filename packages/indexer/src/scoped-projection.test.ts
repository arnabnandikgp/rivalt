import {expect,it} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {emptyLiquidity} from './liquidity-projection.js';
import {projectScopedBatch} from './scoped-projection.js';
import {json} from './events.js';
import type {AccountInvocation} from './account-events.js';
const venue='venue',domain='00'.repeat(32),binding={venue,domain};
const data={schemaVersion:5,profileVersion:4,venue,domain,slot:'1',kind:0,actor:'authority',subject:venue,index:0,amount:'0',members:[],ledgers:[],
  authority:'authority',feeAuthority:'fees',reserveAuthority:'reserve',reserveDestinationOwner:'reserve',quoteMint:'mint',vault:'vault',markets:['btc','eth'],
  marketCount:0,insuranceFeeShareBps:2500,mode:0,paused:false,safetyEpoch:'1',termsEpoch:'1',configEpoch:'1',totalCash:'0',allocatedVault:'0',
  liabilityVersions:['0','0'],membershipVersion:{__option:'None'},memberCount:{__option:'None'},actualVault:'0'};
function initialization():AccountInvocation {
  return {signature:'init',slot:1n,transactionIndex:0,outer:0,invocation:0,instruction:'init',venue,domain,payloads:[],footerInner:1,footerBytes:'fixture',reads:[],
    writes:[{account:venue,kind:0,before:'0',after:'1'},{account:'custody',kind:1,before:'0',after:'1'},{account:'safety',kind:2,before:'0',after:'1'}],
    events:[{signature:'init',outer:0,inner:0,ordinal:0,slot:1,blockTime:1,type:'AccountCustodyChangedV3',data,bytes:'fixture'}]};
}
const prepared=()=>projectScopedBatch(emptyLiquidity(),[initialization()],binding).state;
it('reconstructs initialization with explicit funded balances and independent entity revisions',()=>{
  const state=prepared();
  expect(state.sequence).toBe('1');expect(state.revisions).toEqual({venue:{kind:0,revision:'1'},custody:{kind:1,revision:'1'},safety:{kind:2,revision:'1'}});
  expect(state.custody).toEqual({schemaVersion:5,revision:'1',venue,totalCash:'0',allocatedVault:'0',liabilityVersions:['0','0']});
  expect(state.venue?.revision).toBe('1');expect(state.safety?.revision).toBe('1');
});
it('advances zero-payload storage envelopes without inventing a financial event/cursor',()=>{
  const state=prepared(),storage={...initialization(),signature:'storage',slot:2n,reads:[{account:venue,kind:0,revision:'1'}],
    writes:[{account:'work',kind:12,before:'0',after:'1'}],events:[]};
  const result=projectScopedBatch(state,[storage],binding).state;
  expect(result.sequence).toBe('1');expect(result.revisions.work).toEqual({kind:12,revision:'1'});
  expect(result.custody).toEqual(state.custody);expect(state.revisions.work).toBeUndefined();
});
it('rejects duplicate delivery, missing predecessor and readonly financial changes without altering input',()=>{
  const state=prepared(),original=json(state);
  expect(()=>projectScopedBatch(state,[initialization()],binding)).toThrow(/prefix conflict/);
  const pause={...initialization(),signature:'pause',slot:2n,reads:[{account:venue,kind:0,revision:'1'},{account:'safety',kind:2,revision:'1'}],
    writes:[{account:'custody',kind:1,before:'1',after:'2'}],events:[{...initialization().events[0],data:{...data,kind:8,paused:true,safetyEpoch:'2'}}]};
  expect(()=>projectScopedBatch(state,[pause],binding)).toThrow(/readonly entity safety/);
  expect(()=>projectScopedBatch(state,[{...pause,writes:[{account:'custody',kind:1,before:'2',after:'3'}]}],binding)).toThrow(/predecessor/);
  expect(json(state)).toBe(original);
});
it('rolls back an earlier valid invocation when a later payload in the same transaction is invalid',()=>{
  const first=initialization(),second={...initialization(),outer:1,writes:first.writes.map(write=>({...write,before:'1',after:'2'}))};
  const initial=emptyLiquidity();expect(()=>projectScopedBatch(initial,[second,first],binding)).toThrow(/duplicate initialization/);
  expect(initial).toEqual(emptyLiquidity());
});
