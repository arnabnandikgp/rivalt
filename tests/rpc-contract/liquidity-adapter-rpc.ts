import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as sdk from '@rivalt/sdk';
import { provisionCanonicalMakers } from './canonical-maker-cases.js';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';

const runDir = process.env.RIVALT_RUN_DIR!;
const { rpc,ws,h,checks } = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,runDir);
const serialize = (value: unknown) => JSON.stringify(value,(_,item) => typeof item === 'bigint' ? item.toString() : item,2)+'\n';
try {
  const fixture = await provisionCanonicalMakers(h);
  const identity = { venue: fixture.venue,mint: fixture.mint.address,domain: sdk.hex(fixture.domain) };
  const observations: unknown[] = [];
  let largestBatch = 0;
  const reader = { async call(method: string,params: unknown[] = []) {
    if (method === 'getMultipleAccounts') largestBatch = Math.max(largestBatch,(params[0] as unknown[]).length);
    const response = await rpc.call(method,params);
    if (method === 'getMultipleAccounts') writeFileSync(`${runDir}/latest-snapshot-batch.json`,serialize({ params,response }));
    return response;
  } };
  // All six real capital roots were created and funded through the deployed
  // clearing program. P31 consumes their real inventory/consumption, never a
  // fabricated successful fill. Financial routes are still gated until P32.
  for (const maker of fixture.instances) {
    const marketIndex = (maker.market === fixture.markets[0] ? 0 : 1) as 0|1;
    for (const side of [0,1] as const) {
      await maker.publish(fixture.owner,10_000n);
      const snapshot = await sdk.readAccountTradeSnapshot(reader,identity,maker.capital,marketIndex);
      assert.equal(snapshot.venueState.profileVersion,4);
      assert.equal(snapshot.safetyState.mode,0);
      assert.equal(snapshot.liquidity?.adapters.length,3);
      const adapter = snapshot.liquidity!.adapters.find(candidate => candidate.registration === maker.registration)!;
      assert.equal(adapter.unavailable,null);
      const rawCapital = (await h.read(maker.capital))!;
      assert.deepEqual(Buffer.from(sdk.getMarginAccountEncoder().encode(adapter.capital)),rawCapital);
      assert.equal(adapter.capital.cash,1_000_000n);
      for (const lots of [1n,3n]) {
        const quoted = adapter.quote(side,lots);
        // Independent golden sums at anchor 10000, inventory/consumption zero:
        // offsets buy=3,15; sell=2,9; potential(1)=0,potential(3)=2.
        const expected = side === 0 ? (lots === 1n ? 10003n : 30017n) : (lots === 1n ? 9998n : 29989n);
        assert.equal(quoted.gross,expected);
        await h.quote(`P31 authenticated ${marketIndex}/${adapter.config.instance}/${side}/${lots}`,
          maker.module.getQuoteCurveInstruction({ config: maker.config,price: maker.price,request: adapter.request(side,lots) }),quoted.gross);
        observations.push({ marketIndex,instance: adapter.config.instance,program: maker.pricingProgram,side,lots,
          quote: quoted,contextSlot: snapshot.contextSlot,slot: snapshot.slot,depthHints: adapter.depthHints(side) });
      }
      assert.throws(() => { (adapter.capital as any).cash = 0n; },TypeError);
    }
  }
  // Profile separation: old V3 route discovery cannot silently price profile 4.
  await assert.rejects(() => sdk.readAccountSnapshot(reader,identity,[fixture.instances[0].capital]),/profile mismatch/);
  const summary = { revision: execFileSync('git',['rev-parse','HEAD'],{ encoding: 'utf8' }).trim(),
    trackedDirty: execFileSync('git',['status','--porcelain','--untracked-files=no'],{ encoding: 'utf8' }).trim() !== '',
    runtime: await rpc.call('getVersion'),genesis: await rpc.call('getGenesisHash'),largestBatch,
    binaries: Object.fromEntries(['clearing','maker_a','maker_b'].map(name => [name,
      createHash('sha256').update(readFileSync(`.local/liquidity-execution/${name}.so`)).digest('hex')])),
    checks,observations,financialTradingActivated: false,wsNotifications: ws.notifications.length };
  writeFileSync(`${runDir}/summary.json`,serialize(summary));
  console.log(`P31: ${observations.length} authenticated exact quote comparisons; ${checks.length} signed RPC/WS outcomes.`);
} finally { ws.close(); }
