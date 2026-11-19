import {describe,it,expect} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {accountFields,projectAccounts,reconcileAccountLedger,type AccountState} from './account-projection.js';
import {emptyLiquidity} from './liquidity-projection.js';
import type {AccountEvent} from './account-events.js';
import {reconcileSettlementScratch} from './settlement-reconcile.js';
const zero='11111111111111111111111111111111',scale=1_000_000_000n;
function fixture() {
  const state=emptyLiquidity(),blank=<T>(decoder:{fixedSize:number;decode(bytes:Uint8Array):T})=>accountFields(decoder.decode(new Uint8Array(decoder.fixedSize)));
  state.venue={...blank(sdk.getVenueDecoder()),schemaVersion:10,profileVersion:6,domain:'00'.repeat(32),markets:['btc','eth'],marketCount:2};
  state.custody={...blank(sdk.getCustodyDecoder()),schemaVersion:10,allocatedVault:'6'};
  state.safety={...blank(sdk.getVenueSafetyDecoder()),schemaVersion:10,mode:2,paused:true,epoch:'7',resolutionEpoch:'3'};
  state.revisions.source={kind:10,revision:'11'};
  for(let market=0;market<2;market++) {
    state.markets[['btc','eth'][market]]={...blank(sdk.getMarketDecoder()),schemaVersion:10,index:market,lotsPerUnit:market?'100000':'1000000'};
    state.ledgers[['bl','el'][market]]={...blank(sdk.getMarketLedgerDecoder()),schemaVersion:10,market:['btc','eth'][market],marketIndex:market,
      insurance:market?'0':'3',fees:market?'0':'2',version:'1',liabilityVersion:'1'};
  }
  for(let id=0;id<3;id++) {
    const key=`root${id}`,root={...blank(sdk.getMarginAccountDecoder()),schemaVersion:10,revision:'9',venue:'venue',id:String(id),lifecycle:2,activationGeneration:'1',mode:0,
      isolatedMarketIndex:255,cash:id===0?'1':'0',delegateEpoch:'1'};
    root.positions[0].virtualScaled=((id===0?-2n:1n)*scale).toString();
    root.book.lastOrderId='4';root.book.lastGroupId='8';state.members.push(key);state.roots[key]=root;
  }
  state.resolution={epoch:'3',stage:2,cursor:'0',count:'3',registryHash:'00'.repeat(32),membershipEpoch:'3',safetyEpoch:'7',termsEpoch:'1',configEpochs:['1','1'],
    sourceObservations:['0','0'],sourceDeadlines:['0','0'],prices:['10','20'],funding:['0','0'],frozenAt:'1',cashBefore:'1',poolsBefore:['0','0'],
    insuranceBefore:['3','0'],feesBefore:['2','0'],allocatedBefore:'6',budgets:['3','0'],insuranceSpent:['0','0'],evaluation:0,clippedMask:0,
    rows:{},remainingCash:'1',appliedCash:'0',remainingLots:['0','0'],remainingGross:['0','0'],remainingClaims:['0','0']};
  state.identities=Object.fromEntries(state.members.map((key,index)=>[String(index),key]));state.nextMemberId='3';state.registeredCount='3';
  reconcileAccountLedger(state);return state;
}
const progress=(overrides:any={})=>({venue:'venue',slot:'1',epoch:'3',plan:'plan',stage:9,cursor:'0',count:'3',adoptionRevision:'12',
  remainingCash:'1',appliedCash:'0',marketMovements:['0','0'],gross:['0','0'],pools:['0','0'],insurance:['3','0'],insuranceSpent:['0','0'],
  fees:['2','0'],ledgerVersions:['1','1'],liabilityVersions:['1','1'],insuranceFeeRemainders:'0000',allocated:'6',actualVault:'6',
  resolutionStage:14,mode:2,paused:true,safetyEpoch:'7',...overrides});
