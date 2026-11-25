import {isDeepStrictEqual} from 'node:util';
import {ledgerAfterFill} from './ledger-lane-projection.js';
import * as sdk from '@rivalt/sdk';
import {json} from './events.js';
import type {AccountEvent} from './account-events.js';
import {accountCheck as check, accountFields, emptyAccounts, present, type AccountState} from './account-projection.js';

type Fields<T> = ReturnType<typeof accountFields<T>>;
export type LiquidityState = {
  ledgerCheckpoints?:Record<string,Fields<sdk.MarketLedger>>;
  marketCheckpoints?:Record<string,{grossLots:string;fundingTime:string;fundingIndexScaled:string}>;
  feeAccounting?:Record<string,{lanes:Record<string,string>;classified:string;pending:string;lanePending?:Record<string,string>}>;
  registries:Record<string,Fields<sdk.LiquidityRegistry>>;
  makers:Record<string,Fields<sdk.MakerRegistration>>;
  publishers:Record<string,Fields<sdk.FundingPublisher>>;
  reports:Record<string,{publisher:string;slot:string;report:Fields<sdk.FundingReport>}>;
};
export const emptyLiquidity = ():AccountState => ({...emptyAccounts(),liquidity:{registries:{},makers:{},publishers:{},reports:{}}});
type FinancialProjection = {root(value:any,key?:string):void;market(value:any,key?:string):void;ledger(value:any):void};
const same = (left:unknown,right:unknown,reason:string) => check(json(left)===json(right),reason);
const fields = (value:any,names:string[]) => names.map(name=>value[name]);

/** Full critical-event reconstruction. Fast maker price accounts are provisional
 * external inputs, never silently substituted for finalized clearing state. */
