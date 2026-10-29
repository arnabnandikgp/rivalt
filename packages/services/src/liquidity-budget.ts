import {address} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import type {AccountRuntime} from './account-runtime.js';
import {accountBudget} from './account-execution.js';

/** Explicit operator handover after on-chain rotation. Keep lifetime spent/cap;
 * never release unknown fees or move a role with outstanding signed originals. */
export async function transferLiquidityBudget(runtime:AccountRuntime,role:'maker'|'funding',marketIndex:0|1,
  signer:Keypair,instance?:0|1|2) {
  if(runtime.profile!==4)throw new Error('Canonical operator handover required');
  const {identity,state}=await runtime.discovery();
  if(role==='funding') {
    const input=await sdk.readFundingReport(runtime.rpc,identity.venue,marketIndex);
    if(input.configurationState.publisher!==signer.address)throw new Error('New publisher is not authorized');
  }else {
    const maker=Object.entries(state.liquidity!.makers).find(([,value])=>value.market===state.venue!.markets[marketIndex]&&value.instance===instance);
    if(!maker)throw new Error('Unknown maker role');
    const snapshot=await runtime.snapshot([address(maker[1].capital)],marketIndex);
    const current=snapshot.liquidity!.adapters.find(value=>value.registration===maker[0])!;
    if(current.config.owner!==signer.address&&(current.config.updater!==signer.address||snapshot.slot>=current.config.updaterExpirySlot))
      throw new Error('New updater is not authorized');
  }
  const budget=accountBudget(role,marketIndex,instance,4),client=await runtime.store.pool.connect();
  try {
    await client.query('BEGIN');
    const row=(await client.query('SELECT * FROM service_budgets WHERE run_id=$1 AND name=$2 FOR UPDATE',[runtime.runId,budget.name])).rows[0];
    if(!row||BigInt(row.cap)!==budget.cap)throw new Error('Existing role budget required');
    const pending=await client.query("SELECT 1 FROM service_intents WHERE run_id=$1 AND budget=$2 AND status NOT IN ('finalized','failed') LIMIT 1",[runtime.runId,budget.name]);
    if(BigInt(row.committed)!==0n||pending.rowCount)throw new Error('Resolve every original and network fee before handover');
    await client.query('UPDATE service_budgets SET wallet=$3 WHERE run_id=$1 AND name=$2',[runtime.runId,budget.name,signer.address]);
    await client.query('COMMIT');return {name:budget.name,previousWallet:row.wallet,wallet:signer.address,spent:row.spent,cap:row.cap};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
