// Compare approved joint recovery with a real frozen cross debtor and two isolated makers.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {getTokenDecoder} from '@solana-program/token';
import {getAddressEncoder} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {accountDefaultContext, readAccountResolution} from '../../packages/services/src/account-worker-state.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {financialRoots} from './membership-scan-helper.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {verifyProfitBuild} from './profit-attribution-build.js';
import {eventually} from './wire.js';

const directory = process.env.RIVALT_RUN_DIR!, url = process.env.RIVALT_RPC_URL!;
const revision = execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const gated = process.env.RIVALT_SETTLEMENT_PROBE === 'profit-attribution-btc-allocation-linked';
const probe = process.env.RIVALT_SETTLEMENT_PROBE;
const allocationProfile = probe === 'profit-attribution-linked-allocation';
const contested = allocationProfile || probe === 'profit-attribution-linked-contested';
const flatCreditor = contested || probe === 'profit-attribution-linked-flat' || probe === 'profit-attribution-linked-flat-apply';
const linked = contested || probe === 'profit-attribution-linked-apply' || probe === 'profit-attribution-linked-flat-apply';
const selection = allocationProfile ? 'linked-allocation-candidate' : linked ? (flatCreditor ? 'linked-flat-candidate' : 'linked-pair-candidate') :
  gated ? 'btc-allocation-candidate' : 'profit-attribution-candidate';
