import {type Address,type Instruction} from '@solana/kit';
import {deriveAccountMarket,deriveMarketLedger} from './account-addresses.js';
import {makerRegistrationPdas} from './market-capacity.js';
import * as clearing from './generated/index.js';
import {hex,requireValue} from './wallet-client.js';

export type MarketCheckpoint={account:Address;instruction:Instruction};
export async function venueMarketCheckpoints(venue:Address):Promise<MarketCheckpoint[]> {
  const common={venue,program:clearing.CLEARING_PROGRAM_ADDRESS};
  const perMarket=await Promise.all([0,1].map(async index=>{
    const [market]=await deriveAccountMarket(venue,index);
    const [[ledger],[[first],[second],[third]]]=await Promise.all([deriveMarketLedger(market),makerRegistrationPdas(market)]);
    const [checkpoint,fees]=await Promise.all([
      clearing.getCheckpointMarketInstructionAsync({...common,market,first,second,third}),
      clearing.getClassifyMarketFeesInstructionAsync({...common,ledger,first,second,third}),
    ]);
    return [{account:market,instruction:checkpoint},{account:ledger,instruction:fees}];
  }));
  return perMarket.flat();
}
const tag=(ix:Instruction)=>hex(ix.data?.slice(0,8)??[]);
const checkpointTags=new Set([clearing.CHECKPOINT_MARKET_DISCRIMINATOR,clearing.CLASSIFY_MARKET_FEES_DISCRIMINATOR].map(hex));
const consumers=new Set([clearing.EXECUTE_MULTI_ROUTE_DISCRIMINATOR,clearing.EXECUTE_BEST_ROUTE_DISCRIMINATOR,clearing.EXECUTE_LIQUIDITY_ROUTE_DISCRIMINATOR,clearing.EXECUTE_LIQUIDITY_ORDER_DISCRIMINATOR,
  clearing.LIQUIDATE_LIQUIDITY_ROUTE_DISCRIMINATOR,clearing.DEPOSIT_ACCOUNT_DISCRIMINATOR,clearing.WITHDRAW_FUNDED_ACCOUNT_DISCRIMINATOR,clearing.TRANSFER_FUNDED_ACCOUNT_DISCRIMINATOR,
  clearing.MANAGE_ACCOUNT_ORDER_DISCRIMINATOR,clearing.NET_ACCOUNT_CLAIMS_DISCRIMINATOR].map(hex));
/** Derive financial dependencies from a scoped consumer on this venue. */
export function marketCheckpointsFor(known:readonly MarketCheckpoint[],consumer:Instruction):Instruction[] {
  if(!consumers.has(tag(consumer)))return [];
  const keys=new Set(consumer.accounts?.map(meta=>meta.address));
  return known.filter(entry=>keys.has(entry.account)).map(entry=>entry.instruction);
}

/** Accept a single consumer with its exact canonical prefix. Effective wire
 * privileges may also include the consumer's own writes and sibling checkpoints.
 * No checkpoint in a wallet transaction has any reason to include a signer. */
export function walletEconomicActions(instructions:Instruction[],known?:readonly MarketCheckpoint[]) {
  if(!instructions.length||!checkpointTags.has(tag(instructions[0])))return instructions;
  requireValue(known!==undefined&&instructions.length<=5,'Unsupported wallet checkpoint envelope.');
  const consumer=instructions[instructions.length-1],prefix=marketCheckpointsFor(known,consumer);
  requireValue(prefix.length===instructions.length-1,'Incomplete wallet checkpoint prefix.');
  const writable=new Set([...prefix,consumer].flatMap(ix=>ix.accounts??[]).filter(meta=>(meta.role&1)!==0).map(meta=>meta.address));
  for(const [index,expected] of prefix.entries()) {
    const actual=instructions[index];
    requireValue(actual.programAddress===expected.programAddress && hex(actual.data??[])===hex(expected.data??[]) &&
      actual.accounts?.length===expected.accounts!.length && actual.accounts.every((meta,i)=>{
        const canonical=expected.accounts![i];
        return meta.address===canonical.address && (meta.role===canonical.role || meta.role===1 && writable.has(meta.address));
      }),'Invalid wallet checkpoint dependency or privilege.');
  }
  return [consumer];
}
