import assert from 'node:assert/strict';
import {accessSync,constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {getAddressEncoder,type Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {Rpc} from '../../indexer/src/rpc.js';
import {decodeAccountWorker} from './account-worker-state.js';
import {readRecoveryWitnessBook,recoveryRateWitness,type FrozenRecoveryBook} from './recovery-witness.js';

import {pagedRateWitness} from './paged-recovery-proof.js';

type Calculator = {blocked:string}|{rank:bigint;count:bigint;edges:sdk.SearchEdge[]};
type Member = {id:bigint;cash:bigint;claims:readonly bigint[];lots:readonly bigint[];history:readonly Uint8Array[]};
type Inputs = Omit<FrozenRecoveryBook,'rows'> & {rows:Member[];marks:readonly bigint[];fees:readonly bigint[]};
const binary = fileURLToPath(new URL('../../../target/release/rivalt-recovery-selector',import.meta.url));

export function requireRecoverySelector() {
  accessSync(binary,constants.X_OK);
}

export function recoveryBudget(value:string|undefined) {
  if (value===undefined) return 0;
  assert(/^[1-9][0-9]*$/.test(value) && Number(value)<=65536, 'Recovery worker schedule budget must be 1–65536');
  return Number(value);
}
type ProofFormat = 'one-page' | 'paged';
function wireWitness(book:Inputs, edges:sdk.SearchEdge[], rank:bigint, format:ProofFormat) {
  if (format === 'one-page') {
    const witness = recoveryRateWitness(book, edges, rank);
    return {rates:witness.rates.map(String), orders:witness.orders.map(order => Array.from(order))};
  }
  const {rates, orders} = pagedRateWitness(book, edges, rank);
  const [first, ...remaining] = rates;
  return {rates:first.map(String), additionalRates:remaining.map(round => round.map(String)),
    orders:orders.map(order => Array.from(order))};
}
async function native(request:object) {
  const output=await new Promise<string>((resolve,reject)=>{
    const child=execFile(binary,[],{timeout:120_000,maxBuffer:64*1024},(error,stdout)=>error?reject(error):resolve(stdout));
    child.stdin!.on('error',reject);
    child.stdin!.end(JSON.stringify(request));
  });
  return JSON.parse(output);
}

/** The native engine derives edges from inventory and verified debtor budgets,
 * and independently scores every structurally possible proposal. No payout,
 * candidate rank or exclusion range enters from an external model. */
export async function selectRecovery(book:Inputs,venue:Address,epoch:bigint,budget:number,format:ProofFormat='one-page'):Promise<Calculator> {
  const request={venue:Array.from(getAddressEncoder().encode(venue)),epoch:String(epoch),budget,
    marks:book.marks.map(String),fees:book.fees.map(String),insurance:book.insurance.map(String),pools:book.pools.map(String),
    rows:book.rows.map(row=>({id:String(row.id),cash:String(row.cash),lots:row.lots.map(String),
      claims:row.claims.map(String),history:row.history.map(bytes=>Array.from(bytes))})),
    original:wireWitness(book,[],0n,format)};
  const dimensions=await native(request);
  if(dimensions.blocked==='schedule-budget') return {blocked:'recovery-schedule-budget'};
  const count=BigInt(dimensions.count);
  assert(count>0n && count<=BigInt(budget) && Array.isArray(dimensions.edges) && dimensions.edges.length<=2*book.rows.length*(book.rows.length-1),'Invalid recovery dimensions');
  const edges:sdk.SearchEdge[]=dimensions.edges.map((edge:sdk.SearchEdge)=>({
    market:edge.market,debtor:BigInt(edge.debtor),winner:BigInt(edge.winner),maximum:BigInt(edge.maximum)}));
  assert.equal(count,edges.reduce((product,edge)=>product*(edge.maximum+1n),1n));
  const witnesses=Array.from({length:Number(count)},(_,index)=>{
    // Some rank digits overdraw original debt or need more insurance passes.
    // The native selector blocks if an admissible schedule needs an absent witness.
    try{return wireWitness(book,edges,BigInt(index),format);}
    catch(error){
      if(error instanceof Error && /Invalid frozen collection basis|Reduction consumed frozen cash|another insurance pass|wire width/.test(error.message))return null;
      throw error;
    }
  });
  const outcome=await native({...request,witnesses});
  if(outcome.blocked==='incomparable-plans'||outcome.blocked==='unsupported-rate-witness')return {blocked:'recovery-'+outcome.blocked};
  const rank=BigInt(outcome.rank);
  assert(BigInt(outcome.count)===count && rank>=0n && rank<count,'Incomplete recovery result');
  return {rank,count,edges};
}

export async function loadRecoverySelection(rpc:Pick<Rpc,'call'>,venue:Address,
  selection:sdk.RecoveryDeployment,epoch:bigint,revision:bigint,budget:number,
  profile:{format:'one-page'|'paged';count:bigint}={format:'one-page',count:8n}) {
  const book=await readRecoveryWitnessBook(rpc,venue,selection,epoch,revision,profile.count);
  const rows = [];
  let contextSlot=book.contextSlot;
  for (let start=0; start<book.rows.length; start+=64) {
    const group=book.rows.slice(start,start+64);
    const snapshot=await rpc.call('getMultipleAccounts',[[book.prepared,...group.map(row=>row.member)],
      {encoding:'base64',commitment:'confirmed',minContextSlot:contextSlot}]);
    assert(Number.isSafeInteger(snapshot.context.slot) && snapshot.context.slot>=contextSlot
      && snapshot.value?.length===group.length+1,'Incomplete recovery histories');
    contextSlot=snapshot.context.slot;
    const header=decodeAccountWorker(snapshot.value[0],sdk.PREPARED_SETTLEMENT_DISCRIMINATOR,sdk.getPreparedSettlementDecoder());
    assert(header.stage===4 && header.venue===venue && header.epoch===epoch && header.revision===revision
      && header.count===profile.count,'Recovery freeze advanced during selection');
    for (const [index,row] of group.entries()) {
      const account=snapshot.value[index+1];
      assert(account?.owner===sdk.CLEARING_PROGRAM_ADDRESS && !account.executable && account.data[1]==='base64','Foreign recovery margin');
      const {root,histories}=sdk.decodeProfitAttribution(Buffer.from(account.data[0],'base64'),true);
      assert(root.schemaVersion===10 && root.lifecycle===sdk.MEMBER_FINANCIAL && root.id===row.id && root.venue===venue
        && root.revision===row.originalRevision && root.cash===row.cash && root.activationGeneration===row.activationGeneration,
        'Frozen margin identity changed');
      assert.deepEqual(root.positions.map(position=>position.generation),row.generations);
      assert.deepEqual(root.positions.map(position=>position.lots),row.lots);
      rows.push({...row,history:histories});
    }
  }
  const outcome=await selectRecovery({...book,rows},venue,epoch,budget,profile.format);
  return {book,outcome};
}
