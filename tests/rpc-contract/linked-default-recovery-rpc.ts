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
const build = verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,gated,gated,gated,gated);
const {h,rpc,ws,checks,flush} = await openCanonicalRpcHarness(url,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:()=>1_000_000});
let journal: Awaited<ReturnType<typeof openSettlementJournal>> | undefined;
let worker: AccountRuntime | undefined;
try {
  const makerDeposit = 1_000_000n;
  const setup = await liquidityExecutionSetup(h,rpc,{marginLayout:gated?'sponsored-profit':'profit-attribution',
    shape:symmetricPayoutShape, traderCash:20_012n, makerCash:makerDeposit,verifyRejections:false});
  const {guard,route,root} = executionTestHelpers(h,setup);
  const [debtor,otherTrader] = setup.roots;
  const makers = [setup.instances[0], setup.instances[3]];
  const sources = {primaryBtc:setup.feeds[0].feed,primaryCollateral:setup.feeds[1].feed,guardBtc:setup.feeds[2].feed,
    guardCollateral:setup.feeds[3].feed,primaryEth:setup.feeds[4].feed,guardEth:setup.feeds[5].feed};
  const safety = async () => sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!);
  const resolution = async () => sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const wallet = async () => getTokenDecoder().decode((await h.read(setup.token.address))!).amount;
  const vault = async () => getTokenDecoder().decode((await h.read(setup.vault))!).amount;
  const before = {wallet:await wallet(),vault:await vault()};
  for (const market of [0,1] as const) {
    await setup.sample();
    const gross = market===0 ? 60_002n : 30_002n;
    const fee = market===0 ? 13n : 7n;
    await h.send('open one lot against isolated maker '+market,[await route({trader:debtor,actor:setup.traderOwner,
      marketIndex:market, side:0, makers:[makers[market]], lots:[1n], allInLimit:gross+fee,maxFee:fee})],[setup.traderOwner]);
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
    const {root:value,positions:basis} = sdk.decodeProfitAttribution((await h.read(key))!,gated);
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
  const input = {epoch:frozen.epoch,marks:frozen.prices,funding:frozen.funding,pools:frozen.poolsBefore,
    insurance:frozen.insuranceBefore,fees:frozen.feesBefore,markets:setup.markets,rows,makerDeposit,debtor,otherTrader,
    winners:makers.map(maker=>maker.capital),venueHex:Buffer.from(getAddressEncoder().encode(setup.venue)).toString('hex'),
    sourceDigest:createHash('sha256').update(json([setup.venue,frozen,rows,freezes[0].signature])).digest('hex'),
    fills:history.filter(event=>event.type==='LiquidityRouteExecutedV4').map(event=>event.data)};
  const comparison = JSON.parse(execFileSync('python3',['tests/financial/linked_default_comparison.py'],{input:json(input),encoding:'utf8'}));
  await journal.checkpoint('frozen-two-market-debtor',true);
  const openWorker = async () => {
    const runtime = new AccountRuntime(process.env.RIVALT_DATABASE_URL!,'p55b2-application',url,4,
      gated?'btc-allocation-candidate':'profit-attribution-candidate');
    await runtime.open();
    return runtime;
  };
  process.env.RIVALT_DEFAULT_BATCH_STEPS = gated?'1':'32';
  worker = await openWorker();
  const originals: string[] = [];
  let refused = false;
  while ((await resolution()).stage !== 11) {
    assert(originals.length<128,'eight-member recovery exceeded the test continuation budget');
    const current = await readAccountResolution(worker.rpc,setup.venue);
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
    originals.push(intent.signature);
    if (originals.length===1) {
      await worker.close(); worker=await openWorker();
      assert.equal((await worker.queue.get(intent.request_id)).status,'finalized');
    }
  }
  assert.equal(refused,gated);
  if (gated) {
    assert.equal((await resolution()).stage,2);
    assert.deepEqual([await wallet(),await vault()],[before.wallet,before.vault]);
  } else {
    assert.deepEqual((await resolution()).insuranceSpent,[3n,1n]);
    for (const key of members) assert.equal(String((await root(key)).cash),comparison.cash[key]);
    for (const [index,amount] of [9999n,9997n].entries()) {
      const margin=makers[index].capital;
      await h.send('withdraw market recovery to maker wallet '+index,[sdk.getWithdrawFundedAccountInstruction({...setup.common,
        btc:setup.markets[0],eth:setup.markets[1],owner:setup.owner,margin,quoteMint:setup.mint.address,userToken:setup.token.address,
        guard:await guard(margin),amount})],[setup.owner]);
    }
    assert.deepEqual([await wallet(),await vault()],[before.wallet+19_996n,before.vault-19_996n]);
  }
  await flush(); await journal.checkpoint(gated?'joint-certificate-required':'both-market-credits-withdrawn',true);
  const replay=await journal.finish();
  const result={revision,profile:gated?'BTC-only candidate':'ordinary settlement',freeze:freezes[0].signature,
    inputs:input,comparison,refused,walletAfter:await wallet(),vaultAfter:await vault(),before,originals,events:replay.events,harnessChecks:checks.length};
  writeFileSync(directory+'/linked-default.json',json(result));
  console.log(json({profile:result.profile,events:replay.events,harnessChecks:checks.length,originals:originals.length,charges:comparison.charges}));
} finally {
  await worker?.close(); await journal?.close();
  try {await flush();} finally {ws.close();}
}
