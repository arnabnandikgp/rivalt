import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';

type Setup=Awaited<ReturnType<typeof liquidityExecutionSetup>>;

export async function openSharedInventory(h:CanonicalHarness,setup:Setup,smallWinnerEntry?:bigint,population=false) {
  const {route,root}=executionTestHelpers(h,setup);
  const actor=setup.traderOwner;
  for(const [index,trader] of setup.roots.slice(0,population?3:2).entries()) {
    const reference=60_000n+BigInt(index)*(population?1n:4n);
    setup.sourcePrices.btc=reference*1_000_000n;
    if(index===0)await setup.sample();else await setup.qualify();
    await h.send('open debtor BTC lot against distinct maker '+index,[await route({trader,actor,marketIndex:0,
      side:0,makers:[setup.instances[population?index:2*index]],lots:[1n],allInLimit:reference+15n,maxFee:13n})],[actor]);
  }
  if(smallWinnerEntry===undefined)return;
  const trader=setup.roots[2],fee=(smallWinnerEntry+4999n)/5000n;
  setup.sourcePrices.btc=(smallWinnerEntry+2n)*1_000_000n;
  await setup.qualify();
  await h.send('third trader leaves the first BTC maker flat with unpaid profit',[await route({trader,actor,
    marketIndex:0,side:1,makers:[setup.instances[0]],lots:[1n],allInLimit:smallWinnerEntry-fee,maxFee:fee})],[actor]);
  setup.sourcePrices.btc=(smallWinnerEntry-2n)*1_000_000n;
  await setup.qualify();
  await h.send('close third trader with a newly exposed maker',[await route({trader,actor,marketIndex:0,
    side:0,makers:[setup.instances[1]],lots:[1n],allInLimit:smallWinnerEntry+fee,maxFee:fee,reduceOnly:true,
    generation:(await root(trader)).positions[0].generation})],[actor]);
}
