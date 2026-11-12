import {expect,it} from 'vitest';
import {AccountRole} from '@solana/kit';
import {Keypair,VersionedTransaction} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {defaultBatchSteps,planDefaultBatch} from './account-default-batch.js';

/** Transport fixtures only: no invented financial acceptance. The real signed
 * worker probe separately checks independent payouts, restart and reconciliation. */
async function fixture(options:{reject?:number;units?:number;malformed?:string;bytes?:number;repeat?:boolean}={}) {
  const payer=await Keypair.fromSeed(new Uint8Array(32).fill(42)),target=(await sdk.deriveSettlementWorkspace(payer.address,'plan'))[0];
  const extra=(await sdk.deriveVenueComponent(payer.address,'custody'))[0];
  const simulations:{instructions:number;unsigned:boolean;config:any}[]=[],reads:any[]=[];
  const step=(sequence:number)=>({status:'ready' as const,id:`guard:${sequence}`,reason:'continue',instruction:{
    programAddress:sdk.CLEARING_PROGRAM_ADDRESS,accounts:[{address:target,role:AccountRole.WRITABLE}],
    data:Uint8Array.from({length:options.bytes??8},(_,index)=>index===0?sequence:0)}});
  const account=(sequence:number)=>({owner:sdk.CLEARING_PROGRAM_ADDRESS,executable:false,data:[Buffer.from([sequence]).toString('base64'),'base64']});
  const rpc={call:async(method:string,params:any[]=[])=>{
    if(method==='getLatestBlockhash')return {context:{slot:100},value:{blockhash:'11111111111111111111111111111111'}};
    if(method==='getMultipleAccounts'){reads.push(params);return {context:{slot:101},value:params[0].map(()=>account(99))};}
    expect(method).toBe('simulateTransaction');
    const transaction=VersionedTransaction.deserialize(Buffer.from(params[0],'base64'));
    const instructions=transaction.message.compiledInstructions.filter(ix=>transaction.message.staticAccountKeys[ix.programIdIndex].address===sdk.CLEARING_PROGRAM_ADDRESS);
    expect(instructions.map(ix=>ix.data[0])).toEqual(Array.from({length:instructions.length},(_,index)=>index+1));
    simulations.push({instructions:instructions.length,unsigned:transaction.signatures.every(bytes=>bytes.every(value=>value===0)),config:params[1]});
    const result:any={context:{slot:100},value:{err:instructions.length===options.reject?{InstructionError:[0,'Custom']}:null,
      unitsConsumed:instructions.length*(options.units??100_000),accounts:params[1].accounts.addresses.map(()=>account(instructions.length))}};
    if(options.malformed==='missing-account')result.value.accounts[0]=null;
    if(options.malformed==='short-account-list')result.value.accounts=[];
    if(options.malformed==='missing-units')delete result.value.unitsConsumed;
    if(options.malformed==='backwards-slot')result.context.slot=98;
    return result;
  }};
  const run=(limit=8)=>planDefaultBatch({rpc,payer,first:step(1),minSlot:99n,limit,
    next:async reader=>{
      const response=await reader.call('getMultipleAccounts',[[target,extra],{encoding:'base64'}]);
      expect(response.context.slot).toBe(101);
      expect(Buffer.from(response.value[1].data[0],'base64')[0]).toBe(99);
      const sequence=Buffer.from(response.value[0].data[0],'base64')[0];
      return step(options.repeat?sequence:sequence+1);
    }});
  return {run,simulations,reads,target,step,payer,rpc};
}
it('constructs unsigned guarded prefixes from returned poststates and bounds the complete batch',async()=>{
  const test=await fixture(),batch=await test.run();
  expect(batch.steps.map(step=>step.id)).toEqual(['guard:1','guard:2','guard:3','guard:4','guard:5','guard:6','guard:7','guard:8']);
  expect(batch.simulatedUnits).toBe(800_000);expect(batch.stop).toBe('step-bound');
  expect(test.simulations).toHaveLength(8);expect(test.simulations.every(value=>value.unsigned)).toBe(true);
  expect(test.simulations.at(-1)!.config).toMatchObject({sigVerify:false,minContextSlot:99,accounts:{addresses:[test.target]}});
  expect(test.reads.every(params=>params[1].minContextSlot===100)).toBe(true);
});
it.each([1,4])('does not retain a rejected appended candidate at prefix %i',async reject=>{
  const test=await fixture({reject}),batch=await test.run();
  expect(batch.steps).toHaveLength(reject-1);expect(batch.stop).toBe('simulation-rejected');
});
it('retains the last unsigned prefix within measured compute headroom',async()=>{
  const test=await fixture({units:300_000}),batch=await test.run();
  expect(batch.steps).toHaveLength(3);expect(batch.simulatedUnits).toBe(900_000);expect(batch.stop).toBe('compute-bound');
});
it('measures v1 and stops before its wire limit without attempting that oversized simulation',async()=>{
  const test=await fixture({bytes:1400}),batch=await test.run();
  expect(batch.steps).toHaveLength(2);expect(batch.wireBytes).toBeGreaterThan(1232);expect(batch.wireBytes).toBeLessThanOrEqual(4096);
  expect(test.simulations).toHaveLength(2);expect(batch.stop).toBe('wire-bound');
});
it('never repeats the same guarded step',async()=>{
  const test=await fixture({repeat:true}),batch=await test.run();
  expect(batch.steps).toHaveLength(1);expect(batch.stop).toBe('repeated-step');
});
it.each(['missing-account','short-account-list','missing-units','backwards-slot'])('fails closed on %s',async malformed=>{
  const test=await fixture({malformed});await expect(test.run()).rejects.toThrow();
});
it('bounds returned account requests before simulation',async()=>{
  const test=await fixture(),headers=await Promise.all(Array.from({length:65},(_,index)=>sdk.deriveFrozenMarginPage(test.payer.address,BigInt(index))));
  const result=await planDefaultBatch({rpc:test.rpc,payer:test.payer,first:{...test.step(1),instruction:{...test.step(1).instruction,accounts:headers.map(([address])=>({address,role:AccountRole.WRITABLE}))}},minSlot:99n,limit:8,
    next:async()=>{throw new Error('must not plan an inadmissible prefix');}});
  expect(result.steps).toEqual([]);expect(result.stop).toBe('account-bound');expect(test.simulations).toEqual([]);
});
it('cannot use the speculative reader to submit, simulate or mutate',async()=>{
  const test=await fixture();
  await expect(planDefaultBatch({rpc:test.rpc,payer:test.payer,first:test.step(1),minSlot:99n,limit:2,
    next:async reader=>{await reader.call('sendTransaction',[]);return test.step(2);}})).rejects.toThrow('Unsupported speculative RPC');
});
it('rejects invalid operator batch settings',()=>{
  expect(defaultBatchSteps('1')).toBe(1);expect(defaultBatchSteps('8')).toBe(8);expect(defaultBatchSteps('16')).toBe(16);expect(defaultBatchSteps('32')).toBe(32);
  for(const value of ['0','33','-1','2.5','08','Infinity',''])expect(()=>defaultBatchSteps(value)).toThrow();
});

it.each([16,32])('uses up to %i low-cost steps while retaining the same measured compute ceiling',async limit=>{
  const low=await fixture({units:20_000}),batch=await low.run(limit);
  expect(batch.steps).toHaveLength(limit);expect(batch.simulatedUnits).toBe(limit*20_000);
  expect(batch.stop).toBe('step-bound');expect(low.simulations).toHaveLength(limit);
  const high=await fixture({units:100_000}),bounded=await high.run(limit);
  expect(bounded.steps).toHaveLength(9);expect(bounded.simulatedUnits).toBe(900_000);
  expect(bounded.stop).toBe('compute-bound');expect(high.simulations).toHaveLength(10);
});
