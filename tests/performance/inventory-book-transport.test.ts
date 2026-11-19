import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {AccountRole,blockhash,getAddressDecoder} from '@solana/kit';
import {PublicKey} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';

const key=(label:string)=>getAddressDecoder().decode(createHash('sha256').update(label).digest());
const fixed={venue:key('venue'),custody:key('custody'),safety:key('safety'),registry:key('registry'),storage:key('storage'),
  resolution:key('resolution'),btc:key('btc'),eth:key('eth'),btcLedger:key('btc ledger'),ethLedger:key('eth ledger'),
  vault:key('vault'),prepared:key('prepared'),eventAuthority:key('events'),program:sdk.CLEARING_PROGRAM_ADDRESS};
function inventoryBookWire(ordinals:bigint[]) {
  const pages=[...new Set(ordinals.map(id=>id/8n))];
  const instruction=sdk.getVerifyInventoryBookInstruction({...fixed,epoch:1n,revision:1n,ordinals});
  const metas=pages.map(index=>({address:key('page '+index),role:AccountRole.WRITABLE}));
  const {transaction,v0Bytes,wireBytes}=sdk.compileCanonicalTransaction({
    payerKey:new PublicKey(key('payer')),recentBlockhash:blockhash(key('frozen hash')),
  },[{...instruction,accounts:[...instruction.accounts,...metas]}],{computeUnitLimit:1_200_000,loadedAccountsDataSizeLimit:8*1024*1024});
  return {active:ordinals.length,pages:pages.length,entities:11+pages.length,version:transaction.version,v0Bytes,wireBytes};
}

it('measures wire growth independently of the clearing revision-scope limit',()=>{
  // Both constants belong to this pinned candidate; a changed access set requires a new measurement.
  const scope=readFileSync(new URL('../../programs/clearing/src/instructions/scopes.rs',import.meta.url),'utf8');
  const scoped=scope.split('context!(VerifyInventoryBook,')[1].split(']; []);')[0];
  expect(scoped.match(/: (Read|Write)\b/g)?.length).toBe(11);
  const history=readFileSync(new URL('../../programs/clearing/src/scoped_history.rs',import.meta.url),'utf8');
  expect(history).toMatch(/MAX_ENTITIES: usize = 32;/);
  expect(sdk.INVENTORY_BOOK_ACTIVE_PAGE_LIMIT).toBe(21);
  const fill=(count:number,start=0,step=1)=>Array.from({length:count},(_,i)=>BigInt(start+i*step));
  const cases=[[0n,1n,2n,6n,7n,8n],fill(32,6),fill(58,6),fill(168),fill(22,0,8)];
  const measured=cases.map(inventoryBookWire);
  expect(measured.map(row=>[row.active,row.pages,row.entities])).toEqual([[6,2,13],[32,5,16],[58,8,19],[168,21,32],[22,22,33]]);
  expect(measured.map(row=>[row.version,row.v0Bytes,row.wireBytes])).toEqual([
    [0,803,803],[0,1111,1111],[1,1418,1376],[1,2727,2685],[1,1592,1550],
  ]);
});
