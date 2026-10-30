// Real compiled default binaries must reject activation/initialization even when
// every account and signer is provisioned through valid preceding instructions.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {getAddressEncoder,getProgramDerivedAddress,getTransactionDecoder,lamports} from '@solana/kit';
import {FailedTransactionMetadata,LiteSVM} from 'litesvm';
import * as sdk from '@rivalt/sdk';
import {provisionCanonicalMakers,type CanonicalHarness} from './canonical-maker-cases.js';
import {LOADER,payerKey} from './harness.js';

const directory='.local/liquidity-execution',results:unknown[]=[];
const programs=[['clearing',sdk.CLEARING_PROGRAM_ADDRESS],['maker_a',sdk.makerA.MAKER_A_PROGRAM_ADDRESS],
  ['maker_b',sdk.makerB.MAKER_B_PROGRAM_ADDRESS]] as const;
for(const [gatedName,gatedProgram] of programs) {
  const svm=new LiteSVM().withSigverify(true).withBlockhashCheck(true),payer=await payerKey();
  svm.airdrop(payer.address,lamports(100_000_000_000n));
  for(const [name,program] of programs) {
    svm.addProgramFromFile(program,`${directory}/${name}${name===gatedName?'-default':''}.so`);
    const [key]=await getProgramDerivedAddress({programAddress:LOADER,seeds:[getAddressEncoder().encode(program)]});
    const account=svm.getAccount(key);assert(account.exists);
    const data=Uint8Array.from(account.data);data[12]=1;data.set(getAddressEncoder().encode(payer.address),13);
    svm.setAccount({...account,data}); // Deployment metadata only; no financial state injection.
  }
  const clock=svm.getClock();clock.slot=100n;clock.unixTimestamp=1_800_000_000n;svm.setClock(clock);
  const rejected=Symbol(gatedName);let preceding=0;
  const h:CanonicalHarness={
    async rent(size){return svm.minimumBalanceForRentExemption(BigInt(size));},
    async read(key){const account=svm.getAccount(key);return account.exists?Buffer.from(account.data):null;},
    async quote(){throw new Error('Quote is outside this initialization gate probe');},
    async send(label,instructions,signers=[],expectedError){
      assert.equal(expectedError,undefined,'Provisioning must reach the intended default gate without earlier rejection');
      const gate=instructions.some(instruction=>instruction.programAddress===gatedProgram&&
        sdk.hex(instruction.data!.slice(0,8))===sdk.hex(gatedName==='clearing'?sdk.INITIALIZE_LIQUIDITY_VENUE_DISCRIMINATOR:sdk.makerA.INITIALIZE_CURVE_DISCRIMINATOR));
      const keys=[...new Set(instructions.flatMap(instruction=>instruction.accounts??[])
        .filter(meta=>(meta.role&1)!==0&&meta.address!==payer.address).map(meta=>meta.address))];
      const before=await Promise.all(keys.map(h.read));
      svm.expireBlockhash();
      const {transaction}=await sdk.signCanonicalInstructions({async getLatestBlockhash(){return {blockhash:svm.latestBlockhash(),lastValidBlockHeight:1_000_000n};}},
        payer,instructions,{computeUnitLimit:400_000,loadedAccountsDataSizeLimit:8*1024*1024},signers);
      const outcome=svm.sendTransaction(getTransactionDecoder().decode(transaction.serialize()));
      if(gate){
        assert(outcome instanceof FailedTransactionMetadata,`${gatedName} default unexpectedly initialized`);
        const error=gatedName==='clearing'?sdk.CLEARING_ERROR__PROFILE:sdk.makerA.MAKER_A_ERROR__BINDING;
        assert(outcome.meta().logs().some(log=>log.includes(`Error Number: ${error}.`)),outcome.meta().logs().join('\n'));
        assert.deepEqual(await Promise.all(keys.map(h.read)),before,'Rejected gate changed financial/deployment accounts');
        results.push({program:gatedName,label,precedingSignedTransactions:preceding,rejected:error,logs:outcome.meta().logs()});
        throw rejected;
      }
      assert(!(outcome instanceof FailedTransactionMetadata),`${label}: ${outcome instanceof FailedTransactionMetadata?outcome.meta().logs().join('\n'):''}`);
      preceding++;
    },
  };
  await assert.rejects(async()=>{try{await provisionCanonicalMakers(h,undefined,[0]);}catch(error){if(error===rejected)throw new Error('Default gate verified');throw error;}},/Default gate verified/);
}
assert.equal(results.length,3);
writeFileSync(`${directory}/default-gates-svm.json`,JSON.stringify({results},null,2)+'\n');
console.log('Three compiled default gates rejected valid initialization with full rollback.');
