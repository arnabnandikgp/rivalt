import {emptyOrderBook} from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {it,expect} from 'vitest';
import {effectiveFunding,oracleMode,accruedBalance} from '@rivalt/sdk';
import {empty,project,balance} from '../../packages/indexer/src/projection.js';
import type {Event} from '../../packages/indexer/src/events.js';
it('derives current modes and funding without extending invalid gaps or transferring fractions',()=>{
  const m={mode:2,fundingIndexScaled:237500n,configEpoch:2n},r={validFrom:10n,validUntil:1000n,oracle:{sampledAt:100n,heldUntil:106n,heldEpoch:2n,heldSlot:900n,fundingBase:0n,premiumScaled:285000000n,status:2,sourceDeadline:120n,lastQualified:100n}};
  expect(effectiveFunding(m,r,103n,100n)).toBe(237500n);
  expect(effectiveFunding(m,r,106n,100n)).toBe(475000n);
  expect(effectiveFunding(m,r,110n,100n)).toBe(475000n);
  expect(effectiveFunding(m,r,131n,100n)).toBe(237500n);
  expect(effectiveFunding({...m,configEpoch:3n},r,105n,100n)).toBe(237500n);
  expect(oracleMode(m,r,111n,100n)).toBe('Normal');expect(oracleMode(m,r,112n,100n)).toBe('Degraded');expect(oracleMode(m,r,120n,100n)).toBe('NoCredibleBounds');
  expect(accruedBalance({lots:3n,virtualScaled:0n,fundingCheckpointScaled:0n},237500n).virtualScaled).toBe(-712500n);
  expect(accruedBalance({lots:0n,virtualScaled:-712500n,fundingCheckpointScaled:237500n},475000n).virtualScaled).toBe(-712500n);
});
it('rebuilds exact checkpoint-adjusted claims when the stored virtual balances do not sum to P',()=>{
  const state=empty();state.sequence='1';state.market={mode:2,totalCash:'2000000',allocatedVault:'2000000',settlement:'0',insurance:'0',fees:'0',fundingIndexScaled:'0'};
  const common={owner:'owner',cash:'1000000',generation:'1',nonce:'1',reserved:'0',orderIds:['0','0','0','0'],book:JSON.parse(json(emptyOrderBook()))};
  state.participants={long:{...common,id:0,lots:'3',virtualScaled:'-180000300000000',fundingCheckpointScaled:'100000000'},short:{...common,id:1,lots:'-3',virtualScaled:'180000000000000',fundingCheckpointScaled:'0'}};
  const event={type:'oracle',signature:'s',outer:0,inner:0,ordinal:0,slot:1,blockTime:100,bytes:'',data:{domain:'domain',market:'market',sequence:'2',termsEpoch:'1',configEpoch:'2',fundingIndexScaled:'100000000',fundingTime:'100',referencePrice:'60000',lower:'59400',upper:'60600',validFrom:'0',validUntil:'1000',oracle:{sampledAt:'100',heldUntil:'100',heldEpoch:'2',heldSlot:'900',status:2,sourceDeadline:'120',lastQualified:'100'}}}as Event;
  expect(()=>project(state,event,'market','domain')).not.toThrow();
  expect(balance(state.participants.long,state,100n,100n).unpaidPnlScaled).toBe('-300000000');
  expect(balance(state.participants.short,state,100n,100n).unpaidPnlScaled).toBe('300000000');
});
