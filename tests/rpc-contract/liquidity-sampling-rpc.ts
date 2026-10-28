// Scoped P32 sampler/resource probe. No trading activation or full-phase claim.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { getTransferSolInstruction } from '@solana-program/system';
import * as sdk from '@rivalt/sdk';
import { provisionCanonicalMakers,goldenShape } from './canonical-maker-cases.js';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';
import { feedAddress,initializeFeed,publishFeed } from './oracle-fixture.js';

const runDir = process.env.RIVALT_RUN_DIR!;
const { rpc,ws,h,checks,conformance } = await openCanonicalRpcHarness(
  process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,runDir,
  { computeUnitLimit: label => label.startsWith('P32 sample') ? 1_400_000 : 400_000 });
const serialize = (value: unknown) => JSON.stringify(value,(_,item) => typeof item === 'bigint' ? item.toString() : item,2)+'\n';
const clock = async () => (await h.read(sdk.ACCOUNT_CLOCK))!;
const now = async () => (await clock()).readBigInt64LE(32);
const waitUntil = async (time: bigint) => {
  const deadline = Date.now() + 20_000;
  while (await now() < time) { assert(Date.now() < deadline,'Clock progress'); await delay(100); }
};
try {
  const shape = { ...goldenShape,skewStep: 512n,skewTick: 2n,longCap: 4096n,shortCap: 4096n,bidCount: 8,askCount: 8,
    bids: Array.from({ length: 8 },(_,index) => ({ endLots: BigInt((index+1)*512),offset: BigInt(1+2*index),slope: 0n })),
    asks: Array.from({ length: 8 },(_,index) => ({ endLots: BigInt((index+1)*512),offset: BigInt(3+2*index),slope: 0n })) };
  const fixture = await provisionCanonicalMakers(h,shape,[0]);
  const makers = fixture.instances.slice(0,3), sources = await Promise.all([0,1,2,3].map(feedAddress));
  const authorities = [sources[0].authority,sources[2].authority];
  await h.send('fund controlled local sources',authorities.map(authority => getTransferSolInstruction({
    source: fixture.payer,destination: authority.address,amount: 100_000_000n })));
  for (const [index,source] of sources.entries()) await h.send(`initialize source ${index}`,[await initializeFeed(index)],[source.authority]);
  await h.send('initialize profile4 source bindings',[sdk.getInitializeLiquidityOracleV4Instruction({
    ...fixture.common,authority: fixture.payer,market: fixture.markets[0],primary: authorities[0].address,guard: authorities[1].address })]);
  const sampleAccounts = { ...fixture.common,payer: fixture.payer,market: fixture.markets[0],registry: makers[0].liquidityRegistry,
    primaryAsset: sources[0].feed,primaryCollateral: sources[1].feed,guardAsset: sources[2].feed,guardCollateral: sources[3].feed,
    firstCapital: makers[0].capital,firstRegistration: makers[0].registration,firstProgram: makers[0].pricingProgram,
    firstProgramData: makers[0].controlCommon.programData,firstConfig: makers[0].config,firstPrice: makers[0].price,
    secondCapital: makers[1].capital,secondRegistration: makers[1].registration,secondProgram: makers[1].pricingProgram,
    secondProgramData: makers[1].controlCommon.programData,secondConfig: makers[1].config,secondPrice: makers[1].price,
    thirdCapital: makers[2].capital,thirdRegistration: makers[2].registration,thirdProgram: makers[2].pricingProgram,
    thirdProgramData: makers[2].controlCommon.programData,thirdConfig: makers[2].config,thirdPrice: makers[2].price };
  const marketState = async () => sdk.getMarketV3Decoder().decode((await h.read(fixture.markets[0]))!);
  const observations: unknown[] = [];
  async function publish(anchor: bigint,count = 3) {
    const instructions = await Promise.all(makers.slice(0,count).map(async maker => {
      const config = await maker.state(),price = maker.module.getMakerPriceV4Decoder().decode((await h.read(maker.price))!).state;
      return maker.module.getRepriceV4Instruction({ ...maker.makerCommon,actor: fixture.updater,
        expectedControl: config.controlEpoch,expectedSequence: price.sequence,anchor });
    }));
    await h.send('fresh bounded maker publications',instructions,[fixture.updater]);
  }
  async function fresh(anchor: bigint,count = 3) {
    const time = await now();
    await h.send('fresh independent source observations',await Promise.all(sources.map((_,index) =>
      publishFeed(index,time,{ price: index % 2 === 0 ? anchor * 1_000_000n : 1_000_000n }))),authorities);
    await publish(anchor,count);
  }
  async function sample(label: string,expected: { quantity: bigint; bid: bigint; ask: bigint } | null) {
    await waitUntil((await marketState()).oracle.sampledAt + 2n);
    const keys = makers.flatMap(maker => [maker.capital,maker.registration,maker.config,maker.price]);
    const before = await Promise.all(keys.map(h.read));
    await h.send(`P32 sample ${label}`,[sdk.getSampleLiquidityV4Instruction(sampleAccounts)]);
    assert.deepEqual(await Promise.all(keys.map(h.read)),before,'sample changed maker capital/orders/depth/publications');
    const market = await marketState();
    if (expected) {
      assert.equal(market.oracle.quantity,expected.quantity);
      assert.equal(market.oracle.bid,expected.bid);
      assert.equal(market.oracle.ask,expected.ask);
      assert.equal(market.oracle.premiumScaled,1_000_000_000n);
      const prices = await Promise.all(makers.map(async maker => maker.module.getMakerPriceV4Decoder().decode((await h.read(maker.price))!).state));
      assert.equal(market.oracle.heldUntil,prices.reduce((earliest,price) => earliest < price.updatedTime+6n ? earliest : price.updatedTime+6n,
        market.oracle.sampledAt+6n));
    } else {
      assert.equal(market.oracle.quantity,0n);
      assert.equal(market.oracle.status,1);
    }
    observations.push({ label,market });
  }
  await fresh(60_000n);
  await sample('100-lot full coverage',{ quantity: 100n,bid: 5_999_900n,ask: 6_000_300n });
  await fresh(10_000n);
  // Independent literal optimum: two identical curves avoid the step at512;
  // buy=Q*(10000+3), sell=Q*(10000-1). No SDK optimizer computes this expected.
  await sample('maximum 600-lot three-maker search',{ quantity: 600n,bid: 5_999_400n,ask: 6_001_800n });
  const third = makers[2],thirdConfig = await third.state();
  await h.send('zero-cap required input control',[sdk.getControlLiquidityV4Instruction({ ...third.controlCommon,
    expectedAuthority: 1n,expectedControl: thirdConfig.controlEpoch,expectedShape: thirdConfig.shapeEpoch,
    action: { __kind: 'Shape',fields: [{ ...shape,longCap: 0n,shortCap: 0n }] } })],[fixture.owner]);
  const controlled = await marketState();
  assert.equal(controlled.oracle.heldUntil,controlled.oracle.sampledAt);
  assert.equal(controlled.oracle.validSince,0n);
  await fresh(10_000n);
  await sample('fresh zero-cap third input remains required',{ quantity: 600n,bid: 5_999_400n,ask: 6_001_800n });
  const thirdPrice = third.module.getMakerPriceV4Decoder().decode((await h.read(third.price))!).state;
  await waitUntil(thirdPrice.updatedTime+6n);
  await fresh(10_000n,2);
  await sample('expired zero-cap third input invalidates complete coverage',null);
  const parity = await conformance.finish(runDir,[{ program: sdk.CLEARING_PROGRAM_ADDRESS,name: 'marketV3',key: fixture.markets[0] }],h.read);
  assert.equal(sdk.getSafetyV3Decoder().decode((await h.read(fixture.safety))!).mode,0);
  writeFileSync(`${runDir}/summary.json`,serialize({ revision: execFileSync('git',['rev-parse','HEAD'],{ encoding: 'utf8' }).trim(),
    trackedDirty: execFileSync('git',['status','--porcelain','--untracked-files=no'],{ encoding: 'utf8' }).trim() !== '',
    build: JSON.parse(readFileSync('.local/liquidity-execution/build-manifest.json','utf8')),
    runtime: await rpc.call('getVersion'),genesis: await rpc.call('getGenesisHash'),checks,observations,parity,
    binaries: Object.fromEntries(['clearing','maker_a','maker_b','oracle_fixture'].map(name => [name,
      createHash('sha256').update(readFileSync(`.local/liquidity-execution/${name}.so`)).digest('hex')])),
    financialTradingActivated: false,phaseAcceptance: false }));
  console.log(`P32 sampler probe: ${observations.length} actual observations, ${checks.length} signed RPC/WS outcomes. Trading disabled.`);
} finally { ws.close(); }
