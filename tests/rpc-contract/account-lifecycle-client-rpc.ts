/** Candidate SDK, published indexer/API and real internal Wallet Standard UI.
 * Only signed program instructions provision identities and move test funds. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {getTransferSolInstruction} from '@solana-program/system';
import {getMintToInstruction,getTokenDecoder} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {accountServiceApi} from '../../packages/services/src/account-service-api.js';
import {signedWire} from '../../packages/services/src/queue.js';
import {LiquidityIndexer} from '../../packages/indexer/src/liquidity-indexer.js';
import {accountApi} from '../../packages/indexer/src/account-api.js';
import {json} from '../../packages/indexer/src/events.js';
import {liquidityBrowser} from '../browser/liquidity-lifecycle.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {initializationSignature} from './liquidity-journal.js';
import {verifyBackingBuild} from './backing-artifacts.js';
import {fixtureKey} from './harness.js';

const directory=process.env.RIVALT_RUN_DIR!,databaseUrl=process.env.RIVALT_DATABASE_URL!,rpcUrl=process.env.RIVALT_RPC_URL!,wsUrl=process.env.RIVALT_WS_URL!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const build=verifyBackingBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!);
const {h,rpc,ws,checks,conformance,flush}=await openCanonicalRpcHarness(rpcUrl,wsUrl,directory,{deferFinality:true,computeUnitLimit:()=>1_000_000});
let indexer:LiquidityIndexer|undefined,replay:LiquidityIndexer|undefined,runtime:AccountRuntime|undefined,api:ReturnType<typeof accountServiceApi>|undefined;
let running=false;const loops:Promise<void>[]=[],observations:unknown[]=[],subscriptions:{signature:string;subscription:number}[]=[];
async function until<T>(read:()=>Promise<T>,accept:(value:T)=>boolean,label:string,seconds=60) {
  const deadline=Date.now()+seconds*1000;let last:T|undefined;
  while(Date.now()<deadline){last=await read();if(accept(last))return last;await delay(150);}
  throw new Error(`${label}: ${json(last)}`);
}
try {
  const setup=await liquidityExecutionSetup(h,rpc,{verifyRejections:false});
  // Registration exceeds the former 64-identity boundary without pretending
  // empty identities qualify a larger Financial population (that is P56B).
  for(let operator=0;operator<3;operator++) {
    const owner=await fixtureKey(`p56a2-registration-${operator}`);
    await h.send('fund identity storage payer',[getTransferSolInstruction({source:setup.payer,destination:owner.address,amount:2_000_000_000n})]);
    const count=operator<2?27:12;
    for(let ordinal=0;ordinal<count;ordinal++) {
      const portfolioIndex=Math.floor(ordinal/9),child=ordinal%9;
      const [portfolio]=await sdk.deriveAccountPortfolio(setup.venue,owner.address,portfolioIndex);
      if(child===0)await h.send('create independent registration portfolio',[await sdk.getCreatePortfolioInstructionAsync({...setup.common,owner,portfolio,index:portfolioIndex})],[owner]);
      const registry=sdk.getVenueRegistryDecoder().decode((await h.read(setup.registry))!);
      const [members]=await sdk.deriveMemberPage(setup.venue,registry.nextId/64n);
      if(!await h.read(members)) {
        const [receipt]=await sdk.deriveStorageFunding(setup.venue,members);
        await h.send('fund next identity page',[await sdk.getFundMemberPageInstructionAsync({...setup.common,payer:setup.payer,
          allocation:members,receipt,pageIndex:registry.nextId/64n})]);
      }
      const [margin]=await sdk.deriveMarginAccount(portfolio,child);
      await h.send('register beyond fixed identity capacity',[await sdk.getRegisterMarginInstructionAsync({...setup.common,owner,portfolio,margin,members,
        subaccountIndex:child,mode:child===0?0:1,isolatedMarketIndex:child===0?255:ordinal%2,role:0})],[owner]);
    }
  }
  const registry=sdk.getVenueRegistryDecoder().decode((await h.read(setup.registry))!);
  assert.equal(registry.nextId,74n);assert.equal(registry.financialCount,8n);
  await h.send('mint valueless wallet lifecycle collateral',[getMintToInstruction({mint:setup.mint.address,token:setup.traderToken.address,
    mintAuthority:setup.payer,amount:4_000_000n})]);
  await flush();const anchor=await initializationSignature(rpc,checks.map(check=>String(check.signature)),setup.deployment.eventAuthority);
  const config={rpcUrl,wsUrl,databaseUrl,runId:'p56a2-clients',venue:setup.venue,anchor,profile:'liquidity-execution-qualification' as const,
    deployment:'account-scale-candidate' as const};
  indexer=new LiquidityIndexer(config);await indexer.open();
  await until(async()=>{await indexer!.cycle();return indexer!.healthy;},Boolean,'complete initial candidate publication');
  const {binding}=await indexer.store.published();
  const client=new sdk.AccountUserClient({version:4,accountSchema:10,deployment:'account-scale-candidate',chain:'solana:localnet',
    profile:config.profile,rpcUrl,wsUrl,genesis:binding.genesis,anchor,anchorHash:binding.anchorHash,venue:setup.venue,mint:setup.mint.address,domain:binding.domain});
  await client.environment();runtime=new AccountRuntime(databaseUrl,config.runId,rpcUrl,4,'account-scale-candidate');await runtime.open();
  const before=(await indexer.store.snapshot()).state;
  assert.equal(Object.keys(before.identities).length,74);assert.equal(before.members.length,8);
  api=accountServiceApi(runtime);const endpoint=await api.listen({host:'127.0.0.1',port:0});
  running=true;
  loops.push((async()=>{while(running){try{await indexer!.cycle();}catch(error){observations.push({kind:'indexer-recovery',error:String(error)});}await delay(200);}})());
  loops.push((async()=>{while(running){await setup.sample();await delay(400);}})());
  loops.push((async()=>{while(running){for(const request of await runtime!.queue.pending())await runtime!.queue.step(request);await delay(150);}})());
  const normal=()=>until(()=>client.snapshot([setup.roots[0]],'confirmed'),snapshot=>snapshot.marketStates.every(market=>
    sdk.accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot)==='Normal'),'current sources/publications');
  await normal();
  const browser=await liquidityBrowser({directory,client,owner:setup.traderOwner,endpoint,indexer,normal,lifecycle:true,
    registered:async()=>{
      const target=(await client.ownerAccounts(setup.traderOwner.address,1)).accounts.find(([,root])=>root.subaccountIndex===0)![0];
      const state=await sdk.readMarginMembership(client.rpc,setup.venue,setup.traderOwner.address,target);
      const keys=[target,state.registry,state.members,...state.remaining.map(meta=>meta.address),setup.custody,setup.vault];
      const before=await Promise.all(keys.map(key=>h.read(key)));
      const activate=await client.changeMembership(setup.traderOwner.address,target,true);
      const zero=await sdk.getDepositAccountInstructionAsync({...setup.common,owner:setup.traderOwner,margin:target,quoteMint:setup.mint.address,
        userToken:setup.traderToken.address,amount:0n});
      await h.send('atomic activation rolls back when deposit fails',[activate,zero],[setup.traderOwner],sdk.CLEARING_ERROR__AMOUNT);
      assert.deepEqual(await Promise.all(keys.map(key=>h.read(key))),before);
    },
    onSigned:async wire=>{const {signature}=signedWire(wire,1);subscriptions.push({signature,subscription:await ws.call('signatureSubscribe',
      [signature,{commitment:'finalized',enableReceivedNotification:false}])});}});
  const walletWs=[];
  for(const {signature,subscription}of subscriptions){const notification=await ws.notification(subscription);assert.equal(notification.params.result.value.err,null);walletWs.push({signature,notification});}
  running=false;await Promise.all(loops);await flush();
  await until(async()=>{await indexer!.cycle();return indexer!.healthy;},Boolean,'final lifecycle publication');
  const final=await indexer.store.published(),reconciliation=await indexer.reconcile(final);
  const owned=await client.ownerAccounts(setup.traderOwner.address,1);
  assert.deepEqual(owned.accounts.map(([,root])=>root.subaccountIndex),[0,1]);
  assert.deepEqual(owned.retired.map(([,root])=>root.child),[2]);
  assert(owned.accounts.every(([,root])=>root.id>64n));
  assert.equal(final.state.members.length,10);assert.equal(Object.keys(final.state.identities).length,77);
  assert.equal(final.state.custody!.allocatedVault,'10010000');
  assert.equal(getTokenDecoder().decode((await h.read(setup.traderToken.address))!).amount,1_990_000n);
  const readApi=accountApi(indexer);
  try {
    const ownerRead=await readApi.inject(`/v4/portfolios/${setup.traderOwner.address}`);assert.equal(ownerRead.statusCode,200);
    const retired=await readApi.inject(`/v4/accounts/${owned.retired[0][0]}`);assert.equal(retired.statusCode,200);
    assert.equal(retired.json().lifecycle,'Retired');assert.equal(retired.json().admission,'UnavailableRetiredNamespace');
  }finally{await readApi.close();}
  await indexer.store.pool.query('CREATE DATABASE rivalt_p56a2_replay');
  const replayUrl=new URL(databaseUrl);replayUrl.pathname='/rivalt_p56a2_replay';
  replay=new LiquidityIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p56a2-replay'});await replay.open();
  await until(async()=>{await replay!.cycle();return replay!.healthy;},Boolean,'fresh PostgreSQL replay',120);
  assert.deepEqual((await replay.store.published()).state,final.state);
  const events=async(value:LiquidityIndexer)=>(await value.store.pool.query('SELECT sequence::text,signature,bytes FROM events WHERE run_id=$1 ORDER BY sequence',[value.config.runId])).rows;
  const originalEvents=await events(indexer);assert.deepEqual(await events(replay),originalEvents);
  const parity=await conformance.finish(directory,[],h.read);
  writeFileSync(`${directory}/result.json`,json({revision,build,browser,walletWs,checks,observations,reconciliation,parity,
    identities:77,financialMembers:10,registered:76,retired:1,freshReplayEvents:originalEvents.length,
    state:final.state,endTrackedDirty:!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),
    limitations:['internal Wallet Standard signer; no new Phantom/external wallet acceptance','expanded Financial population remains disabled pending P56B','trading accounts retain actual closed/fractional claims; retirement qualifies a collateral-only child']}));
}finally{running=false;await Promise.allSettled(loops);await api?.close();await runtime?.close();await replay?.close();await indexer?.close();try{await flush();}finally{ws.close();}}
