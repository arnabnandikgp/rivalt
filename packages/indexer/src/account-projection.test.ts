import {describe,it,expect} from 'vitest';
import {address} from '@solana/kit';
import {eventTransaction,fixtureVenue} from './event-test-fixture.js';
import * as sdk from '@rivalt/sdk';
import {decodeAccounts,type AccountEvent} from './account-events.js';
import {accountFields,projectAccounts,reconcileAccountLedger,type AccountState} from './account-projection.js';
import {json} from './events.js';
import {emptyLiquidity} from './liquidity-projection.js';

const zero=address('11111111111111111111111111111111'),venue=fixtureVenue,domain='00'.repeat(32);
const blank=(decoder:{fixedSize:number;decode(bytes:Uint8Array):unknown})=>accountFields(decoder.decode(new Uint8Array(decoder.fixedSize))) as any;
function state():AccountState {
  const value=emptyLiquidity();
  value.venue={...blank(sdk.getVenueDecoder()),schemaVersion:5,revision:'1',profileVersion:4,domain,markets:['btc','eth'],marketCount:2};
  value.custody={schemaVersion:5,revision:'1',venue,totalCash:'200',allocatedVault:'210',liabilityVersions:['0','0']};
  value.safety={schemaVersion:5,revision:'1',venue,mode:1,paused:false,epoch:'1',resolutionEpoch:'0',recoverySince:'0',recoveryLast:'0'};
  value.members=['debtor','winner'];value.membershipVersion='3';
  for(const [index,key] of ['btc','eth'].entries()) {
    value.markets[key]={...blank(sdk.getMarketDecoder()),schemaVersion:5,revision:'1',venue,index,lotsPerUnit:index===0?'1000000':'100000'};
    value.ledgers[`${key}-ledger`]={schemaVersion:5,revision:'1',venue,market:key,marketIndex:index,settlement:'0',insurance:index===0?'10':'0',fees:'0',insuranceFeeRemainder:0,version:'1'};
  }
  for(const [id,key] of value.members.entries())value.roots[key]={...blank(sdk.getMarginAccountDecoder()),schemaVersion:5,revision:'1',venue,
    id,mode:0,subaccountIndex:0,isolatedMarketIndex:255,cash:'100',delegateEpoch:'1'};
  return value;
}
const event=(type:AccountEvent['type'],data:any):AccountEvent=>({type,data:{venue,sequence:'1',slot:'10',...data},
  signature:'signed',outer:0,inner:0,ordinal:0,slot:10,blockTime:10,bytes:'bounded-test-vector'});
const init=()=>sdk.getAccountCustodyChangedEventEncoder().encode({schemaVersion:5,profileVersion:4,
  domain:new Uint8Array(32),venue,slot:10n,kind:0,actor:zero,subject:venue,index:0,amount:0n,
  members:[],ledgers:[],authority:zero,feeAuthority:zero,reserveAuthority:zero,reserveDestinationOwner:zero,
  quoteMint:zero,vault:zero,markets:[zero,zero],marketCount:0,insuranceFeeShareBps:2500,mode:0,paused:false,
  safetyEpoch:1n,termsEpoch:1n,configEpoch:1n,totalCash:0n,allocatedVault:0n,liabilityVersions:[0n,0n],
  membershipVersion:null,memberCount:null,actualVault:0n});
const transaction=(payload=init())=>eventTransaction(payload,venue,zero);

describe('schema-5 authenticated stream',()=>{
  it('authenticates original signature, CPI authority, slot and exact bytes',()=>{
    const tx=transaction();expect(decodeAccounts('signed',tx,zero,venue)).toHaveLength(1);
    expect(()=>decodeAccounts('signed',tx,zero,zero)).toThrow(/footer/);
    expect(()=>decodeAccounts('other',tx,zero,venue)).toThrow(/identity/);
    expect(()=>decodeAccounts('signed',tx,venue,venue)).toThrow(/authority/);
    expect(()=>decodeAccounts('signed',{...tx,slot:11},zero,venue)).toThrow(/slot/);
    expect(decodeAccounts('signed',{...tx,meta:{...tx.meta,err:{InstructionError:[1,'Custom']}}},zero,venue)).toEqual([]);
    const unknown=Buffer.from(init());unknown[0]^=1;
    expect(()=>decodeAccounts('signed',transaction(unknown),zero,venue)).toThrow(/payload|schema/);
    const old=Buffer.from(init());old.writeUInt16LE(2,8);
    expect(()=>decodeAccounts('signed',transaction(old),zero,venue)).toThrow(/version/);
    expect(()=>decodeAccounts('signed',transaction(init().slice(0,-1)),zero,venue)).toThrow();
    expect(()=>decodeAccounts('signed',transaction(Buffer.concat([Buffer.from(init()),Buffer.from([0])])),zero,venue)).toThrow(/Trailing/);
  });
  it('preserves payload bytes and rejects immutable root changes',()=>{
    const current=state(),change=event('AccountAuthorityChangedV3',{margin:'debtor',state:{...current.roots.debtor,delegateEpoch:'2'},liabilityVersions:['1','1']});
    const original=json(change);projectAccounts(current,change,venue,domain);expect(json(change)).toBe(original);
    expect(()=>projectAccounts(current,event('AccountAuthorityChangedV3',{...change.data,sequence:'2',state:{...current.roots.debtor,owner:venue}}),venue,domain)).toThrow(/immutable root/);
  });
});

