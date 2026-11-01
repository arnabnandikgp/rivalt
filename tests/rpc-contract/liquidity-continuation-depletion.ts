// Separate from timed offers: actually exhaust each treatment maker's declared
// one-lot ask side, then prove only an explicit replenishment restores it.
import assert from 'node:assert/strict';
import type {Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type { CanonicalHarness } from './canonical-maker-cases.js';
import type { liquidityExecutionSetup } from './liquidity-execution-setup.js';
import { executionTestHelpers } from './liquidity-execution-helpers.js';
import { comparisonShape } from './liquidity-continuation-setup.js';
import { candidates, referenceQuote, auditFill } from './liquidity-continuation-model.js';

export async function depletionSupplement(h: CanonicalHarness, setup: Awaited<ReturnType<typeof liquidityExecutionSetup>>, cohort?:Address[]) {
  const helpers = executionTestHelpers(h, setup), trader = setup.roots[1], results = [];
  const members = cohort ?? [...setup.instances.map(maker => maker.capital), ...setup.roots];
  const initialCash = (await Promise.all(members.map(helpers.root))).reduce((sum, root) => sum + root.cash, 0n);
  const initialLedger = sdk.getMarketLedgerDecoder().decode((await h.read(setup.ledgers[0]))!);
  for (const [instance, maker] of setup.instances.slice(0, 3).entries()) {
    const original = comparisonShape('treatment', instance);
    const shallow = { ...original, askCount: 1,
      asks: [{ endLots: 1n, offset: 20n, slope: 0n }, ...Array.from({ length: 7 }, () => ({ endLots: 0n, offset: 0n, slope: 0n }))] };
    const shape = async (value: sdk.makerA.LiquidityShapeArgs) => {
      const config = await maker.state(), registration = await maker.registrationState();
      await h.send('supplement treatment shape', [sdk.getControlLiquidityInstruction({ ...maker.controlCommon,
        expectedAuthority: registration.authorityEpoch, expectedControl: config.controlEpoch, expectedShape: config.shapeEpoch,
        action: { __kind: 'Shape', fields: [value] } })], [setup.owner]);
    };
    const replenish = async () => {
      const registration = await maker.registrationState();
      await h.send('supplement explicit treatment replenishment', [sdk.getReplenishLiquidityInstruction({ ...maker.controlCommon,
        expectedAuthority: registration.authorityEpoch, expectedDepth: registration.depthEpoch, sides: 1 })], [setup.owner]);
    };
    await replenish(); await shape(shallow); await setup.qualify();
    const snapshot = await setup.snapshot(trader), model = candidates(snapshot, 'treatment').find(value => value.instance === instance)!;
    const expectedGross = referenceQuote(model, 0, 1n); assert(expectedGross !== null);
    const expectedFee = (expectedGross + 4999n) / 5000n;
    const beforeTrader = await helpers.root(trader), beforeMaker = await helpers.root(maker.capital);
    const route = () => helpers.route({ trader, actor: setup.traderOwner, marketIndex: 0, side: 0, makers: [maker], lots: [1n] });
    await h.send('supplement route exhaust declared ask', [await route()], [setup.traderOwner]);
    auditFill(beforeTrader, await helpers.root(trader), 0, 1n, expectedGross, expectedFee, true);
    auditFill(beforeMaker, await helpers.root(maker.capital), 0, 1n, expectedGross, 0n, false);
    const consumed = await maker.registrationState(); assert.equal(consumed.buyConsumed, 1n);
    await maker.publish(setup.updater, 60_000n);
    assert.deepEqual(await maker.registrationState(), consumed, 'Price-only update cannot restore exhausted liquidity');
    const watched = [trader, maker.capital, maker.registration, setup.custody, setup.markets[0], setup.ledgers[0]];
    const beforeRejection = await Promise.all(watched.map(h.read));
    await h.send('supplement route depleted ask rejects', [await route()], [setup.traderOwner], sdk.CLEARING_ERROR__MAKER_QUOTE);
    assert.deepEqual(await Promise.all(watched.map(h.read)), beforeRejection);
    await replenish();
    const restored = await maker.registrationState();
    assert.equal(restored.buyConsumed, 0n); assert.equal(restored.depthEpoch, consumed.depthEpoch + 1n);
    await shape(original);
    // Restore full coverage before the next maker's independent depletion case.
    await setup.qualify();
    results.push({ instance, expectedGross, expectedFee, beforeDepth: consumed.depthEpoch,
      afterDepth: restored.depthEpoch, depleted: true, repricePreservedDepletion: true });
  }
  const fees = results.reduce((sum, result) => sum + result.expectedFee, 0n);
  const custody = sdk.getCustodyDecoder().decode((await h.read(setup.custody))!);
  const ledger = sdk.getMarketLedgerDecoder().decode((await h.read(setup.ledgers[0]))!);

  assert.equal(ledger.insurance + ledger.fees, initialLedger.insurance + initialLedger.fees + fees);
  const roots = await Promise.all((cohort??[...setup.instances.map(maker => maker.capital), ...setup.roots]).map(helpers.root));
  assert.equal(roots.reduce((sum, root) => sum + root.cash, 0n), initialCash - fees);
  const ledgers = await Promise.all(setup.ledgers.map(async key => sdk.getMarketLedgerDecoder().decode((await h.read(key))!)));
  assert.equal(custody.allocatedVault, initialCash - fees + ledgers.reduce((sum, item) => sum + item.settlement + item.insurance + item.fees, 0n));
  for (const index of [0, 1]) {
    const market = await setup.marketState(index);
    assert.equal(roots.reduce((sum, root) => sum + root.positions[index].lots, 0n), 0n);
    assert.equal(roots.reduce((sum, root) => { const position = root.positions[index];
      return sum + position.virtualScaled - position.lots * (market.fundingIndexScaled - position.fundingCheckpointScaled); }, 0n), 0n);
  }
  return results;
}
