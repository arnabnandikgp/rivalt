// Compare service-built serial prefixes to finalized originals from the combined payout run.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {getBase58Encoder,type Address,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {settlementInstructions} from '../../packages/services/src/settlement-checkpoints.js';
import {accountWorkerKeys} from '../../packages/services/src/account-worker-state.js';

const directory=process.argv[2];
const read=(file:string)=>JSON.parse(readFileSync(join(directory,file),'utf8'));
const {venue,artifactSet}=read('sql-paid-and-withdrawn-snapshot.json').binding;
assert.equal(artifactSet,sdk.INTEGRATED_RECOVERY_ARTIFACT_SET);
const markets=await Promise.all([0,1].map(async i=>(await sdk.deriveAccountMarket(venue,i))[0]));
const ledgers=await Promise.all(markets.map(async key=>(await sdk.deriveMarketLedger(key))[0]));
const [safety]=await sdk.deriveVenueComponent(venue,'safety'),{eventAuthority}=await accountWorkerKeys(venue);
const snapshot={venue,safety,markets,ledgers,eventAuthority,marginLayout:'ledger-lanes' as const};
const observed=new Map<string,number>();
const shape=(ix:Instruction)=>[Array.from(ix.data!),ix.accounts!.map(meta=>meta.address)];
for(const file of readdirSync(directory).filter(name=>/^wire-\d+\.json$/.test(name))) {
  const {label,signature}=read(file);
  const name=label.replace(/ \d+$/,'');
  if(!['collect the maker loss into the BTC pool','pay fully backed closed BTC profit','scan BTC backing'].includes(name))continue;
  const {transaction,meta}=read(file.replace('wire-','transaction-'));
  assert.equal(meta.err,null);assert.equal(transaction.signatures[0],signature);
  const {accountKeys, instructions}=transaction.message;
  const clearing:Instruction[]=instructions
    .filter((ix:{programIdIndex:number})=>accountKeys[ix.programIdIndex]===sdk.CLEARING_PROGRAM_ADDRESS)
    .map((ix:{data:string;accounts:number[]})=>({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,data:getBase58Encoder().encode(ix.data),
      accounts:ix.accounts.map(index=>({address:accountKeys[index] as Address,role:0}))}));
  const consumer=clearing.at(-1)!;
  const rebuilt=await settlementInstructions(snapshot,sdk.routeComputeBudget(),consumer);
  assert.deepEqual(rebuilt.slice(1).map(shape),clearing.map(shape),label);
  observed.set(name,(observed.get(name)??0)+1);
}
assert.equal(observed.get('collect the maker loss into the BTC pool'),1);
assert.equal(observed.get('pay fully backed closed BTC profit'),1);
assert((observed.get('scan BTC backing')??0)>0);
console.log(JSON.stringify(Object.fromEntries(observed)));
