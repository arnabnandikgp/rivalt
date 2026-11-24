import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {Connection} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {eventPayloads, json} from '../../packages/indexer/src/events.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {readOffers, referenceRoute, tradeFee, type Side} from './depth-benchmark-reference.js';
import {routerBuild} from './execution-router-build.js';
import {fixtureKey} from './harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {WireRpc} from './wire.js';

const directory = process.env.RIVALT_RUN_DIR!, url = process.env.RIVALT_RPC_URL!;
const arm = process.env.RIVALT_BENCH_ARM;
assert(arm === 'routed' || arm === 'explicit', 'Choose routed or explicit');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {encoding: 'utf8'}).trim(), '');
const build = routerBuild(), wallet = await fixtureKey('p32-trader'), connection = new Connection(url, 'confirmed');
const budget = {computeUnitLimit: 800_000, heapSize: sdk.BEST_ROUTE_HEAP_BYTES, loadedAccountsDataSizeLimit: 8 * 1024 * 1024};
const index = 61_000n, capital = 500_000_000_000n;
const isOrder = (label: string) => label.startsWith('bench ');
const profiles = {
  deep: {asks: 4_000_000n, bids: 4_000_000n},
  fragmented: {asks: 65_000n, bids: 65_000n},
  'one-sided': {asks: 1_200n, bids: 4_000_000n},
};
type Book = keyof typeof profiles;
function shape(book: Book, id: number) {
  const regions = (endLots: bigint) => [{endLots, offset: BigInt(2 + id * 2), slope: 0n}, ...symmetricPayoutShape.asks.slice(1)];
  return {...symmetricPayoutShape, shortCap: 8_000_000n, longCap: 8_000_000n,
    bids: regions(profiles[book].bids), asks: regions(profiles[book].asks)};
}

function meter(logs: string[], units: number, error: unknown) {
  assert(Number.isSafeInteger(units) && units > 0);
  const consumed = /^Program (\w+) consumed (\d+) of \d+ compute units$/;
  let depth = 0, route = false, routeUnits: number | null = null;
  const makerQuoteUnits: number[] = [];
  for (const line of logs) {
    const invoke = / invoke \[(\d+)\]$/.exec(line);
    if (invoke) depth = Number(invoke[1]);
    if (/Instruction: execute_(best_route|liquidity_route)$/i.test(line)) route = true;
    const match = consumed.exec(line);
    if (route && match && depth === 1 && match[1] === sdk.CLEARING_PROGRAM_ADDRESS) routeUnits = Number(match[2]);
    if (route && match && depth === 2 && [String(sdk.makerA.MAKER_A_PROGRAM_ADDRESS),
      String(sdk.makerB.MAKER_B_PROGRAM_ADDRESS)].includes(match[1])) makerQuoteUnits.push(Number(match[2]));
    if (/^Program \w+ (success|failed:.*)$/.test(line)) depth--;
  }
  if (error === null) assert(routeUnits && makerQuoteUnits.length > 0, 'Missing route or maker CPI measurements');
  return {units, routeUnits, makerQuoteUnits, error};
}

