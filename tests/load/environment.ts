import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { address, type Address, type Instruction } from '@solana/kit';
import { Connection, type Keypair } from '@solana/web3.js';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';
import { TOKEN_PROGRAM_ADDRESS, getInitializeMint2Instruction, getInitializeAccount3Instruction, getMintToInstruction } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { Indexer } from '../../packages/indexer/src/index.js';
import { Runtime } from '../../packages/services/src/runtime.js';
import { json } from '../../packages/indexer/src/events.js';
import { WireRpc } from '../rpc-contract/wire.js';
import { addresses, fixtureKey, payerKey } from '../rpc-contract/custody-cases.js';
import { oracleSetup, type OracleHarness } from '../rpc-contract/oracle-cases.js';
import { orderTools } from '../rpc-contract/order-cases.js';
import { publishFeed } from '../rpc-contract/oracle-fixture.js';

export async function wait<T>(read:()=>Promise<T>,accept:(value:T)=>boolean,label:string,ms=60_000):Promise<T>{
  const end=Date.now()+ms;let last:unknown;
  while(Date.now()<end){try{const value=await read();if(accept(value))return value;last=value;}catch(e){last=e;}await delay(100);}
  throw new Error(`${label}: ${last instanceof Error?last.message:'condition not reached'}`);
}
export async function environment(options: { makerKit?: boolean; beforeStart?: (runtime: Runtime) => Promise<void> } = {}){
  const dir=process.env.RIVALT_RUN_DIR!,url=process.env.RIVALT_RPC_URL!,wsUrl=process.env.RIVALT_WS_URL!,database=process.env.RIVALT_DATABASE_URL!;
  assert.equal(new URL(url).hostname,'127.0.0.1');
  const runId=dir.split('/').at(-1)!,rpc=new WireRpc(url),connection=new Connection(url,'confirmed'),payer=await payerKey(),a=await addresses();
  const txLog=(label:string,signature:string,tx:any)=>appendFileSync(`${dir}/transactions.jsonl.gz`,gzipSync(json({label,signature,tx})+'\n'));
  let sourcePayer:Keypair|undefined;
  const sourceBudget={address:'',openingLamports:0n,cap:1_000_000_000n,committed:0n,spent:0n,publications:0};
  const read=async(key:Address)=>{const r=await rpc.call('getAccountInfo',[key,{encoding:'base64',commitment:'finalized'}]);return r.value?Buffer.from(r.value.data[0],'base64'):null;};
  const now=async()=>(await read(address('SysvarC1ock11111111111111111111111111111111')))!.readBigInt64LE(32);
  const slot=async()=>BigInt(await rpc.call('getSlot',[{commitment:'finalized'}]));
  async function send(label:string,instructions:Instruction[],signers:Keypair[]=[],feePayer=payer){
    const {transaction}=await sdk.signInstructions(connection,feePayer,instructions,signers);
    let reserved=0n;
    if(feePayer===sourcePayer){
      const fee=await rpc.call('getFeeForMessage',[Buffer.from(transaction.message.serialize()).toString('base64'),{commitment:'confirmed'}]);
      assert(fee.value!==null);reserved=BigInt(fee.value);assert(sourceBudget.committed+sourceBudget.spent+reserved<=sourceBudget.cap,'Source fixture fee cap');sourceBudget.committed+=reserved;
    }
    const signature=await rpc.call('sendTransaction',[Buffer.from(transaction.serialize()).toString('base64'),{encoding:'base64',skipPreflight:true}]);
    await wait(()=>rpc.call('getSignatureStatuses',[[signature],{searchTransactionHistory:true}]),r=>r.value[0]?.confirmationStatus==='finalized',label);
    const tx=await rpc.call('getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert(tx?.meta);txLog(label,signature,tx);
    if(feePayer===sourcePayer){assert(BigInt(tx.meta.fee)<=reserved);sourceBudget.committed-=reserved;sourceBudget.spent+=BigInt(tx.meta.fee);sourceBudget.publications++;}
    assert.equal(tx.meta.err,null,`${label}: ${tx.meta.logMessages}`);return signature as string;
  }
  const h:OracleHarness={send:async(label,ixs,signers,error)=>{assert.equal(error,undefined,'Provisioning only; unrelated acceptance cases do not run');await send(label,ixs,signers);},read,now,slot,
    rent:async(n)=>BigInt(await rpc.call('getMinimumBalanceForRentExemption',[n])),
    waitTime:async(n)=>{await wait(now,x=>x>=n,'chain time');},waitUntil:async(n)=>{await wait(slot,x=>x>=n,'chain slot');},quote:async()=>{throw new Error('Unused fixture quote');}};
  const mint=await fixtureKey('mint'),owner=await fixtureKey('trader'),token=await fixtureKey('user-token');
  await send('create six-decimal classic test collateral',[getCreateAccountInstruction({payer,newAccount:mint,lamports:await h.rent(82),space:82n,programAddress:TOKEN_PROGRAM_ADDRESS}),getInitializeMint2Instruction({mint:mint.address,decimals:6,mintAuthority:payer.address})],[mint]);
  const anchor=await send('initialize real clearing market',[await sdk.getInitializeMarketInstructionAsync({...a,authority:payer,quoteMint:mint.address,domain:createHash('sha256').update('rivalt/p12/local/load').digest()})]);
  await send('register and provision trader',[getTransferSolInstruction({source:payer,destination:owner.address,amount:2_000_000_000n}),await sdk.getRegisterParticipantInstructionAsync({...a,owner}),getCreateAccountInstruction({payer,newAccount:token,lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),getInitializeAccount3Instruction({account:token.address,mint:mint.address,owner:owner.address})],[owner,token]);
  const setup=await oracleSetup(h,options.makerKit?1024n:3600n),t=await orderTools(h,setup);
  await send('initialize real resolution ledger',[await sdk.getInitializeResolutionInstructionAsync({...setup,authority:payer})]);
  const actors=[{owner,token,participant:setup.trader}];
  async function participant(name:string,cash:bigint){
    const owner=await fixtureKey(name),token=await fixtureKey(name+'-token'),[participant]=await sdk.findParticipantPda({market:a.market,owner:owner.address});
    await send('provision funded test participant',[getTransferSolInstruction({source:payer,destination:owner.address,amount:2_000_000_000n}),await sdk.getRegisterParticipantInstructionAsync({...a,owner}),getCreateAccountInstruction({payer,newAccount:token,lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),getInitializeAccount3Instruction({account:token.address,mint:mint.address,owner:owner.address}),getMintToInstruction({mint:mint.address,token:token.address,mintAuthority:payer,amount:cash})],[owner,token]);
    await send('fund actual clearing collateral',[await sdk.getDepositInstructionAsync({...a,owner,participant,quoteMint:mint.address,userToken:token.address,amount:cash})],[owner]);
    return {owner,token,participant};
  }
  actors.push(await participant('p12-trader-1',100_000_000n),await participant('p12-trader-2',100_000_000n));
  const receiver=await participant('p12-risk',100_000_000n);
  const operators={funding:await fixtureKey('p12-funding'),settlement:await fixtureKey('p12-settlement'),orders:await fixtureKey('p12-orders'),risk:receiver.owner,'maker-a':setup.makers[0].owner,'maker-b':setup.makers[1].owner};
  for(const name of ['funding','settlement','orders'] as const)await send(`prefund separate ${name} network fees`,[getTransferSolInstruction({source:payer,destination:operators[name].address,amount:2_000_000_000n})]);
  sourcePayer=await fixtureKey('p12-source-fees');
  await send('prefund bounded synthetic source publication fees',[getTransferSolInstruction({source:payer,destination:sourcePayer.address,amount:2_000_000_000n})]);
  sourceBudget.address=sourcePayer.address;sourceBudget.openingLamports=BigInt((await rpc.call('getBalance',[sourcePayer.address,{commitment:'finalized'}])).value);
  await t.recover();
  const config={rpcUrl:url,wsUrl,databaseUrl:database,runId,market:a.market,anchor,maxRecoveryTransactions:200_000,pageSize:1000};
  const seedIndexer=new Indexer(config);await seedIndexer.open();await seedIndexer.cycle();await seedIndexer.close();
  const budgetProfile=options.makerKit?'smoke':'soak24';
  const runtime=new Runtime(database,runId,url,budgetProfile,5n,1n);await runtime.open();
  const makerDomain=options.makerKit?Buffer.from((await runtime.snapshot()).m.domain).toString('hex'):'';
  const children=new Map<string,ChildProcess>();let childNumber=0;
  const start=(role:string,extra:Record<string,string>={})=>{
    assert(!children.has(role));
    const key=operators[role as keyof typeof operators];let signerPath='';
    if(key){signerPath=resolve(dir,role+'-key.json');writeFileSync(signerPath,JSON.stringify([...key.secretKey]),{mode:0o600});}
    const fd=openSync(`${dir}/${role}-${++childNumber}.log`,'w');
    let entry=role==='indexer'?'packages/indexer/src/main.ts':'packages/services/src/main.ts';
    const args:string[]=[];
    if(options.makerKit&&role.startsWith('maker-')){
      const configPath=resolve(dir,role+'-config.json');
      writeFileSync(configPath,json({schemaVersion:1,operatorClass:'internal-reference',chain:'solana:localnet',rpcUrl:url,
        databaseEnv:'RIVALT_DATABASE_URL',signerPath,runId,makerId:role==='maker-a'?0:1,owner:key.address,
        market:a.market,domain:makerDomain,budgetProfile}),{mode:0o600});
      entry='packages/maker-kit/src/bot.ts';args.push(configPath);
    }
    const child=spawn(process.execPath,['--import','tsx',entry,...args],{env:{...process.env,RIVALT_RUN_ID:runId,RIVALT_MARKET:a.market,RIVALT_INIT_SIGNATURE:anchor,RIVALT_HISTORY_LIMIT:'200000',RIVALT_API_PORT:'18083',RIVALT_SERVICE_PORT:'18081',RIVALT_SERVICE_ROLE:role,RIVALT_SIGNER_PATH:signerPath,RIVALT_BUDGET_PROFILE:budgetProfile,RIVALT_FUNDING_INTERVAL_SECONDS:'5',RIVALT_QUOTE_DISPATCH_MARGIN_SECONDS:'1',...extra},stdio:['ignore',fd,fd]});
    closeSync(fd);children.set(role,child);return child;
  };
  const stop=async(role:string)=>{
    const child=children.get(role);if(!child)return;children.delete(role);
    if(child.exitCode!==null||child.signalCode!==null)return;
    const exit=new Promise<void>(r=>child.once('exit',()=>r()));child.kill('SIGTERM');
    await Promise.race([exit,delay(10000).then(()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');throw new Error(`Timed out stopping ${role}`);}})]);
  };
  let sourceActive=true,sourceStop=false,published=0n;
  const sourceErrors:string[]=[];
  const sourceLoop=(async()=>{while(!sourceStop){try{if(sourceActive){const time=await now();if(time>published){await send('signed controlled dependency update',await Promise.all([0,1,2,3].map(i=>publishFeed(i,time))),[setup.primary,setup.guardKey],sourcePayer);published=time;}}}catch(e){sourceErrors.push(e instanceof Error?e.message:'source error');}await delay(500);}})();
  const openingBalances:Record<string,{address:string;lamports:string}>=Object.fromEntries(await Promise.all(Object.entries(operators).map(async([role,key])=>[role,{address:key.address,lamports:String((await rpc.call('getBalance',[key.address,{commitment:'finalized'}])).value)}])));
  try {
  await options.beforeStart?.(runtime);
  for(const role of ['indexer','api','executor','maker-a','maker-b','funding','settlement',...(options.makerKit?[]:['orders','risk'])])start(role);
  await wait(async()=>{const r=await fetch('http://127.0.0.1:18083/ready');return r.ok;},Boolean,'indexer readiness');
  await wait(async()=>{const s=await runtime.snapshot();return s.sourceMode==='Normal'&&s.makers.every(x=>x.online);},Boolean,'funding and makers ready');
  } catch(error) {sourceStop=true;await sourceLoop;await Promise.all([...children.keys()].map(stop));await runtime.close();throw error;}
  return {dir,url,wsUrl,database,runId,rpc,connection,payer,a,setup,t,actors,receiver,operators,openingBalances,config,runtime,read,now,slot,send,start,stop,children,sourceErrors,sourceBudget,txLog,
    stopSources:async()=>{sourceStop=true;await sourceLoop;},setSources:(active:boolean)=>{sourceActive=active;},
    close:async()=>{sourceStop=true;await sourceLoop;await Promise.all([...children.keys()].map(stop));await runtime.close();}};
}
