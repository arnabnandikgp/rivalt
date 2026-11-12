/** Simulation proposes a bounded atomic prefix; it never publishes progress or
 * changes a persisted original. Every instruction retains its on-chain guards. */
import assert from 'node:assert/strict';
import {AccountRole,address,type Address,type Instruction} from '@solana/kit';
import {ComputeBudgetProgram,type Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import type {Rpc} from '../../indexer/src/rpc.js';
import type {AccountRuntime} from './account-runtime.js';
import {accountDefaultStep,type DefaultStep} from './account-default-worker.js';
import {accountDefaultContext,readAccountResolution} from './account-worker-state.js';

type Reader=Pick<Rpc,'call'>;
type ReadyStep=Extract<DefaultStep,{status:'ready'}>;
export const DEFAULT_BATCH_MAX_STEPS=8;
const MAX_ACCOUNTS=64,MAX_COMPUTE=900_000,MAX_RETURNED_BYTES=8*1024*1024;
export function defaultBatchComputeBudget():Instruction {
  const budget=ComputeBudgetProgram.setComputeUnitLimit({units:1_000_000});
  return {programAddress:address(budget.programId.toBase58()),accounts:[],data:budget.data};
}
export function defaultBatchSteps(value=process.env.RIVALT_DEFAULT_BATCH_STEPS??'1'):number {
  assert(/^[1-8]$/.test(value),'Default batch steps must be 1–8');return Number(value);
}
export type DefaultBatch={steps:ReadyStep[];simulatedUnits:number;wireBytes:number;stop:string};

/** Only reads may see speculative poststates. Missing read-only inputs come from
 * RPC at or after the simulation slot and still pass the normal account decoders.
 * A changed live dependency may invalidate the unsigned prefix at preflight; it
 * can never authorize an unchecked write or replace an unresolved original. */
function proposalReader(base:Reader,poststates:Map<string,any>,slot:number):Reader {
  return {call:async(method,params=[])=>{
    if(method==='getSlot')return slot;
    assert(method==='getAccountInfo'||method==='getMultipleAccounts','Unsupported speculative RPC method');
    const keys=method==='getAccountInfo'?[String(params[0])]:params[0] as string[];
    const missing=keys.filter(key=>!poststates.has(key));
    let contextSlot=slot;const values=new Map(poststates);
    if(missing.length) {
      const result=await base.call('getMultipleAccounts',[missing,{...(params[1] as object),encoding:'base64',commitment:'confirmed',minContextSlot:slot}]);
      assert(Number.isSafeInteger(result.context?.slot)&&result.context.slot>=slot&&result.value?.length===missing.length,'Incomplete speculative dependencies');
      contextSlot=result.context.slot;missing.forEach((key,index)=>values.set(key,result.value[index]));
    }
    return {context:{slot:contextSlot},value:method==='getAccountInfo'?values.get(keys[0]):keys.map(key=>values.get(key))};
  }};
}

/** Exposed separately to test resource and malformed-RPC boundaries without
 * pretending mocked poststates are financial implementation evidence. */
export async function planDefaultBatch(input:{rpc:Reader;payer:Keypair;first:ReadyStep;headers:Address[];minSlot:bigint;
  limit:number;next(reader:Reader):Promise<DefaultStep>}):Promise<DefaultBatch> {
  assert(Number.isInteger(input.limit)&&input.limit>=1&&input.limit<=DEFAULT_BATCH_MAX_STEPS,'Invalid default batch bound');
  const lifetime=await input.rpc.call('getLatestBlockhash',[{commitment:'confirmed',minContextSlot:Number(input.minSlot)}]);
  const steps:ReadyStep[]=[],ids=new Set<string>();
  let next=input.first,simulatedUnits=0,wireBytes=0,stop='step-bound';
  for(let index=0;index<input.limit;index++) {
    if(ids.has(next.id)){stop='repeated-step';break;}
    const candidate=[...steps,next],instructions=candidate.map(step=>step.instruction);
    assert(instructions.every(instruction=>instruction.programAddress===sdk.CLEARING_PROGRAM_ADDRESS),'Foreign default instruction');
    const requested=[...new Set([...input.headers,...instructions.flatMap(instruction=>instruction.accounts??[])
      .filter(meta=>meta.role===AccountRole.WRITABLE||meta.role===AccountRole.WRITABLE_SIGNER).map(meta=>meta.address)])];
    if(requested.length>MAX_ACCOUNTS){stop='account-bound';break;}
    let compiled:ReturnType<typeof sdk.compileCanonicalTransaction>;
    try {
      compiled=sdk.compileCanonicalTransaction({payerKey:input.payer.publicKey,recentBlockhash:lifetime.value.blockhash},instructions,
        {computeUnitLimit:1_000_000,loadedAccountsDataSizeLimit:MAX_RETURNED_BYTES});
    }catch(error){if(!steps.length)throw error;stop='wire-bound';break;}
    const result=await input.rpc.call('simulateTransaction',[Buffer.from(compiled.transaction.serialize()).toString('base64'),{
      encoding:'base64',sigVerify:false,commitment:'confirmed',minContextSlot:Number(input.minSlot),
      accounts:{encoding:'base64',addresses:requested}}]);
    const simulation=result.value;
    assert(Number.isSafeInteger(result.context?.slot)&&BigInt(result.context.slot)>=input.minSlot,'Simulation moved backwards');
    if(simulation?.err){stop='simulation-rejected';break;}
    assert(Number.isSafeInteger(simulation?.unitsConsumed)&&simulation.unitsConsumed>0,'Missing simulation compute measurement');
    if(simulation.unitsConsumed>MAX_COMPUTE){stop='compute-bound';break;}
    assert(Array.isArray(simulation.accounts)&&simulation.accounts.length===requested.length,'Incomplete simulation poststates');
    let returnedBytes=0;
    simulation.accounts.forEach((account:any)=>{
      assert(account&&typeof account.owner==='string'&&account.data?.[1]==='base64'&&typeof account.data[0]==='string','Missing simulation poststate');
      returnedBytes+=Buffer.byteLength(account.data[0],'base64');
    });
    assert(returnedBytes<=MAX_RETURNED_BYTES,'Simulation poststates exceed byte bound');
    steps.push(next);ids.add(next.id);simulatedUnits=simulation.unitsConsumed;wireBytes=compiled.wireBytes;
    if(steps.length===input.limit)break;
    const reader=proposalReader(input.rpc,new Map(requested.map((key,index)=>[key,simulation.accounts[index]])),result.context.slot);
    const proposed=await input.next(reader);
    if(proposed.status==='blocked'){stop=proposed.reason;break;}
    next=proposed;
  }
  return {steps,simulatedUnits,wireBytes,stop};
}

export async function accountDefaultBatch(runtime:AccountRuntime,payer:Keypair,state:Awaited<ReturnType<typeof readAccountResolution>>,
  first:ReadyStep,limit:number):Promise<DefaultBatch> {
  // Separate cache identity: speculative rate/order proposals never pollute the
  // runtime's cache of actual committed frozen inputs.
  const proposedRuntime=Object.create(runtime) as AccountRuntime;
  return planDefaultBatch({rpc:runtime.rpc,payer,first,limit,minSlot:state.contextSlot,
    headers:[state.registry,state.resolution,state.storage,state.prepared,state.rates,state.plan],
    next:async reader=>{
      Object.defineProperty(proposedRuntime,'rpc',{value:reader,configurable:true});
      const continuation=await readAccountResolution(reader,state.registryState.venue);
      assert(continuation.header.epoch===state.header.epoch,'Simulation changed frozen epoch');
      if(![2,14].includes(continuation.header.stage))return {status:'blocked',reason:'frozen-work-complete'};
      return accountDefaultStep(proposedRuntime,payer,continuation,await accountDefaultContext(reader,continuation));
    }});
}
