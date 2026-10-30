import {hash} from './events.js';
import {integer} from './rpc.js';

export type FinalizedBlock={slot:number;blockhash:string;parentSlot:number;previousBlockhash:string;
  signatures:string[];signatureDigest:string;transactions:{signature:string;tx:any}[]};
export type BlockFence={slot:number;blockhash:string};

export async function readFinalizedBlock(rpc:{call(method:string,params:unknown[]):Promise<any>},slot:number,maxVersion:0|1) {
  const configuration={encoding:'json',commitment:'finalized',rewards:false,maxSupportedTransactionVersion:maxVersion};
  const [body,manifest]=await Promise.all([
    rpc.call('getBlock',[slot,{...configuration,transactionDetails:'full'}]),
    rpc.call('getBlock',[slot,{...configuration,transactionDetails:'signatures'}]),
  ]);
  const block=decodeFinalizedBlock(slot,body);
  if(!manifest||manifest.blockhash!==block.blockhash||manifest.parentSlot!==block.parentSlot
    ||manifest.previousBlockhash!==block.previousBlockhash||!Array.isArray(manifest.signatures)
    ||manifest.signatures.length!==block.signatures.length
    ||manifest.signatures.some((signature:unknown,index:number)=>signature!==block.signatures[index]))
    throw new Error('Incomplete or conflicting finalized block signature manifest');
  return block;
}

/** Full ordered block bodies are the discovery proof. Address pagination and
 * notifications are only hints; neither covers independent scoped writers. */
export function decodeFinalizedBlock(slot:number,value:any):FinalizedBlock {
  integer(slot);
  if(!value||typeof value.blockhash!=='string'||typeof value.previousBlockhash!=='string'
    ||!Array.isArray(value.transactions))throw new Error('Unavailable complete finalized block');
  const parentSlot=integer(value.parentSlot);
  if(slot>0&&parentSlot>=slot)throw new Error('Invalid finalized parent');
  const transactions=value.transactions.map((entry:any)=>{
    const signature=entry.transaction?.signatures?.[0];
    if(typeof signature!=='string'||!entry.meta||!Object.hasOwn(entry.meta,'err'))throw new Error('Incomplete finalized block transaction');
    return {signature,tx:{...entry,slot,blockTime:value.blockTime}};
  });
  const signatures:string[]=transactions.map((entry:{signature:string})=>entry.signature);
  if(new Set(signatures).size!==signatures.length)throw new Error('Duplicate finalized block signature');
  return {slot,blockhash:value.blockhash,parentSlot,previousBlockhash:value.previousBlockhash,
    signatures,signatureDigest:hash(signatures),transactions};
}
export function validateBlockChain(blocks:readonly FinalizedBlock[],previous:BlockFence|null,fence:BlockFence) {
  let cursor=previous;
  for(const block of blocks) {
    if(block.signatureDigest!==hash(block.signatures)||block.signatures.length!==block.transactions.length
      ||block.transactions.some((entry,index)=>entry.signature!==block.signatures[index]||entry.tx.slot!==block.slot))
      throw new Error('Conflicting complete block manifest');
    if(cursor&&(block.slot<=cursor.slot||block.parentSlot!==cursor.slot||block.previousBlockhash!==cursor.blockhash))
      throw new Error('Missing or conflicting finalized parent block');
    cursor=block;
  }
  if(!cursor||cursor.slot!==fence.slot||cursor.blockhash!==fence.blockhash)throw new Error('Incomplete finalized block fence');
}
