// Local compiled negative gates only. No devnet RPC, deployment or activation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {address,getAddressEncoder,getProgramDerivedAddress,getTransactionDecoder,lamports,type Address,type Instruction} from '@solana/kit';
import {getCreateAccountInstruction} from '@solana-program/system';
import {TOKEN_PROGRAM_ADDRESS,getInitializeMint2Instruction} from '@solana-program/token';
import {FailedTransactionMetadata,LiteSVM} from 'litesvm';
import * as sdk from '@rivalt/sdk';
import {assertInstructionError,svmInstructionError} from './instruction-errors.js';
import {LOADER,payerKey,fixtureKey} from './harness.js';
import {goldenShape} from './canonical-maker-cases.js';
const directory=process.env.RIVALT_DEVNET_GATE_ARTIFACTS!;assert(directory,'Explicit compiled devnet-gate directory');
const manifest=JSON.parse(readFileSync(`${directory}/build-manifest.json`,'utf8'));
assert.equal(manifest.trackedDirty,false);assert.equal(manifest.profile,'devnet-test-profile');
const programs=[['clearing',address('BbLhJdwymg9aGCtdrcxkFsBwP3L8N9NbGJucq37sS2jv')],
  ['maker_a',address('C2dhcKi2FQTsJgHiAYYb8hGeqYWdcUQr9MB4kU6AdLJG')],
  ['maker_b',address('8gBGZLMdws9ci5ax8ASmK46WPigHguFYvm8azK8q6Ckc')]] as const;
const svm=new LiteSVM().withSigverify(true).withBlockhashCheck(true),payer=await payerKey(),encoder=getAddressEncoder();
svm.airdrop(payer.address,lamports(100_000_000_000n));
const pda=(program:Address,...seeds:Uint8Array[])=>getProgramDerivedAddress({programAddress:program,seeds});
for(const [name,program] of programs){
  const bytes=readFileSync(`${directory}/${name}.so`);assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.binaries[`${name}.so`]);
  svm.addProgramFromFile(program,`${directory}/${name}.so`);
  const [key]=await pda(LOADER,new Uint8Array(encoder.encode(program))),account=svm.getAccount(key);assert(account.exists);
  const data=Uint8Array.from(account.data);data[12]=1;data.set(encoder.encode(payer.address),13);svm.setAccount({...account,data});
}
const clock=svm.getClock();clock.slot=100n;clock.unixTimestamp=1_800_000_000n;svm.setClock(clock);
const results:unknown[]=[];
async function send(label:string,instructions:Instruction[],signers:typeof payer[]=[],expected?:number){
  const keys=[...new Set(instructions.flatMap(value=>value.accounts??[]).filter(meta=>(meta.role&1)!==0&&meta.address!==payer.address).map(meta=>meta.address))];
  const before=keys.map(key=>svm.getAccount(key));svm.expireBlockhash();
  const {transaction}=await sdk.signCanonicalInstructions({async getLatestBlockhash(){return {blockhash:svm.latestBlockhash(),lastValidBlockHeight:1_000_000n};}},
    payer,instructions,{computeUnitLimit:400_000,loadedAccountsDataSizeLimit:8*1024*1024},signers);
  const result=svm.sendTransaction(getTransactionDecoder().decode(transaction.serialize()));
  if(expected===undefined){assert(!(result instanceof FailedTransactionMetadata),result instanceof FailedTransactionMetadata?result.meta().logs().join('\n'):label);return;}
  assert(result instanceof FailedTransactionMetadata,`${label}: gate unexpectedly succeeded`);
  assertInstructionError(svmInstructionError(result),expected,result.meta().logs().join('\n'));
  assert.deepEqual(keys.map(key=>svm.getAccount(key)),before,'Rejected gate changed account bytes/lamports');
  results.push({label,error:expected,logs:result.meta().logs()});
}
const clearing=programs[0][1],mint=await fixtureKey('p47-devnet-negative-mint');
await send('create real six-decimal mint',[getCreateAccountInstruction({payer,newAccount:mint,
  lamports:svm.minimumBalanceForRentExemption(82n),space:82n,programAddress:TOKEN_PROGRAM_ADDRESS}),
  getInitializeMint2Instruction({mint:mint.address,decimals:6,mintAuthority:payer.address})],[mint]);
