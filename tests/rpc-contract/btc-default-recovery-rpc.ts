// A signed, one-debtor BTC default. Compare the two rules at the same verified freeze.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {getMintToInstruction, getTokenDecoder} from '@solana-program/token';
import type {Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {readAccountResolution,accountDefaultContext} from '../../packages/services/src/account-worker-state.js';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {financialRoots} from './membership-scan-helper.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {eventually} from './wire.js';
import {verifyProfitBuild} from './profit-attribution-build.js';

const directory = process.env.RIVALT_RUN_DIR!, url = process.env.RIVALT_RPC_URL!;
const revision = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const {h,rpc,ws,checks,flush} = await openCanonicalRpcHarness(url,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:()=>1_000_000});
let journal: Awaited<ReturnType<typeof openSettlementJournal>> | undefined;
let worker: AccountRuntime | undefined;
async function run() {
  const probe=process.env.RIVALT_SETTLEMENT_PROBE??'';
  const allocation=probe.startsWith('profit-attribution-btc-allocation-'),tie=probe.endsWith('-tie');
  const residual=probe.startsWith('profit-attribution-btc-residual-');
  const scenario=allocation?(tie?'equal':'unequal'):residual?probe.slice('profit-attribution-btc-residual-'.length):'full';
  assert(['full','partial','multi','none','equal','unequal'].includes(scenario),'Unknown BTC payout scenario');
  const limited=probe==='profit-attribution-verified-pair-limited';
  const paired=allocation||residual||limited||probe==='profit-attribution-verified-pair';
  const sponsored=paired||probe==='profit-attribution-sponsor-recovery';
  const candidate=(sponsored||probe==='profit-attribution-recovery')
    ?verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,sponsored,paired,residual,allocation):undefined;
  const multi=scenario==='multi',lots=multi?3n:1n,makerCash=allocation?(tie?18_498n:16_000n):multi?27_000n:8_000n;
  const closeMid=limited||scenario==='partial'?69_500n:multi?69_000n:scenario==='none'?70_002n:61_000n;
  const openGross=60_002n*lots,closeGross=(closeMid-2n)*lots;
  const openFee=(openGross+4_999n)/5_000n,closeFee=(closeGross+4_999n)/5_000n;
  const fees=openFee+closeFee+(allocation?13n:0n),protectedFees=fees-fees/4n,initialCash=1_000_000n-openFee-closeFee;
  const setup=await liquidityExecutionSetup(h,rpc,{marginLayout:sponsored?'sponsored-profit':candidate?'profit-attribution':'selected',
    shape:symmetricPayoutShape,makerCash,verifyRejections:false});
  const [trader] = setup.roots, owner = setup.traderOwner;
  const first = setup.instances[0], second = setup.instances[2], debtor = first.capital, winner = second.capital;
  assert.notEqual(first.pricingProgram,second.pricingProgram);
  const {route,root,guard} = executionTestHelpers(h,setup);
  const tokenBalance = async (key:Address) => getTokenDecoder().decode((await h.read(key))!).amount;
  const safety = async () => sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!);
  const resolution = async () => sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const ledger = async (key:Address) => sdk.getMarketLedgerDecoder().decode((await h.read(key))!);
  const lamports=async(key:Address)=>BigInt((await rpc.call('getBalance',[key,{commitment:'confirmed'}])).value);
  const contributor=setup.primary;
  const initialSponsor=sponsored?await lamports(contributor.address):0n;
  let rentCredit=0n;
  if(sponsored) {
    const size=(await h.read(winner))!.length+40+2*(256-128);
    rentCredit=BigInt(await rpc.call('getMinimumBalanceForRentExemption',[size]))-await lamports(winner);
    await h.send('sponsor winning maker through default',[await sdk.getManageProfitCapacityInstructionAsync({...setup.common,
      margin:winner,actor:setup.owner,payer:contributor,previousContributor:setup.owner.address,slotBytes:256,
      revision:(await root(winner)).revision,maxPayment:rentCredit})],[setup.owner,contributor]);
    assert.equal(await lamports(contributor.address),initialSponsor-rentCredit);
  }
  const wallet = setup.traderToken.address;
  // The donor contributes actual tokens. The other six insurance atoms come from the two trading fees.
  await h.send('seed BTC insurance from funded donor',[
    getMintToInstruction({mint:setup.mint.address,token:wallet,mintAuthority:setup.payer,amount:492n}),
    await sdk.getSeedMarketInsuranceInstructionAsync({...setup.common,ledger:setup.ledgers[0],marketIndex:0,
      reserveAuthority:setup.payer,donor:owner,donorToken:wallet,quoteMint:setup.mint.address,amount:492n})],[owner]);
  const vaultBefore = await tokenBalance(setup.vault), walletBefore = await tokenBalance(wallet);
  await setup.sample();
  await h.send('open BTC against the eventual debtor',[await route({actor:owner,trader,marketIndex:0,side:0,
    makers:[first],lots:[lots],allInLimit:openGross+openFee,maxFee:openFee})],[owner]);
  if(allocation) {
    if(tie){setup.sourcePrices.btc=60_996_000_000n;await setup.qualify();}
    const gross=tie?60_998n:60_002n;
    await h.send('independent second BTC account takes the other lot against the debtor',[
      await route({actor:owner,trader:setup.roots[1],marketIndex:0,side:0,makers:[first],lots:[1n],allInLimit:gross+13n,maxFee:13n})],[owner]);
  }
  setup.sourcePrices.btc = closeMid*1_000_000n;
  await setup.qualify();
  await h.send('close trader against the open winner',[await route({actor:owner,trader,marketIndex:0,side:1,
    makers:[second],lots:[lots],allInLimit:closeGross-closeFee,maxFee:closeFee,reduceOnly:true,generation:(await root(trader)).positions[0].generation})],[owner]);
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
  assert.equal((await root(trader)).cash,initialCash);
  journal = await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),candidate);
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
    assert.equal(data.fee,String(data.side===0?openFee:closeFee));
    assert.equal(data.legs.length,1);
    const [leg] = data.legs;
    return {signature,side:data.side,maker:leg.capital,traderId:data.rootStates[0].id,lots:leg.lots,gross:leg.gross};
  });
  const inputs = {case:scenario,rows,debtor,winner,trader,otherWinner:setup.roots[1],venue:setup.venue,epoch:frozen.epoch,mark:frozen.prices[0],funding:frozen.funding,pools:frozen.poolsBefore,
    fees:frozen.feesBefore,insurance:frozen.insuranceBefore,fills};
  const comparison = limited?undefined:JSON.parse(execFileSync('python3',[allocation?'tests/financial/btc_allocation_comparison.py':'tests/financial/btc_default_comparison.py'],{input:json(inputs),encoding:'utf8'}));
  if(candidate) {
    for(const row of rows) {
      const {positions}=sdk.decodeProfitAttribution((await h.read(row.key))!,sponsored);
      const entry=row.key===winner?closeMid-2n:row.key===debtor?(allocation&&tie?60_500n:60_002n):
        allocation&&row.key===setup.roots[1]?(tie?60_998n:60_002n):0n;
      assert.deepEqual(positions[0],{entryScaled:entry*1_000_000_000n,paidScaled:0n,denominator:1n});
    }
  }
  await journal.checkpoint('frozen',true);
  const openWorker = async () => {
    const runtime = new AccountRuntime(process.env.RIVALT_DATABASE_URL!,'p55b2-application',url,4,allocation?'btc-allocation-candidate':residual?'btc-residual-candidate':paired?'verified-pair-candidate':sponsored?'sponsored-profit-candidate':candidate?'profit-attribution-candidate':'selected');
    await runtime.open();
    return runtime;
  };
  if(paired)process.env.RIVALT_DEFAULT_BATCH_STEPS=residual?'32':'1';
  worker = await openWorker();
  let exercisedPair=false;
  const originals: {requestId:string; signature:string; cu:number}[] = [];
  while ((await resolution()).stage!==11) {
    assert(originals.length<128,'Eight-member BTC recovery exceeded its continuation budget');
    if(paired&&!residual&&!allocation&&!exercisedPair) {
      const current=await readAccountResolution(worker.rpc,setup.venue),prepared=current.preparedState;
      if(prepared.epoch===frozen.epoch&&prepared.stage===4) {
        const common=await accountDefaultContext(worker.rpc,current);
        const debtorOrdinal=BigInt(members.indexOf(debtor)),winnerOrdinal=BigInt(members.indexOf(winner));
        const [page]=await sdk.deriveFrozenMarginPage(setup.venue,debtorOrdinal/8n);
        const args={...common,epoch:frozen.epoch,revision:prepared.revision,debtorOrdinal,winnerOrdinal,
          debtorPage:page,winnerPage:undefined,debtor,winner};
        const checkpoint=()=>Promise.all([common.prepared,debtor,winner,setup.vault].map(key=>h.read(key)));
        const original=await checkpoint();
        await h.send('reject substituting the flat creditor for the winning position',[sdk.getVerifyFrozenPairInstruction({
          ...args,winner:trader})],[],sdk.CLEARING_ERROR__RESOLUTION);
        await h.send('reject proportional progression before the BTC pair is verified',[
          sdk.getAcceptDenominatorRowInstruction({...common,epoch:frozen.epoch,revision:prepared.revision,page})
        ],[],sdk.CLEARING_ERROR__RESOLUTION);
        assert.deepEqual(await checkpoint(),original);
        if(limited) {
          // Independent economics for the 69,498 last buy: the only winner has
          // 502 atoms eligible against 9,998 debt less 8,000 cash and 498 insurance.
          const debtorRow=rows.find(row=>row.key===debtor)!,winnerRow=rows.find(row=>row.key===winner)!;
          assert.equal(-debtorRow.claims[0]/1_000_000_000n-debtorRow.cash-frozen.insuranceBefore[0],1_500n);
          assert.equal(winnerRow.claims[0]/1_000_000_000n,502n);
          await h.send('reject 502 eligible atoms against 1500 required',[sdk.getVerifyFrozenPairInstruction(args)],[],sdk.CLEARING_ERROR__RESOLUTION);
          assert.deepEqual(await checkpoint(),original);
          await flush();await journal.checkpoint('incomplete-pair-remains-frozen',true);
          const recovered=await journal.finish();assert.equal(recovered.state.safety?.mode,2);
          assert.equal(await tokenBalance(wallet),walletBefore);assert.equal(await tokenBalance(setup.vault),vaultBefore);
          writeFileSync(directory+'/limited-pair.json',json({revision,eligible:502,shortfall:1500,events:recovered.events,
            originals:originals.length,checks:checks.length,stage:prepared.stage}));
          console.log('Insufficient pair remained frozen',json({checks:checks.length,events:recovered.events,originals:originals.length}));
          return;
        }
        exercisedPair=true;
        await worker.close();process.env.RIVALT_DEFAULT_BATCH_STEPS='8';worker=await openWorker();
      }
    }
    if(allocation&&!exercisedPair) {
      const current=await readAccountResolution(worker.rpc,setup.venue),prepared=current.preparedState;
      if(prepared.epoch===frozen.epoch&&prepared.stage===4){
        const common=await accountDefaultContext(worker.rpc,current);
        const ix=async(index:number,cutoff:bigint[]|null)=>{
          const fresh=await readAccountResolution(worker!.rpc,setup.venue);
          return sdk.getAdvanceBtcAllocationInstruction({...common,epoch:frozen.epoch,revision:fresh.preparedState.revision,
            ordinal:BigInt(index),margin:members[index],page:(await sdk.deriveFrozenMarginPage(setup.venue,BigInt(index)/8n))[0],cutoff});
        };
        await h.send('reject a solvent root as sole debtor',[await ix(members.indexOf(winner),[0n,0n,0n,0n])],[],sdk.CLEARING_ERROR__RESOLUTION);
        await h.send('propose a zero-charge cutoff for a funded shortfall',[await ix(members.indexOf(debtor),[0n,0n,0n,0n])]);
        await h.send('reject skipping the first frozen row',[await ix(1,null)],[],sdk.CLEARING_ERROR__RESOLUTION);
        for(const index of members.keys())await h.send('scan under-recovering cutoff '+index,[await ix(index,null)]);
        const rejected=await readAccountResolution(worker.rpc,setup.venue);
        assert.equal(rejected.preparedState.stage,4);assert.equal(rejected.header.stage,2);
        assert.equal(await tokenBalance(wallet),walletBefore);assert.equal(await tokenBalance(setup.vault),vaultBefore);
        await flush();await journal.checkpoint('under-recovering-allocation-rejected',true);
        exercisedPair=true;
      } else if(prepared.stage===5){throw new Error('Unexpected allocation scan before rejection test');}
    }
    const outcome:Awaited<ReturnType<AccountRuntime['riskWork']>> = await worker.riskWork(setup.payer);
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
    const justScored=allocation&&exercisedPair&&(await readAccountResolution(worker.rpc,setup.venue)).preparedState;
    const midway=justScored&&justScored.stage===5&&sdk.btcAllocationReceipt(justScored)?.cursor===2n;
    if (originals.length===1||midway) {
      if(midway)process.env.RIVALT_DEFAULT_BATCH_STEPS='32';
      await worker.close();
      worker = await openWorker();
      assert.equal((await worker.queue.get(original.request_id)).status,'finalized');
    }
  }
  assert(originals.length>1);
  const terminal = await resolution();
  assert.deepEqual(terminal.insuranceSpent,[492n+fees/4n,0n]);
  const finalCash = Object.fromEntries(await Promise.all(members.map(async key=>{
    const value = await root(key);
    assert(value.positions.every(position=>position.lots===0n && position.virtualScaled===0n));
    if(candidate)assert(sdk.decodeProfitAttribution((await h.read(key))!,sponsored).positions.every(slot=>slot.entryScaled===0n&&slot.paidScaled===0n));
    return [key,String(value.cash)];
  })));
  assert.deepEqual(finalCash,paired?comparison.successorModelCash:comparison.onchainExpectedCash);
  if(allocation) {
    assert(exercisedPair);
    const prepared=(await readAccountResolution(worker.rpc,setup.venue)).preparedState;
    const receipt=sdk.btcAllocationReceipt(prepared);
    assert(receipt?.committed);assert.equal(receipt.recovered,BigInt(comparison.winnerCharge));
    const page=sdk.getBtcAllocationPageDecoder().decode((await h.read((await sdk.deriveFrozenMarginPage(setup.venue,0n))[0]))!);
    assert.deepEqual(Object.fromEntries(page.rows.map(row=>[row.member,String(row.btcCharge)])),comparison.charges);
  } else if(paired) {
    assert(residual||exercisedPair);
    const current=await readAccountResolution(worker.rpc,setup.venue);
    const receipt=sdk.frozenPairReceipt(current.preparedState);
    assert.deepEqual(receipt,{epoch:frozen.epoch,debtorId:(await root(debtor)).id,winnerId:(await root(winner)).id,
      charge:BigInt(comparison.winnerCharge),price:BigInt(comparison.forcedClosePrice),unpaidGainCap:(70_000n-closeMid+2n)*lots,
      ...(residual?{matchedLots:BigInt(comparison.matchedLots),extraTickLots:BigInt(comparison.extraTickLots)}:{})});
  }
  const ledgers = await Promise.all(setup.ledgers.map(ledger));
  assert.deepEqual(ledgers.map(value=>[value.insurance,value.settlement,value.fees]),[[0n,0n,protectedFees],[0n,0n,0n]]);
  assert.equal(await tokenBalance(setup.vault),vaultBefore);
  await journal.checkpoint('cash-distributed',true);
  const paid = BigInt(finalCash[trader])-initialCash;
  assert.equal(paid,paired?BigInt(comparison.flatPayout):847n);
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
  if(sponsored) {
    const credited=sdk.decodeProfitAttribution((await h.read(winner))!,true);
    assert.deepEqual(credited.credit,{contributor:contributor.address,lamports:rentCredit});
    await h.send('refund surviving sponsor principal after default',[await sdk.getManageProfitCapacityInstructionAsync({
      ...setup.common,margin:winner,actor:setup.owner,payer:setup.owner,previousContributor:contributor.address,slotBytes:128,
      revision:credited.root.revision,maxPayment:0n})],[setup.owner]);
    assert.equal(await lamports(contributor.address),initialSponsor);
    assert.equal(sdk.decodeProfitAttribution((await h.read(winner))!,true).credit,null);
  }
  await flush();
  assert.equal((await safety()).mode,0);
  await journal.checkpoint('withdrawn-and-recovered',true);
  const replay = await journal.finish();
  assert.equal(replay.state.roots[trader].cash,String(initialCash));
  const summary = {revision,artifactSet:replay.binding.artifactSet,inputs,freeze:cutoff.signature,comparison,finalCash,
    paid,walletBefore,walletAfter:await tokenBalance(wallet),vaultBefore,vaultAfter:await tokenBalance(setup.vault),
    insuranceSpent:terminal.insuranceSpent,originals,events:replay.events,signedHarnessChecks:checks.length};
  writeFileSync(directory+'/btc-default-recovery.json',json(summary));
  console.log('BTC default recovery',json({paid,events:replay.events,continuations:originals.length,harnessChecks:checks.length}));
}
try {await run();} finally {
  await worker?.close();await journal?.close();
  try {await flush();} finally {ws.close();}
}
