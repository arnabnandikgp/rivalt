import assert from 'node:assert/strict';

const SCALE=1_000_000_000n;
type Root={id:number;cash:string;role:number;mode:number;isolatedMarketIndex:number;
  positions:{lots:string;virtualScaled:string;fundingCheckpointScaled:string}[]};
type Boundary={cursor:string;root:Root;fundingIndexScaled:string;referencePrice:string|null};
export type LiquidityEconomicsInput={version:5;operatorClass:'internal-reference';capital:string;market:string;marketIndex:0|1;
  opening:Boundary;closing:Boundary;events:{cursor:string;signature:string;kind:string;payload:any}[];
  transactions:{signature:string;feeLamports:string;failed:boolean;chargeToMaker:boolean}[];costScope:string;pendingFeeReservationLamports:string;
  hedge:{kind:'not-observed';assumedBps:string;description:string}};
function integer(value:unknown){assert(typeof value==='string'&&/^-?(0|[1-9][0-9]*)$/.test(value),'Decimal integer required');return BigInt(value);}
function unsigned(value:unknown){const result=integer(value);assert(result>=0n);return result;}

/** Independent normal-lifecycle arithmetic, not the production projection.
 * Require the complete local payload stream from the authenticated scoped journal. Default/liquidation windows fail
 * closed and need the separate complete-resolution economics qualification. */
