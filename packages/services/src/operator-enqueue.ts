import type {Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import type {Queue, Authority} from './queue.js';
import type {Rpc} from '../../indexer/src/rpc.js';
import type {LiquidityInputs} from './liquidity-inputs.js';

/** Immutable attempt identity is shared by V1 and V2 workers. A transport error
 * cannot authorize new bytes, and fee reservations survive unknown outcomes. */
export async function enqueueOperator(context:{queue:Queue;rpc:Rpc;connection:Parameters<typeof sdk.signInstructions>[0]},
  id:string,instructions:Instruction[],payer:Keypair,budget:string,authority:Authority|null,preflight=false,
  canonicalBudget?:sdk.CanonicalTransactionBudget,inputs?:LiquidityInputs, sizeCredit=false) {
  let attempt:string|undefined;
  for (let index=0;index<16;index++) {
    const candidate=index ? `${id}:retry:${index}` : id, prior=await context.queue.get(candidate);
    if (!prior) {attempt=candidate;break;}
    if (!['failed','expired-unexecuted'].includes(prior.status)) return;
  }
  if (!attempt) throw new Error('Operator request retry limit reached');
  if (sizeCredit) {
    if (!preflight || !canonicalBudget) throw new Error('Direct credit requires canonical preflight');
    const lifetime=await context.connection.getLatestBlockhash('confirmed');
    const probe=sdk.compileCanonicalTransaction({payerKey:payer.publicKey,recentBlockhash:lifetime.blockhash},instructions,
      {...canonicalBudget,computeUnitLimit:1_400_000});
    const response=await context.rpc.call('simulateTransaction',[Buffer.from(probe.transaction.serialize()).toString('base64'),
      {encoding:'base64',sigVerify:false,commitment:'confirmed'}]);
    if(response.value.err) throw new Error('Risk action presently unavailable');
    canonicalBudget={...canonicalBudget,computeUnitLimit:directCreditLimit(response.value.unitsConsumed)};
  }
  const {transaction}=canonicalBudget?await sdk.signCanonicalInstructions(context.connection,payer,instructions,canonicalBudget):
    await sdk.signInstructions(context.connection,payer,instructions);
  const wire=Buffer.from(transaction.serialize()).toString('base64');
  if (preflight) {
    const simulation=await context.rpc.call('simulateTransaction',[wire,{encoding:'base64',sigVerify:true,commitment:'confirmed'}]);
    if (simulation.value.err) throw new Error('Risk action presently unavailable');
  }
  return context.queue.put(attempt,wire,authority,budget,inputs);
}


/** Keep the existing floor for ordinary payments. Add 15% headroom when exact debtor
 * checks cost more. A final signed preflight still checks the exact persisted bytes. */
export function directCreditLimit(measured:number):number {
  if (!Number.isSafeInteger(measured) || measured<=0 || measured>1_400_000) throw new Error('Invalid direct credit CU measurement');
  return Math.min(1_400_000,Math.max(sdk.ROUTE_COMPUTE_UNITS,Math.ceil(measured*115/100)));
}
