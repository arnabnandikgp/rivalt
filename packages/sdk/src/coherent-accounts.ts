import type {Address} from '@solana/kit';
import {requireValue, rpcInteger, type UserRpc} from './wallet-client.js';

/** Each RPC call accepts up to 100 addresses. Financial inputs from separate
 * calls must have the same confirmed/finalized context before concatenation. */
export async function readCoherentAccounts(rpc: Pick<UserRpc,'call'>, keys: readonly Address[],
  commitment: 'confirmed'|'finalized', minimumSlot: bigint) {
  const chunks: Address[][] = [];
  for (let offset = 0; offset < keys.length; offset += 100) chunks.push(keys.slice(offset,offset + 100));
  requireValue(chunks.length > 0, 'Empty financial account set.');
  let fence = minimumSlot;
  for (let attempt = 0; attempt < 4; attempt++) {
    const responses = await Promise.all(chunks.map(chunk => rpc.call('getMultipleAccounts',
      [chunk,{encoding:'base64',commitment,minContextSlot:Number(fence)}])));
    const slots = responses.map((response,index) => {
      const slot = rpcInteger(response.context.slot);
      requireValue(slot >= fence && response.value?.length === chunks[index].length, 'Incomplete or regressed financial read.');
      return slot;
    });
    if (slots.every(slot => slot === slots[0])) {
      return {context:responses[0].context,value:responses.flatMap(response => response.value)};
    }
    fence = slots.reduce((latest,slot) => slot > latest ? slot : latest);
  }
  throw new Error('Financial account batches span different RPC slots.');
}
