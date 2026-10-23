import {expect,it} from 'vitest';
import {sampleMatchesSnapshot} from './runtime.js';
import {json} from '../../indexer/src/events.js';

it('requires the exact observed market, epochs, prices, validity and funding state before using a pending sample',()=>{
  const s={market:'market',m:{domain:new Uint8Array(32),termsEpoch:3n,configEpoch:4n},risk:{observationSequence:9n,referencePrice:60000n,lower:59400n,upper:60600n,validFrom:100n,validUntil:200n,oracle:{sampledAt:1000n,fundingBase:5n,heldEpoch:4n,sources:['a','b','c','d']}}} as unknown as Parameters<typeof sampleMatchesSnapshot>[1];
  const event=JSON.parse(json({...s.risk,market:s.market,domain:s.m.domain,termsEpoch:3n,configEpoch:4n}));
  expect(sampleMatchesSnapshot(event,s)).toBe(true);
  for(const key of ['market','domain','termsEpoch','configEpoch','observationSequence','referencePrice','lower','upper','validFrom','validUntil'])expect(sampleMatchesSnapshot({...event,[key]:'different'},s)).toBe(false);
  for(const key of ['sampledAt','fundingBase','heldEpoch','sources'])expect(sampleMatchesSnapshot({...event,oracle:{...event.oracle,[key]:'different'}},s)).toBe(false);
  expect(sampleMatchesSnapshot({...event,oracle:null},s)).toBe(false);
});
