import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {getTokenDecoder} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {routerBuild} from './execution-router-build.js';
import {fixtureKey} from './harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {backingStep} from './membership-scan-helper.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const directory = process.env.RIVALT_RUN_DIR!;
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {encoding: 'utf8'}).trim(), '');
const build = routerBuild();
const openingIndex = 61_000n, closingIndex = 62_000n, scale = 1_000_000_000n;
const cash = 80_000_000_000n, depth = 2_000_000n;
const fee = (gross: bigint) => (gross + 4_999n) / 5_000n;
// One BTC is a million lots. At test collateral parity the reference price is also atoms per lot.
const requests = [100n, 1_000n, 10_000n, 61_000n].map(dollars => ({
  label: 'USD ' + dollars, lots: (dollars * 1_000_000n + openingIndex - 1n) / openingIndex,
})).concat([{label: 'three-lot control', lots: 3n}, {label: 'one-lot control', lots: 1n}]);
const wallet = await fixtureKey('p32-trader');
const isRoute = (label: string) => label.startsWith('buy ') || label === 'close admitted inventory';
const {h, rpc, ws, checks, flush} = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,
  process.env.RIVALT_WS_URL!, directory, {deferFinality: true, observeOutcomes: label => label.startsWith('buy '),
    payerFor: label => isRoute(label) || label === 'withdraw net gain' ? wallet : undefined,
    computeUnitLimit: label => isRoute(label) ? 800_000 : label === 'withdraw net gain' ? 400_000 : undefined,
    heapSize: label => isRoute(label) ? sdk.BEST_ROUTE_HEAP_BYTES : undefined});
