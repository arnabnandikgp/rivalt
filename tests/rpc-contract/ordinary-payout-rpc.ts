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
import {initializationSignature} from './liquidity-journal.js';
import {LiquidityIndexer} from '../../packages/indexer/src/liquidity-indexer.js';
import {accountApi} from '../../packages/indexer/src/account-api.js';
import {eventually} from './wire.js';

const directory=process.env.RIVALT_RUN_DIR!, database=process.env.RIVALT_DATABASE_URL!, url=process.env.RIVALT_RPC_URL!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(url,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:()=>1_000_000});
const SCALE=1_000_000_000n;
const region=[{endLots:4096n,offset:2n,slope:0n},...Array.from({length:7},()=>({endLots:0n,offset:0n,slope:0n}))];
const shape={...goldenShape,skewTick:0n,longCap:4096n,shortCap:4096n,bidCount:1,askCount:1,bids:region,asks:region};
let indexer:LiquidityIndexer|undefined, replay:LiquidityIndexer|undefined;
let api:ReturnType<typeof accountApi>|undefined, runtime:AccountRuntime|undefined;
async function checkpoint(service:LiquidityIndexer) {
  const deadline=performance.now()+180_000;
  do {
    await service.cycle();
    if(service.healthy)return service.store.published();
  } while(performance.now()<deadline);
  throw new Error('Ordinary payout indexer did not publish a reconciled snapshot');
}
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
  const ledgerBalance=async()=>sdk.getMarketLedgerDecoder().decode((await h.read(setup.ledgers[0]))!);
  const startingLedger=await ledgerBalance();
  const initialWallet=await walletBalance(), initialVault=await vaultBalance(), initialCash=(await root(trader)).cash;
  // Independently derived at one lot, symmetric quotes and zero funding premium.
  const buy=60_002n,sell=60_998n,claim=sell-buy,fee=(buy+4_999n)/5_000n+(sell+4_999n)/5_000n;
  const closedCash=initialCash-fee, firstPayment=300n, netProfit=claim-fee;
  const stages:{label:string;cash:bigint;unpaid:bigint;settlement:bigint;wallet:bigint;elapsedMs:number}[]=[];
  const sections:string[]=[], workerReceipts:unknown[]=[];
  let closedAt=0;
  const capture=async(label:string,cash:bigint,unpaid:bigint,settlement:bigint,status:string|null,withdrawn=0n)=>{
    await flush();
    const published=await checkpoint(indexer!);
    assert.equal(published.state.roots[trader].cash,cash.toString(),label);
    assert.equal(published.state.roots[trader].positions[0].virtualScaled,(unpaid*SCALE).toString(),label);
    const read=await api!.inject('/v4/accounts/'+trader);
    assert.equal(read.statusCode,200,label);
    assert.equal(read.json().fundedCash,cash.toString(),label);
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
  const anchor=await initializationSignature(rpc,checks.map(check=>String(check.signature)),setup.deployment.eventAuthority);
  const config={rpcUrl:url,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:database,runId:'ordinary-payout',
    venue:setup.venue,anchor,profile:'liquidity-execution-qualification' as const};
  indexer=new LiquidityIndexer(config);
  await indexer.open();
  api=accountApi(indexer);
  await capture('Closed against maker B',closedCash,claim,0n,'Awaiting loss collection');
  const withdraw=async(amount:bigint)=>sdk.getWithdrawFundedAccountInstruction({...common,owner,margin:trader,
    quoteMint:setup.mint.address,userToken:setup.traderToken.address,amount,guard:await guard(trader)});
  await setup.sample();
  const balances=()=>Promise.all([trader,setup.common.custody,setup.vault,setup.traderToken.address].map(key=>h.read(key)));
  const beforeAttempt=await balances();
  await h.send('reject exit of one unpaid atom',[await withdraw(closedCash+1n)],[owner],sdk.CLEARING_ERROR__ARITHMETIC);
  assert.deepEqual(await balances(),beforeAttempt);
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
  let keeper=new AccountRuntime(database,config.runId,url);
  runtime=keeper;
  await keeper.open();
  for(let step=0;(await root(trader)).positions[0].virtualScaled!==0n;step++) {
    assert(step<12,'remaining ordinary settlement progress');
    await setup.sample();
    await flush();
    await checkpoint(indexer);
    const outcome:AccountWorkerOutcome=await keeper.settle(setup.payer);
    assert.equal(outcome.status,'queued',json(outcome));
    const rows:{request_id:string;signature:string;wire:string}[]=(await keeper.store.pool.query("SELECT request_id,signature,wire FROM service_intents WHERE run_id=$1 AND status='pending'",[keeper.runId])).rows;
    assert.equal(rows.length,1);
    const original=rows[0];
    const subscription=await ws.call('signatureSubscribe',[original.signature,{commitment:'finalized'}]);
    await eventually(async()=>{await keeper.queue.step(original.request_id);return keeper.queue.get(original.request_id);},
      result=>result?.status==='finalized'||result?.status==='failed','ordinary settlement');
    const receipt:{status:string}|null=await keeper.queue.get(original.request_id);
    assert.equal(receipt?.status,'finalized',json(receipt));
    const fetched=await rpc.call('getTransaction',[original.signature,{commitment:'finalized',encoding:'base64',maxSupportedTransactionVersion:1}]);
    assert.equal(fetched.transaction[0],original.wire);
    assert.equal(fetched.meta.err,null);
    assert.equal((await ws.notification(subscription)).params.result.value.err,null);
    workerReceipts.push({reason:outcome.reason,signature:original.signature,cu:fetched.meta.computeUnitsConsumed});
    if(step===0) {
      assert.equal(outcome.reason,'funded-account-loss');
      await keeper.close();
      keeper=new AccountRuntime(database,config.runId,url);
      runtime=keeper;await keeper.open();
      assert.equal((await keeper.queue.get(original.request_id))?.status,'finalized');
    }
  }
  const pool=await ledgerBalance();
  const insuranceNumerator=BigInt(startingLedger.insuranceFeeRemainder)+fee;
  assert.equal(pool.insurance-startingLedger.insurance,insuranceNumerator/4n);
  assert.equal(pool.fees-startingLedger.fees,fee-insuranceNumerator/4n);
  assert.equal(BigInt(pool.insuranceFeeRemainder),insuranceNumerator%4n);
  await capture('Profit funded',closedCash+claim,0n,0n,null);
  assert.equal((await root(first.capital)).positions[0].lots,-1n);
  assert.equal((await root(second.capital)).positions[0].lots,1n);
  assert.equal((await root(first.capital)).cash,originCash-(61_000n-buy));
  await h.send('withdraw net profit to trader wallet',[await withdraw(netProfit)],[owner]);
  await capture('Net profit withdrawn',initialCash,0n,0n,null,netProfit);
  const final=await indexer.store.published();
  const events=async(service:LiquidityIndexer)=>(await service.store.pool.query(
    'SELECT sequence::text,signature,bytes FROM events WHERE run_id=$1 ORDER BY sequence',[service.config.runId])).rows;
  const originals=await events(indexer);
  await indexer.store.pool.query('CREATE DATABASE ordinary_payout_replay');
  const replayUrl=new URL(database);replayUrl.pathname='/ordinary_payout_replay';
  replay=new LiquidityIndexer({...config,databaseUrl:replayUrl.href,runId:'payout-replay'});
  await replay.open();
  assert.deepEqual((await checkpoint(replay)).state,final.state);
  assert.deepEqual(await events(replay),originals);
  const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+
    '<title>Rivalt ordinary payout</title><style>body{font:16px/1.5 system-ui;color:#20303d;margin:2rem auto;max-width:65rem;padding:0 1rem}'+
    'section{border-top:1px solid #aebbc4;overflow:auto;margin-top:2rem}table{border-collapse:collapse;text-align:left}th,td{padding:.45rem;border-bottom:1px solid #ddd}</style>'+
    '<main><h1>Ordinary trader payout</h1><p>One BTC lot opened against internal maker A and closed against internal maker B. '+
    'Both makers kept their positions through withdrawal. Amounts use local test collateral.</p><p>Gross gain '+fixed(claim)+
    ' test USD, fees '+fixed(fee)+', net received '+fixed(netProfit)+'. Each panel uses a finalized account snapshot.</p>'+sections.join('')+'</main></html>';
  writeFileSync(directory+'/payout.html',html);
  writeFileSync(directory+'/payout.json',json({revision,artifactSet:sdk.LIQUIDITY_ARTIFACT_SET,stages,workerReceipts,netProfit,fee,
    checks:checks.filter(check=>/open one|close one|reject exit|collect 300|pay first|withdraw net/.test(String(check.label))),events:originals.length}));
  console.log('Ordinary payout',json({stages,workerReceipts,events:originals.length}));
} finally {
  await api?.close();await runtime?.close();await replay?.close();await indexer?.close();
  try{await flush();}finally{ws.close();}
}
