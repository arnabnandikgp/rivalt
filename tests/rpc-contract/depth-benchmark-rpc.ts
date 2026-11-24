import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {getTokenDecoder} from '@solana-program/token';
import {Connection} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {eventPayloads, json} from '../../packages/indexer/src/events.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {readOffers, referenceRoute, tradeFee} from './depth-benchmark-reference.js';
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
async function sameBank(label: string, routed: string, explicit: string) {
  const simulate = (wire: string) => probe.call('simulateTransaction', [wire, {encoding:'base64', sigVerify:true, commitment:'confirmed'}]);
  for (let attempt = 0; attempt < 15; attempt++) {
    const [a,b] = await Promise.all([simulate(routed), simulate(explicit)]);
    if (a.context.slot !== b.context.slot) continue;
    writeFileSync(directory + '/pair-' + label.replaceAll(' ', '-') + '.json',json({routed,explicit,routedSimulation:a,explicitSimulation:b}));
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
    if (isOrder(label) && peer) pair = arm === 'routed' ? await sameBank(label, original, peer) : await sameBank(label, peer, original);
  },
});
let journal: Awaited<ReturnType<typeof openSettlementJournal>> | undefined;
try {
  const setup = await liquidityExecutionSetup(h,rpc,{marketCheckpoints:true, marginLayout:'ledger-lanes',
    verifyRejections:false, shape:id => shape('deep',id), makerCash:capital, traderDeposits:[capital, 1n]});
  const {root, route, guard, withCheckpoints} = executionTestHelpers(h,setup);
  const btc = setup.instances.slice(0,3), owner = setup.traderOwner;
  setup.sourcePrices.btc = index * 1_000_000n;
  await setup.qualify();
  const [authority] = await sdk.findEventAuthorityPda();
  const fillTag = Buffer.from(sdk.LIQUIDITY_ROUTE_FEE_RECORDED_EVENT_DISCRIMINATOR);
  const rows = [];
  const common = {...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  async function replaceBook(book: Book) {
    for (const [id,maker] of btc.entries()) {
      const registration = await maker.registrationState(), config = await maker.state();
      await h.send('change benchmark book ' + book + ' ' + id, await withCheckpoints(sdk.getControlLiquidityInstruction({
        ...maker.controlCommon,expectedAuthority:registration.authorityEpoch,expectedControl:config.controlEpoch,
        expectedShape:config.shapeEpoch,action:{__kind:'Shape',fields:[shape(book,id)]}})), [setup.owner]);
      const changed = await maker.registrationState();
      await h.send('replenish benchmark book ' + book + ' ' + id, await withCheckpoints(sdk.getReplenishLiquidityInstruction({
        ...maker.controlCommon,expectedAuthority:changed.authorityEpoch,expectedDepth:changed.depthEpoch,sides:3})), [setup.owner]);
    }
    await setup.qualify();
  }
  for (const book of Object.keys(profiles) as Book[]) {
    if (book !== 'deep') await replaceBook(book);
    const orders = [61_000,10_000,5_000,1_000,100].flatMap(dollars =>
      ([0,1] as const).map(side => ({dollars,side,control:'ordinary'})));
    if (book === 'deep') orders.push({dollars:100,side:0,control:'limit'}, {dollars:100,side:1,control:'limit'},
      {dollars:100,side:0,control:'one-atom-wallet'}, {dollars:100,side:0,control:'repriced'},
      {dollars:100,side:0,control:'maker-capital-limit'}, {dollars:100,side:0,control:'maker-capital-fallback'});
    for (const {dollars,side,control} of orders) {
      await setup.sample();
      const trader = setup.roots[control === 'one-atom-wallet' ? 1 : 0];
      const capitalControl = control.startsWith('maker-capital');
      const marketIndex = capitalControl ? 1 : 0;
      const reference = marketIndex === 1 ? setup.sourcePrices.eth / 100_000n : index;
      const makers = setup.instances.slice(marketIndex*3,marketIndex*3+3);
      if (control === 'repriced') await makers[0].publish(setup.updater,index+8n);
      if (control === 'maker-capital-limit') {
        const margin = makers[0].capital;
        const before = await root(margin);
        assert.equal(before.cash,capital);
        assert(before.positions.every(position=>position.lots===0n && position.virtualScaled===0n));
        await h.send('withdraw idle ETH maker cash',await withCheckpoints(sdk.getWithdrawFundedAccountInstruction({
          ...common,owner:setup.owner,margin,userToken:setup.token.address,quoteMint:setup.mint.address,
          amount:capital-1n,guard:await guard(margin)})),[setup.owner]);
      }
      const snapshot = await setup.snapshot(trader,marketIndex), adapters = snapshot.liquidity!.adapters;
      const lots = (BigInt(dollars) * 1_000_000n + reference - 1n) / reference;
      const offers = readOffers(adapters,side), publishedBest = referenceRoute(offers,side,lots);
      if (capitalControl) {
        assert.equal(adapters[0].capital.cash,1n);
        assert.equal(adapters[0].capital.positions[marketIndex].lots,0n);
      }
      // With one atom a flat ETH maker cannot margin even one 30,000-atom lot.
      const eligible = offers.map(offer=>capitalControl && offer.id===0 ? {...offer,depth:0n} : offer);
      const best = referenceRoute(eligible,side,lots);
      const maxFee = tradeFee((reference+12n)*lots);
      const allInLimit = control === 'maker-capital-limit' ? publishedBest!.allIn
        : best ? best.allIn + (control === 'limit' ? side === 0 ? -1n : 1n : 0n)
        : side === 0 ? (reference+6n)*lots+maxFee : (reference-6n)*lots-maxFee;
      const published = offers.reduce((total, offer) => total + offer.depth, 0n);
      const capacity = offers.map(offer => offer.depth).sort((a,b) => a>b ? -1 : a<b ? 1 : 0);
      const expectedRefusal = !best ? published < lots ? 'insufficient published depth' : 'requires three makers'
        : control === 'maker-capital-limit' ? 'only price within limit has insufficient maker cash'
        : control === 'limit' ? 'signed limit' : control === 'one-atom-wallet' ? 'insufficient trader cash for fee' : null;
      if (control === 'one-atom-wallet') assert(snapshot.roots[trader].cash === 1n && best && best.fee > 1n);
      const routed = await sdk.buildBestRoute({snapshot,trader,marketIndex,side,lots,allInLimit,maxFee,reduceOnly:false},owner.address);
      let instructions = routed.instructions, landedPath = 'routed';
      peer = undefined;
      pair = null;
      const specifiedQuote = control === 'maker-capital-limit' ? publishedBest : best;
      if (specifiedQuote) {
        const explicit = await route({trader,actor:owner,marketIndex,side,makers:specifiedQuote.legs.map(leg=>makers[leg.id]),
          lots:specifiedQuote.legs.map(leg=>leg.lots),minimalMarkets:true});
        const intent = sdk.getExecuteBestRouteInstructionDataDecoder().decode(routed.instructions.at(-1)!.data!);
        const {legs} = sdk.getExecuteLiquidityRouteInstructionDataDecoder().decode(explicit.data!);
        const specified = [...routed.instructions.slice(0,-1), {...explicit,
          data:sdk.getExecuteLiquidityRouteInstructionDataEncoder().encode({...intent,legs})}];
        const other = arm === 'routed' ? specified : routed.instructions;
        if (arm === 'explicit') { instructions = specified; landedPath = 'explicit'; }
        const signed = await sdk.signCanonicalInstructions(connection,wallet,other,budget,[wallet]);
        peer = Buffer.from(signed.transaction.serialize()).toString('base64');
      }
      const keys = [trader,...setup.markets,...setup.ledgers,...makers.flatMap(maker=>[maker.registration,maker.capital])];
      const states = () => Promise.all(keys.map(h.read));
      const before = await states(), start = snapshot.roots[trader].positions[marketIndex].lots;
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
          [setup.venue,marketIndex,side,lots,best.legs,best.gross,best.fee],label);
        assert.equal((await root(trader)).positions[marketIndex].lots,start+(side===0?lots:-lots));
        fill = {legs,gross:landed.grossQuote,fee:landed.fee};
      } else {
        assert.deepEqual(await states(),before,label+' atomic rollback');
        assert.equal(events.length,0);
      }
      rows.push({label,book,marketIndex,dollars,side,control,requestedIndexAtoms:lots*reference,lots,offers,published,maxPairDepth:capacity[0]+capacity[1],
        expectedRefusal,eligible,publishedBest,allInLimit,maxFee,best,landedPath,fill,measured,pair,receipt});
      writeFileSync(directory+'/benchmark-orders.json', json(rows));
    }
  }
  // Settle the benchmark trader's spread losses and measure funded collateral returned to its SPL account.
  await h.send('restore ETH maker capital', [await sdk.getDepositAccountInstructionAsync({...setup.common,
    owner:setup.owner,margin:setup.instances[3].capital,quoteMint:setup.mint.address,userToken:setup.token.address,
    amount:capital-1n})],[setup.owner]);
  await replaceBook('deep');
  const trader = setup.roots[0];
  peer = undefined;
  for (const marketIndex of [0,1] as const) {
    await setup.sample();
    const snapshot = await setup.snapshot(trader,marketIndex), position = snapshot.roots[trader].positions[marketIndex];
    if (position.lots !== 0n) {
      const side = position.lots > 0n ? 1 : 0, lots = position.lots > 0n ? position.lots : -position.lots;
      const quote = referenceRoute(readOffers(snapshot.liquidity!.adapters,side),side,lots);
      assert(quote);
      const flatten = await sdk.buildBestRoute({snapshot,trader,marketIndex,side,lots,reduceOnly:true,
        allInLimit:quote.allIn,maxFee:quote.fee},owner.address);
      await h.send('bench exit close '+marketIndex,flatten.instructions,[wallet]);
      assert.equal((await root(trader)).positions[marketIndex].lots,0n);
    }
    const remaining = (await root(trader)).positions[marketIndex].virtualScaled;
    assert(remaining<=0n);
    const loss = -remaining/1_000_000_000n;
    if (loss>0n) await h.send('collect benchmark trader loss '+marketIndex,await withCheckpoints(
      sdk.getCollectAccountLossInstruction({...common,actor:setup.payer,margin:trader,amount:loss,marketIndex})));
  }
  const beforeExit = await root(trader);
  const token = async (key:typeof trader) => getTokenDecoder().decode((await h.read(key))!).amount;
  const balance = await token(setup.traderToken.address), vault = await token(setup.vault);
  const unpaid = beforeExit.positions.map(position=>position.virtualScaled);
  const remainingLiability = unpaid.reduce((sum,claim)=>claim<0n ? sum-claim : sum,0n);
  const withdrawal = beforeExit.cash - (remainingLiability+999_999_999n)/1_000_000_000n;
  assert(withdrawal>0n);
  await setup.sample();
  await h.send('bench exit withdrawal',await withCheckpoints(sdk.getWithdrawFundedAccountInstruction({
    ...common,owner,margin:trader,userToken:setup.traderToken.address,quoteMint:setup.mint.address,
    amount:withdrawal,guard:await guard(trader)})),[wallet]);
  assert.deepEqual([await token(setup.traderToken.address),await token(setup.vault),(await root(trader)).cash],
    [balance+withdrawal,vault-withdrawal,beforeExit.cash-withdrawal]);
  await flush();
  journal = await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  await journal.checkpoint('benchmark',true);
  const replay = await journal.finish();
  assert(rows.some(row=>row.fill?.legs.length===1) && rows.some(row=>row.fill?.legs.length===2), 'Need signed singleton and split fills');
  writeFileSync(directory+'/depth-benchmark.json',json({revision,build,arm,withdrawal,unpaid,events:replay.events,rows}));
  console.log(arm, rows.filter(row=>row.fill).length, 'fills from',rows.length,'signed orders;',replay.events,'replayed events');
} finally {
  await journal?.close();
  try {await flush();} finally {ws.close();}
}