const domain=createHash('sha256').update('p47/devnet-negative-gates').digest();
const [venue,venueBump]=await pda(clearing,Buffer.from('venue-v3'),domain);
const [custody]=await pda(clearing,Buffer.from('custody-v3'),new Uint8Array(encoder.encode(venue)));
const [safety]=await pda(clearing,Buffer.from('safety-v3'),new Uint8Array(encoder.encode(venue)));
const [vault,vaultBump]=await pda(clearing,Buffer.from('vault-v3'),new Uint8Array(encoder.encode(venue)));
const [programData]=await pda(LOADER,new Uint8Array(encoder.encode(clearing))),[eventAuthority]=await pda(clearing,Buffer.from('__event_authority'));
await send('devnet clearing initialization disabled',[sdk.getInitializeLiquidityVenueInstruction({authority:payer,clearingProgram:clearing,
  programData,quoteMint:mint.address,venue,custody,safety,vault,program:clearing,eventAuthority,domain,
  feeAuthority:payer.address,reserveAuthority:payer.address,reserveDestinationOwner:payer.address},{programAddress:clearing})],[],sdk.CLEARING_ERROR__PROFILE);
// Clearing cannot create profile-4 state in this build. Well-formed context-only
// fixtures reach each maker's own gate; they provide no economic success evidence.
const [market,marketBump]=await pda(clearing,Buffer.from('market-v3'),new Uint8Array(encoder.encode(venue)),Uint8Array.of(0));
const [portfolio]=await pda(clearing,Buffer.from('portfolio-v3'),new Uint8Array(encoder.encode(venue)),new Uint8Array(encoder.encode(payer.address)),Uint8Array.of(0,0));
const [capital,capitalBump]=await pda(clearing,Buffer.from('margin-v3'),new Uint8Array(encoder.encode(portfolio)),Uint8Array.of(1,0));
function contextAccount(key:Address,data:Uint8Array){const template=svm.getAccount(payer.address);assert(template.exists);
  svm.setAccount({...template,address:key,programAddress:clearing,data,lamports:lamports(svm.minimumBalanceForRentExemption(BigInt(data.length))),executable:false});}
contextAccount(venue,new Uint8Array(sdk.getVenueEncoder().encode({...sdk.getVenueDecoder().decode(new Uint8Array(sdk.getVenueSize())),
  schemaVersion:8,profileVersion:4,domain,authority:payer.address,quoteMint:mint.address,vault,markets:[market,market],marketCount:2,bump:venueBump,vaultBump})));
contextAccount(market,new Uint8Array(sdk.getMarketEncoder().encode({...sdk.getMarketDecoder().decode(new Uint8Array(sdk.getMarketSize())),
  schemaVersion:8,venue,index:0,bump:marketBump})));
contextAccount(capital,new Uint8Array(sdk.getMarginAccountEncoder().encode({...sdk.getMarginAccountDecoder().decode(new Uint8Array(sdk.getMarginAccountSize())),
  schemaVersion:8,venue,portfolio,owner:payer.address,subaccountIndex:1,mode:1,role:1,isolatedMarketIndex:0,bump:capitalBump})));
for(const [name,program] of programs.slice(1)){
  const module=name==='maker_a'?sdk.makerA:sdk.makerB;
  const [config]=await pda(program,Buffer.from('curve-v4'),new Uint8Array(encoder.encode(capital)));
  const [price]=await pda(program,Buffer.from('price-v4'),new Uint8Array(encoder.encode(config)));
  const [makerEventAuthority]=await pda(program,Buffer.from('__event_authority'));
  await send(`devnet ${name} initialization disabled`,[module.getInitializeCurveInstruction({owner:payer,venue,market,capital,config,price,
    eventAuthority:makerEventAuthority,program,shape:goldenShape,updater:payer.address,expiry:1000n,instance:0},{programAddress:program})],[],sdk.makerA.MAKER_A_ERROR__BINDING);
}
assert.equal(results.length,3);
writeFileSync(`${directory}/devnet-gates-svm.json`,JSON.stringify({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  build:manifest,scope:'local negative initialization with explicit context-only maker fixtures; no devnet RPC or financial acceptance',results},null,2)+'\n');
console.log('Three actual devnet-feature binaries reject initialization with full rollback; no network deployment.');