let journal: Awaited<ReturnType<typeof openSettlementJournal>> | undefined;
try {
  const regions = [{...symmetricPayoutShape.asks[0], endLots: depth}, ...symmetricPayoutShape.asks.slice(1)];
  const setup = await liquidityExecutionSetup(h, rpc, {marketCheckpoints: true, marginLayout: 'ledger-lanes',
    verifyRejections: false, shape: {...symmetricPayoutShape, bids: regions, asks: regions, longCap: depth, shortCap: depth},
    makerCash: cash, traderCash: cash});
  const {root, guard, withCheckpoints} = executionTestHelpers(h, setup);
  const trader = setup.roots[0], owner = setup.traderOwner, makers = setup.instances.slice(0, 3);
  assert.equal(owner.address, wallet.address);
  const common = {...setup.common, btc: setup.markets[0], eth: setup.markets[1]};
  const accounts = [trader, ...makers.flatMap(maker => [maker.capital, maker.registration]), ...setup.markets, ...setup.ledgers];
  const economicState = () => Promise.all(accounts.map(h.read));
  const tokenBalance = async (key: typeof trader) => getTokenDecoder().decode((await h.read(key))!).amount;
  const settlementPool = async () => sdk.decodeFeeLedger((await h.read(setup.ledgers[0]))!).state.settlement;
  for (const [margin, actor] of [[trader, owner] as const, ...makers.map(maker => [maker.capital, setup.owner] as const)]) {
    const bytes = (await h.read(margin))!, prior = sdk.decodeProfitAttribution(bytes, true);
    assert.equal(prior.width, 128);
    assert.equal(prior.credit, null);
    const slotBytes = 256, newSize = bytes.length + 2 * (slotBytes - prior.width) + 40;
    const balance = await rpc.call('getBalance', [margin, {commitment: 'confirmed'}]);
    const rent = await h.rent(newSize) - BigInt(balance.value);
    await h.send('grow position history ' + margin, [await sdk.getManageProfitCapacityInstructionAsync({
      ...setup.common, margin, payer: actor, actor, previousContributor: actor.address,
      slotBytes, revision: prior.root.revision, maxPayment: rent,
    })], [actor]);
    assert.equal(sdk.decodeProfitAttribution((await h.read(margin))!, true).width, slotBytes);
  }
  setup.sourcePrices.btc = openingIndex * 1_000_000n;
  await setup.qualify();
  const startingWallet = await tokenBalance(setup.traderToken.address), startingVault = await tokenBalance(setup.vault);
  assert.equal((await root(trader)).cash, cash);
  assert.equal(await settlementPool(), 0n);
  const orders = [];
  let admittedLots = 0n, openingFees = 0n;
  for (const {lots, label} of requests) {
    await setup.sample();
    const snapshot = await setup.snapshot(trader, 0);
    const published = snapshot.liquidity!.adapters.map(maker => maker.quote(0, lots));
    const gross = (openingIndex + 2n) * lots, maxFee = fee(gross);
    assert.deepEqual(published.map(quote => quote.gross), [gross, gross, gross]);
    const order = await sdk.buildBestRoute({snapshot, trader, marketIndex: 0, side: 0, lots,
      allInLimit: gross + maxFee, maxFee}, owner.address);
    const before = await economicState();
    const buyLabel = 'buy ' + label;
    // In this loopback harness only, send the original even if the RPC simulation refuses it.
    await h.send(buyLabel, order.instructions, [owner]);
    await flush();
    const receipt = checks.find(check => check.label === buyLabel)!;
    assert.equal(receipt.signatures, 1);
    if (receipt.error === null) {
      admittedLots += lots;
      openingFees += maxFee;
    } else {
      assert.deepEqual(await economicState(), before, label + ' economic rollback');
    }
    const account = await root(trader);
    assert.deepEqual([account.positions[0].lots, account.cash, account.positions[0].virtualScaled],
      [admittedLots, cash - openingFees, -admittedLots * (openingIndex + 2n) * scale]);
    const consumed = await Promise.all(makers.map(maker => maker.registrationState()));
    assert.equal(consumed.reduce((total, maker) => total + maker.buyConsumed, 0n), admittedLots);
    orders.push({label, lots, referenceAtoms: openingIndex * lots, published, receipt});
    writeFileSync(directory + '/notional-orders.json', json(orders));
    // This probe pins the router binary and book. A different first failure is a changed result.
    const expected = lots <= 3n ? null : {InstructionError: [order.instructions.length - 1, {Custom: sdk.CLEARING_ERROR__CAPACITY}]};
    assert.deepEqual(receipt.simulationError, expected, buyLabel + ' simulation');
    assert.deepEqual(receipt.error, expected, buyLabel + ' finalized execution');
  }
  assert(admittedLots > 0n, 'No admitted inventory for settlement control');
  setup.sourcePrices.btc = closingIndex * 1_000_000n;
  await setup.qualify();
  const snapshot = await setup.snapshot(trader, 0);
  const closeGross = (closingIndex - 2n) * admittedLots, closeFee = fee(closeGross);
  const close = await sdk.buildBestRoute({snapshot, trader, marketIndex: 0, side: 1, lots: admittedLots,
    allInLimit: closeGross - closeFee, maxFee: closeFee, reduceOnly: true}, owner.address);
  await h.send('close admitted inventory', close.instructions, [owner]);
  const gain = closeGross - (openingIndex + 2n) * admittedLots;
  const net = gain - openingFees - closeFee;
  const closed = await root(trader);
  assert.deepEqual([closed.positions[0].lots, closed.positions[0].virtualScaled, closed.cash],
    [0n, gain * scale, cash - openingFees - closeFee]);
  assert.equal(await tokenBalance(setup.traderToken.address), startingWallet);
  for (const maker of makers) {
    const position = (await root(maker.capital)).positions[0];
    const debt = -(position.virtualScaled / scale + position.lots * closingIndex);
    const remaining = gain - await settlementPool();
    const amount = debt < remaining ? debt : remaining;
    if (amount > 0n) await h.send('collect maker loss ' + maker.capital, await withCheckpoints(
      sdk.getCollectAccountLossInstruction({...common, actor: setup.payer, margin: maker.capital, amount, marketIndex: 0})));
  }
  assert.equal(await settlementPool(), gain);
  const [certificate] = await sdk.deriveSettlementCertificate(setup.venue, 0);
  await h.send('initialize BTC backing', [sdk.getInitializeMarketBackingInstruction({
    ...common, payer: setup.payer, certificate, marketIndex: 0})]);
  for (let step = 0; !sdk.getSettlementCertificateDecoder().decode((await h.read(certificate))!).complete; step++) {
    assert(step < 65, 'Backing scan exceeded the eight-member fixture budget');
    if (step % 4 === 0) await setup.sample();
    const next = await backingStep(h, {...common, certificate, ledger: setup.ledgers[0]}, step === 0);
    await h.send('certify backing ' + step, await withCheckpoints(next.instruction));
  }
  await setup.sample();
  await h.send('pay closed gain', await withCheckpoints(sdk.getPayAccountGainInstruction({
    ...common, actor: setup.payer, margin: trader, amount: gain, marketIndex: 0, certificate})));
  const paid = await root(trader);
  assert.deepEqual([paid.positions[0].virtualScaled, paid.cash, await settlementPool()], [0n, cash + net, 0n]);
  await h.send('withdraw net gain', await withCheckpoints(sdk.getWithdrawFundedAccountInstruction({
    ...common, owner, margin: trader, userToken: setup.traderToken.address, quoteMint: setup.mint.address,
    amount: net, guard: await guard(trader)})), [owner]);
  assert.deepEqual([await tokenBalance(setup.traderToken.address), await tokenBalance(setup.vault), (await root(trader)).cash],
    [startingWallet + net, startingVault - net, cash]);
  await flush();
  journal = await openSettlementJournal(rpc, setup, checks.map(check => String(check.signature)), build);
  await journal.checkpoint('notional-wallet-exit', true);
  const replay = await journal.finish();
  writeFileSync(directory + '/notional-baseline.json', json({revision, program: process.env.RIVALT_ROUTER_REVISION,
    orders, admittedLots, openingFees, closeFee, gain, net, events: replay.events,
    lifecycle: checks.filter(check => ['close admitted inventory', 'pay closed gain', 'withdraw net gain'].includes(String(check.label)))}));
  console.log('Replayed', replay.events, 'events and withdrew', net.toString(), 'collateral atoms');
} finally {
  await journal?.close();
  try { await flush(); } finally { ws.close(); }
}
