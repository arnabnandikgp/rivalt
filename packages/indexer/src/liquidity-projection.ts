import * as sdk from '@rivalt/sdk';
import {json} from './events.js';
import type {AccountEvent} from './account-events.js';
import {accountCheck as check, accountFields, emptyAccounts, present, type AccountState} from './account-projection.js';

type Fields<T> = ReturnType<typeof accountFields<T>>;
export type LiquidityState = {
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
export function projectLiquidity(state:AccountState,event:AccountEvent,financial:FinancialProjection) {
  const liquidity=present(state.liquidity,'liquidity profile'),venue=present(state.venue,'venue');
  check(venue.profileVersion===4,'liquidity profile');
  const change=event.data;
  const marketIndex=venue.markets.indexOf(change.market??change.state?.market);
  check(marketIndex>=0&&marketIndex<venue.marketCount,'liquidity market');
  const maker=(value:any,key?:string) => {
    check(value.schemaVersion===7&&value.venue===change.venue&&value.market===venue.markets[marketIndex]
      &&Number.isInteger(value.instance)&&value.instance>=0&&value.instance<3,'canonical maker identity');
    const capital=present(state.roots[value.capital],'canonical maker capital');
    check(capital.role===1&&capital.mode===1&&capital.isolatedMarketIndex===marketIndex&&capital.owner===value.owner,'isolated canonical capital');
    const canonical=key??Object.keys(liquidity.makers).find(key=>liquidity.makers[key].capital===value.capital);
    check(canonical,'canonical registration key');
    const previous=liquidity.makers[canonical];
    if(previous)same(fields(previous,['venue','market','capital','owner','pricingProgram','programData','config','price','instance']),
      fields(value,['venue','market','capital','owner','pricingProgram','programData','config','price','instance']),'immutable canonical maker');
    liquidity.makers[canonical]=accountFields<sdk.MakerRegistration>(value);
  };
  switch(event.type) {
    case 'LiquidityRegistryChangedV4': {
      const value=change.state;
      check(value.schemaVersion===7&&value.venue===change.venue&&Number.isInteger(value.count)&&value.count>=0&&value.count<=3
        &&(!value.sealed||value.count===3),'canonical registry shape');
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
      check(value.schemaVersion===7&&value.venue===change.venue&&value.market===change.market,'publisher identity');
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
    case 'LiquidityRouteExecutedV4': {
      check([1,2].includes(change.legs.length)&&change.makerStates.length===change.legs.length&&change.rootStates.length===change.legs.length+1
        &&new Set(change.rootStates.map((value:any)=>value.id)).size===change.rootStates.length
        &&new Set(change.legs.map((leg:any)=>leg.registration)).size===change.legs.length,'canonical route shape');
      same(BigInt(change.fee),BigInt(change.insuranceCredit)+BigInt(change.retainedFee),'canonical fee partition');
      check(BigInt(change.insuranceCredit)===(BigInt(change.fee)+BigInt(change.carryBefore))/4n
        &&BigInt(change.carryAfter)===(BigInt(change.fee)+BigInt(change.carryBefore))%4n,'canonical insurance fee carry');
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
      change.rootStates.forEach((value:any)=>financial.root(value));
      financial.market(change.marketState,change.market);
      if(change.otherMarketState.__option==='Some') {
        check(change.otherMarketState.value.index!==change.marketState.index,'distinct route market snapshots');
        financial.market(change.otherMarketState.value);
      } else check(change.otherMarketState.__option==='None','optional route market snapshot');
      financial.ledger(change.ledger);
      if(change.otherLedger.__option==='Some') {
        check(change.otherLedger.value.marketIndex!==change.ledger.marketIndex,'distinct route ledgers');
        financial.ledger(change.otherLedger.value);
      } else check(change.otherLedger.__option==='None','optional route ledger snapshot');break;
    }
    default:throw new Error('Unsupported liquidity projection event');
  }
}
