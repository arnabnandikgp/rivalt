import { expect, it } from 'vitest';
import { address } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { json, PROGRAM } from './events.js';
import {eventTransaction,fixtureVenue,fixtureAuthority} from './event-test-fixture.js';
import {decodeAccounts} from './account-events.js';
const key=fixtureVenue,authority=fixtureAuthority;
const rootDecoder=sdk.getMarginAccountSnapshotDecoder();
const payload=Buffer.from(sdk.getAccountAuthorityChangedEventEncoder().encode({venue:key,slot:10n,margin:key,
  state:{...rootDecoder.decode(new Uint8Array(rootDecoder.fixedSize)),schemaVersion:5},liabilityVersions:[0n,0n]}));
const decode=(signature:string,transaction:unknown,authority:string,program:string=PROGRAM)=>decodeAccounts(signature,transaction,authority,key,program);
const tx=(bytes=payload)=>eventTransaction(bytes,key,authority,sdk.CLEARING_PROGRAM_ADDRESS,'signature');
it('requires successful metadata and authenticated event-CPI envelope, not log strings',()=>{
  const valid=tx();expect(decode('signature',valid,authority)).toHaveLength(1);
  expect(decode('signature',{...valid,meta:{...valid.meta,err:{InstructionError:[1,'Custom']}}},authority)).toEqual([]);
  expect(()=>decode('signature',valid,'wrong-authority')).toThrow(/authority/);
  expect(()=>decode('different-signature',valid,authority)).toThrow(/identity/);
  expect(()=>decode('signature',{...valid,meta:{...valid.meta,innerInstructions:null}},authority)).toThrow(/Missing inner/);
  expect(()=>decode('signature',{...valid,meta:{...valid.meta,innerInstructions:[]}},authority)).toThrow(/footer/);
});
it('fails closed on unknown, truncated, extended and unsupported critical schemas',()=>{
  const unknown=Buffer.from(payload);unknown[0]^=1;
  expect(()=>decode('signature',tx(unknown),authority)).toThrow(/Unknown.*payload/);
  expect(()=>decodeAccounts('signature',tx(),authority,key,PROGRAM,3 as 4)).toThrow(/profile/);
  expect(()=>decode('signature',tx(payload.subarray(0,-1)),authority)).toThrow();
  expect(()=>decode('signature',tx(Buffer.concat([payload,Buffer.from([0])])),authority)).toThrow(/Trailing/);
});
it('canonicalizes Buffer and typed bytes identically for PostgreSQL run bindings',()=>{
  expect(json({bytes:Buffer.from([1,2,255]),amount:12345678901234567890n})).toBe('{"bytes":"0102ff","amount":"12345678901234567890"}');
  expect(json({bytes:new Uint8Array([1,2,255])})).toBe('{"bytes":"0102ff"}');
});
it('binds event-CPI decoding to an explicitly selected deployment',()=>{
  const other=address('BbLhJdwymg9aGCtdrcxkFsBwP3L8N9NbGJucq37sS2jv');
  const deployed=eventTransaction(payload,key,authority,other,'signature');
  expect(()=>decode('signature',deployed,authority)).toThrow(/footer/);
  expect(decode('signature',deployed,authority,other)).toHaveLength(1);
});
