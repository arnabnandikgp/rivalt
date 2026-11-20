// Compare one finalized original per recovery instruction, with two independently
// isolated Anchor clients. This requires only the retained qualification receipts.
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {address,AccountRole,getBase58Encoder} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from '@rivalt/sdk';
import clearingIdl from '../../packages/sdk/idl/clearing.json' with {type:'json'};
import {CanonicalConformance} from './canonical-maker-conformance.js';

const directory=process.argv[2], destination=join(directory,'recovery-wire');
const expected=new Set(['open_search','capture_member','derive_pairs','verify_incumbent','cover_plan','cover_range','seal_search','bind_recovery_selection']);
const names=new Map(clearingIdl.instructions.filter(ix=>expected.has(ix.name))
  .map(ix=>[Buffer.from(ix.discriminator).toString('hex'),ix.name]));
const observed=new Set<string>(), check=new CanonicalConformance();
const keeper=join(directory,'keeper-proof');
for(const folder of existsSync(keeper)?[keeper,directory]:[join(directory,'search-start'),join(directory,'search-resume'),directory]) {
  for(const file of readdirSync(folder).filter(name=>/^transaction-\d+\.json$/.test(name))) {
    const receipt=JSON.parse(readFileSync(join(folder,file),'utf8'));
    if(receipt.meta.err!==null)continue;
    const {header,accountKeys,instructions}=receipt.transaction.message;
    for(const ix of instructions) {
      if(accountKeys[ix.programIdIndex]!==CLEARING_PROGRAM_ADDRESS)continue;
      const data=Buffer.from(getBase58Encoder().encode(ix.data));
      const name=names.get(data.subarray(0,8).toString('hex'));
      if(!name || observed.has(name))continue;
      assert.deepEqual(receipt.meta.loadedAddresses,{writable:[],readonly:[]},'Static keys for the measured original');
      const accounts=ix.accounts.map((index:number)=>{
        const signer=index<header.numRequiredSignatures;
        const writable=signer?index<header.numRequiredSignatures-header.numReadonlySignedAccounts:index<accountKeys.length-header.numReadonlyUnsignedAccounts;
        const role=signer?(writable?AccountRole.WRITABLE_SIGNER:AccountRole.READONLY_SIGNER):(writable?AccountRole.WRITABLE:AccountRole.READONLY);
        return {address:address(accountKeys[index]),role};
      });
      check.record([{programAddress:CLEARING_PROGRAM_ADDRESS,accounts,data}],receipt);
      observed.add(name);
    }
  }
}
assert.deepEqual(observed,expected,'Each new instruction must have actually succeeded');
mkdirSync(destination,{recursive:true});
const results=await check.finish(destination,[],async()=>null);
assert.equal(results[0].instructions,8);
assert.equal(results[0].events,2,'Selection event and scoped footer');
console.log(JSON.stringify(results[0]));
