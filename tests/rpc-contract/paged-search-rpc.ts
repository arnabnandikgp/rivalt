// A new client process resumes solely from both membership pages and the sealed source.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {address,type Address} from '@solana/kit';
import * as paged from '@rivalt/sdk/paged-recovery';
import {json} from '../../packages/indexer/src/events.js';
import {loadRecoverySelection} from '../../packages/services/src/recovery-selection.js';
import {nextPagedProofInstruction} from '../../packages/services/src/paged-recovery-proof.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {payerKey} from './harness.js';

const root=process.env.RIVALT_RUN_DIR!,phase=process.argv[2];
assert(phase==='start'||phase==='resume');
const input=JSON.parse(readFileSync(root+'/paged-source.json','utf8')) as {
  venue:Address;resolution:Address;epoch:string;revision:string;members:string};
const epoch=BigInt(input.epoch),revision=BigInt(input.revision);
const directory=root+'/paged-search-'+phase;
mkdirSync(directory);
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,
  {instructionConformance:()=>false,heapSize:()=>256*1024,computeUnitLimit:()=>1_400_000});
const program=address('92GA4Cm7NZq8GEwY5r7zLwdLeYLuQYa79Ut9f3gAQ8U7');
try {
  const {book,outcome}=await loadRecoverySelection(rpc,input.venue,'recovery-search-candidate',epoch,revision,
    Number(process.env.RIVALT_RECOVERY_SCHEDULE_BUDGET),{format:'paged',count:BigInt(input.members)});
  assert(!('blocked' in outcome));
  const payer=await payerKey(),nonce=outcome.rank;
  const [search]=await paged.findSearchPda({payer:payer.address,nonce},{programAddress:program});
  const args={payer,nonce,epoch,revision,resolution:input.resolution,search};
  const read=async()=>{
    const response=await rpc.call('getAccountInfo',[search,{commitment:'confirmed',encoding:'base64'}]);
    if(!response.value)return null;
    assert(response.value.owner===program && !response.value.executable);
    const bytes=Buffer.from(response.value.data[0],'base64');
    const state=paged.getPagedRecoverySearchDecoder().decode(bytes);
    assert.deepEqual(Array.from(state.discriminator),Array.from(paged.PAGED_RECOVERY_SEARCH_DISCRIMINATOR));
    return state;
  };
  let state=await read();
  if(phase==='start')assert.equal(state,null);
  else assert(state && state.stage===3 && state.cursor>0n && state.cursor<state.count);
  const costs=[];
  for(;;) {
    const next=nextPagedProofInstruction(book,outcome,args,state,program);
    if(!next)break;
    await h.send(next.action,[next.instruction]);
    const transaction=checks.at(-1)!;
    const receipt=await rpc.call('getTransaction',[transaction.signature,{commitment:'finalized',encoding:'base64',maxSupportedTransactionVersion:1}]);
    assert.equal(receipt.meta.err,null);
    assert(Number.isSafeInteger(receipt.meta.computeUnitsConsumed) && receipt.meta.computeUnitsConsumed>0);
    costs.push({action:next.action,signature:transaction.signature,cu:receipt.meta.computeUnitsConsumed,
      bytes:Buffer.from(receipt.transaction[0],'base64').length,fee:receipt.meta.fee,
      rent:receipt.meta.preBalances[0]-receipt.meta.postBalances[0]-receipt.meta.fee});
    state=await read();
    if(phase==='start' && next.action.startsWith('range-'))break;
  }
  assert(state);
  if(phase==='resume')assert(state.stage===4 && state.cursor===outcome.count);
  writeFileSync(directory+'/result.json',json({search,costs,cursor:state.cursor,count:state.count,rank:state.proposed,
    cash:state.cash,movements:state.movements,remainingInsurance:state.remainingInsurance,retainedFees:state.retainedFees}));
} finally {try{await flush();}finally{ws.close();}}
