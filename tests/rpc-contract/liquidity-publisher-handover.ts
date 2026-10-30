import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {transferLiquidityBudget} from '../../packages/services/src/liquidity-budget.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import type {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityQueueFault} from './liquidity-queue-fault.js';

/** Called with pricing/source/indexer loops alive and all old publishers stopped. */
export async function publisherHandover(runtime:AccountRuntime,setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>,
  transport:Awaited<ReturnType<typeof openCanonicalRpcHarness>>,databaseUrl:string,directory:string) {
  const state=async()=>sdk.getFundingPublisherDecoder().decode((await transport.h.read(setup.configurations[0]))!);
  const control=async(publisher:typeof setup.owner.address,label:string)=>transport.h.send(label,[sdk.getConfigureFundingPublisherInstruction({
    ...setup.common,authority:setup.payer,market:setup.markets[0],configuration:setup.configurations[0],
    expectedAuthority:(await state()).authorityEpoch,publisher})]);
  const previous=await state();
  await control(setup.owner.address,'P33 rotate restricted publisher');
  await assert.rejects(()=>runtime.funding(0,setup.updater),/signer mismatch/);
  const handover=await transferLiquidityBudget(runtime,'funding',0,setup.owner);
  const row=(await runtime.store.pool.query('SELECT * FROM service_budgets WHERE run_id=$1 AND name=$2',[runtime.runId,handover.name])).rows[0];
  assert.equal(row.spent,handover.spent);assert.equal(row.cap,handover.cap);
  // Build a fresh original under the new signer. Cadence fences are real.
  let queued=false;
  for(let attempt=0;attempt<30;attempt++) {
    if((await runtime.funding(0,setup.owner)).status==='queued'){queued=true;break;}await delay(200);
  }
  assert(queued,'new signer publication due');
  const request=(await runtime.store.pool.query("SELECT request_id FROM service_intents WHERE run_id=$1 AND budget=$2 AND status='pending'",[runtime.runId,handover.name])).rows[0].request_id;
  await assert.rejects(()=>transferLiquidityBudget(runtime,'funding',0,setup.owner),/Resolve every original/);
  const fault=await liquidityQueueFault(runtime,{databaseUrl,rpcUrl:runtime.rpc.url,directory},request);
  // A tight report can expire across deliberate process death. Its exact final
  // success/failure is preserved; recovery below must actually publish anew.
  assert(['failed','finalized'].includes(fault.receipt.status));
  for(let attempt=0;attempt<30&&(await state()).lastSequence===previous.lastSequence;attempt++) {
    await runtime.funding(0,setup.owner);await runtime.execute();await delay(300);await runtime.execute();
  }
  assert((await state()).lastSequence>previous.lastSequence,'new authorized report accepted');
  // Confirmed on-chain acceptance can precede durable receipt finalization.
  // Drain the original before testing the next authority state; the worker
  // correctly prioritizes retaining an unresolved original over making a new one.
  for(let attempt=0;attempt<50&&await runtime.pendingBudget(handover.name);attempt++){await runtime.execute();await delay(200);}
  assert.equal(await runtime.pendingBudget(handover.name),false,'publisher original receipt resolved');
  await control(address('11111111111111111111111111111111'),'P33 revoke restricted publisher');
  assert.equal((await state()).enabled,false);await assert.rejects(()=>runtime.funding(0,setup.owner),/not authorized/);
  const revoked=await state();await control(setup.updater.address,'P33 restore original restricted publisher');
  for(let attempt=0;attempt<30&&await runtime.pendingBudget(handover.name);attempt++){await runtime.execute();await delay(100);}
  const restored=await transferLiquidityBudget(runtime,'funding',0,setup.updater);
  return {previous,revoked,current:await state(),handover,restored,fault};
}
