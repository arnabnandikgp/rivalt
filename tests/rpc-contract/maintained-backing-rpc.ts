/** Actual signed maintained-proof progress; all financial effects use deployed
 * handlers. Independent Python checks every captured processed contribution. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {AccountRole,type Address,type Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {backingStep,financialRoots} from './membership-scan-helper.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {backingResolution} from './maintained-backing-resolution.js';
import {backingBoundaries} from './maintained-backing-boundaries.js';
import {verifyBackingBuild} from './backing-artifacts.js';
import {transactionLocks,conflicts} from '../performance/lock-model.js';

const directory=process.env.RIVALT_RUN_DIR!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const build=verifyBackingBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!);
let traderPayer:Keypair|undefined;
const {h,rpc,ws,checks,conformance,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:()=>1_000_000,payerFor:label=>label.startsWith('concurrent fill')?traderPayer:undefined});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined;
try {
  const setup=await liquidityExecutionSetup(h,rpc,{verifyRejections:false});
  const {root,guard,route}=executionTestHelpers(h,setup),[cross,isolated]=setup.roots,owner=setup.traderOwner;
  traderPayer=owner;
  const registry=async()=>sdk.getVenueRegistryDecoder().decode((await h.read(setup.registry))!);
  const ledger=async(index:number)=>sdk.getMarketLedgerDecoder().decode((await h.read(setup.ledgers[index]))!);
  const certificates=await Promise.all([0,1].map(async index=>(await sdk.deriveSettlementCertificate(setup.venue,index))[0]));
  const proof=async(index:number)=>{const bytes=await h.read(certificates[index]);return bytes?sdk.getSettlementCertificateDecoder().decode(bytes):null;};
  const identity={...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  const frames:unknown[]=[],concurrentPairs:{scan:string;fill:string}[]=[],progress:unknown[]=[];
  const capture=async(label:string)=>{
    const members=await financialRoots(h,setup.venue,setup.registry);
    frames.push({label,safety:sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!),registry:await registry(),roots:await Promise.all(members.map(root)),
      ledgers:await Promise.all([0,1].map(ledger)),certificates:await Promise.all([0,1].map(proof))});
    writeFileSync(`${directory}/backing-frames.json`,json(frames));
  };
  const mutate=async(label:string,instructions:Instruction[],signers:Keypair[]=[owner])=>{
    await h.send(label,instructions,signers);await capture(label);
  };
  const allTracked=async()=>[...new Set([...setup.tracked,...await financialRoots(h,setup.venue,setup.registry),...certificates])];
  const reject=async(label:string,instructions:Instruction[],expected:number,signers:Keypair[]=[owner])=>{
    const keys=await allTracked(),before=await Promise.all(keys.map(h.read));
    await h.send(label,instructions,signers,expected);
    assert.deepEqual(await Promise.all(keys.map(h.read)),before,`${label}: atomic rollback`);
    await capture(label);
  };
  const trade=async(marketIndex:0|1,side:0|1,lots=1n)=>route({trader:cross,actor:owner,marketIndex,side,
    makers:[setup.instances[marketIndex*3]],lots:[lots],minimalMarkets:true});
  for(const marketIndex of [0,1] as const) {
    await setup.sample();
    await mutate(`seed round trip open ${marketIndex}`,[await trade(marketIndex,0)]);
    await mutate(`seed round trip close ${marketIndex}`,[await trade(marketIndex,1)]);
    const position=(await root(cross)).positions[marketIndex];assert.equal(position.lots,0n);
    const loss=-position.virtualScaled/1_000_000_000n;assert(loss>=4n);
    await mutate(`collect actual whole loss ${marketIndex}`,[sdk.getCollectAccountLossInstruction({...identity,
      actor:owner,margin:cross,marketIndex,amount:loss})]);
    assert.equal((await ledger(marketIndex)).settlement,loss);
  }
  await setup.sample();
  await mutate('open BTC exposure for maintained mutations',[await trade(0,0,10n)]);
  await mutate('open ETH exposure for mixed dependencies',[await trade(1,0,2n)]);
  for(const marketIndex of [0,1] as const) {
    await h.send(`initialize maintained certificate ${marketIndex}`,[sdk.getInitializeMarketBackingInstruction({...setup.common,
      payer:setup.payer,certificate:certificates[marketIndex],marketIndex})]);
  }
  for(const marketIndex of [0,1] as const) {
    const common={...identity,ledger:setup.ledgers[marketIndex],certificate:certificates[marketIndex]};
    let restart=true,steps=0,epoch=0n,mutations=0;
    const started=performance.now();
    while(!(await proof(marketIndex))!.complete) {
      assert(steps<100,'Bounded eight-root traversal');
      if(steps%4===0)await setup.sample();
      const next=await backingStep(h,common,restart),label=`backing scan ${marketIndex}/${steps}`;
      if(next.request.kind==='member'&&next.request.ordinal===0n) {
        const malformed={...next.instruction,accounts:next.instruction.accounts.map((meta,index,array)=>
          index===array.length-1?{...meta,address:cross}:meta)};
        await reject('foreign member cannot replace authenticated page root',[malformed],sdk.CLEARING_ERROR__RESOLUTION,[]);
      }
      if(next.request.kind==='member'&&next.request.ordinal<2n) {
        // Independent fee payers remove the artificial common-payer lock. Both
        // real requests still contend on the selected market's financial ledger.
        const fillLabel=`concurrent fill ${marketIndex}/${steps}`,fill=await trade(marketIndex,0);
        await Promise.all([h.send(label,[next.instruction]),h.send(fillLabel,[fill],[owner])]);
        concurrentPairs.push({scan:label,fill:fillLabel});mutations++;
        await capture(`${label} plus admitted fill`);
      } else if(!restart&&next.request.kind==='node'&&next.request.level===14&&next.proof.next===next.proof.count) {
        const recipient=setup.instances[marketIndex*3].capital;
        const payment=(amount:bigint)=>sdk.getPayAccountGainInstruction({...identity,actor:owner,margin:recipient,
          certificate:certificates[marketIndex],marketIndex,amount});
        await reject(`final closure/payment ${marketIndex} rolls back together`,[next.instruction,payment(1_000_000n)],sdk.CLEARING_ERROR__AMOUNT);
        const before=await root(recipient),pool=(await ledger(marketIndex)).settlement;
        await mutate(`atomic final closure and funded gain ${marketIndex}`,[next.instruction,payment(1n)]);
        assert.equal((await root(recipient)).cash,before.cash+1n);
        assert.equal((await ledger(marketIndex)).settlement,pool-1n);
      } else await mutate(label,[next.instruction],[]);
      const after=(await proof(marketIndex))!;
      if(restart)epoch=after.backingEpoch;
      assert.equal(after.backingEpoch,epoch,'In-region activity must not reset the proof epoch');
      restart=false;steps++;
      if(next.request.kind==='member'&&next.request.ordinal===6n) {
        await mutate('processed cross cash transfer',[sdk.getTransferFundedAccountInstruction({...identity,
          owner,donor:cross,recipient:isolated,amount:3n,guard:await guard(cross)})]);
        await mutate('processed cross token withdrawal',[sdk.getWithdrawFundedAccountInstruction({...identity,
          owner,margin:cross,quoteMint:setup.mint.address,userToken:setup.traderToken.address,amount:2n,guard:await guard(cross)})]);
        await mutate('processed cross actual token deposit',[await sdk.getDepositAccountInstructionAsync({...setup.common,
          owner,margin:cross,quoteMint:setup.mint.address,userToken:setup.traderToken.address,amount:2n})]);
        mutations+=3;
      }
    }
    const complete=(await proof(marketIndex))!;
    assert.equal(complete.next,8n);
    await reject('valid complete proof cannot be reset',[sdk.getCheckMarketBackingInstruction({...common,
      revision:complete.revision,restart:true})],sdk.CLEARING_ERROR__EXIT_COHORT,[]);
    progress.push({marketIndex,steps,mutations,epoch,elapsedMs:performance.now()-started,restarts:1,
      classification:'initial epoch only; ongoing in-region source publication and admitted mutations'});
  }
  const context={h,rpc,setup,certificates,flush,capture,mutate,reject};
  const boundaries=await backingBoundaries(context);
  await flush();
  journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)));
  await journal.checkpoint('maintained-boundaries');
  const resolution=await backingResolution(context,label=>journal!.checkpoint(label));
  await flush();
  const independent=JSON.parse(execFileSync('python3',['tests/financial/check_backing_runtime.py',`${directory}/backing-frames.json`],{encoding:'utf8'}));
  const parity=await conformance.finish(directory,[
    ...certificates.map(key=>({program:sdk.CLEARING_PROGRAM_ADDRESS,name:'settlementCertificate',key})),
    ...setup.ledgers.map(key=>({program:sdk.CLEARING_PROGRAM_ADDRESS,name:'marketLedger',key})),
    {program:sdk.CLEARING_PROGRAM_ADDRESS,name:'marginAccount',key:cross}],h.read);
  const resources=concurrentPairs.map(pair=>{
    const find=(label:string)=>{const index=checks.findIndex(check=>check.label===label);assert(index>=0);
      const wire=JSON.parse(readFileSync(`${directory}/wire-${index}.json`,'utf8'));
      return {index,locks:transactionLocks(Buffer.from(wire.wireBase64,'base64')),measurement:checks[index]};};
    const scan=find(pair.scan),fill=find(pair.fill),shared=conflicts(scan.locks,fill.locks);
    assert(shared.some(lock=>setup.ledgers.includes(lock.address as Address)&&lock.kind==='write/write'));
    assert(!fill.locks.write.includes(setup.registry),'No new writable venue membership registry');
    return {scan,fill,shared};
  });
  await journal.checkpoint('maintained-progress-and-recovery');
  const sql=await journal.finish();
  writeFileSync(`${directory}/result.json`,json({revision,build,checks,parity,independent,progress,boundaries,resolution,resources,sql,
    endTrackedDirty:!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),
    limitations:['eight actual Financial members; larger population remains P56B','overlapping signed requests, not a saturated throughput or public-network fee claim']}));
}finally {try{await journal?.close();await flush();}finally{ws.close();}}
