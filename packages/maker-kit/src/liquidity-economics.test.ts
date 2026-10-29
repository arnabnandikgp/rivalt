import {describe,it,expect} from 'vitest';
import {liquidityMakerEconomics,type LiquidityEconomicsInput} from './liquidity-economics.js';
const root=(lots='0',virtual='0',funding='0',cash='1000000')=>({id:0,cash,role:1,mode:1,isolatedMarketIndex:0,
  positions:[{lots,virtualScaled:virtual,fundingCheckpointScaled:funding},{lots:'0',virtualScaled:'0',fundingCheckpointScaled:'0'}]});
const vector=():LiquidityEconomicsInput=>({version:4,operatorClass:'internal-reference',capital:'capital',market:'market',marketIndex:0,
  opening:{sequence:'10',root:root(),fundingIndexScaled:'0',referencePrice:'60000'},
  closing:{sequence:'14',root:root('0','400','200','1000010'),fundingIndexScaled:'200',referencePrice:'60000'},
  events:[
    {signature:'a',kind:'LiquidityRouteExecutedV4',payload:{sequence:'11',market:'market',side:0,marketState:{index:0,fundingIndexScaled:'0'},
      legs:[{capital:'capital',lots:'2',gross:'120006'}],rootStates:[root('-2','120006000000000')]}},
    {signature:'b',kind:'FundingReportAcceptedV4',payload:{sequence:'12',state:{index:0,fundingIndexScaled:'200'}}},
    {signature:'c',kind:'LiquidityRouteExecutedV4',payload:{sequence:'13',market:'market',side:1,marketState:{index:0,fundingIndexScaled:'200'},
      legs:[{capital:'capital',lots:'2',gross:'119996'}],rootStates:[root('0','10000000400','200')]}},
    {signature:'d',kind:'AccountFinancialChangedV3',payload:{sequence:'14',roots:['capital'],kind:3,marketIndex:0,amount:'10',
      markets:[{index:0,fundingIndexScaled:'200'}],rootStates:[root('0','400','200','1000010')]}}
  ],transactions:['a','b','c','d'].map(signature=>({signature,feeLamports:'5000',failed:false,chargeToMaker:signature==='a'})),
  costScope:'one specified operator transaction only',pendingFeeReservationLamports:'0',hedge:{kind:'not-observed',assumedBps:'1',description:'hypothetical'}});
describe('independent canonical maker economics',()=>{
  it('separates 10 funded atoms from a fractional unpaid claim and actual network costs',()=>{
    const result=liquidityMakerEconomics(vector());expect(result).toMatchObject({fundedPnlAtoms:'10',unpaidPnlScaled:'400',fundingPnlScaled:'400',
      inventoryLots:'0',cashAtoms:'1000010',providerFeesAtoms:'0',networkFeesLamports:'5000',totalPnlBeforeNetworkAndHedgesScaled:'10000000400'});
    expect(result.hedge).toMatchObject({observedHedges:false,costAssumptionScaled:'24000200000',deductedFromReportedPnl:false});
  });
  it('rejects missing events, duplicate fees, failed fills and invented cash',()=>{
    for(const mutate of [(value:LiquidityEconomicsInput)=>value.events.splice(1,1),
      (value:LiquidityEconomicsInput)=>value.transactions.push(value.transactions[0]),
      (value:LiquidityEconomicsInput)=>value.transactions[0].failed=true,
      (value:LiquidityEconomicsInput)=>value.closing.root.cash='1000011']){const value=vector();mutate(value);expect(()=>liquidityMakerEconomics(value)).toThrow();}
  });
  it('does not apply an ordinary economics model to a default window',()=>{
    const value=vector();value.events[1].kind='AccountResolutionAppliedV3';expect(()=>liquidityMakerEconomics(value)).toThrow(/separate economics/);
  });
});
