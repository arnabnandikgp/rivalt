// P40B: actual nested financial CPI, atomic rollback and paused retirement.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {AccountRole,type Instruction} from '@solana/kit';
import {getTokenDecoder} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {LiquidityIndexer} from '../../packages/indexer/src/liquidity-indexer.js';
import {decodeAccountInvocations} from '../../packages/indexer/src/account-events.js';
import {json} from '../../packages/indexer/src/events.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {provisionCanonicalMakers} from './canonical-maker-cases.js';
import {initializationSignature} from './liquidity-journal.js';
import {ORACLE_FIXTURE} from './oracle-fixture.js';

const directory=process.env.RIVALT_RUN_DIR!,databaseUrl=process.env.RIVALT_DATABASE_URL!;
assert(databaseUrl);
let batchArrivals=0,releaseBatch:()=>void;
let batchReady=new Promise<void>(resolve=>{releaseBatch=resolve;});
const {h,rpc,ws,checks,conformance,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,{
  deferFinality:true,computeUnitLimit:()=>500_000,beforeBroadcast:async label=>{
    if(!label.startsWith('P40B same-slot'))return;
    if(++batchArrivals===3)releaseBatch();await batchReady;
  }});
let indexer:LiquidityIndexer|undefined,replay:LiquidityIndexer|undefined;
const u32=(value:number)=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
try {
  const setup=await provisionCanonicalMakers(h),{owner,payer,venue,custody,safety,registry,common,markets,instances}=setup;
  const roots=instances.map(value=>value.capital),root=async(key=roots[0])=>sdk.getMarginAccountDecoder().decode((await h.read(key))!);
  const identity={...common,btc:markets[0],eth:markets[1]},[certificate]=await sdk.deriveVenueComponent(venue,'retirement');
  const safetyState=async()=>sdk.getVenueSafetyDecoder().decode((await h.read(safety))!);
  const state=async()=>Promise.all([...roots,venue,custody,safety,certificate].map(async key=>(await h.read(key))?.toString('base64')??null));
  const transfer=(amount:bigint)=>sdk.getTransferAccountCustodyInstruction({...common,owner,donor:roots[0],recipient:roots[1],amount});
  await flush();
  const sameSlot:{slot:number;signatures:string[]}[]=[];
  // A bounded broadcast barrier is a journal ordering probe, not scheduler TPS.
  // Return each atom before the nested-CPI/retirement financial expectations.
  for(let attempt=0;attempt<3&&sameSlot.length===0;attempt++) {
    for(const reverse of [false,true]) {
      batchArrivals=0;batchReady=new Promise<void>(resolve=>{releaseBatch=resolve;});
      const start=checks.length;
      await Promise.all([0,2,4].map(index=>h.send(`P40B same-slot ${attempt}/${reverse}/${index}`,[
        sdk.getTransferAccountCustodyInstruction({...common,owner,donor:roots[index+(reverse?1:0)],
          recipient:roots[index+(reverse?0:1)],amount:1n})],[owner])));
      await flush();
      const group=checks.slice(start),statuses=await rpc.call('getSignatureStatuses',[group.map(value=>value.signature),{searchTransactionHistory:true}]);
      const slots=new Map<number,string[]>();
      statuses.value.forEach((value:{slot:number},index:number)=>slots.set(value.slot,[...slots.get(value.slot)??[],String(group[index].signature)]));
      for(const [slot,signatures] of slots)if(signatures.length>1)sameSlot.push({slot,signatures});
    }
  }
  assert(sameSlot.length>0,'Bounded probe did not observe multiple finalized originals in one slot');
  assert((await Promise.all(roots.map(key=>root(key)))).every(value=>value.cash===1_000_000n));
  const forward=(instructions:Instruction[]):Instruction=>{
    assert(instructions.length>0);for(const instruction of instructions)assert.deepEqual(instruction.accounts,instructions[0].accounts);
    return {programAddress:ORACLE_FIXTURE,accounts:[{address:sdk.CLEARING_PROGRAM_ADDRESS,role:AccountRole.READONLY},...instructions[0].accounts!],
      data:Buffer.concat([createHash('sha256').update('global:forward_clearing').digest().subarray(0,8),u32(instructions.length),
        ...instructions.flatMap(instruction=>[u32(instruction.data!.length),Buffer.from(instruction.data!)])])};
  };
  const two=[transfer(1n),transfer(1n)];
  await h.send('P40B two financial calls beneath one external frame',[forward(two)],[owner]);conformance.record(two);
  assert.deepEqual([(await root()).cash,(await root(roots[1])).cash],[999_998n,1_000_002n]);
  const before=await state();
  await h.send('P40B second nested call rolls back first event and revisions',[forward([transfer(1n),transfer(1_000_000n)])],[owner],sdk.CLEARING_ERROR__ARITHMETIC);
  assert.deepEqual(await state(),before);
  await h.send('P40B zero-payload retirement storage',[sdk.getInitializeAccountRetirementInstruction({payer,venue,safety,certificate,eventAuthority:common.eventAuthority,program:common.program})]);
  const scan=(start:number)=>{
    const instruction=sdk.getCheckAccountRetirementInstruction({...identity,registry,certificate,start});
    return {...instruction,accounts:[...instruction.accounts,...roots.slice(start,start+2).map(address=>({address,role:AccountRole.READONLY}))]};
  };
  await h.send('P40B unpaused terminal scan rejects',[scan(0)],[],sdk.CLEARING_ERROR__RESOLUTION);
  const pause=(paused:boolean)=>sdk.getPauseVenueInstruction({...common,authority:payer,paused});
  await h.send('P40B authority opens terminal proof window',[pause(true)]);
  await h.send('P40B first complete-member page',[scan(0)]);
  const partial=sdk.getRetirementCertificateDecoder().decode((await h.read(certificate))!);
  assert.equal(partial.next,2);assert.equal(partial.cash,2_000_000n);
  await h.send('P40B unpause and repause invalidate the earlier proof',[pause(false),pause(true)]);
  await h.send('P40B prior page cannot continue in new epoch',[scan(2)],[],sdk.CLEARING_ERROR__RESOLUTION);
  await h.send('P40B paused cash transfer cannot alter scanned entitlement',[transfer(1n)],[owner],sdk.CLEARING_ERROR__PAUSED);
  for(let start=0;start<roots.length;start+=2)await h.send(`P40B fresh complete-member page ${start}`,[scan(start)]);
  const proof=sdk.getRetirementCertificateDecoder().decode((await h.read(certificate))!);
  assert.equal(proof.complete,true);assert.equal(proof.cash,6_000_000n);assert.equal(proof.next,6);
  await h.send('P40B retire only the completed same-epoch proof',[sdk.getRetireAccountsInstruction({...identity,authority:payer,registry,
    certificate,resolution:undefined,safetyEpoch:(await safetyState()).epoch})]);
  assert.equal((await safetyState()).mode,4);
  const current=await root(),venueState=sdk.getVenueDecoder().decode((await h.read(venue))!);
  await h.send('P40B retired owner cash remains withdrawable',[sdk.getWithdrawFundedAccountInstruction({...identity,owner,margin:roots[0],
    quoteMint:setup.mint.address,userToken:setup.token.address,amount:1n,guard:{safetyEpoch:(await safetyState()).epoch,
      venueTermsEpoch:venueState.termsEpoch,nonce:current.nonce,stateVersion:current.stateVersion}})],[owner]);
  assert.equal((await root()).cash,999_997n);assert.equal(getTokenDecoder().decode((await h.read(setup.token.address))!).amount,1n);
  assert.equal(getTokenDecoder().decode((await h.read(setup.vault))!).amount,5_999_999n);
  await flush();
  const wrapped=checks.find(value=>value.label==='P40B two financial calls beneath one external frame')!;
  const wrappedTx=await rpc.call('getTransaction',[wrapped.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
  const envelopes=decodeAccountInvocations(String(wrapped.signature),wrappedTx,0,{program:common.program,eventAuthority:common.eventAuthority,venue,domain:setup.domain.toString('hex')});
  assert.equal(envelopes.length,2);assert.equal(envelopes[0].outer,envelopes[1].outer);assert.deepEqual(envelopes.map(value=>value.invocation),[0,1]);
  const anchor=await initializationSignature(rpc,checks.map(check=>String(check.signature)),common.eventAuthority);
  const config={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl,runId:'p40b-scoped-history',venue,anchor,profile:'liquidity-execution-qualification' as const};
  indexer=new LiquidityIndexer(config);await indexer.open();await indexer.cycle();const snapshot=await indexer.store.snapshot(),reconciliation=await indexer.reconcile();
  assert.equal(snapshot.state.custody!.totalCash,'5999999');assert.equal(snapshot.state.safety!.mode,4);
  assert.equal(snapshot.state.revisions[certificate].revision,proof.revision.toString());
  const sql=await indexer.store.pool.query(`SELECT count(*) FILTER (WHERE jsonb_array_length(payload->'events')=0) AS empty,
    count(*) FILTER (WHERE invocation=1) AS nested_second FROM envelopes WHERE run_id=$1`,[config.runId]);
  assert(Number(sql.rows[0].empty)>0);assert.equal(Number(sql.rows[0].nested_second),1);
  for(const group of sameSlot) {
    const positions:{rows:{signature:string;transaction_index:number}[]}=await indexer.store.pool.query('SELECT signature, transaction_index FROM transactions WHERE run_id=$1 AND slot=$2 ORDER BY transaction_index',[config.runId,group.slot]);
    assert(group.signatures.every(signature=>positions.rows.some(value=>value.signature===signature)));
    assert.equal(new Set(positions.rows.map(value=>value.transaction_index)).size,positions.rows.length);
  }
  await indexer.store.pool.query('CREATE DATABASE rivalt_p40b_scoped_replay');const replayUrl=new URL(databaseUrl);replayUrl.pathname='/rivalt_p40b_scoped_replay';
  replay=new LiquidityIndexer({...config,runId:'p40b-scoped-replay',databaseUrl:replayUrl.toString()});await replay.open();await replay.cycle();
  assert.deepEqual((await replay.store.snapshot()).state,snapshot.state);
  const parity=await conformance.finish(directory,[{program:common.program,name:'retirementCertificate',key:certificate},
    {program:common.program,name:'marginAccount',key:roots[0]},{program:common.program,name:'custody',key:custody}],h.read);
  writeFileSync(`${directory}/summary.json`,json({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    trackedDirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',
    build:JSON.parse(readFileSync('.local/liquidity-execution/build-manifest.json','utf8')),checks,reconciliation,parity,envelopes,sameSlot,sql:sql.rows[0]}));
  console.log(json({stage:'p40b-scoped-history-pass',reconciliation,parity}));
}finally{await replay?.close();await indexer?.close();try{await flush();}finally{ws.close();}}
