import { createInterface } from 'node:readline';
import { liquidityFixture } from '../../packages/sdk/test-support/liquidity-fixture.js';
import { allocateLiquidityRoute } from '../../packages/sdk/src/liquidity-allocation.js';

// The independent Python oracle supplies economic inputs, never expected results.
for await (const line of createInterface({ input: process.stdin,crlfDelay: Infinity })) {
  try {
    const vector = JSON.parse(line), { input,root,makers } = liquidityFixture();
    const applyRoot = (target: typeof root,source: any) => {
      target.cash = BigInt(source.cash);
      source.positions.forEach((position: any,index: number) => Object.assign(target.positions[index],{
        lots: BigInt(position.q),virtualScaled: BigInt(position.v),fundingCheckpointScaled: BigInt(position.f),generation: BigInt(position.g),
      }));
      source.orders.forEach((order: any,index: number) => {
        target.book.orders[index].marketIndex = order.market;
        Object.assign(target.book.orders[index].order,{ id: BigInt(index+1),version: 1n,state: order.state,termsEpoch: 1n,
          side: order.side,lots: BigInt(order.lots),filled: BigInt(order.filled),notional: BigInt(order.prefix),feeCharged: BigInt(order.paid),
          feeBudget: BigInt(order.budget),limit: BigInt(order.limit),startSlot: 1n,expirySlot: 1000n,
          reduceOnly: order.reduce,generation: BigInt(order.g),trigger: 0 });
      });
    };
    applyRoot(root,vector.root);input.lots = BigInt(vector.lots);input.side = vector.side;input.reduceOnly = vector.reduce;
    input.allInLimit = BigInt(vector.limit);input.maxFee = BigInt(vector.fee);
    input.funding = vector.funding.map(BigInt);input.sources = vector.sources;
    if (vector.stored !== null) { const order = root.book.orders[vector.stored].order;
      input.stored = { id: order.id,version: order.version,filled: order.filled }; }
    for (const [index,maker] of makers.entries()) {
      const source = vector.makers[index];applyRoot(maker.capital,source);
      maker.price.anchor = BigInt(source.anchor);maker.unavailable = source.unavailable;
      maker.registrationState.buyConsumed = BigInt(source.consumed);maker.registrationState.sellConsumed = BigInt(source.consumed);
      maker.shape = { ...maker.shape,mode: source.mode,target: BigInt(source.target),skewStep: BigInt(source.step),skewTick: BigInt(source.tick),
        longCap: BigInt(source.cap),shortCap: BigInt(source.cap),
        bids: source.regions.map((region: number[]) => ({ endLots: BigInt(region[0]),offset: BigInt(region[1]),slope: BigInt(region[2]) })),
        asks: source.regions.map((region: number[]) => ({ endLots: BigInt(region[0]),offset: BigInt(region[1]),slope: BigInt(region[2]) })),
      };
    }
    input.makers = vector.permutation.map((index: number) => makers[index]);
    const result = allocateLiquidityRoute(input).allocation;
    const answer = result ? { gross: result.grossQuote,fee: result.fee,allIn: result.allIn,
      legs: result.legs.map(leg => [leg.instance,leg.lots]) } : null;
    process.stdout.write(JSON.stringify(answer,(_,value) => typeof value === 'bigint' ? value.toString() : value)+'\n');
  } catch (error) { process.stdout.write(JSON.stringify({ rejected: true,message: String(error) })+'\n'); }
}