describe('per-market fractional accounting',()=>{
  it('counts shared cash once and forbids cross-market cancellation in the indexer',()=>{
    const current=state();current.roots.debtor.positions[0].virtualScaled='1';current.roots.winner.positions[1].virtualScaled='-1';
    expect(()=>reconcileAccountLedger(current)).toThrow(/market claims/);
    current.roots.winner.positions[1].virtualScaled='0';current.roots.winner.positions[0].virtualScaled='-1';
    expect(()=>reconcileAccountLedger(current)).not.toThrow();
    current.custody!.totalCash='400';current.custody!.allocatedVault='410';expect(()=>reconcileAccountLedger(current)).toThrow(/root cash/);
  });
  it('separates insurance, fees and modulo-four carries',()=>{
    const current=state();current.ledgers['btc-ledger'].insuranceFeeRemainder=3;expect(()=>reconcileAccountLedger(current)).not.toThrow();
    current.ledgers['btc-ledger'].insuranceFeeRemainder=4;expect(()=>reconcileAccountLedger(current)).toThrow(/carry/);
    current.ledgers['btc-ledger'].insuranceFeeRemainder=0;current.ledgers['btc-ledger'].insurance='11';
    expect(()=>reconcileAccountLedger(current)).toThrow(/cash conservation/);
  });
  it('preserves each nonzero fee carry from the actual completion-event byte encoding',()=>{
    for(const stage of [10,11])for(const carries of [[3,1],[0,0],[2,3]]) {
      const current=state();
      current.resolution={epoch:'1',stage:10} as AccountState['resolution'];
      const payload=sdk.getAccountResolutionCompletedEventEncoder().encode({venue,slot:10n,epoch:1n,
        stage,mode:3,safetyEpoch:2n,cash:200n,pools:[0n,0n],insurance:[10n,0n],fees:[0n,0n],insuranceSpent:[0n,0n],
        allocated:210n,actualVault:210n,liabilityVersions:[1n,1n],ledgerVersions:[2n,2n],insuranceFeeRemainders:Uint8Array.from(carries)});
      const [change]=decodeAccounts('signed',transaction(payload),zero,venue);
      expect(change.data.insuranceFeeRemainders).toBe(Buffer.from(carries).toString('hex'));
      projectAccounts(current,change,venue,domain);
      expect(Object.values(current.ledgers).map(ledger=>ledger.insuranceFeeRemainder)).toEqual(carries);
      expect(()=>projectAccounts({...state(),resolution:{epoch:'1',stage:10} as AccountState['resolution']},
        {...change,data:{...change.data,insuranceFeeRemainders:'0400'}},venue,domain)).toThrow(/carry bound/);
    }
  });
  it('keeps isolated foreign slots zero and validates cached reservations',()=>{
    const current=state();Object.assign(current.roots.debtor,{mode:1,subaccountIndex:1,isolatedMarketIndex:0});
    current.roots.debtor.positions[1].generation='1';expect(()=>reconcileAccountLedger(current)).toThrow(/foreign isolated/);
    current.roots.debtor.positions[1].generation='0';current.roots.debtor.reserved='1';expect(()=>reconcileAccountLedger(current)).toThrow(/cached order/);
  });
  it('reconciles mixed Apply roots without adopting payouts prematurely',()=>{
    // One debtor C=100 pays 100; winner C=100 has +120 owed and receives 110
    // after the market adds I=10. Frozen custody remains C=200,I=10 until complete.
    const current=state();current.safety!.mode=2;current.safety!.paused=true;
    current.roots.debtor.cash='0';current.roots.winner.positions[0].virtualScaled='120000000000';
    current.resolution={epoch:'1',stage:9,cursor:1,count:2,registryHash:'00'.repeat(32),safetyEpoch:'2',termsEpoch:'2',
      configEpochs:['1','1'],sourceObservations:['1','1'],sourceDeadlines:['100','100'],prices:['10','20'],funding:['0','0'],frozenAt:'90',
      cashBefore:'200',poolsBefore:['0','0'],insuranceBefore:['10','0'],feesBefore:['0','0'],allocatedBefore:'210',budgets:['10','0'],insuranceSpent:['10','0'],
      evaluation:0,clippedMask:0,rows:{},remainingCash:'100',appliedCash:'0',remainingLots:['0','0'],remainingGross:['0','0'],remainingClaims:['120000000000','0']};
    expect(()=>reconcileAccountLedger(current)).not.toThrow();
    current.custody!.totalCash='100';current.custody!.allocatedVault='110';expect(()=>reconcileAccountLedger(current)).toThrow(/frozen cash/);
    current.custody!.totalCash='200';current.custody!.allocatedVault='210';current.roots.winner.cash='210';
    expect(()=>reconcileAccountLedger(current)).toThrow(/root cash/);
  });
});
