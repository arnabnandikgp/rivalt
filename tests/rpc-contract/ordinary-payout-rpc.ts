// Normal clearing and worker paths, using explicitly internal makers and test collateral.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {getTokenDecoder} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {renderPayoutPositions} from '../../apps/trader/tests/ordinary-payout-view.js';
import {fixed} from '../../apps/trader/src/amount.js';
import {AccountRuntime,type AccountWorkerOutcome} from '../../packages/services/src/account-runtime.js';
import {json} from '../../packages/indexer/src/events.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {goldenShape} from './canonical-maker-cases.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {backingStep} from './membership-scan-helper.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {eventually} from './wire.js';

const directory=process.env.RIVALT_RUN_DIR!, database=process.env.RIVALT_DATABASE_URL!, url=process.env.RIVALT_RPC_URL!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(url,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:()=>1_000_000});
const SCALE=1_000_000_000n;
const region=[{endLots:4096n,offset:2n,slope:0n},...Array.from({length:7},()=>({endLots:0n,offset:0n,slope:0n}))];
const shape={...goldenShape,skewTick:0n,longCap:4096n,shortCap:4096n,bidCount:1,askCount:1,bids:region,asks:region};
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined, runtime:AccountRuntime|undefined;
try {
  const setup=await liquidityExecutionSetup(h,rpc,{shape,verifyRejections:false});
  const [trader]=setup.roots, owner=setup.traderOwner, first=setup.instances[0], second=setup.instances[2];
  assert.notEqual(first.pricingProgram,second.pricingProgram);
  assert.notEqual(first.capital,second.capital);
  const {route,root,guard}=executionTestHelpers(h,setup);
  const common={...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  const [certificate]=await sdk.deriveSettlementCertificate(setup.venue,0);
  const proofCommon={...common,certificate,ledger:setup.ledgers[0]};
  const proof=async()=>sdk.getSettlementCertificateDecoder().decode((await h.read(certificate))!);
  const walletBalance=async()=>getTokenDecoder().decode((await h.read(setup.traderToken.address))!).amount;
  const vaultBalance=async()=>getTokenDecoder().decode((await h.read(setup.vault))!).amount;
  const initialWallet=await walletBalance(), initialVault=await vaultBalance(), initialCash=(await root(trader)).cash;
  // Independently derived at one lot, symmetric quotes and zero funding premium.
  const buy=60_002n,sell=60_998n,claim=sell-buy,fee=(buy+4_999n)/5_000n+(sell+4_999n)/5_000n;
  const closedCash=initialCash-fee, firstPayment=300n, netProfit=claim-fee;
  const stages:{label:string;cash:bigint;unpaid:bigint;settlement:bigint;wallet:bigint;elapsedMs:number}[]=[];
  const sections:string[]=[], workerReceipts:unknown[]=[];
  let closedAt=0;
  const capture=async(label:string,cash:bigint,unpaid:bigint,settlement:bigint,status:string|null,withdrawn=0n)=>{
    await flush();
    await journal!.checkpoint(label,true);
    const snapshot=await sdk.readAccountSnapshot(rpc,setup.identity,[trader],'finalized');
    const account=snapshot.roots[trader];
    const view=sdk.accountBalanceView(account,snapshot.safetyState,snapshot.marketStates,snapshot.now,snapshot.slot);
    const position=view.positions[0], ledger=snapshot.ledgerStates[0];
    assert.equal(account.cash,cash,label);
    assert.equal(position.lots,'0',label);
    assert.equal(position.unpaidClaimScaled,(unpaid*SCALE).toString(),label);
    assert.equal(ledger.settlement,settlement,label);
    assert.equal(sdk.closedGainStatus(position,ledger.settlement,snapshot.safetyState),status);
    const wallet=await walletBalance();
    assert.equal(wallet,initialWallet+withdrawn,label);
    assert.equal(await vaultBalance(),initialVault-withdrawn,label);
    const html=renderPayoutPositions(snapshot,view);
    if(status)assert(html.includes(status),label);
    assert(html.includes(fixed(unpaid*SCALE,15)));
    sections.push('<section><h2>'+label+'</h2><p>Funded cash '+fixed(cash)+' test USD · wallet '+fixed(wallet)+' test USD</p>'+html+'</section>');
    stages.push({label,cash,unpaid,settlement,wallet,elapsedMs:Math.round(performance.now()-closedAt)});
  };
  const originCash=(await root(first.capital)).cash;
  await setup.sample();
  await h.send('open one BTC lot against maker A',[await route({actor:owner,trader,marketIndex:0,side:0,
    makers:[first],lots:[1n],allInLimit:buy+13n,maxFee:13n})],[owner]);
  assert.equal((await root(trader)).positions[0].virtualScaled,-buy*SCALE);
  assert.equal((await root(first.capital)).positions[0].lots,-1n);
  setup.sourcePrices.btc=61_000_000_000n;
  await setup.qualify();
  await h.send('close one BTC lot against maker B',[await route({actor:owner,trader,marketIndex:0,side:1,
    makers:[second],lots:[1n],allInLimit:sell-13n,maxFee:13n,reduceOnly:true,generation:(await root(trader)).positions[0].generation})],[owner]);
  closedAt=performance.now();
  await flush();
  const build={artifactSet:sdk.LIQUIDITY_ARTIFACT_SET,artifacts:Object.fromEntries(sdk.LIQUIDITY_ARTIFACTS.map(item=>[item.name,item]))};
  journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  await capture('Closed against maker B',closedCash,claim,0n,'Awaiting loss collection');
  // Deliberately collect only part of maker A's fully funded open-position loss.
  await setup.sample();
  await h.send('collect 300 atoms from open maker A',[sdk.getCollectAccountLossInstruction({...common,
    actor:setup.payer,margin:first.capital,marketIndex:0,amount:firstPayment})]);
  assert.equal((await root(first.capital)).cash,originCash-firstPayment);
  assert.equal((await root(first.capital)).positions[0].lots,-1n);
  await capture('First collection',closedCash,claim,firstPayment,'Market pool covers part of this claim');
  await h.send('initialize market backing',[sdk.getInitializeMarketBackingInstruction({...setup.common,payer:setup.payer,certificate,marketIndex:0})]);
  for(let pages=0;!(await proof()).complete;pages++) {
    assert(pages<60,'ordinary eight-member backing traversal');
    if(pages%4===0)await setup.sample();
    const next=await backingStep(h,proofCommon,pages===0);
    await h.send('verify backing '+pages,[next.instruction]);
  }
  await setup.sample();
  await h.send('pay first 300 atoms to trader',[sdk.getPayAccountGainInstruction({...common,actor:setup.payer,margin:trader,
    certificate,marketIndex:0,amount:firstPayment})]);
  await capture('Part paid',closedCash+firstPayment,claim-firstPayment,0n,'Awaiting loss collection');
  // A fresh ordinary worker discovers the remaining open maker loss from published SQL.
  runtime=new AccountRuntime(database,'p55b2-application',url);
  await runtime.open();
  for(let step=0;(await root(trader)).positions[0].virtualScaled!==0n;step++) {
    assert(step<12,'remaining ordinary settlement progress');
    await setup.sample();
    await flush();
    await journal.checkpoint('worker-'+step,true);
    const outcome:AccountWorkerOutcome=await runtime.settle(setup.payer);
    assert.equal(outcome.status,'queued',json(outcome));
    const {rows}:{rows:{request_id:string;signature:string;wire:string}[]}=await runtime.store.pool.query("SELECT request_id,signature,wire FROM service_intents WHERE run_id=$1 AND status='pending'",[runtime.runId]);
    assert.equal(rows.length,1);
    const original=rows[0];
    const subscription=await ws.call('signatureSubscribe',[original.signature,{commitment:'finalized'}]);
    await eventually(async()=>{await runtime!.queue.step(original.request_id);return runtime!.queue.get(original.request_id);},
      result=>result?.status==='finalized'||result?.status==='failed','ordinary settlement');
    const receipt=await runtime.queue.get(original.request_id);
    assert.equal(receipt?.status,'finalized',json(receipt));
    const fetched=await rpc.call('getTransaction',[original.signature,{commitment:'finalized',encoding:'base64',maxSupportedTransactionVersion:1}]);
    assert.equal(fetched.transaction[0],original.wire);
    assert.equal(fetched.meta.err,null);
    assert.equal((await ws.notification(subscription)).params.result.value.err,null);
    workerReceipts.push({reason:outcome.reason,signature:original.signature,cu:fetched.meta.computeUnitsConsumed});
  }
  const pool=sdk.getMarketLedgerDecoder().decode((await h.read(setup.ledgers[0]))!);
  await capture('Profit funded',closedCash+claim,0n,pool.settlement,null);
  assert.equal((await root(first.capital)).positions[0].lots,-1n);
  assert.equal((await root(second.capital)).positions[0].lots,1n);
  assert.equal((await root(first.capital)).cash,originCash-(61_000n-buy));
  await h.send('withdraw net profit to trader wallet',[sdk.getWithdrawFundedAccountInstruction({...common,owner,margin:trader,
    quoteMint:setup.mint.address,userToken:setup.traderToken.address,amount:netProfit,guard:await guard(trader)})],[owner]);
  await capture('Net profit withdrawn',initialCash,0n,pool.settlement,null,netProfit);
  const replay=await journal.finish();
  assert.equal(replay.state.roots[trader].cash,initialCash.toString());
  const html='<!doctype html><html lang="en"><meta charset="utf-8"><title>Rivalt ordinary payout</title><main><h1>Ordinary trader payout</h1>'+
    '<p>Finalized local test transactions. One BTC lot opened against maker A and closed against maker B.</p>'+sections.join('')+'</main></html>';
  writeFileSync(directory+'/payout.html',html);
  writeFileSync(directory+'/payout.json',json({revision,artifactSet:build.artifactSet,stages,workerReceipts,netProfit,fee,
    checks:checks.filter(check=>/open one|close one|collect 300|pay first|withdraw net/.test(String(check.label))),events:replay.events}));
  console.log('Ordinary payout',json({stages,workerReceipts,events:replay.events}));
} finally {
  await runtime?.close();await journal?.close();
  try{await flush();}finally{ws.close();}
}
