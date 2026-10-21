import { expect, it } from 'vitest';
import { address, getBase58Decoder } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { decode, json, PROGRAM } from './events.js';
const key=address('11111111111111111111111111111111');
const payload=Buffer.from(sdk.getCustodyChangedEventEncoder().encode({schemaVersion:1,profileVersion:1,domain:new Uint8Array(32),market:key,
  termsEpoch:1n,configEpoch:1n,sequence:1n,slot:10n,kind:0,actor:key,participant:key,amount:0n,participantCash:0n,totalCash:0n,settlement:0n,insurance:0n,fees:0n,allocatedVault:0n,actualVault:0n,paused:false}));
const tx=(bytes=payload)=>({slot:10,blockTime:20,transaction:{signatures:['signature'],message:{accountKeys:[PROGRAM,key]}},meta:{err:null,
  innerInstructions:[{index:0,instructions:[{programIdIndex:0,accounts:[1],data:getBase58Decoder().decode(Buffer.concat([Buffer.from('e445a52e51cb9a1d','hex'),bytes]))}]}],
  logMessages:['Program data: untrusted log contents']}});
it('requires successful metadata and authenticated event-CPI envelope, not log strings',()=>{
  const valid=tx();expect(decode('signature',valid,key)).toHaveLength(1);
  expect(decode('signature',{...valid,meta:{...valid.meta,err:{InstructionError:[1,'Custom']}}},key)).toEqual([]);
  expect(()=>decode('signature',valid,'wrong-authority')).toThrow(/authority/);
  expect(()=>decode('different-signature',valid,key)).toThrow(/identity/);
  expect(()=>decode('signature',{...valid,meta:{...valid.meta,innerInstructions:null}},key)).toThrow(/Missing inner/);
  expect(decode('signature',{...valid,meta:{...valid.meta,innerInstructions:[]}},key)).toEqual([]);
});
it('fails closed on unknown, truncated, extended and unsupported critical schemas',()=>{
  const unknown=Buffer.from(payload);unknown[0]^=1;
  expect(()=>decode('signature',tx(unknown),key)).toThrow(/Unknown critical/);
  const version=Buffer.from(payload);version.writeUInt16LE(2,8);
  expect(()=>decode('signature',tx(version),key)).toThrow(/version/);
  expect(()=>decode('signature',tx(payload.subarray(0,-1)),key)).toThrow();
  expect(()=>decode('signature',tx(Buffer.concat([payload,Buffer.from([0])])),key)).toThrow(/Trailing/);
});
it('canonicalizes Buffer and typed bytes identically for PostgreSQL run bindings',()=>{
  expect(json({bytes:Buffer.from([1,2,255]),amount:12345678901234567890n})).toBe('{"bytes":"0102ff","amount":"12345678901234567890"}');
  expect(json({bytes:new Uint8Array([1,2,255])})).toBe('{"bytes":"0102ff"}');
});
