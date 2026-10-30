import {expect,it} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {emptyLiquidity} from './liquidity-projection.js';
import {projectScopedBatch} from './scoped-projection.js';
import {json} from './events.js';
import type {AccountInvocation} from './account-events.js';
const venue='venue',domain='00'.repeat(32),binding={venue,domain};
const data={schemaVersion:6,profileVersion:4,venue,domain,slot:'1',kind:0,actor:'authority',subject:venue,index:0,amount:'0',members:[],ledgers:[],
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
  expect(state.custody).toEqual({schemaVersion:6,revision:'1',venue,totalCash:'0',allocatedVault:'0',liabilityVersions:['0','0']});
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

it('uses the authenticated predecessor when a zero-payload storage account first emits financial progress',()=>{
  const storage={...initialization(),signature:'storage',slot:2n,reads:[{account:venue,kind:0,revision:'1'}],
    writes:[{account:'retirement',kind:13,before:'0',after:'1'}],events:[]};
  const initial=projectScopedBatch(prepared(),[storage],binding).state;
  expect(initial.retirement).toBeNull();expect(initial.revisions.retirement.revision).toBe('1');
  const progress={...storage,signature:'progress',slot:3n,writes:[{account:'retirement',kind:13,before:'1',after:'2'}],
    events:[{...initialization().events[0],type:'AccountRetirementProgressV3' as const,data:{venue,slot:'3',safetyEpoch:'2',membershipVersion:'1',cash:'0',count:0,next:0,complete:true}}]};
  const result=projectScopedBatch(initial,[progress],binding).state;
  expect(result.retirement).toEqual({schemaVersion:6,revision:'2',venue,safetyEpoch:'2',membershipVersion:'1',cash:'0',count:0,next:0,complete:true});
  expect(result.sequence).toBe('2');expect(initial.retirement).toBeNull();
});

it('binds revision-less backing payloads to the authenticated certificate predecessor',()=>{
  const certificate={schemaVersion:6,venue,marketIndex:0,safetyEpoch:'1',membershipVersion:'2',liabilityVersions:['3','0'],
    observations:['7','0'],fundingBounds:[['0','1'],['0','0']],sourceDeadlines:['100','0'],requiredMarketMask:1,
    count:2,next:0,cash:'0',lots:['0','0'],claimSum:'0',complete:false,bump:255};
  const created={...initialization(),signature:'certificate',slot:2n,reads:[{account:venue,kind:0,revision:'1'}],
    writes:[{account:'certificate',kind:9,before:'0',after:'1'}],
    events:[{...initialization().events[0],type:'AccountBackingChangedV3' as const,data:{venue,slot:'2',certificate:'certificate',state:certificate}}]};
  const first=projectScopedBatch(prepared(),[created],binding).state;
  expect(first.backing.certificate.revision).toBe('1');expect(first.backing.certificate.next).toBe(0);
  const checked={...created,signature:'checked',slot:3n,writes:[{account:'certificate',kind:9,before:'1',after:'2'}],
    events:[{...created.events[0],data:{...created.events[0].data,state:{...certificate,next:2,cash:'70',complete:true}}}]};
  const complete=projectScopedBatch(first,[checked],binding).state;
  expect(complete.backing.certificate.revision).toBe('2');expect(complete.backing.certificate.cash).toBe('70');
  expect(complete.backing.certificate.complete).toBe(true);expect(first.backing.certificate.revision).toBe('1');
  expect(()=>projectScopedBatch(first,[{...checked,writes:[{account:'work',kind:12,before:'0',after:'1'}],reads:[...checked.reads,{account:'certificate',kind:9,revision:'1'}]}],binding))
    .toThrow(/readonly entity certificate/);
  expect(()=>projectScopedBatch(first,[{...checked,writes:[{account:'certificate',kind:9,before:'2',after:'3'}]}],binding))
    .toThrow(/predecessor/);
});
