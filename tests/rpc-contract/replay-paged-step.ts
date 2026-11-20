// Profile a failed simulation from its original frozen account bytes without
// provisioning another venue. Wallet and PostgreSQL acceptance use Surfpool.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {address,getTransactionDecoder,lamports} from '@solana/kit';
import {LiteSVM,FailedTransactionMetadata} from 'litesvm';
import {CLEARING_PROGRAM_ADDRESS} from '@rivalt/sdk';
import {payerKey} from './harness.js';

const [capturePath,programPath]=process.argv.slice(2);
const capture=JSON.parse(readFileSync(capturePath,'utf8'));
assert.equal(capture.keys.length,capture.accounts.value.length);
const vm=new LiteSVM().withSigverify(true).withBlockhashCheck(false);
vm.addProgramFromFile(CLEARING_PROGRAM_ADDRESS,programPath);
const payer=await payerKey();
vm.airdrop(payer.address,lamports(1_000_000_000n));
for(const [index,key] of capture.keys.entries()) {
  const account=capture.accounts.value[index];
  assert(account && account.owner===CLEARING_PROGRAM_ADDRESS && !account.executable);
  assert.equal(account.data[1],'base64');
  const data=Buffer.from(account.data[0],'base64');
  vm.setAccount({address:address(key),programAddress:CLEARING_PROGRAM_ADDRESS,data,
    executable:false,lamports:lamports(BigInt(account.lamports)),space:BigInt(data.length)});
}
for(const {wire,computeUnitLimit,result} of capture.simulations) {
  const replay=vm.simulateTransaction(getTransactionDecoder().decode(Buffer.from(wire,'base64')));
  const failed=replay instanceof FailedTransactionMetadata, meta=replay.meta();
  assert.equal(failed,result.value.err!==null,'Replay disagrees with the RPC outcome');
  assert.equal(meta.computeUnitsConsumed(),BigInt(result.value.unitsConsumed),'Replay disagrees with the RPC compute meter');
  assert.deepEqual(meta.logs().slice(-2),result.value.logs.slice(-2),'Replay disagrees with the final program logs');
  console.log(JSON.stringify({step:capture.reason,computeUnitLimit,rpcUnits:result.value.unitsConsumed,rpcError:result.value.err,
    replayUnits:String(meta.computeUnitsConsumed()),replayError:failed?replay.err().toString():null,logs:meta.logs().slice(-6)}));
}