function emit(state:AccountState,type:AccountEvent['type'],data:any,artifactSet?:string) {
  projectAccounts(state,{type,data,signature:'signature',outer:0,inner:0,ordinal:0,slot:1,blockTime:1,bytes:''},'venue','00'.repeat(32),4,artifactSet);
}
function apply(state:AccountState,id:number) {
  const previous=state.roots[`root${id}`],root=structuredClone(previous);
  root.cash=id===1?'1':'0';root.nonce='1';root.stateVersion='1';root.delegateEpoch='2';
  root.positions.forEach(position=>{position.virtualScaled='0';position.generation='1';});
  return {venue:'venue',slot:'1',epoch:'3',ordinal:String(id),id:String(id),member:`root${id}`,cashBefore:previous.cash,
    claims:[((id===0?-2n:1n)*scale).toString(),'0'],lots:['0','0'],flows:[id===2?'0':'1','0'],state:root};
}
function linkedBook() {
  const state=fixture(), source=state.resolution!;
  source.prices=['50000','20000'];source.insuranceBefore=['9','1'];source.remainingGross=['2','2'];source.count='4';
  source.cashBefore='19976';source.remainingCash='19976';source.allocatedBefore='19988';
  state.custody!.allocatedVault=source.allocatedBefore;
  state.ledgers.bl.insurance='9';state.ledgers.el.insurance='1';
  state.markets.btc.grossLots='2';state.markets.eth.grossLots='2';
  state.registeredCount='4';state.nextMemberId='4';
  state.roots.root0.cash=source.cashBefore;
  state.roots.flat=structuredClone(state.roots.root1);state.roots.flat.id='3';
  state.members.push('flat');state.identities['3']='flat';
  const terms=[
    ['root0',1,-10002,1,-10002], ['root1',-1,5006,0,0],
    ['root2',0,0,-1,10002], ['flat',0,4996,0,0],
  ] as const;
  for(const [key,btcLots,btcClaim,ethLots,ethClaim] of terms) {
    for(const [market,[lots,claim]] of [[btcLots,btcClaim],[ethLots,ethClaim]].entries()) {
      const position=state.roots[key].positions[market];
      position.lots=String(lots);
      position.virtualScaled=String((BigInt(claim)-BigInt(lots)*BigInt(source.prices[market]))*scale);
    }
  }
  return state;
}
describe('paged default independent one-atom ownership',()=>{
  it('authenticates the whole flat BTC claim only on the corresponding linked deployment',()=>{
    const state=linkedBook(),source=state.resolution!;
    const event={venue:'venue',epoch:'3',debtorId:'0',winners:['1','2'],shares:['9988','9988'],charges:['5','13'],
      eligible:['5006','10002'],matchedLots:['1','1'],basePrices:['50005','20013'],extraTickLots:['0','0']};
    const applyJoint=(snapshot:AccountState,artifactSet:string)=>emit(snapshot,'FrozenJointReductionVerified',event,artifactSet);
    expect(()=>applyJoint(structuredClone(state),sdk.LINKED_PAIR_ARTIFACT_SET)).toThrow('sole creditor');
    const foreign=structuredClone(state);foreign.roots.flat.positions[1].virtualScaled='1';
    expect(()=>applyJoint(foreign,sdk.LINKED_FLAT_ARTIFACT_SET)).toThrow('flat BTC creditor identity and face');
    applyJoint(state,sdk.LINKED_FLAT_ARTIFACT_SET);
    expect(source.joint?.charges).toEqual(['5','13']);
  });
  it('requires both totals and canonical identities before accepting a restarted linked attempt',()=>{
    const state=linkedBook();
    const applyRow=(attempt:number,ordinal:number,btc:number,eth:number,status:number,snapshot=state)=>{
      const term=(amount:number,market:number)=>amount===0?'0':String([50000,20000][market]+amount);
      emit(snapshot,'FrozenLinkedAllocationRow',{venue:'venue',epoch:'3',ordinal:String(ordinal),attempt:String(attempt),
        memberId:String(ordinal),debtorId:'0',shares:['9988','9988'],targets:['5','13'],
        eligible:[ordinal===1?'5006':'0',ordinal===2?'10002':'0'],charges:[String(btc),String(eth)],
        matchedLots:[btc?'1':'0',eth?'1':'0'],basePrices:[term(btc,0),term(eth,1)],extraTickLots:['0','0'],status},
        sdk.LINKED_ALLOCATION_ARTIFACT_SET);
    };
    applyRow(11,0,0,0,0);
    expect(()=>applyRow(11,2,0,13,0,structuredClone(state))).toThrow('linked scan binding');
    applyRow(11,1,0,0,0);applyRow(11,2,0,13,0);
    expect(()=>applyRow(11,3,0,0,1,structuredClone(state))).toThrow('linked proof outcome');
    applyRow(11,3,0,0,2);
    expect(()=>applyRow(11,0,0,0,0,structuredClone(state))).toThrow('new linked attempt');
    applyRow(19,0,0,0,0);applyRow(19,1,5,0,0);applyRow(19,2,0,13,0);
    expect(()=>applyRow(19,3,1,0,1,structuredClone(state))).toThrow('eligible linked terms');
    applyRow(19,3,0,0,1);
    expect(state.resolution?.linkedAllocation?.recovered).toEqual(['5','13']);
  });
  it('reads the flow owner from frozen membership after registration gaps',async()=>{
    const state=fixture();emit(state,'SettlementPlanProgress',progress());
    const resolution=state.resolution!,id='9007199254740993';
    resolution.rows={[id]:resolution.rows['0']};
    state.pagedSettlement!.count='1';
    const venue=sdk.CLEARING_PROGRAM_ADDRESS;
    const [key,bump]=await sdk.deriveSettlementLimbPage(venue,64,0n);
    const encode=(owner:bigint)=>{
      const words=Array<bigint>(256).fill(0n);words[0]=owner;words[1]=1n;
      return Buffer.from(sdk.getSettlementLimbPageEncoder().encode({schemaVersion:10,revision:1,epoch:3,
        venue,attempt:1,register:64,pageIndex:0,wordCount:7,bump,payload:{words}}));
    };
    await reconcileSettlementScratch(key,21,encode(BigInt(id)),state,{venue,program:venue},[id]);
    await expect(reconcileSettlementScratch(key,21,encode(0n),state,{venue,program:venue},[id])).rejects.toThrow();
  });
  it('keeps unapplied root claims separate from the verified payout basis between paired members',()=>{
    const state=fixture(),source=state.resolution!;
    state.ledgers.bl.insurance='0';source.insuranceBefore=['0','0'];source.budgets=['0','0'];
    state.custody!.allocatedVault='3';source.allocatedBefore='3';
    const debtor=state.roots.root0.positions[0],winner=state.roots.root1.positions[0];
    debtor.lots='-1';debtor.virtualScaled=String(8n*scale);
    winner.lots='1';winner.virtualScaled=String(-9n*scale);
    source.remainingGross=['2','0'];state.markets.btc.grossLots='2';
    emit(state,'FrozenPairVerified',{epoch:'3',mark:'10',price:'9',charge:'1',unpaidGainCap:'1',
      venue:'venue',debtorId:'0',winnerId:'1'});
    emit(state,'SettlementPlanProgress',progress({gross:['2','0'],insurance:['0','0'],allocated:'3',actualVault:'3'}));
    const paid=apply(state,0);paid.claims[0]=String(-scale);paid.lots[0]='-1';paid.state.positions[0].lots='0';
    emit(state,'SettlementMarginApplied',paid);
    expect(source.remainingClaims[0]).toBe(String(2n*scale));
    expect(source.rows['0'].claimsScaled[0]).toBe(String(-2n*scale));
    const charged=apply(state,1);charged.claims[0]='0';charged.lots[0]='1';
    charged.flows[0]='0';charged.state.cash='0';charged.state.positions[0].lots='0';
    emit(state,'SettlementMarginApplied',charged);
    expect(source.remainingClaims[0]).toBe(String(scale));
  });
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
