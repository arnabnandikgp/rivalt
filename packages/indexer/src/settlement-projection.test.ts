import {describe,it,expect} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {accountFields,projectAccounts,reconcileAccountLedger,type AccountState} from './account-projection.js';
import {emptyLiquidity} from './liquidity-projection.js';
import type {AccountEvent} from './account-events.js';
const zero='11111111111111111111111111111111',scale=1_000_000_000n;
function fixture() {
  const state=emptyLiquidity(),blank=<T>(decoder:{fixedSize:number;decode(bytes:Uint8Array):T})=>accountFields(decoder.decode(new Uint8Array(decoder.fixedSize)));
  state.venue={...blank(sdk.getVenueDecoder()),schemaVersion:8,profileVersion:4,domain:'00'.repeat(32),markets:['btc','eth'],marketCount:2};
  state.custody={...blank(sdk.getCustodyDecoder()),schemaVersion:8,allocatedVault:'6'};
  state.safety={...blank(sdk.getVenueSafetyDecoder()),schemaVersion:8,mode:2,paused:true,epoch:'7',resolutionEpoch:'3'};
  state.revisions.source={kind:10,revision:'11'};
  for(let market=0;market<2;market++) {
    state.markets[['btc','eth'][market]]={...blank(sdk.getMarketDecoder()),schemaVersion:8,index:market,lotsPerUnit:market?'100000':'1000000'};
    state.ledgers[['bl','el'][market]]={...blank(sdk.getMarketLedgerDecoder()),schemaVersion:8,market:['btc','eth'][market],marketIndex:market,
      insurance:market?'0':'3',fees:market?'0':'2',version:'1',liabilityVersion:'1'};
  }
  for(let id=0;id<3;id++) {
    const key=`root${id}`,root={...blank(sdk.getMarginAccountDecoder()),schemaVersion:8,revision:'9',venue:'venue',id,mode:0,
      isolatedMarketIndex:255,cash:id===0?'1':'0',delegateEpoch:'1'};
    root.positions[0].virtualScaled=((id===0?-2n:1n)*scale).toString();
    root.book.lastOrderId='4';root.book.lastGroupId='8';state.members.push(key);state.roots[key]=root;
  }
  state.resolution={epoch:'3',stage:2,cursor:0,count:3,registryHash:'00'.repeat(32),safetyEpoch:'7',termsEpoch:'1',configEpochs:['1','1'],
    sourceObservations:['0','0'],sourceDeadlines:['0','0'],prices:['10','20'],funding:['0','0'],frozenAt:'1',cashBefore:'1',poolsBefore:['0','0'],
    insuranceBefore:['3','0'],feesBefore:['2','0'],allocatedBefore:'6',budgets:['3','0'],insuranceSpent:['0','0'],evaluation:0,clippedMask:0,
    rows:{},remainingCash:'1',appliedCash:'0',remainingLots:['0','0'],remainingGross:['0','0'],remainingClaims:['0','0']};
  reconcileAccountLedger(state);return state;
}
const progress=(overrides:any={})=>({venue:'venue',slot:'1',epoch:'3',plan:'plan',stage:9,cursor:'0',count:'3',adoptionRevision:'12',
  remainingCash:'1',appliedCash:'0',marketMovements:['0','0'],gross:['0','0'],pools:['0','0'],insurance:['3','0'],insuranceSpent:['0','0'],
  fees:['2','0'],ledgerVersions:['1','1'],liabilityVersions:['1','1'],insuranceFeeRemainders:'0000',allocated:'6',actualVault:'6',
  resolutionStage:14,mode:2,paused:true,safetyEpoch:'7',...overrides});
function emit(state:AccountState,type:AccountEvent['type'],data:any) {
  projectAccounts(state,{type,data,signature:'signature',outer:0,inner:0,ordinal:0,slot:1,blockTime:1,bytes:''},'venue','00'.repeat(32));
}
function apply(state:AccountState,id:number) {
  const previous=state.roots[`root${id}`],root=structuredClone(previous);
  root.cash=id===1?'1':'0';root.nonce='1';root.stateVersion='1';root.delegateEpoch='2';
  root.positions.forEach(position=>{position.virtualScaled='0';position.generation='1';});
  return {venue:'venue',slot:'1',epoch:'3',ordinal:String(id),id:String(id),member:`root${id}`,cashBefore:previous.cash,
    claims:[((id===0?-2n:1n)*scale).toString(),'0'],lots:['0','0'],flows:[id===2?'0':'1','0'],state:root};
}
describe('paged default independent one-atom ownership',()=>{
  it('replays partial cash/claims, protected buckets, complete reconciliation and terminal accounting',()=>{
    const state=fixture();emit(state,'SettlementPlanProgress',progress());
    for(let id=0;id<3;id++) {
      emit(state,'SettlementMarginApplied',apply(state,id));
      emit(state,'SettlementPlanProgress',progress({cursor:String(id+1),remainingCash:'0',appliedCash:id===0?'0':'1',marketMovements:[id===0?'-1':'0','0']}));
      expect(state.resolution!.remainingClaims).toEqual([[(2n*scale).toString(),scale.toString(),'0'][id],'0']);
    }
    expect(state.members.map(key=>state.roots[key].cash)).toEqual(['0','1','0']);
    const distributed={remainingCash:'0',appliedCash:'1',ledgerVersions:['2','2'],liabilityVersions:['2','2']};
    emit(state,'SettlementPlanProgress',progress({...distributed,stage:10,cursor:'0'}));
    for(let cursor=1;cursor<=3;cursor++)emit(state,'SettlementPlanProgress',progress({...distributed,stage:cursor===3?11:10,cursor:String(cursor)}));
    emit(state,'SettlementPlanProgress',progress({...distributed,stage:12,cursor:'3',resolutionStage:11,mode:3,paused:false,safetyEpoch:'8'}));
    expect(state.resolution!.stage).toBe(11);expect(state.safety!.mode).toBe(3);
    expect([state.ledgers.bl.insurance,state.ledgers.bl.fees]).toEqual(['3','2']);
    expect(state.pagedSettlement!.marketMovements).toEqual(['0','0']);
  });
  it('rejects omitted or duplicate accounts, fabricated cash, changed claims, premature distribution and insurance subsidy',()=>{
    const source=fixture();emit(source,'SettlementPlanProgress',progress());
    expect(()=>emit(structuredClone(source),'SettlementMarginApplied',apply(source,1))).toThrow('next Apply');
    const inflated=apply(source,0);inflated.state.cash='1';
    expect(()=>emit(structuredClone(source),'SettlementMarginApplied',inflated)).toThrow('payout conservation');
    const wrong=apply(source,0);wrong.claims[0]='-1';
    expect(()=>emit(structuredClone(source),'SettlementMarginApplied',wrong)).toThrow('claims');
    expect(()=>emit(structuredClone(source),'SettlementPlanProgress',progress({stage:10}))).toThrow('stage/cursor');
    expect(()=>emit(structuredClone(source),'SettlementPlanProgress',progress({insurance:['2','0']}))).toThrow('insurance ownership');
    const next=structuredClone(source),original=apply(next,0);emit(next,'SettlementMarginApplied',original);
    expect(()=>emit(next,'SettlementMarginApplied',original)).toThrow('next Apply');
  });
});