export function liquidityMakerEconomics(input:LiquidityEconomicsInput) {
  assert.equal(input.version,5);assert.equal(input.operatorClass,'internal-reference');
  assert.equal(input.hedge.kind,'not-observed');assert(input.hedge.description.trim()&&input.costScope.trim());
  const hedgeBps=unsigned(input.hedge.assumedBps);assert(hedgeBps<=10_000n);
  const {opening,closing,marketIndex}=input;
  for(const boundary of [opening,closing])assert(boundary.root.role===1&&boundary.root.mode===1&&boundary.root.isolatedMarketIndex===marketIndex);
  assert.equal(opening.root.id,closing.root.id);
  let sequence=unsigned(opening.cursor),funding=integer(opening.fundingIndexScaled),cash=unsigned(opening.root.cash);
  const initial=opening.root.positions[marketIndex];
  let lots=integer(initial.lots),virtual=integer(initial.virtualScaled)-lots*(funding-integer(initial.fundingCheckpointScaled));
  const openingClaim=opening.referencePrice===null?null:virtual+lots*unsigned(opening.referencePrice)*SCALE;
  let fundingPnl=0n,notional=0n,filledLots=0n,collected=0n,paid=0n,deposited=0n,withdrawn=0n;
  const fills:unknown[]=[],bySignature=new Map(input.transactions.map(tx=>[tx.signature,tx]));
  assert.equal(bySignature.size,input.transactions.length,'Duplicate network fee');
  function accrue(next:bigint){const delta=-lots*(next-funding);virtual+=delta;fundingPnl+=delta;funding=next;}
  function checkRoot(root:Root|undefined){if(!root)return;const position=root.positions[marketIndex];
    assert.equal(unsigned(root.cash),cash,'Maker funded cash');assert.equal(integer(position.lots),lots,'Maker inventory');
    assert.equal(integer(position.virtualScaled)-lots*(funding-integer(position.fundingCheckpointScaled)),virtual,'Maker claim/funding');}
  for(const event of input.events) {
    const change=event.payload;assert.equal(unsigned(event.cursor),++sequence,'Incomplete local payload stream');
    const transaction=bySignature.get(event.signature);assert(transaction&&!transaction.failed,'Successful finalized transaction required');
    assert(!/Resolution|Liquidated|Retired/.test(event.kind),'Exceptional resolution requires its separate economics report');
    const market=[change.marketState,change.otherMarketState?.__option==='Some'?change.otherMarketState.value:undefined,...(change.markets??[]),change.state].find(value=>
      value&&typeof value==='object'&&value.index===marketIndex&&value.fundingIndexScaled!==undefined);
    if(market)accrue(integer(market.fundingIndexScaled));
    if(event.kind==='LiquidityRouteExecutedV4') {
      const root=change.rootStates.find((value:Root)=>value.id===opening.root.id);
      if(root) {
        const leg=change.legs.find((value:any)=>value.capital===input.capital);assert(leg,'Maker aggressive trading outside this report contract');
        assert.equal(change.market,input.market);assert([0,1].includes(change.side));
        const quantity=unsigned(leg.lots),gross=unsigned(leg.gross);assert(quantity>0n&&gross>0n);
        lots+=change.side===0?-quantity:quantity;virtual+=(change.side===0?gross:-gross)*SCALE;
        filledLots+=quantity;notional+=gross;fills.push({signature:event.signature,cursor:event.cursor,side:change.side===0?'sell':'buy',lots:leg.lots,grossQuoteAtoms:leg.gross});
        checkRoot(root);
      }
    }else if(event.kind==='AccountFinancialChangedV3') {
      const position=change.roots.indexOf(input.capital);
      if(position>=0) {
        const amount=unsigned(change.amount);
        if(change.kind===0){cash-=amount;withdrawn+=amount;}
        else if(change.kind===2){assert.equal(change.marketIndex,marketIndex);cash-=amount;virtual+=amount*SCALE;collected+=amount;}
        else if(change.kind===3){assert.equal(change.marketIndex,marketIndex);cash+=amount;virtual-=amount*SCALE;paid+=amount;}
        else assert.fail('Transfers/netting require a separately scoped maker economics window');
        checkRoot(change.rootStates[position]);
      }
    }else if(event.kind==='AccountCustodyChangedV3') {
      const member=change.members.find((value:any)=>value.margin===input.capital);
      if(member){const amount=unsigned(change.amount);
        if(change.kind===4){cash+=amount;deposited+=amount;}else if(change.kind===5){cash-=amount;withdrawn+=amount;}
        else assert.fail('Window must start after maker registration and exclude ownership transfers');
        assert.equal(unsigned(member.cash),cash);}
    }else {
      assert(['LiquidityRegistryChangedV4','LiquidityMakerChangedV4','FundingPublisherChangedV4','FundingReportAcceptedV4',
        'AccountAuthorityChangedV3','AccountOrderChangedV3','AccountBackingChangedV3','AccountQualificationV3','AccountSafetyRecoveryV3'].includes(event.kind),'Unknown economic event');
      if(change.margin===input.capital)checkRoot(change.state);
    }
    assert(cash>=0n);
  }
  assert.equal(sequence,unsigned(closing.cursor),'Missing tail history');accrue(integer(closing.fundingIndexScaled));checkRoot(closing.root);
  const unpaid=closing.referencePrice===null?null:virtual+lots*unsigned(closing.referencePrice)*SCALE,funded=paid-collected;
  assert.equal(cash-unsigned(opening.root.cash)-deposited+withdrawn,funded);
  return {version:5,operatorClass:input.operatorClass,independentMakerValidation:false,capital:input.capital,market:input.market,
    fills,filledLots:filledLots.toString(),grossNotionalAtoms:notional.toString(),inventoryLots:lots.toString(),cashAtoms:cash.toString(),
    fundedPnlAtoms:funded.toString(),unpaidPnlScaled:unpaid?.toString()??null,fundingPnlScaled:fundingPnl.toString(),providerFeesAtoms:'0',
    totalPnlBeforeNetworkAndHedgesScaled:unpaid===null||openingClaim===null?null:(funded*SCALE+unpaid-openingClaim).toString(),
    depositedAtoms:deposited.toString(),withdrawnAtoms:withdrawn.toString(),collectedLossAtoms:collected.toString(),settledGainAtoms:paid.toString(),
    networkFeesLamports:input.transactions.reduce((sum,tx)=>sum+(tx.chargeToMaker?unsigned(tx.feeLamports):0n),0n).toString(),networkFeeScope:input.costScope,
    pendingFeeReservationLamports:unsigned(input.pendingFeeReservationLamports).toString(),pnlScale:SCALE.toString(),
    valuation:{referenceAtomsPerLot:closing.referencePrice,basis:'finalized materialized funding; index mark may be stale',unpaidIsWithdrawableCash:false},
    hedge:{...input.hedge,observedHedges:false,costAssumptionScaled:(notional*hedgeBps*SCALE/10_000n).toString(),deductedFromReportedPnl:false},reconciliation:'pass'};
}
