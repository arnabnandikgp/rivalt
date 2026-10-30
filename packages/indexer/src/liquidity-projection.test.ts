import {describe,it,expect} from 'vitest';
import * as sdk from '@rivalt/sdk';
import type {AccountEvent} from './account-events.js';
import {accountFields,projectAccounts} from './account-projection.js';
import {emptyLiquidity} from './liquidity-projection.js';

const venue=sdk.CLEARING_PROGRAM_ADDRESS,domain='00'.repeat(32);
const blank=(decoder:{fixedSize:number;decode(bytes:Uint8Array):unknown})=>accountFields(decoder.decode(new Uint8Array(decoder.fixedSize))) as any;
function fixture() {
  const state=emptyLiquidity();
  state.venue={...blank(sdk.getVenueDecoder()),schemaVersion:6,revision:'1',profileVersion:4,domain,markets:['btc','eth'],marketCount:2};
  state.custody={schemaVersion:6,revision:'1',venue,totalCash:'200000',allocatedVault:'200000',liabilityVersions:['0','0']};
  state.safety={schemaVersion:6,revision:'1',venue,mode:1,paused:false,epoch:'1',resolutionEpoch:'0',recoverySince:'0',recoveryLast:'0'};
  state.members=['trader','capital'];state.membershipVersion='3';
  for(const [index,key] of ['btc','eth'].entries()) {
    state.markets[key]={...blank(sdk.getMarketDecoder()),schemaVersion:6,revision:'1',venue,index,lotsPerUnit:index===0?'1000000':'100000'};
    state.ledgers[`${key}-ledger`]={schemaVersion:6,revision:'1',venue,market:key,marketIndex:index,settlement:'0',insurance:'0',fees:'0',insuranceFeeRemainder:0,version:'1'};
  }
  for(const [id,key] of state.members.entries())state.roots[key]={...blank(sdk.getMarginAccountDecoder()),schemaVersion:6,revision:'1',venue,
    id,mode:1,role:id,owner:'owner',subaccountIndex:1,isolatedMarketIndex:0,cash:'100000',delegateEpoch:'1'};
  state.liquidity!.makers.maker={...blank(sdk.getMakerRegistrationDecoder()),schemaVersion:6,revision:'1',venue,market:'btc',owner:'owner',
    capital:'capital',instance:0,authorityEpoch:'1',depthEpoch:'1'};
  state.liquidity!.publishers.publisher={schemaVersion:6,revision:'1',venue,market:'btc',publisher:'signer',authorityEpoch:'1',lastSequence:'0',lastObservedSlot:'0',lastObservedTime:'0',enabled:true};
  return state;
}
function event(type:AccountEvent['type'],data:any):AccountEvent {
  return {type,data:{venue,sequence:'1',slot:'10',market:'btc',...data},signature:'signed',outer:0,inner:0,ordinal:0,slot:10,blockTime:10,bytes:'unit-vector'};
}
function trade(state=fixture()) {
  const roots=structuredClone(Object.values(state.roots));roots[0].cash='99999';
  roots[0].positions[0].lots='1';roots[0].positions[0].virtualScaled='-1000000000000';
  roots[1].positions[0].lots='-1';roots[1].positions[0].virtualScaled='1000000000000';
  const change=event('LiquidityRouteExecutedV4',{side:0,lots:'1',grossQuote:'1000',fee:'1',insuranceCredit:'0',retainedFee:'1',carryBefore:0,carryAfter:1,
    rootStates:roots,makerStates:[{...state.liquidity!.makers.maker,buyConsumed:'1'}],
    marketState:{...state.markets.btc,grossLots:'2'},otherMarketState:{__option:'Some',value:state.markets.eth},
    ledger:{ledger:'btc-ledger',...state.ledgers['btc-ledger'],fees:'1',insuranceFeeRemainder:1},totalCash:'199999',liabilityVersions:['1','0'],
    legs:[{registration:'maker',capital:'capital',instance:0,lots:'1',gross:'1000',priceSequence:'9',authorityEpoch:'1',controlEpoch:'1',shapeEpoch:'1',depthEpoch:'1',consumedBefore:'0',consumedAfter:'1'}]});
  return {state,change};
}
const apply=(state:ReturnType<typeof fixture>,change:AccountEvent)=>projectAccounts(state,change,venue,domain,4);
describe('profile-4 financial reconstruction',()=>{
  it('preserves the omitted market exactly while applying the selected fill',()=>{
    const {state,change}=trade();const eth=structuredClone(state.markets.eth);
    change.data.otherMarketState={__option:'None'};apply(state,change);
    expect(state.markets.eth).toEqual(eth);expect(state.roots.trader.cash).toBe('99999');
  });
  it('reconstructs independent one-lot economics, consumption and funded fees',()=>{
    const {state,change}=trade();apply(state,change);
    expect(state.roots.trader.cash).toBe('99999');expect(state.roots.capital.cash).toBe('100000');
    expect(state.roots.trader.positions[0].virtualScaled).toBe('-1000000000000');
    expect(state.liquidity!.makers.maker.buyConsumed).toBe('1');expect(state.custody!.allocatedVault).toBe('200000');
  });
  it.each(['prefix','advance','sum','capital','epoch','cash','fee'])('rejects a corrupt %s instead of publishing balances',kind=>{
    const {state,change}=trade(),leg=change.data.legs[0];
    if(kind==='prefix')leg.consumedBefore='1';if(kind==='advance')leg.consumedAfter='2';
    if(kind==='sum')change.data.grossQuote='999';if(kind==='capital')leg.capital='trader';if(kind==='epoch')leg.depthEpoch='2';
    if(kind==='cash')change.data.rootStates[0].cash='100000';if(kind==='fee')change.data.insuranceCredit='1';
    expect(()=>apply(state,change)).toThrow();
  });
  it('keeps V3 projections and V4 maker messages explicitly separated',()=>{
    const {state,change}=trade();expect(()=>projectAccounts(state,change,venue,domain,3 as 4)).toThrow(/profile/);
    change.type='AccountRouteExecutedV3' as unknown as AccountEvent['type'];expect(()=>apply(state,change)).toThrow(/Unsupported liquidity projection event/);
  });
});
describe('restricted publisher reconstruction',()=>{
  const report=(state:ReturnType<typeof fixture>)=>event('FundingReportAcceptedV4',{publisher:'signer',state:state.markets.btc,
    report:{version:1,domain,market:'btc',authorityEpoch:'1',sequence:'1',observedSlot:'10',observedTime:'10',outcome:0}});
  it('records provenance and advances only the authorized monotone report',()=>{
    const state=fixture();apply(state,report(state));expect(state.liquidity!.publishers.publisher.lastSequence).toBe('1');
    expect(state.liquidity!.reports.btc.publisher).toBe('signer');
    const duplicate=report(state);duplicate.data.sequence='2';expect(()=>apply(state,duplicate)).toThrow(/monotone/);
  });
  it.each(['disabled','signer','epoch','domain'])('rejects a report with wrong %s',kind=>{
    const state=fixture(),change=report(state);
    if(kind==='disabled')state.liquidity!.publishers.publisher.enabled=false;
    if(kind==='signer')change.data.publisher='other';if(kind==='epoch')change.data.report.authorityEpoch='2';
    if(kind==='domain')change.data.report.domain='ff'.repeat(32);expect(()=>apply(state,change)).toThrow(/publisher/);
  });
  it('preserves report sequence while rotation advances the authoritative Clock fence',()=>{
    const state=fixture();Object.assign(state.liquidity!.publishers.publisher,{lastSequence:'9',lastObservedSlot:'9',lastObservedTime:'9'});
    const change=event('FundingPublisherChangedV4',{configuration:'publisher',marketState:state.markets.btc,
      state:{...state.liquidity!.publishers.publisher,publisher:'rotated',authorityEpoch:'2',lastObservedSlot:'10',lastObservedTime:'10'}});
    const reset=structuredClone(change);reset.data.state.lastSequence='0';expect(()=>apply(structuredClone(state),reset)).toThrow(/history/);
    const stale=structuredClone(change);stale.data.state.lastObservedSlot='9';expect(()=>apply(structuredClone(state),stale)).toThrow(/Clock fence/);
    apply(state,change);expect(state.liquidity!.publishers.publisher).toMatchObject({lastSequence:'9',lastObservedSlot:'10',lastObservedTime:'10'});
  });
});