const probe = new WireRpc(url);
async function sameBank(routed: string, explicit: string) {
  const simulate = (wire: string) => probe.call('simulateTransaction', [wire, {encoding:'base64', sigVerify:true, commitment:'confirmed'}]);
  for (let attempt = 0; attempt < 15; attempt++) {
    const [a,b] = await Promise.all([simulate(routed), simulate(explicit)]);
    if (a.context.slot !== b.context.slot) continue;
    const result = (response: typeof a) => meter(response.value.logs, response.value.unitsConsumed, response.value.err);
    return {slot:a.context.slot, routed:result(a), explicit:result(b)};
  }
  throw new Error('Could not observe both signed alternatives on the same confirmed bank');
}
let peer: string | undefined, pair: Awaited<ReturnType<typeof sameBank>> | null = null;
const {h, rpc, ws, checks, flush} = await openCanonicalRpcHarness(url, process.env.RIVALT_WS_URL!, directory, {
  deferFinality:true, observeOutcomes:isOrder, measureComputeBoundary:isOrder,
  computeUnitLimit: label => isOrder(label) ? budget.computeUnitLimit : undefined,
  heapSize: label => isOrder(label) ? budget.heapSize : undefined,
  payerFor: label => isOrder(label) ? wallet : undefined,
  beforeBroadcast: async (label, original) => {
    if (isOrder(label) && peer) pair = arm === 'routed' ? await sameBank(original, peer) : await sameBank(peer, original);
  },
});
let journal: Awaited<ReturnType<typeof openSettlementJournal>> | undefined;
try {
  const setup = await liquidityExecutionSetup(h,rpc,{marketCheckpoints:true, marginLayout:'ledger-lanes',
    verifyRejections:false, shape:id => shape('deep',id), makerCash:capital, traderDeposits:[capital, 1n]});
  const {root, route} = executionTestHelpers(h,setup);
  const btc = setup.instances.slice(0,3), owner = setup.traderOwner;
  setup.sourcePrices.btc = index * 1_000_000n;
  await setup.qualify();
  const [authority] = await sdk.findEventAuthorityPda();
  const fillTag = Buffer.from(sdk.LIQUIDITY_ROUTE_FEE_RECORDED_EVENT_DISCRIMINATOR);
  const rows = [];
  for (const book of Object.keys(profiles) as Book[]) {
    if (book !== 'deep') {
      for (const [id,maker] of btc.entries()) {
        const registration = await maker.registrationState(), config = await maker.state();
        await h.send('change benchmark book ' + book + ' ' + id, [sdk.getControlLiquidityInstruction({...maker.controlCommon,
          expectedAuthority:registration.authorityEpoch, expectedControl:config.controlEpoch, expectedShape:config.shapeEpoch,
          action:{__kind:'Shape',fields:[shape(book,id)]}})], [setup.owner]);
        const changed = await maker.registrationState();
        await h.send('replenish benchmark book ' + book + ' ' + id, [sdk.getReplenishLiquidityInstruction({
          ...maker.controlCommon,expectedAuthority:changed.authorityEpoch,expectedDepth:changed.depthEpoch,sides:3})], [setup.owner]);
      }
      await setup.qualify();
    }
    const orders = [61_000,10_000,5_000,1_000,100].flatMap(dollars =>
      ([0,1] as const).map(side => ({dollars,side,control:'ordinary'})));
    if (book === 'deep') orders.push({dollars:100,side:0,control:'limit'}, {dollars:100,side:1,control:'limit'},
      {dollars:100,side:0,control:'one-atom-wallet'});
    for (const {dollars,side,control} of orders) {
      await setup.sample();
      const trader = setup.roots[control === 'one-atom-wallet' ? 1 : 0];
      const snapshot = await setup.snapshot(trader,0), adapters = snapshot.liquidity!.adapters;
      const lots = (BigInt(dollars) * 1_000_000n + index - 1n) / index;
      const offers = readOffers(adapters,side), best = referenceRoute(offers,side,lots);
      const maxFee = tradeFee((index+6n)*lots);
      const allInLimit = best ? best.allIn + (control === 'limit' ? side === 0 ? -1n : 1n : 0n)
        : side === 0 ? (index+6n)*lots+maxFee : (index-6n)*lots-maxFee;
      const published = offers.reduce((total, offer) => total + offer.depth, 0n);
      const capacity = offers.map(offer => offer.depth).sort((a,b) => a>b ? -1 : a<b ? 1 : 0);
      const expectedRefusal = !best ? published < lots ? 'insufficient published depth' : 'requires three makers'
        : control === 'limit' ? 'signed limit' : control === 'one-atom-wallet' ? 'insufficient trader cash for fee' : null;
      if (control === 'one-atom-wallet') assert(snapshot.roots[trader].cash === 1n && best && best.fee > 1n);
      const routed = await sdk.buildBestRoute({snapshot,trader,marketIndex:0,side,lots,allInLimit,maxFee,reduceOnly:false},owner.address);
      let instructions = routed.instructions, landedPath = 'routed';
      peer = undefined;
      pair = null;
      if (best) {
        const explicit = await route({trader,actor:owner,marketIndex:0,side,makers:best.legs.map(leg=>btc[leg.id]),
          lots:best.legs.map(leg=>leg.lots),minimalMarkets:true});
        const intent = sdk.getExecuteBestRouteInstructionDataDecoder().decode(routed.instructions.at(-1)!.data!);
        const {legs} = sdk.getExecuteLiquidityRouteInstructionDataDecoder().decode(explicit.data!);
        const specified = [...routed.instructions.slice(0,-1), {...explicit,
          data:sdk.getExecuteLiquidityRouteInstructionDataEncoder().encode({...intent,legs})}];
        const other = arm === 'routed' ? specified : routed.instructions;
        if (arm === 'explicit') { instructions = specified; landedPath = 'explicit'; }
        const signed = await sdk.signCanonicalInstructions(connection,wallet,other,budget,[wallet]);
        peer = Buffer.from(signed.transaction.serialize()).toString('base64');
      }
      const keys = [trader,...setup.markets,...setup.ledgers,...btc.flatMap(maker=>[maker.registration,maker.capital])];
      const states = () => Promise.all(keys.map(h.read));
      const before = await states(), start = snapshot.roots[trader].positions[0].lots;
      const label = ['bench',book,dollars,side,control].join(' ');
      await h.send(label,instructions,[wallet]);
      await flush();
      const receipt = checks.find(check=>check.label === label)!;
      const signature = String(receipt.signature);
      const tx = await rpc.call('getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
      const measured = meter(tx.meta.logMessages,tx.meta.computeUnitsConsumed,tx.meta.err);
      const events = eventPayloads(signature,tx,authority).filter(event=>event.payload.subarray(0,8).equals(fillTag));
      let fill = null;
      if (tx.meta.err === null) {
        assert(best && !expectedRefusal, label);
        assert.equal(events.length,1);
        const landed = sdk.getLiquidityRouteFeeRecordedEventDecoder().decode(events[0].payload);
        const legs = landed.legs.map(leg=>({id:leg.instance,lots:leg.lots,gross:leg.gross}));
        assert.deepEqual([landed.venue,landed.marketState.index,landed.side,landed.lots,legs,landed.grossQuote,landed.fee],
          [setup.venue,0,side,lots,best.legs,best.gross,best.fee],label);
        assert.equal((await root(trader)).positions[0].lots,start+(side===0?lots:-lots));
        fill = {legs,gross:landed.grossQuote,fee:landed.fee};
      } else {
        assert.deepEqual(await states(),before,label+' atomic rollback');
        assert.equal(events.length,0);
      }
      rows.push({label,book,dollars,side,control,requestedIndexAtoms:lots*index,lots,offers,published,maxPairDepth:capacity[0]+capacity[1],
        expectedRefusal,allInLimit,maxFee,best,landedPath,fill,measured,pair,receipt});
      writeFileSync(directory+'/benchmark-orders.json', json(rows));
    }
  }
  journal = await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  await journal.checkpoint('benchmark',true);
  const replay = await journal.finish();
  assert(rows.some(row=>row.fill?.legs.length===1) && rows.some(row=>row.fill?.legs.length===2), 'Need signed singleton and split fills');
  writeFileSync(directory+'/depth-benchmark.json',json({revision,build,arm,events:replay.events,rows}));
  console.log(arm, rows.filter(row=>row.fill).length, 'fills from',rows.length,'signed orders;',replay.events,'replayed events');
} finally {
  await journal?.close();
  try {await flush();} finally {ws.close();}
}