const build = verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,gated,gated,gated,gated,allocationProfile ? 'allocation' : linked && flatCreditor ? 'flat' : linked);
const {h,rpc,ws,checks,flush} = await openCanonicalRpcHarness(url,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:()=>1_000_000});
let journal: Awaited<ReturnType<typeof openSettlementJournal>> | undefined;
let worker: AccountRuntime | undefined;
try {
  const makerDeposit = 1_000_000n;
  const setup = await liquidityExecutionSetup(h,rpc,{marginLayout:gated||linked?'sponsored-profit':'profit-attribution',
    shape:symmetricPayoutShape, traderCash:contested?30_000n:flatCreditor?19_996n:20_012n, makerCash:makerDeposit,verifyRejections:false});
  const {guard,route,root} = executionTestHelpers(h,setup);
  const [debtor,otherTrader] = setup.roots;
  const makers = [setup.instances[0], setup.instances[3]];
  const sources = {primaryBtc:setup.feeds[0].feed,primaryCollateral:setup.feeds[1].feed,guardBtc:setup.feeds[2].feed,
    guardCollateral:setup.feeds[3].feed,primaryEth:setup.feeds[4].feed,guardEth:setup.feeds[5].feed};
  const safety = async () => sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!);
  const resolution = async () => sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const wallet = async () => getTokenDecoder().decode((await h.read(setup.token.address))!).amount;
  const traderWallet = async () => getTokenDecoder().decode((await h.read(setup.traderToken.address))!).amount;
  const vault = async () => getTokenDecoder().decode((await h.read(setup.vault))!).amount;
  const before = {wallet:await wallet(),traderWallet:await traderWallet(),vault:await vault()};
  for (const market of [0,1] as const) {
    await setup.sample();
    const gross = market===0 ? 60_002n : 30_002n;
    const fee = market===0 ? 13n : 7n;
    await h.send('open one lot against isolated maker '+market,[await route({trader:debtor,actor:setup.traderOwner,
      marketIndex:market, side:0, makers:[makers[market]], lots:[1n], allInLimit:gross+fee,maxFee:fee})],[setup.traderOwner]);
  }
  const secondMaker=setup.instances[2];
  if (contested) {
    await setup.sample();
    await h.send('cross debtor buys another BTC lot from an independent capital account',[
      await route({trader:debtor,actor:setup.traderOwner,marketIndex:0,side:0,makers:[secondMaker],
        lots:[1n],allInLimit:60_015n,maxFee:13n})],[setup.traderOwner]);
  }
  if (flatCreditor) {
    setup.sourcePrices.btc=65_000_000_000n;
    await setup.qualify();
    await h.send('open the second trader short at 64998',[await route({trader:otherTrader,actor:setup.traderOwner,
      marketIndex:0, side:1, makers:[makers[0]], lots:[1n], allInLimit:64_985n,maxFee:13n})],[setup.traderOwner]);
    setup.sourcePrices.btc=60_000_000_000n;
    await setup.qualify();
    await h.send('close the second trader at 60002 leaving an unpaid BTC claim',[await route({trader:otherTrader,actor:setup.traderOwner,
      marketIndex:0, side:0, makers:[makers[0]], lots:[1n], allInLimit:60_015n,maxFee:13n,
      reduceOnly:true,generation:(await root(otherTrader)).positions[0].generation})],[setup.traderOwner]);
    const closed=await root(otherTrader);
    assert.deepEqual([closed.cash,closed.positions[0].lots,closed.positions[0].virtualScaled],[contested?29_974n:19_970n,0n,4_996_000_000_000n]);
  }
  setup.sourcePrices.btc = 50_000_000_000n;
  setup.sourcePrices.eth = 2_000_000_000n;
  await setup.freshSources();
  await h.send('freeze a cross debtor with both BTC and ETH losses',[sdk.getFreezeAccountsInstruction({...setup.safetyCommon,...sources,
    caller:setup.payer,target:debtor,members:(await sdk.deriveMemberPage(setup.venue,(await root(debtor)).id/64n))[0],
    safetyEpoch:(await safety()).epoch,resolutionEpoch:(await resolution()).epoch,emergency:false})]);
  await flush();
  const frozen = await resolution();
  assert.deepEqual(frozen.prices,[50_000n,20_000n]);
  const members = await financialRoots(h,setup.venue,setup.registry);
  const rows = await Promise.all(members.map(async key=>{
    const {root:value,positions:basis} = sdk.decodeProfitAttribution((await h.read(key))!,gated||linked);
    const claims = value.positions.map((position,index)=>position.lots*frozen.prices[index]*1_000_000_000n+
      position.virtualScaled-position.lots*(frozen.funding[index]-position.fundingCheckpointScaled));
    return {key,id:value.id,revision:value.revision,generation:value.activationGeneration,cash:value.cash,
      lots:value.positions.map(pos=>pos.lots),claims,basis};
  }));
  journal = await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  const events = journal.initialEvents;
  const freezes = events.filter(event=>event.type==='AccountResolutionFrozenV3');
  assert.equal(freezes.length,1);
  assert.equal(freezes[0].data.trigger,debtor);
  const history = events.slice(0,events.indexOf(freezes[0]));
  assert(!history.some(event=>event.type==='AccountFinancialChangedV3' && [2,3].includes(event.data.kind)));
  const input = {flatCreditor,secondBtcWinner:contested?secondMaker.capital:undefined,epoch:frozen.epoch,marks:frozen.prices,funding:frozen.funding,pools:frozen.poolsBefore,
    insurance:frozen.insuranceBefore,fees:frozen.feesBefore,markets:setup.markets,rows,makerDeposit,debtor,otherTrader,
    winners:makers.map(maker=>maker.capital),venueHex:Buffer.from(getAddressEncoder().encode(setup.venue)).toString('hex'),
    sourceDigest:createHash('sha256').update(json([setup.venue,frozen,rows,freezes[0].signature])).digest('hex'),
    fills:history.filter(event=>event.type==='LiquidityRouteExecutedV4').map(event=>event.data)};
  const comparison = JSON.parse(execFileSync('python3',['tests/financial/linked_default_comparison.py'],{input:json(input),encoding:'utf8'}));
  await journal.checkpoint('frozen-two-market-debtor',true);
  const openWorker = async () => {
    const runtime = new AccountRuntime(process.env.RIVALT_DATABASE_URL!,'p55b2-application',url,4,
      selection);
    await runtime.open();
    return runtime;
  };
  process.env.RIVALT_DEFAULT_BATCH_STEPS = gated||linked?'1':'32';
  worker = await openWorker();
  const originals: string[] = [];
  const workerCosts: {request:string; units:number; bytes:number}[] = [];
  let refused = false, partialChecked = false, jointChecked = false;
  let badAttempt:bigint|undefined,rejectionChecked=false;
  const financialSnapshot=()=>Promise.all([setup.resolution,setup.vault,setup.token.address,setup.traderToken.address,
    ...setup.ledgers,...members].map(key=>h.read(key)));
  let beforeScoring:Awaited<ReturnType<typeof financialSnapshot>>|undefined;
  while ((await resolution()).stage !== 11) {
    assert(originals.length<128,'eight-member recovery exceeded the test continuation budget');
    const current = await readAccountResolution(worker.rpc,setup.venue);
    const prepared=current.preparedState;
    if(allocationProfile && prepared.epoch===frozen.epoch) {
      if(prepared.stage===4 && badAttempt===undefined) {
        const common=await accountDefaultContext(worker.rpc,current);
        const ordinal=BigInt(members.indexOf(debtor)),[page]=await sdk.deriveFrozenMarginPage(setup.venue,ordinal/8n);
        beforeScoring=await financialSnapshot();
        badAttempt=prepared.revision;
        // Admit the correct ETH prefix and zero BTC atoms, then drive the entire failed attempt through the worker.
        await h.send('propose insufficient BTC recovery alongside the full ETH charge',[sdk.getAdvanceLinkedAllocationInstruction({
          ...common,epoch:frozen.epoch,revision:prepared.revision,ordinal,page,margin:debtor,
          cutoffs:[[1n,0xffff_ffff_ffff_ffffn,0n,0n],[12n,10_002n,0n,(await root(makers[1].capital)).id]]})]);
        await flush();
        continue;
      }
      if(prepared.stage===4 && badAttempt!==undefined && !rejectionChecked) {
        assert.equal(sdk.linkedAllocationReceipt(prepared),null);
        assert.deepEqual(await financialSnapshot(),beforeScoring);
        await journal.checkpoint('insufficient-btc-cutoff-rejected',true);
        rejectionChecked=true;
      }
      const scan=sdk.linkedAllocationReceipt(prepared);
      if(scan && rejectionChecked && scan.cursor===3n && !partialChecked) {
        assert(scan.attempt>badAttempt!&&!scan.committed);
        const common=await accountDefaultContext(worker.rpc,current);
        const [page]=await sdk.deriveFrozenMarginPage(setup.venue,scan.cursor/8n);
        const beforeScratch=await Promise.all([common.prepared,page].map(key=>h.read(key)));
        for(const ordinal of [scan.cursor-1n,scan.cursor+1n]) {
          await h.send('refuse noncanonical linked member '+ordinal,[sdk.getAdvanceLinkedAllocationInstruction({...common,
            epoch:frozen.epoch,revision:prepared.revision,ordinal,page,margin:members[Number(ordinal)],cutoffs:null})],[],sdk.CLEARING_ERROR__RESOLUTION);
        }
        await h.send('refuse payment calculations during linked scan',[sdk.getAcceptDenominatorRowInstruction({...common,
          epoch:frozen.epoch,revision:prepared.revision,page})],[],sdk.CLEARING_ERROR__RESOLUTION);
        const margin=makers[0].capital;
        await h.send('refuse withdrawal during linked scan',[sdk.getWithdrawFundedAccountInstruction({...setup.common,
          btc:setup.markets[0],eth:setup.markets[1],owner:setup.owner,margin,quoteMint:setup.mint.address,userToken:setup.token.address,
          guard:await guard(margin),amount:1n})],[setup.owner],sdk.CLEARING_ERROR__PROFILE);
        assert.deepEqual(await financialSnapshot(),beforeScoring);
        assert.deepEqual(await Promise.all([common.prepared,page].map(key=>h.read(key))),beforeScratch);
        await worker.close();worker=await openWorker();
        await journal.checkpoint('linked-allocation-restart-at-member-three',true);
        partialChecked=true;
      }
      if(scan?.committed&&!jointChecked) {
        assert(rejectionChecked&&partialChecked);
        assert.deepEqual(scan.shares,comparison.collections.map(BigInt));
        assert.deepEqual(scan.recovered,comparison.charges.map(BigInt));
        for(let start=0;start<members.length;start+=8) {
          const [page]=await sdk.deriveFrozenMarginPage(setup.venue,BigInt(start/8));
          const frozenPage=sdk.getLinkedAllocationPageDecoder().decode((await h.read(page))!);
          for(const record of frozenPage.rows.slice(0,frozenPage.rowCount)) {
            const expected=BigInt(comparison.winnerCharges[record.member]??0);
            assert.deepEqual(record.linkedCharges,record.member===makers[1].capital?[0n,expected]:[expected,0n]);
          }
        }
        assert.deepEqual(await financialSnapshot(),beforeScoring);
        process.env.RIVALT_DEFAULT_BATCH_STEPS='32';
        await worker.close();worker=await openWorker();
        await journal.checkpoint('joint-allocation-certified-before-payment',true);
        jointChecked=true;
      }
    }
    if(contested && !allocationProfile && current.preparedState.epoch===frozen.epoch && current.preparedState.stage===4) {
      const blocked=await worker.riskWork(setup.payer);
      assert.deepEqual(blocked,{status:'blocked',reason:'unsupported-linked-creditors'});
      const common=await accountDefaultContext(worker.rpc,current);
      const debtorOrdinal=BigInt(members.indexOf(debtor));
      const [page]=await sdk.deriveFrozenMarginPage(setup.venue,debtorOrdinal/8n);
      const watched=[common.prepared,page,setup.resolution,setup.vault,setup.token.address,setup.traderToken.address,...members];
      const snapshot=()=>Promise.all(watched.map(key=>h.read(key)));
      const beforeAttempt=await snapshot();
      for(const maker of [makers[0],secondMaker]) {
        const winnerOrdinal=BigInt(members.indexOf(maker.capital));
        const [winnerPage]=await sdk.deriveFrozenMarginPage(setup.venue,winnerOrdinal/8n);
        await h.send('refuse certifying just one of two open BTC winners',[sdk.getVerifyFrozenPairInstruction({...common,
          epoch:frozen.epoch,revision:current.preparedState.revision,debtorOrdinal,winnerOrdinal,debtor,winner:maker.capital,
          debtorPage:page,winnerPage:winnerPage===page?undefined:winnerPage})],[],sdk.CLEARING_ERROR__RESOLUTION);
      }
      await h.send('refuse releasing the contested book without a joint certificate',[sdk.getAcceptDenominatorRowInstruction({
        ...common,epoch:frozen.epoch,revision:current.preparedState.revision,page})],[],sdk.CLEARING_ERROR__RESOLUTION);
      assert.deepEqual(await snapshot(),beforeAttempt);
      refused=true;
      break;
    }
    if (!allocationProfile && linked && flatCreditor && current.preparedState.epoch===frozen.epoch && current.preparedState.stage===4) {
      const common=await accountDefaultContext(worker.rpc,current);
      const debtorOrdinal=BigInt(members.indexOf(debtor)), flatOrdinal=BigInt(members.indexOf(otherTrader));
      const [page]=await sdk.deriveFrozenMarginPage(setup.venue,debtorOrdinal/8n);
      const [creditorPage]=await sdk.deriveFrozenMarginPage(setup.venue,flatOrdinal/8n);
      const watched=[common.prepared,debtor,otherTrader,setup.vault,setup.traderToken.address];
      const snapshot=()=>Promise.all(watched.map(key=>h.read(key)));
      const prior=await snapshot();
      await h.send('refuse charging the flat BTC creditor as an open winner',[sdk.getVerifyFrozenPairInstruction({
        ...common,epoch:frozen.epoch,revision:current.preparedState.revision,debtorOrdinal,winnerOrdinal:flatOrdinal,
        debtor,winner:otherTrader,debtorPage:page,winnerPage:page===creditorPage?undefined:creditorPage})],[],sdk.CLEARING_ERROR__RESOLUTION);
      assert.deepEqual(await snapshot(),prior);
    }
    if (linked && current.preparedState.epoch===frozen.epoch && current.preparedState.stage===6 && !partialChecked) {
      const receipt=sdk.frozenJointReceipt(current.preparedState);
      assert(receipt && !receipt.complete && receipt.legs[0].charge===BigInt(comparison.charges[0]));
      const common=await accountDefaultContext(worker.rpc,current);
      const debtorOrdinal=BigInt(members.indexOf(debtor)), winnerOrdinal=BigInt(members.indexOf(makers[0].capital));
      const page=(await sdk.deriveFrozenMarginPage(setup.venue,debtorOrdinal/8n))[0];
      const watched=[setup.resolution,common.prepared,setup.vault,setup.token.address,...members];
      const snapshot=()=>Promise.all(watched.map(key=>h.read(key)));
      const original=await snapshot();
      await h.send('refuse BTC leg as an ETH winner',[sdk.getVerifyFrozenPairInstruction({...common,
        epoch:frozen.epoch,revision:current.preparedState.revision,debtorOrdinal,winnerOrdinal,
        debtor,winner:makers[0].capital,debtorPage:page})],[],sdk.CLEARING_ERROR__RESOLUTION);
      await h.send('refuse settlement after only BTC verified',[sdk.getAcceptDenominatorRowInstruction({...common,
        epoch:frozen.epoch,revision:current.preparedState.revision,page})],[],sdk.CLEARING_ERROR__RESOLUTION);
      const margin=makers[0].capital;
      await h.send('refuse funded withdrawal between verified legs',[sdk.getWithdrawFundedAccountInstruction({...setup.common,
        btc:setup.markets[0],eth:setup.markets[1],owner:setup.owner,margin,quoteMint:setup.mint.address,userToken:setup.token.address,
        guard:await guard(margin),amount:1n})],[setup.owner],sdk.CLEARING_ERROR__PROFILE);
      assert.deepEqual(await snapshot(),original);
      await worker.close(); worker=await openWorker();
      await journal.checkpoint('btc-verified-eth-pending',true);
      partialChecked=true;
    }
    if(!allocationProfile && linked && partialChecked && !jointChecked && [2,3].includes(current.preparedState.stage)) {
      const receipt=sdk.frozenJointReceipt(current.preparedState);
      assert(receipt?.complete);
      assert.deepEqual(receipt.shares,comparison.collections.map(BigInt));
      assert.deepEqual(receipt.legs.map(leg=>leg.charge),comparison.charges.map(BigInt));
      assert.deepEqual(receipt.legs.map(leg=>leg.price),comparison.matched.map(BigInt));
      assert.deepEqual(receipt.legs.map(leg=>leg.matched),[1n,1n]);
      process.env.RIVALT_DEFAULT_BATCH_STEPS='32';
      await worker.close(); worker=await openWorker();
      assert.equal(worker.defaultContinuationSteps,32);
      jointChecked=true;
    }
    if (gated && current.preparedState.epoch===frozen.epoch && current.preparedState.stage===4) {
      const common = await accountDefaultContext(worker.rpc,current);
      const ordinal = BigInt(members.indexOf(debtor)), page = (await sdk.deriveFrozenMarginPage(setup.venue,ordinal/8n))[0];
      const frozenRows = sdk.getBtcAllocationPageDecoder().decode((await h.read(page))!);
      for (const [index, row] of rows.entries()) {
        const stored = frozenRows.rows[index];
        assert.deepEqual([stored.id,stored.member,stored.originalRevision,stored.activationGeneration,stored.cash,stored.claims,stored.lots],
          [row.id,row.key,row.revision,row.generation,row.cash,row.claims,row.lots]);
      }
      const watched = [setup.vault,setup.resolution,common.prepared,page,...members];
      const snapshot = () => Promise.all(watched.map(key=>h.read(key)));
      const original = await snapshot();
      await h.send('refuse omitting ETH from the BTC-only certificate',[sdk.getAdvanceBtcAllocationInstruction({...common,
        epoch:frozen.epoch, revision:current.preparedState.revision,ordinal,margin:debtor,page,cutoff:[0n,0n,0n,0n]})],
        [],sdk.CLEARING_ERROR__RESOLUTION);
      await h.send('refuse bypassing linked selection',[sdk.getAcceptDenominatorRowInstruction({...common,
        epoch:frozen.epoch, revision:current.preparedState.revision,page})],[],sdk.CLEARING_ERROR__RESOLUTION);
      assert.deepEqual(await snapshot(),original);
      refused = true;
      break;
    }
    const work = await worker.riskWork(setup.payer);
    assert.equal(work.status,'queued',json(work));
    const pending: {request_id:string;signature:string;wire:string}[] = (await worker.store.pool.query("SELECT request_id,signature,wire FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[worker.runId])).rows;
    assert.equal(pending.length,1);
    const [intent] = pending;
    const subscription = await ws.call('signatureSubscribe',[intent.signature,{commitment:'finalized'}]);
    await eventually(async()=>{await worker!.queue.step(intent.request_id);return worker!.queue.get(intent.request_id);},
      value=>['finalized','failed'].includes(value?.status),'linked default continuation');
    assert.equal((await worker.queue.get(intent.request_id)).status,'finalized');
    assert.equal((await ws.notification(subscription)).params.result.value.err,null);
    const receipt = await rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(receipt.transaction[0],intent.wire);
    assert(Number.isSafeInteger(receipt.meta.computeUnitsConsumed) && receipt.meta.computeUnitsConsumed>0);
    workerCosts.push({request:intent.request_id,units:receipt.meta.computeUnitsConsumed,bytes:Buffer.from(intent.wire,'base64').length});
    originals.push(intent.signature);
    if (originals.length===1) {
      await worker.close(); worker=await openWorker();
      assert.equal((await worker.queue.get(intent.request_id)).status,'finalized');
    }
  }
  assert.equal(refused,gated||contested&&!allocationProfile);
  assert.equal(jointChecked,linked&&(!contested||allocationProfile));
  if (refused) {
    assert.equal((await resolution()).stage,2);
    assert.deepEqual([await wallet(),await traderWallet(),await vault()],[before.wallet,before.traderWallet,before.vault]);
  } else {
    assert.deepEqual((await resolution()).insuranceSpent,allocationProfile?[13n,1n]:flatCreditor?[9n,1n]:[3n,1n]);
    const target=linked?comparison.cash:comparison.ordinaryCash;
    for (const key of members) assert.equal(String((await root(key)).cash),target[key]);
    const traderPayout=flatCreditor?(linked?4_996n:4_994n):0n;
    if (flatCreditor) {
      const owner=setup.traderOwner;
      await h.send('withdraw the flat BTC claim into the trader wallet',[sdk.getWithdrawFundedAccountInstruction({...setup.common,
        btc:setup.markets[0],eth:setup.markets[1],owner,margin:otherTrader,quoteMint:setup.mint.address,
        userToken:setup.traderToken.address,guard:await guard(otherTrader),amount:traderPayout})],[owner]);
      assert.equal((await root(otherTrader)).cash,allocationProfile?29_974n:19_970n);
      assert.deepEqual([await traderWallet(),await vault()],[before.traderWallet+traderPayout,before.vault-traderPayout]);
    }
    const payoutAccounts=allocationProfile?[makers[0],secondMaker,makers[1]]:makers;
    const makerPayouts=allocationProfile?[5_002n,9_993n,9_990n]:flatCreditor?[linked?5_001n:5_003n,9_989n]:[9_999n,9_997n];
    for (const [index,amount] of makerPayouts.entries()) {
      const margin=payoutAccounts[index].capital;
      await h.send('withdraw market recovery to maker wallet '+index,[sdk.getWithdrawFundedAccountInstruction({...setup.common,
        btc:setup.markets[0],eth:setup.markets[1],owner:setup.owner,margin,quoteMint:setup.mint.address,userToken:setup.token.address,
        guard:await guard(margin),amount})],[setup.owner]);
    }
    const makerTotal=makerPayouts.reduce((total,payout)=>total+payout,0n);
    for(const maker of payoutAccounts)assert.equal((await root(maker.capital)).cash,makerDeposit);
    assert.deepEqual([await wallet(),await vault()],[before.wallet+makerTotal,before.vault-makerTotal-traderPayout]);
  }
  await flush(); await journal.checkpoint(refused?'joint-certificate-required':'both-market-credits-withdrawn',true);
  const replay=await journal.finish();
  if(allocationProfile) {
    const failed=replay.checkpoints.find(point=>point.name==='insufficient-btc-cutoff-rejected')!.state.resolution.linkedAllocation;
    assert.deepEqual([failed.status,failed.cursor,failed.recovered],[2,'8',['0','12']]);
    assert.equal(replay.state.resolution?.linkedAllocation?.status,1);
  }
  const result={revision,rejectionChecked,profile:allocationProfile?'verified linked winner allocation':contested?'contested BTC winner gate':linked?'verified linked clearing':gated?'BTC-only candidate':'ordinary settlement',freeze:freezes[0].signature,
    inputs:input,traderWalletAfter:await traderWallet(),comparison,refused,partialChecked,jointChecked,walletAfter:await wallet(),vaultAfter:await vault(),before,originals,workerCosts,events:replay.events,harnessChecks:checks.length};
  writeFileSync(directory+'/linked-default.json',json(result));
  console.log(json({profile:result.profile,events:replay.events,harnessChecks:checks.length,originals:originals.length,charges:comparison.charges}));
} finally {
  await worker?.close(); await journal?.close();
  try {await flush();} finally {ws.close();}
}
