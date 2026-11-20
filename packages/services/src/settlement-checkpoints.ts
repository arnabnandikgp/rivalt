import type {Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {AccountRuntime} from './account-runtime.js';

/** In the ledger-lane build each serial consumer reads its own immediately
 * preceding checkpoints. A second consumer in a transaction needs its own set. */
export async function settlementInstructions(
  snapshot:Pick<Awaited<ReturnType<AccountRuntime['snapshot']>>,'venue'|'safety'|'eventAuthority'|'markets'|'ledgers'|'marginLayout'>,
  budget:Instruction, ...consumers:Instruction[]
):Promise<Instruction[]> {
  if(snapshot.marginLayout!=='ledger-lanes')return [budget,...consumers];
  const instructions=[budget];
  const registrations=new Map<number,Awaited<ReturnType<typeof sdk.makerRegistrationPdas>>>();
  for(const consumer of consumers) {
    const keys=new Set(consumer.accounts?.map(meta=>meta.address));
    for(const [index,market] of snapshot.markets.entries()) {
      const ledger=snapshot.ledgers[index];
      if(!keys.has(market)&&!keys.has(ledger))continue;
      const makers=registrations.get(index)??await sdk.makerRegistrationPdas(market);
      registrations.set(index,makers);
      const [[first],[second],[third]]=makers;
      const inputs={venue:snapshot.venue,safety:snapshot.safety,eventAuthority:snapshot.eventAuthority,
        program:sdk.CLEARING_PROGRAM_ADDRESS,first,second,third};
      if(keys.has(market))instructions.push(sdk.getCheckpointMarketInstruction({...inputs,market}));
      if(keys.has(ledger))instructions.push(sdk.getClassifyMarketFeesInstruction({...inputs,ledger}));
    }
    instructions.push(consumer);
  }
  return instructions;
}
