// Compiled CPI isolation regression. All financial state is created by signed
// instructions. After provisioning, substitute a malicious maker and explicitly
// fault-inject its admission hash to reach the CPI boundary. This is not evidence
// of an authorized upgrade or a landed RPC transaction.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {getAddressEncoder,getProgramDerivedAddress,getTransactionDecoder,lamports,type Address} from '@solana/kit';
import {FailedTransactionMetadata,LiteSVM} from 'litesvm';
import * as sdk from '@rivalt/sdk';
import {LOADER,payerKey} from './harness.js';
import {ORACLE_FIXTURE} from './oracle-fixture.js';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';

const directory='.local/liquidity-execution';
const svm=new LiteSVM().withSigverify(true).withBlockhashCheck(true),payer=await payerKey();
svm.airdrop(payer.address,lamports(100_000_000_000n));
for(const [name,program] of [['clearing',sdk.CLEARING_PROGRAM_ADDRESS],['maker_a',sdk.makerA.MAKER_A_PROGRAM_ADDRESS],
  ['maker_b',sdk.makerB.MAKER_B_PROGRAM_ADDRESS],['oracle_fixture',ORACLE_FIXTURE]] as const){
  svm.addProgramFromFile(program,`${directory}/${name}.so`);
  const [key]=await getProgramDerivedAddress({programAddress:LOADER,seeds:[getAddressEncoder().encode(program)]});
  const account=svm.getAccount(key);assert(account.exists);
  const data=Uint8Array.from(account.data);data[12]=1;data.set(getAddressEncoder().encode(payer.address),13);
  svm.setAccount({...account,data}); // Loader authority only; no financial injection.
}
const started=Date.now();
function advanceClock(){
  const elapsed=Date.now()-started,clock=svm.getClock();
  clock.slot=100n+BigInt(Math.floor(elapsed/50));clock.unixTimestamp=1_800_000_000n+BigInt(Math.floor(elapsed/1000));svm.setClock(clock);
}
let submitted=0,hostile=false;
const checks:{label:string;error:string;units:string;logs:string[]}[]=[];
const h:CanonicalHarness={
  async rent(size){return svm.minimumBalanceForRentExemption(BigInt(size));},
  async read(key){advanceClock();const account=svm.getAccount(key);return account.exists?Buffer.from(account.data):null;},
  async quote(){throw new Error('Standalone quote is outside this route isolation check');},
  async send(label,instructions,signers=[],expectedError){
    advanceClock();svm.expireBlockhash();
    const {transaction}=await sdk.signCanonicalInstructions({async getLatestBlockhash(){return {blockhash:svm.latestBlockhash(),lastValidBlockHeight:1_000_000n};}},
      payer,instructions,{computeUnitLimit:800_000,loadedAccountsDataSizeLimit:8*1024*1024},signers);
    const outcome=svm.sendTransaction(getTransactionDecoder().decode(transaction.serialize()));submitted++;
    if(expectedError===undefined){
      assert(!(outcome instanceof FailedTransactionMetadata),`${label}: ${outcome instanceof FailedTransactionMetadata?outcome.meta().logs().join('\n'):''}`);
    }else{
      assert(outcome instanceof FailedTransactionMetadata,`${label}: unexpectedly succeeded`);
      const logs=outcome.meta().logs(),error=outcome.err().toString();
      if(expectedError===-1)assert.match(error,/ReadonlyDataModified/,logs.join('\n'));
      else assert(logs.some(log=>log.includes(`Error Number: ${expectedError}.`)),`${label}: ${error}\n${logs.join('\n')}`);
      if(hostile)checks.push({label,error,units:String(outcome.meta().computeUnitsConsumed()),logs});
    }
  },
};
const rpc={async call(method:string,params:any[]):Promise<any>{
  assert.equal(method,'getMultipleAccounts');advanceClock();
  return {context:{slot:Number(svm.getClock().slot)},value:params[0].map((key:Address)=>{
    const account=svm.getAccount(key);return account.exists?{owner:account.programAddress,executable:account.executable,
      data:[Buffer.from(account.data).toString('base64'),'base64']}:null;
  })};
}};
const setup=await liquidityExecutionSetup(h,rpc),{route}=executionTestHelpers(h,setup);
const [first,second]=[setup.instances[0],setup.instances[2]];
const build=(lots:bigint)=>route({trader:setup.roots[0],actor:setup.traderOwner,marketIndex:0,side:0,makers:[first,second],lots:[1n,lots]});
await h.send('genuine two-maker route before malicious substitution',[await build(1n)],[setup.traderOwner]);
await setup.fresh();
const watched=[...new Set([...setup.tracked,...setup.roots,...setup.configurations,setup.traderToken.address])];
const snapshot=()=>Promise.all(watched.map(h.read));
hostile=true;
svm.addProgramFromFile(second.pricingProgram,`${directory}/hostile_maker.so`);
let before=await snapshot();
await h.send('unapproved malicious replacement rejected',[await build(1n)],[setup.traderOwner],sdk.CLEARING_ERROR__MAKER_UPGRADE);
assert.deepEqual(await snapshot(),before);

// Deliberate admission fault only, in this isolated VM: prove that even an
// approved but malicious module cannot alter clearing/config state or lie about
// price. Retain all balances, positions, reservations and consumption unchanged.
const programData=await h.read(second.controlCommon.programData);assert(programData);
const registration=svm.getAccount(second.registration);assert(registration.exists);
const decoded=sdk.getMakerRegistrationDecoder().decode(registration.data);
const data=sdk.getMakerRegistrationEncoder().encode({...decoded,approvedHash:createHash('sha256').update(programData).digest()});
svm.setAccount({...registration,data});
for(const [lots,label,error] of [[1n,'wrong gross',sdk.CLEARING_ERROR__MAKER_RESPONSE],
  [2n,'overlong return bytes',sdk.CLEARING_ERROR__MAKER_RESPONSE],[3n,'read-only config mutation',-1],[4n,'maker rejection',6000]] as const){
  before=await snapshot();
  await h.send(`hostile second leg: ${label}`,[await build(lots)],[setup.traderOwner],error);
  assert.deepEqual(await snapshot(),before,`${label}: failed pair mutated clearing, token, maker or consumption state`);
}
assert.equal(checks.length,5);
writeFileSync(`${directory}/hostile-svm.json`,JSON.stringify({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  trackedDirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',
  build:JSON.parse(readFileSync(`${directory}/build-manifest.json`,'utf8')),submitted,checks,
  scope:'Compiled hostile-CPI fault injection; admission hash replaced after proving upgrade rejection; financial state only from signed instructions; no RPC landing claim'},null,2)+'\n');
console.log(`Compiled hostile-route isolation: ${checks.length} rejections with full rollback; ${submitted} signed VM transactions.`);
