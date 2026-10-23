import {emptyOrderBook} from '@rivalt/sdk';
import {json} from './events.js';
import { describe, expect, it } from 'vitest';
import { balance, empty, project, type Participant } from './projection.js';
import type { Event } from './events.js';
const participant=(changes:Partial<Participant>={}):Participant=>({owner:'owner',id:0,cash:'1000000',lots:'0',virtualScaled:'0',fundingCheckpointScaled:'0',generation:'0',nonce:'0',reserved:'0',orderIds:['0','0','0','0'],book:JSON.parse(json(emptyOrderBook())),...changes});
describe('independent financial read vectors',()=>{
  it('distinguishes cash, marked unpaid profit, adverse loss, margin and disabled withdrawals',()=>{
    const state=empty();state.market={mode:1,paused:false};
    state.risk={referencePrice:'60000',lower:'59400',upper:'60600',validFrom:'100',validUntil:'200'};
    // Bought 10 lots for 590,000 atoms: mark profit 10,000; lower-bound profit 4,000.
    const long=balance(participant({lots:'10',virtualScaled:'-590000000000000'}),state,100n);
    expect(long).toMatchObject({cash:'1000000',unpaidPnlScaled:'10000000000000',negativeUnpaidLiability:'0',riskEquity:'1000000',initialMargin:'60600',withdrawableCash:'0',positiveUnpaidMarginCredit:'0',valuationStatus:'FreshTestObservation'});
    // Short 10 lots received 590,000: mark loss 10,000, adverse loss 16,000.
    expect(balance(participant({lots:'-10',virtualScaled:'590000000000000'}),state,199n)).toMatchObject({unpaidPnlScaled:'-10000000000000',negativeUnpaidLiability:'16000',riskEquity:'984000',initialMargin:'60600'});
    expect(balance(participant(),state,200n).valuationStatus).toBe('ExpiredTestObservation');
    expect(balance(participant(),state,99n).valuationStatus).toBe('ExpiredTestObservation');
  });
  it('rounds negative unpaid liability upward and never turns a fraction into cash',()=>{
    const state=empty();state.market={mode:1,paused:false};
    expect(balance(participant({virtualScaled:'-1'}),state,0n)).toMatchObject({unpaidPnlScaled:'-1',negativeUnpaidLiability:'1',riskEquity:'999999',initialMargin:'0',withdrawableCash:'0'});
    expect(balance(participant({virtualScaled:'999999999'}),state,0n)).toMatchObject({negativeUnpaidLiability:'0',riskEquity:'1000000',positiveUnpaidMarginCredit:'0'});
  });
  it('enforces complete sequence/environment and conservation independently of event post-state',()=>{
    const state=empty();
    const init:Event={type:'custody',signature:'sig',outer:0,inner:0,ordinal:0,slot:1,blockTime:1,bytes:'',data:{market:'market',domain:'domain',sequence:'1',kind:0,participant:'11111111111111111111111111111111',totalCash:'0',settlement:'0',insurance:'0',fees:'0',allocatedVault:'0',paused:false,termsEpoch:'1',configEpoch:'1'}};
    project(state,init,'market','domain');
    expect(()=>project(state,{...init,data:{...init.data,sequence:'3'}},'market','domain')).toThrow(/sequence gap/);
    expect(()=>project(state,{...init,data:{...init.data,sequence:'2'}},'other','domain')).toThrow(/environment/);
    expect(()=>project(state,{...init,data:{...init.data,sequence:'2',kind:4,insurance:'1'}},'market','domain')).toThrow(/conservation/);
  });
});

it('keeps planned default payout separate from cash and clears unpaid claims after application',()=>{
  const state=empty();state.market={mode:3,paused:true,fundingIndexScaled:'0'};
  state.resolution={header:{epoch:'2',stage:10,cursor:0,count:2,price:'60000',funding:'0'},
    rows:[{claim:'15000000000',collected:'0',paid:'5',impairedScaled:'10000000000',roundingScaled:'0'}]};
  const pending=balance(participant({cash:'3'}),state,100n);
  expect(pending).toMatchObject({cash:'3',unpaidPnlScaled:'15000000000',withdrawableCash:'0',sourceMode:'Frozen',resolution:{plannedPayment:'5',paymentApplied:false,appliedPayment:'0'}});
  state.resolution.header.cursor=1;
  expect(balance(participant({cash:'8'}),state,101n)).toMatchObject({cash:'8',unpaidPnlScaled:'0',withdrawableCash:'0',resolution:{plannedPayment:'5',paymentApplied:true,appliedPayment:'5'}});
});

it('keeps canonical order payloads immutable across candidate cleanup and journal replay',()=>{
  const state=empty();
  state.market={mode:2,totalCash:'1000000',settlement:'0',insurance:'0',fees:'0',allocatedVault:'1000000'};
  state.participants.trader=participant();
  const book=JSON.parse(json(emptyOrderBook()));book.lastOrderId='7';
  Object.assign(book.orders[0],{id:'7',state:1,lots:'10',filled:'0',notional:'0',feeCharged:'0',reserve:'100'});
  const event:Event={type:'order',signature:'order',outer:0,inner:0,ordinal:0,slot:1,blockTime:1,bytes:'canonical-order-bytes',
    data:{market:'market',domain:'domain',sequence:'1',kind:0,participant:'trader',reserved:'100',orderIds:['7','0','0','0'],book}};
  const original=json(event);
  project(state,event,'market','domain');
  // A later default invalidates the candidate's retained book in place. The
  // journal must still contain the original active order with its 100 reserve.
  state.participants.trader.book.orders[0].state=6;
  state.participants.trader.book.orders[0].reserve='0';
  state.participants.trader.book.groups[0].remaining='0';
  state.participants.trader.orderIds[0]='0';
  expect(json(event)).toBe(original);
  const committed=empty();committed.market=structuredClone(state.market);committed.participants.trader=participant();
  project(committed,event,'market','domain');
  expect(committed.participants.trader).toMatchObject({reserved:'100',orderIds:['7','0','0','0'],book:{orders:[expect.objectContaining({id:'7',state:1,reserve:'100'}),expect.anything(),expect.anything(),expect.anything()]}});
});
