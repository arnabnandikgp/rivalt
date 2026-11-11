// P55A2 provisioning/lifecycle probe: rent-funded PDAs and signed financial
// entry, custody exit and terminal retirement. Default/SQL are separate gates.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {getAddressEncoder,getProgramDerivedAddress,type Address,type Instruction,type ReadonlyUint8Array} from '@solana/kit';
import {getCreateAccountInstruction,getTransferSolInstruction} from '@solana-program/system';
import {TOKEN_PROGRAM_ADDRESS,getInitializeMint2Instruction} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {addresses,fixtureKey,payerKey} from './harness.js';
import {prepareMembershipLifecycle} from './account-membership-lifecycle.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';

const directory=process.env.RIVALT_RUN_DIR!;
const encode=(value:unknown)=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2)+'\n';
const {h,rpc,ws,checks,conformance,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:()=>400_000});
const bytes=getAddressEncoder();
const u64=(value:bigint)=>{const out=Buffer.alloc(8);out.writeBigUInt64LE(value);return out;};
const u32=(value:number)=>{const out=Buffer.alloc(4);out.writeUInt32LE(value);return out;};
const derive=async(...seeds:ReadonlyUint8Array[])=>(await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds}))[0];
type Allocation={kind:number;register:number;page:bigint;key:Address;receipt:Address;name:string;size:number};
try {
  const payer=await payerKey(),mint=await fixtureKey('p55a2-storage-mint'),attacker=await fixtureKey('p55a2-storage-attacker');
  const deployment=await addresses();
  const domain=createHash('sha256').update('rivalt/p55a2/schema9/profile5/lifecycle').digest();
  const venue=await derive(Buffer.from('venue-v3'),domain);
  const pda=(prefix:string,...indices:ReadonlyUint8Array[])=>derive(Buffer.from(prefix),bytes.encode(venue),...indices);
  const custody=await pda('custody-v3'),safety=await pda('safety-v3'),vault=await pda('vault-v3');
  const storage=await pda('recovery-storage');
  const common={...deployment,venue,safety,storage};
  const admin={...common,authority:payer};
  const markets=await Promise.all([0,1].map(index=>pda('market-v3',Buffer.from([index]))));
  const ledgers=await Promise.all(markets.map(key=>derive(Buffer.from('ledger-v3'),bytes.encode(key))));
  await h.send('P55 provision fixture mint',[getCreateAccountInstruction({payer,newAccount:mint,lamports:await h.rent(82),space:82n,
    programAddress:TOKEN_PROGRAM_ADDRESS}),getInitializeMint2Instruction({mint:mint.address,decimals:6,mintAuthority:payer.address}),
    getTransferSolInstruction({source:payer,destination:attacker.address,amount:1_000_000n})],[mint]);
  await h.send('P55 provision fresh local venue',[await sdk.getInitializeLiquidityVenueInstructionAsync({...deployment,authority:payer,
    venue,custody,safety,vault,quoteMint:mint.address,domain,feeAuthority:payer.address,reserveAuthority:payer.address,reserveDestinationOwner:payer.address})]);
  for(const index of [0,1])await h.send('P55 provision market identity',[sdk.getInitializeMarketInstruction({...admin,custody,
    market:markets[index],ledger:ledgers[index],index})]);
  await h.send('P55 initialize recovery capacity',[sdk.getInitializeRecoveryStorageInstruction(admin)]);
  const state=async()=>sdk.getRecoveryStorageDecoder().decode((await h.read(storage))!);
  const tracked=new Set<Address>([venue,custody,safety,vault,storage,...markets,...ledgers]);
  const snapshot=async()=>Object.fromEntries(await Promise.all([...tracked].map(async key=>[key,(await h.read(key))?.toString('base64')??null])));
  const reject=async(label:string,instruction:Instruction,error=sdk.CLEARING_ERROR__RESOLUTION,signers:typeof payer[]=[])=>{
    const before=await snapshot();await h.send(`P55 reject ${label}`,[instruction],signers,error);assert.deepEqual(await snapshot(),before,label);
  };
  const lifecycle=await prepareMembershipLifecycle(h,rpc,flush,{...common,custody,vault},mint.address,markets,ledgers,tracked,checks);
  await reject('non-authority growth',sdk.getBeginRecoveryProvisionInstruction({...admin,authority:attacker,capacity:128n,revision:(await state()).revision}),2001,[attacker]);
  await reject('zero capacity',sdk.getBeginRecoveryProvisionInstruction({...admin,capacity:0n,revision:(await state()).revision}));
  await reject('overflow capacity',sdk.getBeginRecoveryProvisionInstruction({...admin,capacity:0xffffffffffffffffn,revision:(await state()).revision}));
  const first=sdk.getBeginRecoveryProvisionInstruction({...admin,capacity:1n,revision:(await state()).revision});
  await h.send('P55 begin one-root capacity proof',[first]);await reject('start replay',first);
  const allocation=async(kind:number,register:number,page:bigint):Promise<Allocation>=>{
    const prefixes=['prepared-settlement','settlement-rates','settlement-plan','frozen-margin-page','resolution-limbs'];
    const key=await pda(prefixes[kind],...(kind===4?[u32(register),u64(page)]:kind===3?[u64(page)]:[]));
    const receipt=await pda('storage-funding',bytes.encode(key));
    tracked.add(key);tracked.add(receipt);
    return {kind,register,page,key,receipt,name:['preparedSettlement','settlementRates','settlementPlan','frozenMarginPage','settlementLimbPage'][kind],
      size:[1460,1204,1181,1156,2129][kind]};
  };
  const firstAllocations=await Promise.all([0,1].map(kind=>allocation(kind,0,0n)));
  let totalContribution=0n,totalRent=0n;
  const funded=new Set<Address>();
  const fund=async(item:Allocation,ordinal:bigint,donation=0n)=>{
    if(donation)await h.send('P55 voluntarily pre-fund canonical allocation',[getTransferSolInstruction({source:payer,destination:item.key,amount:donation})]);
    const expectedRent=await h.rent(item.size),before=await state();
    await h.send('P55 fund exact next allocation',[sdk.getFundRecoveryAllocationInstruction({...common,payer,allocation:item.key,receipt:item.receipt,
      kind:item.kind,register:item.register,page:item.page,generation:before.generation,ordinal})]);
    assert.deepEqual(await state(),before,'funding alone cannot earn capacity');
    const receipt=sdk.getStorageFundingDecoder().decode((await h.read(item.receipt))!);
    assert.equal(receipt.contributedLamports,expectedRent-donation);assert.equal(receipt.rentPayer,payer.address);
    assert.equal(receipt.allocation,item.key);assert.equal(receipt.venue,venue);assert.equal(receipt.revision,1n);
    const actual=await rpc.call('getAccountInfo',[item.key,{encoding:'base64',commitment:'confirmed'}]);
    assert.equal(actual.value.owner,sdk.CLEARING_PROGRAM_ADDRESS);assert.equal(BigInt(actual.value.lamports),expectedRent);
    assert.equal((await h.read(item.key))!.length,item.size);
    totalContribution+=receipt.contributedLamports;totalRent+=expectedRent+await h.rent(123);funded.add(item.key);
  };
  const verify=async(item:Allocation,ordinal:bigint)=>sdk.getVerifyRecoveryAllocationInstruction({...common,allocation:item.key,receipt:item.receipt,
    generation:(await state()).generation,ordinal,revision:(await state()).revision});
  for(const [index,item] of firstAllocations.entries()){
    await fund(item,BigInt(index),index===0?1_000_000n:await h.rent(item.size));
    const instruction=await verify(item,BigInt(index));await h.send('P55 verify actual funded prefix',[instruction]);await reject('prefix replay',instruction);
    assert.equal((await state()).readyCapacity,0n);
  }
  const cancel=sdk.getCancelRecoveryProvisionInstruction({...admin,generation:1n,revision:(await state()).revision});
  await h.send('P55 cancel incomplete proof preserving funded allocations',[cancel]);await reject('cancel replay',cancel);
  assert.equal((await state()).readyCapacity,0n);assert.equal((await state()).targetCapacity,0n);
  await h.send('P55 begin full 128-root recovery capacity',[sdk.getBeginRecoveryProvisionInstruction({...admin,capacity:128n,revision:(await state()).revision})]);

  // Independent specification arithmetic; no program/native schedule is imported.
  const count=128n,ceil=(value:bigint,divisor:bigint)=>(value+divisor-1n)/divisor;
  const expected:Allocation[]=[];
  for(let kind=0;kind<3;kind++)expected.push(await allocation(kind,0,0n));
  for(let page=0n;page<ceil(count,8n);page++)expected.push(await allocation(3,0,page));
  const bitWidth=BigInt((count-1n).toString(2).length);
  const limbPages=ceil(ceil(88n*count+4n*(87n+bitWidth)+16n,64n),256n);
  for(let register=0;register<46;register++)for(let page=0n;page<limbPages;page++)expected.push(await allocation(4,register,page));
  const arcs=8n*count+6n;
  let hierarchyWords=0n,level=ceil(arcs,64n);
  for(;;){hierarchyWords+=level;if(level===1n)break;level=ceil(level,64n);}
  const pages=[ceil(count,36n),ceil(count+5n,28n),ceil(arcs,64n),ceil(arcs,256n),ceil(hierarchyWords,256n),ceil(count,256n),ceil(count,256n)];
  for(let offset=0;offset<pages.length;offset++)for(let page=0n;page<pages[offset];page++)expected.push(await allocation(4,64+offset,page));
  assert.equal(expected.length,99);
  const paused={...admin,custody,vault,btcLedger:ledgers[0],ethLedger:ledgers[1]};
  for(const [index,item] of expected.entries()){
    const ordinal=BigInt(index),before=await state();
    assert.equal(before.readyCapacity,0n);assert.equal(before.nextAllocation,ordinal);assert.equal(before.generation,2n);
    if(!funded.has(item.key))await fund(item,ordinal);
    if(index===0){
      await reject('old proof generation',sdk.getVerifyRecoveryAllocationInstruction({...common,allocation:item.key,receipt:item.receipt,
        ordinal,generation:1n,revision:before.revision}));
      await reject('skipped ordinal',sdk.getVerifyRecoveryAllocationInstruction({...common,allocation:item.key,receipt:item.receipt,
        ordinal:1n,generation:2n,revision:before.revision}));
      await h.send('P55 pause venue during incomplete provision',[sdk.getPauseVenueInstruction({...paused,paused:true})]);
      await reject('paused capacity proof',await verify(item,ordinal),sdk.CLEARING_ERROR__PROFILE);
      await h.send('P55 resume venue provision',[sdk.getPauseVenueInstruction({...paused,paused:false})]);
    }
    await h.send('P55 authenticate complete capacity step',[await verify(item,ordinal)]);
  }
  const complete=await state();assert.equal(complete.readyCapacity,128n);assert.equal(complete.targetCapacity,0n);assert.equal(complete.nextAllocation,0n);
  await reject('decrease funded capacity',sdk.getBeginRecoveryProvisionInstruction({...admin,capacity:127n,revision:complete.revision}));
  assert.equal(sdk.getCustodyDecoder().decode((await h.read(custody))!).allocatedVault,0n);
  assert.equal((await rpc.call('getTokenAccountBalance',[vault,{commitment:'confirmed'}])).value.amount,'0');
  const lifecycleResult=await lifecycle.complete(expected);
  await flush();
  for(const outcome of checks)assert.deepEqual(outcome.signatureWsError,outcome.error);
  writeFileSync(`${directory}/outcomes.json`,encode(checks));
  const parity=await conformance.finish(directory,[{program:sdk.CLEARING_PROGRAM_ADDRESS,name:'recoveryStorage',key:storage},
    ...expected.flatMap(item=>[{program:sdk.CLEARING_PROGRAM_ADDRESS,name:lifecycle.parity.get(item.key)??item.name,key:item.key},
      {program:sdk.CLEARING_PROGRAM_ADDRESS,name:'storageFunding',key:item.receipt}]),
    ...[...lifecycle.parity].filter(([key])=>!expected.some(item=>item.key===key)).map(([key,name])=>({program:sdk.CLEARING_PROGRAM_ADDRESS,key,name}))],h.read);
  const result={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    trackedDirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',
    build:JSON.parse(readFileSync(`${process.env.RIVALT_MEMBERSHIP_ARTIFACT_DIR}/build-manifest.json`,'utf8')),
    scope:'storage, owner lifecycle and terminal refunds; default and PostgreSQL still separate acceptance',checks,parity,lifecycle:lifecycleResult,
    allocations:expected.length,readyCapacity:complete.readyCapacity,totalAllocationAndReceiptRent:totalRent,totalContribution,
    financialCollateral:0n,rawAccounts:await snapshot()};
  writeFileSync(`${directory}/result.json`,encode(result));
  console.log(`P55 storage: ${checks.length} signed outcomes; ${expected.length} physical allocations; 128-root recovery capacity; 71 registrations / two Financial roots / terminal refunds.`);
} finally {ws.close();}
