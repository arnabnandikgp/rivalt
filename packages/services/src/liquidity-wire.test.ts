import {it,expect} from 'vitest';
import {Keypair,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {address,blockhash,AccountRole} from '@solana/kit';
import {signedWire} from './queue.js';
import {signCanonicalInstructions} from '../../sdk/src/canonical-transport.js';

it('accepts authenticated v1 originals only at the explicit profile-4 boundary',async()=>{
  const payer=await Keypair.generate(),program=address('11111111111111111111111111111111');
  const instruction={programAddress:program,accounts:[{address:payer.address,role:AccountRole.WRITABLE_SIGNER}],data:new Uint8Array(1100)};
  const {transaction}=await signCanonicalInstructions({getLatestBlockhash:async()=>({blockhash:blockhash(program),lastValidBlockHeight:100n})},payer,[instruction],
    {computeUnitLimit:800000,loadedAccountsDataSizeLimit:8*1024*1024});
  expect(transaction.version).toBe(1);const wire=Buffer.from(transaction.serialize()).toString('base64');
  expect(()=>signedWire(wire)).toThrow();expect(signedWire(wire,1).tx.version).toBe(1);
  transaction.signatures[0][0]^=1;expect(()=>signedWire(Buffer.from(transaction.serialize()).toString('base64'),1)).toThrow(/signature/);
});
it('does not enlarge v0 packets when the queue supports v1',async()=>{
  const payer=await Keypair.generate(),program=address('11111111111111111111111111111111');
  const transaction=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:blockhash(program),
    instructions:[{programAddress:program,accounts:[],data:new Uint8Array(1200)}]}).compileToV0Message());
  // Size rejection precedes signature verification (the SDK itself refuses to
  // sign oversized v0). This malformed wire must not enter the durable queue.
  expect(()=>signedWire(Buffer.from(transaction.serialize()).toString('base64'),1)).toThrow(/bounded/);
});