export function projectLiquidity(state:AccountState,event:AccountEvent,financial:FinancialProjection,artifactSet?:string) {
  const liquidity=present(state.liquidity,'liquidity profile'),venue=present(state.venue,'venue');
  check(venue.profileVersion===6,'liquidity profile');
  const makerLimit = sdk.hasWideDirectory(artifactSet) ? sdk.MAX_REGISTERED_MAKERS : 3;
  const change=event.data;
  const marketIndex=venue.markets.indexOf(change.market??change.state?.market);
  check(marketIndex>=0&&marketIndex<venue.marketCount,'liquidity market');
  const feesForMarket=()=>{
    check(sdk.hasAggregateFees(artifactSet),'fee lane deployment');
    liquidity.feeAccounting??={};
    return liquidity.feeAccounting[change.market]??={lanes:{},classified:'0',pending:'0'};
  };
  const previousLedger=()=>present(Object.values(state.ledgers).find(ledger=>ledger.market===change.market),'fee ledger');
  const maker=(value:any,key?:string) => {
    check(value.schemaVersion===10&&value.venue===change.venue&&value.market===venue.markets[marketIndex]
      &&Number.isInteger(value.instance)&&value.instance>=0&&value.instance<makerLimit,'canonical maker identity');
    const capital=present(state.roots[value.capital],'canonical maker capital');
    check(capital.role===1&&capital.mode===1&&capital.isolatedMarketIndex===marketIndex&&capital.owner===value.owner,'isolated canonical capital');
    const canonical=key??Object.keys(liquidity.makers).find(key=>liquidity.makers[key].capital===value.capital);
    check(canonical,'canonical registration key');
    const previous=liquidity.makers[canonical];
    if(previous)same(fields(previous,['venue','market','capital','owner','pricingProgram','programData','config','price','instance']),
      fields(value,['venue','market','capital','owner','pricingProgram','programData','config','price','instance']),'immutable canonical maker');
    liquidity.makers[canonical]=accountFields<sdk.MakerRegistration>(value);
  };
  const ledgerLanes=sdk.hasLedgerLanes(artifactSet);
  switch(event.type) {
    case 'LiquidityRegistryChangedV4': {
      const value=change.state;
      check(value.schemaVersion===10&&value.venue===change.venue&&Number.isInteger(value.count)&&value.count>=0&&value.count<=makerLimit
        &&(!value.sealed||value.count>=3),'canonical registry shape');
      const previous=liquidity.registries[change.registry];
      if(previous) {
        check(!previous.sealed&&value.count>=previous.count,'sealed/monotone registry');
        same(previous.registrations.slice(0,previous.count),value.registrations.slice(0,previous.count),'stable registry prefix');
      }
      const members=value.registrations.slice(0,value.count);
      check(new Set(members).size===members.length,'distinct registry makers');
      liquidity.registries[change.registry]=accountFields<sdk.LiquidityRegistry>(value);break;
    }
    case 'LiquidityMakerChangedV4':
      check([0,1,2,3,4,5,6].includes(change.operation),'canonical maker operation');
      check((change.operation===0)===!liquidity.makers[change.registration],'canonical maker history');
      maker(change.state,change.registration);financial.market(change.marketState,change.market);break;
    case 'FundingPublisherChangedV4': {
      const value=change.state,previous=liquidity.publishers[change.configuration];
      check(value.schemaVersion===10&&value.venue===change.venue&&value.market===change.market,'publisher identity');
      check(BigInt(value.authorityEpoch)===(previous?BigInt(previous.authorityEpoch)+1n:1n),'publisher authority epoch');
      // D76 preserves report sequence, but initialization/rotation/revocation
      // stamp a fresh authoritative Clock fence. That fence is not a report.
      same(value.lastSequence,previous?.lastSequence??'0','publisher history survives rotation');
      same(value.lastObservedSlot,change.slot,'publisher control Clock fence');
      if(previous)check(BigInt(value.lastObservedSlot)>=BigInt(previous.lastObservedSlot),'publisher control slot regression');
      liquidity.publishers[change.configuration]=accountFields<sdk.FundingPublisher>(value);
      financial.market(change.marketState,change.market);break;
    }
    case 'FundingReportAcceptedV4': {
      const configuration=present(Object.values(liquidity.publishers).find(value=>value.market===change.market),'publisher configuration');
      const report=change.report;
      check(configuration.enabled&&configuration.publisher===change.publisher&&report.version===1&&report.market===change.market
        &&report.domain===venue.domain&&report.authorityEpoch===configuration.authorityEpoch,'report publisher/domain');
      check(BigInt(report.sequence)===BigInt(configuration.lastSequence)+1n&&BigInt(report.observedSlot)>BigInt(configuration.lastObservedSlot)
        &&BigInt(report.observedTime)>=BigInt(configuration.lastObservedTime),'monotone publisher report');
      check([0,1,2,3].includes(report.outcome),'publisher outcome');
      Object.assign(configuration,{lastSequence:report.sequence,lastObservedSlot:report.observedSlot,lastObservedTime:report.observedTime});
      liquidity.reports[change.market]={publisher:change.publisher,slot:String(event.slot),report:accountFields<sdk.FundingReport>(report)};
      financial.market(change.state,change.market);break;
    }
    case 'MarketCheckpointed': {
      check(sdk.hasMarketLanes(artifactSet),'market checkpoint deployment');
      const logical=present(state.markets[change.market],'current market');
      same(fields(logical,['grossLots','fundingTime','fundingIndexScaled']),fields(change.state,['grossLots','fundingTime','fundingIndexScaled']),
        'checkpoint versus committed economic effects');
      if(liquidity.marketCheckpoints)delete liquidity.marketCheckpoints[change.market];
      financial.market(change.state,change.market);
      break;
    }
    case 'MarketFeesClassified': {
      const fees=feesForMarket(), prior=previousLedger();
      const total=Object.values(fees.lanes).reduce((sum,lane)=>sum+BigInt(lane),0n);
      const amount=total-BigInt(fees.classified), numerator=BigInt(prior.insuranceFeeRemainder)+amount;
      same([String(total),String(amount),String(numerator/4n)],[change.classified,change.amount,change.insuranceCredit],'complete market fee checkpoint');
      same([fees.pending,change.ledger.insurance,change.ledger.fees,change.ledger.insuranceFeeRemainder],
        [String(amount),String(BigInt(prior.insurance)+numerator/4n),String(BigInt(prior.fees)-numerator/4n),Number(numerator%4n)],'funded insurance reclassification');
      if(ledgerLanes){
        check(isDeepStrictEqual(prior.backing,change.ledger.backing),'complete ledger backing checkpoint');
        same([prior.liabilityVersion,String(BigInt(prior.version)+BigInt(amount>0n))],[change.ledger.liabilityVersion,change.ledger.version],'complete ledger versions');
        if(liquidity.ledgerCheckpoints)delete liquidity.ledgerCheckpoints[change.ledger.ledger];
        fees.lanePending={};
      }
      Object.assign(fees,{classified:total.toString(),pending:'0'});
      financial.ledger(change.ledger);
      break;
    }
    case 'LedgerLaneFilled':
    case 'MarketLaneFilled':
    case 'LiquidityRouteFeeRecorded':
    case 'LiquidityRouteExecutedV4': {
      const maximumLegs = sdk.hasMultiMaker(artifactSet) ? 8 : 2;
      check(change.legs.length >= 1 && change.legs.length <= maximumLegs && change.makerStates.length===change.legs.length&&change.rootStates.length===change.legs.length+1
        &&new Set(change.rootStates.map((value:any)=>value.id)).size===change.rootStates.length
        &&new Set(change.legs.map((leg:any)=>leg.registration)).size===change.legs.length,'canonical route shape');
      let ledgerAfter=change.ledger;
      if(event.type!=='LiquidityRouteExecutedV4') {
        const accounting=feesForMarket(), prior=previousLedger();
        const instance=change.legs[0].instance;
        let lane = change.legs[0].registration;
        if(instance >= 3) {
          const directory=present(Object.values(liquidity.registries).find(value=>value.market===change.market),'fee directory');
          check(directory.sealed && instance < directory.count,'fee lane membership');
          lane=directory.registrations[instance % 3];
        }
        const amount=BigInt(change.fee), collected=BigInt(accounting.lanes[lane]??'0')+amount;
        const pending=BigInt(accounting.pending)+amount;
        if(event.type==='LedgerLaneFilled'){
          check(ledgerLanes&&change.otherLedger.__option==='None','ledger lane deployment and scope');
          const key=change.ledger.ledger;
          const {ledger:_,...fields}=change.ledger;
          const physical={schemaVersion:10,revision:prior.revision,venue:change.venue,...fields};
          check(isDeepStrictEqual(physical,liquidity.ledgerCheckpoints?.[key]??prior),'read-only ledger snapshot');
          liquidity.ledgerCheckpoints??={};liquidity.ledgerCheckpoints[key]=physical;
          accounting.lanePending??={};
          const lanePending=BigInt(accounting.lanePending[lane]??0)+amount;
          same([change.lanePending,change.laneCollected],[String(lanePending),String(collected)],'maker fee receipt');
          accounting.lanePending[lane]=String(lanePending);
          const {schemaVersion,revision,venue,...updated}=ledgerAfterFill(state,prior,change.rootStates,change.fee);
          ledgerAfter={ledger:key,...updated};
        }else same([change.laneCollected,change.marketPending,change.ledger.fees,change.ledger.insurance,change.ledger.insuranceFeeRemainder],
          [String(collected),String(pending),String(BigInt(prior.fees)+amount),prior.insurance,prior.insuranceFeeRemainder],'funded fee escrow');
        accounting.lanes[lane]=String(collected);
        accounting.pending=String(pending);
      } else {
        check(!sdk.hasAggregateFees(artifactSet),'unexpected serial fee receipt');
        same(BigInt(change.fee),BigInt(change.insuranceCredit)+BigInt(change.retainedFee),'canonical fee partition');
        check(BigInt(change.insuranceCredit)===(BigInt(change.fee)+BigInt(change.carryBefore))/4n
          &&BigInt(change.carryAfter)===(BigInt(change.fee)+BigInt(change.carryBefore))%4n,'canonical insurance fee carry');
      }
      let lots=0n,gross=0n;
      for(const [index,leg] of change.legs.entries()) {
        const previous=present(liquidity.makers[leg.registration],'route maker'),next=change.makerStates[index];
        const consumed=change.side===0?'buyConsumed':'sellConsumed';
        same(previous[consumed],leg.consumedBefore,'route consumed prefix');
        same(BigInt(leg.consumedAfter),BigInt(leg.consumedBefore)+BigInt(leg.lots),'route consumption advance');
        check(leg.capital===previous.capital&&leg.instance===previous.instance&&leg.authorityEpoch===previous.authorityEpoch
          &&leg.depthEpoch===previous.depthEpoch&&next[consumed]===leg.consumedAfter,'route maker epochs/consumption');
        check(BigInt(leg.lots)>0n&&BigInt(leg.gross)>0n,'positive route leg');
        maker(next,leg.registration);lots+=BigInt(leg.lots);gross+=BigInt(leg.gross);
      }
      same(lots,BigInt(change.lots),'route lots sum');same(gross,BigInt(change.grossQuote),'route notional sum');
      let marketAfter=change.marketState;
      if(event.type==='MarketLaneFilled'||event.type==='LedgerLaneFilled'){
        check(sdk.hasMarketLanes(artifactSet)&&change.otherMarketState.__option==='None','local market lane scope');
        const logical=present(state.markets[change.market],'current market'),cached=change.marketState;
        const physical={grossLots:cached.grossLots,fundingTime:cached.fundingTime,fundingIndexScaled:cached.fundingIndexScaled};
        const prior=liquidity.marketCheckpoints?.[change.market]??logical;
        const names=['grossLots','fundingTime','fundingIndexScaled'];
        same(fields(prior,names),fields(physical,names),'read-only market checkpoint');
        const abs=(quantity:bigint)=>quantity<0n?-quantity:quantity;
        let grossLots=BigInt(logical.grossLots);
        for(const row of change.rootStates){
          const old=present(state.roots[state.identities[row.id]],'previous trading account');
          grossLots+=abs(BigInt(row.positions[marketIndex].lots))-abs(BigInt(old.positions[marketIndex].lots));
        }
        const oracle=logical.oracle,through=BigInt(change.through);
        check(through>=BigInt(oracle.sampledAt)&&through<=BigInt(oracle.heldUntil),'lane funding time');
        same(BigInt(change.index),BigInt(oracle.fundingBase)+BigInt(oracle.premiumScaled)*(through-BigInt(oracle.sampledAt))/3600n,'lane funding index');
        liquidity.marketCheckpoints??={};
        liquidity.marketCheckpoints[change.market]=physical;
        marketAfter={...cached,grossLots:String(grossLots),fundingTime:change.through,fundingIndexScaled:change.index};
      }
      change.rootStates.forEach((value:any)=>financial.root(value));
      financial.market(marketAfter,change.market);
      if(change.otherMarketState.__option==='Some') {
        check(change.otherMarketState.value.index!==change.marketState.index,'distinct route market snapshots');
        financial.market(change.otherMarketState.value);
      } else check(change.otherMarketState.__option==='None','optional route market snapshot');
      financial.ledger(ledgerAfter);
      if(change.otherLedger.__option==='Some') {
        check(change.otherLedger.value.marketIndex!==change.ledger.marketIndex,'distinct route ledgers');
        financial.ledger(change.otherLedger.value);
      } else check(change.otherLedger.__option==='None','optional route ledger snapshot');break;
    }
    default:throw new Error('Unsupported liquidity projection event');
  }
}
