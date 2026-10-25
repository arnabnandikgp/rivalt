import type {Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import type {Queue, Authority} from './queue.js';
import type {Rpc} from '../../indexer/src/rpc.js';

/** Immutable attempt identity is shared by V1 and V2 workers. A transport error
 * cannot authorize new bytes, and fee reservations survive unknown outcomes. */
export async function enqueueOperator(context:{queue:Queue;rpc:Rpc;connection:Parameters<typeof sdk.signInstructions>[0]},
  id:string,instructions:Instruction[],payer:Keypair,budget:string,authority:Authority|null,preflight=false) {
  let attempt:string|undefined;
  for (let index=0;index<16;index++) {
    const candidate=index ? `${id}:retry:${index}` : id, prior=await context.queue.get(candidate);
    if (!prior) {attempt=candidate;break;}
    if (!['failed','expired-unexecuted'].includes(prior.status)) return;
  }
  if (!attempt) throw new Error('Operator request retry limit reached');
  const {transaction}=await sdk.signInstructions(context.connection,payer,instructions);
  const wire=Buffer.from(transaction.serialize()).toString('base64');
  if (preflight) {
    const simulation=await context.rpc.call('simulateTransaction',[wire,{encoding:'base64',sigVerify:true,commitment:'confirmed'}]);
    if (simulation.value.err) throw new Error('Risk action presently unavailable');
  }
  await context.queue.put(attempt,wire,authority,budget);
}
