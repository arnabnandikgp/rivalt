import {expect,it} from 'vitest';
import {address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {groupAuthorityValue} from './group-authority.js';
import {groupBudget} from './group-execution.js';

const group=sdk.CLEARING_PROGRAM_ADDRESS, other=address('11111111111111111111111111111111');
it('separates all four maker fee budgets and both funding budgets',()=>{
  expect(new Set([0,1].flatMap(market=>[0,1].map(maker=>groupBudget('maker',market,maker).name))).size).toBe(4);
  expect(groupBudget('maker',1,0)).toEqual({name:'group-maker-1-0',cap:1_000_000n});
  expect(groupBudget('funding',0).name).not.toBe(groupBudget('funding',1).name);
  expect(()=>groupBudget('maker',2,0)).toThrow(/Market/);
  expect(()=>groupBudget('funding')).toThrow(/Market/);
  expect(()=>groupBudget('risk',0)).toThrow(/Invalid/);
});
it('reads a V2 margin nonce only from the bound group and account schema',()=>{
  const decoder=sdk.getMarginAccountV2Decoder(), root={...decoder.decode(new Uint8Array(decoder.fixedSize)),schemaVersion:2,group,nonce:9n};
  const bytes=Buffer.from(sdk.getMarginAccountV2Encoder().encode(root));
  const authority={kind:'marginNonce' as const,group,account:other,value:'9'};
  expect(groupAuthorityValue(authority,bytes)).toBe(9n);
  expect(()=>groupAuthorityValue({...authority,group:other},bytes)).toThrow(/binding/);
  const wrong=Buffer.from(bytes);wrong[0]^=1;
  expect(()=>groupAuthorityValue(authority,wrong)).toThrow(/schema/);
  expect(()=>groupAuthorityValue(authority,Buffer.from(sdk.getMarginAccountV2Encoder().encode({...root,schemaVersion:1})))).toThrow(/binding/);
});
it('keeps group sequence and per-market maker epoch authority separate',()=>{
  const groupDecoder=sdk.getClearingGroupV2Decoder();
  const bytes=Buffer.from(sdk.getClearingGroupV2Encoder().encode({...groupDecoder.decode(new Uint8Array(groupDecoder.fixedSize)),schemaVersion:2,profileVersion:2,sequence:12n}));
  const authority={kind:'groupSequence' as const,group,account:group,value:'12'};
  expect(groupAuthorityValue(authority,bytes)).toBe(12n);
  expect(()=>groupAuthorityValue({...authority,account:other},bytes)).toThrow(/binding/);
  const makerDecoder=sdk.getMakerRegistrationV2Decoder();
  const maker=Buffer.from(sdk.getMakerRegistrationV2Encoder().encode({...makerDecoder.decode(new Uint8Array(makerDecoder.fixedSize)),schemaVersion:2,group,quoteEpoch:4n}));
  expect(groupAuthorityValue({kind:'groupQuoteEpoch',group,account:other,value:'4'},maker)).toBe(4n);
  expect(()=>groupAuthorityValue(authority,maker)).toThrow(/schema/);
});
