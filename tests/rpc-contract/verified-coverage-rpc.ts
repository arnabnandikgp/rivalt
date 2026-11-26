// Read-only candidate versus the existing certificate and a real one-atom payment.
// Every price change, fill, cash movement and certificate step is signed.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import type {Address, Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {coverageProvisioning, appendCoverage} from './coverage-provisioning.js';
import {routerBuild} from './execution-router-build.js';
import {payerKey} from './harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {backingStep} from './membership-scan-helper.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {auditCoverage, observeCoverage} from './shadow-coverage.js';

const dir = process.env.RIVALT_RUN_DIR!, build = routerBuild();
const revision = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const {rpc,ws,h:transport,checks,flush} = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,
  process.env.RIVALT_WS_URL!,dir,{deferFinality:true});
const payer = await payerKey(), {h,members,lanes} = coverageProvisioning(transport,payer);
try {
  const setup = await liquidityExecutionSetup(h,rpc,{traderCount:1,traderCash:150_000n,marketCheckpoints:true,
    marginLayout:'ledger-lanes',shape:symmetricPayoutShape,verifyRejections:false});
  const {root,route,withCheckpoints} = executionTestHelpers(h,setup);
  const {venue,registry,markets,ledgers,traderOwner:owner} = setup;
  const common = {...setup.common,btc:markets[0],eth:markets[1]};
  const [certificate] = await sdk.deriveSettlementCertificate(venue,1);
  const trader = setup.roots[0], ethMaker = setup.instances[3];
  const allRoots = [...setup.roots,...setup.instances.map(maker=>maker.capital)];
  const scale = 1_000_000_000n;
  const ledger = async () => sdk.getMarketLedgerDecoder().decode((await h.read(ledgers[1]))!);
  const observation = (market: 0|1, pool = ledgers[market]) =>
    observeCoverage([venue,registry,...markets,setup.safety,pool],lanes,market);
  function withLanes(ix: Instruction, keys: Address[]) {return appendCoverage(ix,keys.map(key=>members.get(key)!));}
  async function trade(market: 0|1, side: 0|1) {
    const maker = market === 0 ? setup.instances[0] : ethMaker;
    const fill = await route({trader,actor:owner,marketIndex:market,side,makers:[maker],lots:[10n],marketLane:market===1,minimalMarkets:true});
    // The BTC leg sees the trader’s ETH liability and takes the ordinary checkpointed route.
    const prefix = market===0 ? (await withCheckpoints(fill)).slice(0,-1) : [];
    await h.send('trade ten lots '+market+' '+side,[...prefix,withLanes(fill,[trader,maker.capital])],[owner]);
  }
  await trade(1,0);
  await trade(1,1);
  assert.equal((await root(trader)).positions[1].virtualScaled,-40n*scale);
  assert.equal((await root(ethMaker.capital)).positions[1].virtualScaled,40n*scale);
  await trade(0,0);
  const collect = sdk.getCollectAccountLossInstruction({...common,actor:payer,margin:trader,marketIndex:1,amount:10n});
  const collection = await withCheckpoints(collect);
  await h.send('fund ETH settlement with ten real loss atoms',[...collection.slice(0,-1),withLanes(collect,[trader])]);
  assert.equal((await ledger()).settlement,10n);
  assert.equal((await root(trader)).positions[1].virtualScaled,-30n*scale);
  await h.send('open legacy ETH certificate',[sdk.getInitializeMarketBackingInstruction({...common,payer,certificate,marketIndex:1})]);
  const samples = [];
  async function measure(label: string, expected: boolean, target: 0|1 = 1, refresh = true) {
    if (refresh) await setup.sample();
    const book = await Promise.all(allRoots.map(root));
    const risks = await Promise.all([setup.marketState(0),setup.marketState(1)]);
    // The symmetric, unskewed book has zero premium at each observation.
    for (const market of risks) {
      assert.equal(market.oracle.premiumScaled,0n);
      assert.equal(market.fundingIndexScaled,0n);
    }
    const pool = sdk.getMarketLedgerDecoder().decode((await h.read(ledgers[target]))!).settlement;
    let lots = 0n, fixed = 0n, bad = 0;
    for (const member of book) {
      const claims = member.positions.map((p,i) => {
        const intercept = p.virtualScaled + p.lots*p.fundingCheckpointScaled;
        if (i===target) {lots += p.lots; fixed += intercept;}
        return intercept + p.lots*(p.lots<0n ? risks[i].upper : risks[i].lower)*scale;
      });
      const loss = claims.reduce((sum,claim)=>sum+(claim<0n?-claim:0n),0n);
      if (claims[target]<0n && member.cash*scale<loss) bad++;
    }
    assert.equal(lots,0n); assert.equal(fixed,pool*scale); assert.equal(bad,expected?0:1);
    await h.send(label,[observation(target)]);
    await flush();
    const check = checks.find(item=>item.label===label)!;
    const tx = await rpc.call('getTransaction',[check.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(tx.meta.err,null);
    assert.equal(tx.meta.returnData.programId,sdk.CLEARING_PROGRAM_ADDRESS);
    assert.equal(Buffer.from(tx.meta.returnData.data[0],'base64').readBigUInt64LE(),BigInt(expected));
    assert(tx.meta.logMessages.includes('Program log: backing pool='+pool+' sources=1'));
    await auditCoverage(rpc,venue,registry,lanes,allRoots,true);
    return {label,pool,bad,btc:risks[0].referencePrice,cu:tx.meta.computeUnitsConsumed,signature:check.signature};
  }
  async function legacy(label: string, expected: boolean) {
    const proof = async () => sdk.getSettlementCertificateDecoder().decode((await h.read(certificate))!);
    let steps = 0;
    do {
      assert(steps<64);
      if (steps%4===0) await setup.sample();
      const next = await backingStep(h,{...common,certificate,ledger:ledgers[1]},steps===0);
      await h.send(label+' certificate step '+steps,await withCheckpoints(next.instruction));
      steps++;
    } while (!(await proof()).complete);
    const totals = sdk.decodeBackingSummary((await ledger()).backing.summary);
    assert.equal(totals.bad,expected?0n:1n);
    assert.equal(totals.quantity,0n);
    assert.equal(totals.positive-totals.negative,(await ledger()).settlement*scale);
    assert.equal(totals.requiredMask,1);
    await setup.sample();
    const previous = (await root(ethMaker.capital)).cash, pool = (await ledger()).settlement;
    const pay = sdk.getPayAccountGainInstruction({...common,actor:payer,margin:ethMaker.capital,marketIndex:1,certificate,amount:1n});
    const payout = await withCheckpoints(pay);
    await h.send(label+' certified one-atom payout',[...payout.slice(0,-1),withLanes(pay,[ethMaker.capital])],[],
      expected?undefined:sdk.CLEARING_ERROR__EXIT_COHORT);
    assert.equal((await ledger()).settlement,pool-BigInt(expected));
    assert.equal((await root(ethMaker.capital)).cash,previous+BigInt(expected));
    return steps;
  }
  async function move(btc: bigint) {
    const keys = [trader,...lanes], before = await Promise.all(keys.map(h.read));
    setup.sourcePrices.btc = btc;
    await setup.qualify();
    assert.deepEqual(await Promise.all(keys.map(h.read)),before);
  }
  await h.send('reject BTC ledger on ETH check',[observation(1,ledgers[0])],[],sdk.CLEARING_ERROR__EXIT_COHORT);
  samples.push({...await measure('initial ETH backing',true),legacySteps:await legacy('initial',true)});
  await move(40_000_000_000n);
  samples.push(await measure('BTC backing during idle BTC loss',false,0));
  samples.push({...await measure('ETH backing during idle BTC loss',false),legacySteps:await legacy('loss',false)});
  await move(60_000_000_000n);
  samples.push({...await measure('ETH backing after BTC recovery',true),legacySteps:await legacy('recovery',true)});
  const lastBtc = await setup.marketState(0);
  // Keep ETH current while the only source that matters to this flat ETH debtor expires.
  for (let samples=0; await setup.slot()<lastBtc.validUntil && await setup.now()<lastBtc.oracle.sourceDeadline; samples++) {
    assert(samples<25); await setup.sample([1]);
  }
  await h.send('stale BTC blocks ETH backing',[observation(1)],[],sdk.CLEARING_ERROR__ORACLE_POLICY);
  await setup.qualify();
  samples.push(await measure('ETH backing after BTC source resumes',true));
  const lastEth = await setup.marketState(1);
  for (let rounds=0; await setup.slot()<lastEth.validUntil && await setup.now()<lastEth.oracle.sourceDeadline; rounds++) {
    assert(rounds<25); await setup.sample([0]);
  }
  samples.push(await measure('unrelated stale ETH admits flat ETH book with current BTC',true,1,false));
  const journal = await openSettlementJournal(rpc,setup,checks.map(row=>String(row.signature)),build);
  const replay = await journal.finish();
  writeFileSync(dir+'/verified-backing.json',json({program:build.revision,revision,samples,events:replay.events}));
  console.log('Verified BTC/ETH backing',json(samples),'replayed events',replay.events);
} finally { await ws.close(); }
