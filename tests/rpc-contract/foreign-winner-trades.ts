import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';

/** The isolated trader loses on BTC. The cross trader's BTC gain backs its ETH debt. */
export async function openForeignWinnerBook(h:CanonicalHarness,setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>) {
  const {route}=executionTestHelpers(h,setup);
  const [cross,isolated]=setup.roots,actor=setup.traderOwner;
  await setup.sample();
  await h.send('isolated trader buys BTC at 60002',[await route({trader:isolated,actor,marketIndex:0,side:0,
    makers:[setup.instances[0]],lots:[1n],allInLimit:60_015n,maxFee:13n})],[actor]);
  setup.sourcePrices.btc=55_000_000_000n;
  await setup.qualify();
  await h.send('cross trader sells BTC and leaves the maker flat',[await route({trader:cross,actor,marketIndex:0,
    side:1,makers:[setup.instances[0]],lots:[1n],allInLimit:54_987n,maxFee:11n})],[actor]);
  await setup.sample();
  await h.send('cross trader opens two ETH lots against separate maker capital',[await route({trader:cross,actor,marketIndex:1,
    side:0,makers:[setup.instances[3]],lots:[2n],allInLimit:60_017n,maxFee:13n})],[actor]);
}
