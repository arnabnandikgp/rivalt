// Pure arithmetic resource probe. This fixture has no venue, token or margin
// account; these results are not financial/default acceptance evidence.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {address,AccountRole,getProgramDerivedAddress,getTransactionDecoder,lamports,type Instruction} from '@solana/kit';
import {LiteSVM,FailedTransactionMetadata} from 'litesvm';
import * as sdk from '@rivalt/sdk';
import {payerKey} from './custody-cases.js';

const program=address('4BBtj9tUo1xeZFkrW3LBg9GrUTtTezGYGBKqjs7A7fAE');
const artifact='target/deploy/clearing_math_probe.so';
const output=`.local/account-safety-math/${new Date().toISOString().replaceAll(/[-:.]/g,'')}-${process.pid}`;
mkdirSync(output,{recursive:true});
const svm=new LiteSVM().withSigverify(true).withBlockhashCheck(true);
svm.addProgramFromFile(program,artifact);
const payer=await payerKey();svm.airdrop(payer.address,lamports(100_000_000_000n));
const tag=(name:string)=>createHash('sha256').update(`global:${name}`).digest().subarray(0,8);
const json=(value:unknown)=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2)+'\n';
const checks:Record<string,unknown>[]=[];
async function send(label:string,instruction:Instruction) {
  svm.expireBlockhash();
  const {transaction}=await sdk.signInstructions({async getLatestBlockhash(){return {blockhash:svm.latestBlockhash(),lastValidBlockHeight:1_000_000n};}},
    payer,[sdk.fundingComputeBudget(),instruction]);
  const wire=transaction.serialize();
  const result=svm.sendTransaction(getTransactionDecoder().decode(wire));
  const meta=result instanceof FailedTransactionMetadata?result.meta():result;
  const entry={label,success:!(result instanceof FailedTransactionMetadata),computeUnits:String(meta.computeUnitsConsumed()),
    headroom20Percent:meta.computeUnitsConsumed()<=960_000n,
    bytes:wire.length,logs:meta.logs(),signatureHex:Buffer.from(transaction.signatures[0]).toString('hex')};
  checks.push(entry);writeFileSync(`${output}/checks.json`,json(checks));
  console.log(label,entry.success,entry.computeUnits);
  return entry.success;
}
function wide(data:Buffer,offset:number) {
  let value=0n;for(let index=95;index>=0;index--)value=(value<<64n)+data.readBigUInt64LE(offset+index*8);
  return value;
}
const maxClaim=100_300_000_000_000_000_000_000_000n,cash=1_000_000_000_000_000n,scale=1_000_000_000n;
for(const factors of [1,32,64]) {
  const seed=Buffer.alloc(2);seed.writeUInt16LE(factors);
  const [probe]=await getProgramDerivedAddress({programAddress:program,seeds:[Buffer.from('math-probe'),seed]});
  assert(await send(`prepare ${factors} maximum debt factors`,{programAddress:program,data:Buffer.concat([tag('prepare'),seed]),
    accounts:[{address:payer.address,role:AccountRole.WRITABLE_SIGNER},{address:probe,role:AccountRole.WRITABLE},
      {address:address('11111111111111111111111111111111'),role:AccountRole.READONLY}]}));
  const initialAccount=svm.getAccount(probe);assert(initialAccount.exists);
  const data=Buffer.from(initialAccount.data);
  const common=(2n*maxClaim-1n)**BigInt(factors);
  assert.equal(wide(data,10),common);
  assert.equal(wide(data,778),common*2n);assert.equal(wide(data,1546),common*2n*scale);
  console.log('common denominator bits',common.toString(2).length);
  let hasFlows=false;
  for(const kind of [0,1,2])for(const rows of kind===2?[1]:[1,2]) {
    if(kind===1 && !hasFlows)continue;
    const success=await send(`${common.toString(2).length}-bit ${kind===0?'exact row flows':kind===1?'whole atom floors':'final market insurance checks'} x${rows}`,{
      programAddress:program,data:Buffer.concat([tag('measure'),Buffer.from([kind,rows])]),accounts:[{address:probe,role:AccountRole.WRITABLE}]});
    if(!success)continue; // Persist a measured overrun; it is never a passing gate.
    const updatedAccount=svm.getAccount(probe);assert(updatedAccount.exists);
    const actual=Buffer.from(updatedAccount.data);
    if(kind===0) {
      hasFlows=true;
      assert.equal(wide(actual,2314),common/(2n*maxClaim-1n)*cash*scale*maxClaim*2n);
      assert.equal(wide(actual,3082),common/(2n*maxClaim-1n)*cash*scale*(maxClaim-1n)*2n);
    } else if(kind===1) {
      assert.deepEqual([0,1,2].map(index=>actual.readBigUInt64LE(3850+index*8)),
        [cash*maxClaim/(2n*maxClaim-1n),cash*(maxClaim-1n)/(2n*maxClaim-1n),0n]);
      assert.deepEqual([...actual.subarray(3874,3877)],[1,1,0]);
    } else {
      assert.deepEqual([0,1,2].map(index=>actual.readBigUInt64LE(3850+index*8)),[cash,cash,0n]);
      assert.deepEqual([...actual.subarray(3874,3877)],[0,0,0]);
    }
  }
}
writeFileSync(`${output}/summary.json`,json({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  trackedDirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',
  scope:'Resource-only pure arithmetic fixture, not venue/default acceptance; complete context overhead must still be measured.',
  artifactHash:createHash('sha256').update(readFileSync(artifact)).digest('hex'),checks}));
console.log(`P26 arithmetic probe evidence: ${output}`);
if(checks.some(check=>!check.success))process.exitCode=1;
