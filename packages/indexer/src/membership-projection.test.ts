import {it,expect} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {emptyLiquidity} from './liquidity-projection.js';
import {accountFields,projectAccounts,reconcileAccountLedger,type AccountState} from './account-projection.js';
import {projectScopedBatch} from './scoped-projection.js';
import type {AccountEvent,AccountInvocation} from './account-events.js';
const venue='venue',domain='00'.repeat(32),zero='11111111111111111111111111111111';
function fixture() {
  const state=emptyLiquidity(),blank=<T>(decoder:{fixedSize:number;decode(bytes:Uint8Array):T})=>accountFields(decoder.decode(new Uint8Array(decoder.fixedSize)));
  state.venue={...blank(sdk.getVenueDecoder()),schemaVersion:9,revision:'1',profileVersion:5,domain,marketCount:0};
  state.custody={...blank(sdk.getCustodyDecoder()),schemaVersion:9,revision:'1',venue};
  state.safety={...blank(sdk.getVenueSafetyDecoder()),schemaVersion:9,revision:'1',venue};
  state.portfolios.portfolio={schemaVersion:9,revision:'1',venue,owner:'owner',index:0,activeChildren:1};
  state.identities={'0':'root'};state.registeredCount='1';state.nextMemberId='1';state.membershipVersion='8';
  state.roots.root={...blank(sdk.getMarginAccountDecoder()),schemaVersion:9,revision:'1',venue,portfolio:'portfolio',owner:'owner',
    lifecycle:1,id:'0',delegate:zero,delegateEpoch:'3',nonce:'10',stateVersion:'11',activationGeneration:'7',mode:0,isolatedMarketIndex:255};
  state.roots.root.book.lastOrderId='51';state.roots.root.book.lastGroupId='39';
  state.revisions={venue:{kind:0,revision:'1'},custody:{kind:1,revision:'1'},safety:{kind:2,revision:'1'},
    portfolio:{kind:4,revision:'1'},root:{kind:5,revision:'1'}};
  reconcileAccountLedger(state);return state;
}
function event(state:AccountState,lifecycle:1|2|3):AccountEvent {
  const previous=state.roots.root;
  return {signature:'sig',slot:1,blockTime:1,outer:0,inner:0,ordinal:0,type:'MarginMembershipChanged',bytes:'fixture',
    data:{venue,slot:'1',margin:'root',portfolio:'portfolio',owner:'owner',id:'0',lifecycle,
      activationGeneration:(BigInt(previous.activationGeneration)+(lifecycle===2?1n:0n)).toString(),
      nonce:(BigInt(previous.nonce)+1n).toString(),stateVersion:(BigInt(previous.stateVersion)+1n).toString(),delegateEpoch:(BigInt(previous.delegateEpoch)+1n).toString(),
      membershipEpoch:(BigInt(state.membershipVersion!)+(lifecycle===3?0n:1n)).toString(),registeredCount:lifecycle===3?'0':'1',
      financialCount:lifecycle===2?'1':'0',nextId:'1',refundedLamports:lifecycle===3?'100':'0'}};
}
it('replays entry, exit and generation-preserving retirement without cash or claim changes',()=>{
  const state=fixture();
  for(const lifecycle of [2,1,2,1] as const)projectAccounts(state,event(state,lifecycle),venue,domain);
  expect(state.roots.root.activationGeneration).toBe('9');expect(state.membershipVersion).toBe('12');
  expect(state.roots.root.book.lastOrderId).toBe('51');expect(state.roots.root.book.lastGroupId).toBe('39');
  const retirement=event(state,3);
  const invocation:AccountInvocation={signature:'sig',slot:1n,transactionIndex:0,outer:0,invocation:0,venue,domain,
    instruction:sdk.hex(sdk.RETIRE_MARGIN_DISCRIMINATOR),payloads:[],footerBytes:'fixture',footerInner:1,events:[retirement],
    reads:[{account:venue,kind:0,revision:'1'}],writes:[{account:'root',kind:26,before:'1',after:'2'},
      {account:'portfolio',kind:4,before:'1',after:'2'}],retirements:[{account:'root',from:5,to:26}]};
  const final=projectScopedBatch(state,[invocation],{venue,domain}).state;
  expect(final.tombstones.root).toMatchObject({id:'0',activationGeneration:'9',revision:'2',owner:'owner',child:0});
  expect(final.roots.root).toBeUndefined();expect(final.identities).toEqual({'0':'root'});
  expect(final.registeredCount).toBe('0');expect(final.nextMemberId).toBe('1');expect(final.membershipVersion).toBe('12');
  expect(final.custody).toEqual(state.custody);expect(final.portfolios.portfolio.activeChildren).toBe(0);
});
it('refuses residual fractions, reservations, live protection, delegates and replay counter resets',()=>{
  for(const mutation of ['fraction','cash','reservation','protection','delegate','replay','generation','membership']) {
    const state=fixture(),change=event(state,2);
    switch(mutation) {
      case 'fraction':state.roots.root.positions[0].virtualScaled='1';break;
      case 'cash':state.roots.root.cash='1';break;
      case 'reservation':state.roots.root.reserved='1';break;
      case 'protection':state.roots.root.book.protections[0].protection.remaining='1';break;
      case 'delegate':state.roots.root.delegate='delegate';break;
      case 'replay':change.data.nonce='0';break;
      case 'generation':change.data.activationGeneration='7';break;
      case 'membership':change.data.membershipEpoch='8';break;
    }
    expect(()=>projectAccounts(state,change,venue,domain)).toThrow();
  }
});
