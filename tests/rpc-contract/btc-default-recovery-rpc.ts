// A signed, one-debtor BTC default. Compare the two rules at the same verified freeze.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {getMintToInstruction, getTokenDecoder} from '@solana-program/token';
import type {Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {financialRoots} from './membership-scan-helper.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {eventually} from './wire.js';

const directory = process.env.RIVALT_RUN_DIR!, url = process.env.RIVALT_RPC_URL!;
const revision = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const {h,rpc,ws,checks,flush} = await openCanonicalRpcHarness(url,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:()=>1_000_000});
let journal: Awaited<ReturnType<typeof openSettlementJournal>> | undefined;
let worker: AccountRuntime | undefined;
try {
  const setup = await liquidityExecutionSetup(h,rpc,{shape:symmetricPayoutShape,makerCash:8_000n,verifyRejections:false});
  const [trader] = setup.roots, owner = setup.traderOwner;
  const first = setup.instances[0], second = setup.instances[2], debtor = first.capital, winner = second.capital;
  assert.notEqual(first.pricingProgram,second.pricingProgram);
  const {route,root,guard} = executionTestHelpers(h,setup);
  const tokenBalance = async (key:Address) => getTokenDecoder().decode((await h.read(key))!).amount;
  const safety = async () => sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!);
  const resolution = async () => sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const ledger = async (key:Address) => sdk.getMarketLedgerDecoder().decode((await h.read(key))!);
  const wallet = setup.traderToken.address;
  // The donor contributes actual tokens. The other six insurance atoms come from the two trading fees.
  await h.send('seed BTC insurance from funded donor',[
    getMintToInstruction({mint:setup.mint.address,token:wallet,mintAuthority:setup.payer,amount:492n}),
    await sdk.getSeedMarketInsuranceInstructionAsync({...setup.common,ledger:setup.ledgers[0],marketIndex:0,
      reserveAuthority:setup.payer,donor:owner,donorToken:wallet,quoteMint:setup.mint.address,amount:492n})],[owner]);
  const vaultBefore = await tokenBalance(setup.vault), walletBefore = await tokenBalance(wallet);
  await setup.sample();
  await h.send('open one BTC lot against the eventual debtor',[await route({actor:owner,trader,marketIndex:0,side:0,
    makers:[first],lots:[1n],allInLimit:60_015n,maxFee:13n})],[owner]);
  setup.sourcePrices.btc = 61_000_000_000n;
  await setup.qualify();
  await h.send('close trader against the open winner',[await route({actor:owner,trader,marketIndex:0,side:1,
    makers:[second],lots:[1n],allInLimit:60_985n,maxFee:13n,reduceOnly:true,generation:(await root(trader)).positions[0].generation})],[owner]);
  const sources = {primaryBtc:setup.feeds[0].feed,primaryCollateral:setup.feeds[1].feed,guardBtc:setup.feeds[2].feed,
    guardCollateral:setup.feeds[3].feed,primaryEth:setup.feeds[4].feed,guardEth:setup.feeds[5].feed};
  setup.sourcePrices.btc = 70_000_000_000n;
  await setup.freshSources();
  await h.send('freeze insolvent BTC maker at verified price',[sdk.getFreezeAccountsInstruction({...setup.safetyCommon,...sources,
    caller:setup.payer,target:debtor,members:(await sdk.deriveMemberPage(setup.venue,(await root(debtor)).id/64n))[0],
    safetyEpoch:(await safety()).epoch,resolutionEpoch:(await resolution()).epoch,emergency:false})]);
  await flush();
  const frozen = await resolution();
  assert.equal(frozen.stage,2);
  const members = await financialRoots(h,setup.venue,setup.registry);
  assert.equal(members.length,8);
  assert.equal(frozen.count,BigInt(members.length));
  const rows = await Promise.all(members.map(async key=>{
    const value = await root(key);
    assert.equal(value.positions[1].lots,0n);
    return {key,id:value.id,cash:value.cash,btcLots:value.positions[0].lots,claims:value.positions.map((position,index)=>
      position.lots*frozen.prices[index]*1_000_000_000n+position.virtualScaled-position.lots*(frozen.funding[index]-position.fundingCheckpointScaled))};
  }));
  assert.equal((await root(trader)).cash,999_974n);
  journal = await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)));
  const events = journal.initialEvents, freezes = events.filter(event=>event.type==='AccountResolutionFrozenV3');
  assert.equal(freezes.length,1);
  const cutoff = freezes[0];
  assert.equal(cutoff.data.trigger,debtor);
  assert.equal(cutoff.data.emergency,false);
  assert.deepEqual(cutoff.data.prices,frozen.prices.map(String));
  const history = events.slice(0,events.indexOf(cutoff));
  assert(!history.some(event=>event.type==='AccountFinancialChangedV3'&&[2,3].includes(event.data.kind)));
  const fills = history.filter(event=>event.type==='LiquidityRouteExecutedV4').map(({signature,data})=>{
    assert.equal(data.market,setup.markets[0]);
    assert.equal(data.fee,'13');
    assert.equal(data.legs.length,1);
    const [leg] = data.legs;
    return {signature,side:data.side,maker:leg.capital,traderId:data.rootStates[0].id,lots:leg.lots,gross:leg.gross};
  });
  const inputs = {rows,debtor,winner,trader,mark:frozen.prices[0],funding:frozen.funding,pools:frozen.poolsBefore,
    fees:frozen.feesBefore,insurance:frozen.insuranceBefore,fills};
  const comparison = JSON.parse(execFileSync('python3',['tests/financial/btc_default_comparison.py'],{input:json(inputs),encoding:'utf8'}));
  await journal.checkpoint('frozen',true);
  const openWorker = async () => {
    const runtime = new AccountRuntime(process.env.RIVALT_DATABASE_URL!,'p55b2-application',url);
    await runtime.open();
    return runtime;
  };
  worker = await openWorker();
  const originals: {requestId:string; signature:string; cu:number}[] = [];
  while ((await resolution()).stage!==11) {
    assert(originals.length<128,'Eight-member BTC recovery exceeded its continuation budget');
    const outcome = await worker.riskWork(setup.payer);
    assert.equal(outcome.status,'queued',json(outcome));
    const pending: {request_id:string; signature:string; wire:string}[] = (await worker.store.pool.query(
      "SELECT request_id,signature,wire FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[worker.runId])).rows;
    assert.equal(pending.length,1);
    const [original] = pending;
    const subscription = await ws.call('signatureSubscribe',[original.signature,{commitment:'finalized'}]);
    await eventually(async ()=>{
      await worker!.queue.step(original.request_id);
      return worker!.queue.get(original.request_id);
    },receipt=>['finalized','failed'].includes(receipt?.status),'finalized BTC default continuation');
    assert.equal((await worker.queue.get(original.request_id)).status,'finalized');
    assert.equal((await ws.notification(subscription)).params.result.value.err,null);
    const fetched = await rpc.call('getTransaction',[original.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(fetched.transaction[0],original.wire);
    assert.equal(fetched.meta.err,null);
    originals.push({signature:original.signature,requestId:original.request_id,cu:fetched.meta.computeUnitsConsumed});
    if (originals.length===1) {
      await worker.close();
      worker = await openWorker();
      assert.equal((await worker.queue.get(original.request_id)).status,'finalized');
    }
  }
  assert(originals.length>1);
  const terminal = await resolution();
  assert.deepEqual(terminal.insuranceSpent,[498n,0n]);
  const finalCash = Object.fromEntries(await Promise.all(members.map(async key=>{
    const value = await root(key);
    assert(value.positions.every(position=>position.lots===0n && position.virtualScaled===0n));
    return [key,String(value.cash)];
  })));
  assert.deepEqual(finalCash,comparison.onchainExpectedCash);
  const ledgers = await Promise.all(setup.ledgers.map(ledger));
  assert.deepEqual(ledgers.map(value=>[value.insurance,value.settlement,value.fees]),[[0n,0n,20n],[0n,0n,0n]]);
  assert.equal(await tokenBalance(setup.vault),vaultBefore);
  await journal.checkpoint('cash-distributed',true);
  const paid = BigInt(finalCash[trader])-999_974n;
  assert.equal(paid,847n);
  await h.send('withdraw funded BTC recovery to trader wallet',[sdk.getWithdrawFundedAccountInstruction({...setup.common,
    btc:setup.markets[0],eth:setup.markets[1],owner,margin:trader,quoteMint:setup.mint.address,userToken:wallet,
    guard:await guard(trader),amount:paid})],[owner]);
  assert.equal(await tokenBalance(wallet),walletBefore+paid);
  assert.equal(await tokenBalance(setup.vault),vaultBefore-paid);
  setup.sourcePrices.btc = 60_000_000_000n;
  for(let observation=0;observation<4;observation++) {
    await setup.waitUntil(await setup.now()+2n);
    await setup.fresh();
    await h.send('observe sustained source recovery',[sdk.getRecoverAccountsInstruction({...setup.safetyCommon,...sources,
      caller:setup.payer,epoch:frozen.epoch,resume:false})]);
  }
  await h.send('resume custody after BTC default',[sdk.getRecoverAccountsInstruction({...setup.safetyCommon,...sources,
    caller:setup.payer,epoch:frozen.epoch,resume:true})]);
  await flush();
  assert.equal((await safety()).mode,0);
  await journal.checkpoint('withdrawn-and-recovered',true);
  const replay = await journal.finish();
  assert.equal(replay.state.roots[trader].cash,'999974');
  const summary = {revision,artifactSet:replay.binding.artifactSet,inputs,freeze:cutoff.signature,comparison,finalCash,
    paid,walletBefore,walletAfter:await tokenBalance(wallet),vaultBefore,vaultAfter:await tokenBalance(setup.vault),
    insuranceSpent:terminal.insuranceSpent,originals,events:replay.events,signedHarnessChecks:checks.length};
  writeFileSync(directory+'/btc-default-recovery.json',json(summary));
  console.log('BTC default recovery',json({paid,events:replay.events,continuations:originals.length,harnessChecks:checks.length}));
} finally {
  await worker?.close();await journal?.close();
  try {await flush();} finally {ws.close();}
}
