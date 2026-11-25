import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {routerBuild} from './execution-router-build.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const directory = process.env.RIVALT_RUN_DIR!;
const build = routerBuild();
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,
  process.env.RIVALT_WS_URL!,directory,{deferFinality:true,
    computeUnitLimit:label=>label.startsWith('multi wallet')?800_000:undefined,
    heapSize:label=>label.startsWith('multi wallet')?128*1024:undefined,
    measureComputeBoundary:label=>label.startsWith('multi wallet')});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined;
try {
  const cash=500_000_000_000n,quantity=163_935n;
  const setup=await liquidityExecutionSetup(h,rpc,{marketCheckpoints:true,marginLayout:'ledger-lanes',traderCount:1,
    makerCash:cash,traderCash:cash,verifyRejections:false,shape:id=>{
      const regions=[{endLots:65_000n,offset:2n+2n*BigInt(id),slope:0n},...symmetricPayoutShape.asks.slice(1)];
      return {...symmetricPayoutShape,shortCap:8_000_000n,longCap:8_000_000n,bids:regions,asks:regions};
    }});
  setup.sourcePrices.btc=61_000_000_000n;
  await setup.qualify();
  const trader=setup.roots[0],owner=setup.traderOwner,makers=setup.instances.slice(0,3);
  const keys=[trader,...setup.markets,...setup.ledgers,...makers.flatMap(maker=>[maker.capital,maker.registration])];
  const dump=()=>Promise.all(keys.map(key=>h.read(key)));
  const order=async()=>sdk.buildMultiMakerRoute({snapshot:await setup.snapshot(trader,0),trader,
    side:0,lots:quantity,marketIndex:0,maxFee:2_000_126n,allInLimit:10_002_628_736n},owner.address);
  const {guard,withCheckpoints}=await executionTestHelpers(h,setup);
  const common={...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  const last=makers[2],leave=33_935n*6_100n;
  await h.send('limit third maker capital',await withCheckpoints(sdk.getWithdrawFundedAccountInstruction({
    ...common,owner:last.owner,margin:last.capital,userToken:last.token.address,quoteMint:setup.mint.address,
    amount:cash-leave,guard:await guard(last.capital)})),[last.owner]);
  await setup.sample();
  await last.publish(setup.updater,60_894n);
  const refused=await order(),before=await dump();
  await h.send('multi wallet last maker lacks initial margin',refused.instructions,[owner],sdk.CLEARING_ERROR__ROUTE_HEALTH);
  assert.deepEqual(await dump(),before);
  await h.send('restore third maker funded cash',await withCheckpoints(await sdk.getDepositAccountInstructionAsync({
    ...common,owner:last.owner,margin:last.capital,userToken:last.token.address,quoteMint:setup.mint.address,amount:cash-leave})),[last.owner]);
  await setup.sample();
  const original=await order(),beforeFill=await setup.snapshot(trader,0);
  await h.send('multi wallet fragmented BTC buy',original.instructions,[owner]);
  const after=await setup.snapshot(trader,0);
  const fills=[65_000n,65_000n,33_935n],prices=[61_002n,61_004n,61_006n];
  const gross=fills.reduce((sum,lots,index)=>sum+lots*prices[index],0n),fee=(gross+4_999n)/5_000n;
  assert.equal(after.roots[trader].positions[0].lots,quantity);
  assert.equal(after.roots[trader].positions[0].virtualScaled,-gross*1_000_000_000n);
  assert.equal(after.roots[trader].cash,cash-fee);
  assert.equal(after.roots[trader].nonce,beforeFill.roots[trader].nonce+1n);
  for (const [id,maker] of makers.entries()) {
    const root=after.roots[maker.capital];
    assert.equal(root.positions[0].lots,-fills[id]);
    assert.equal(root.positions[0].virtualScaled,prices[id]*fills[id]*1_000_000_000n);
    assert.equal(root.cash,cash);
    assert.equal((await maker.registrationState()).buyConsumed,fills[id]);
  }
  const checkpoints=await sdk.venueMarketCheckpoints(setup.venue);
  const fees=checkpoints.find(item=>item.account===setup.ledgers[0])!;
  await h.send('classify whole multi-maker fee',[fees.instruction]);
  const ledger=sdk.getMarketLedgerDecoder().decode((await h.read(setup.ledgers[0]))!);
  assert.equal(ledger.insurance,fee/4n);
  assert.equal(ledger.insuranceFeeRemainder,Number(fee%4n));
  await flush();
  journal=await openSettlementJournal(rpc,setup,checks.map(row=>String(row.signature)),build);
  await journal.checkpoint('fragmented-three',true);
  const replay=await journal.finish();
  writeFileSync(directory+'/multi-maker.json',json({build,quantity,fills,prices,gross,fee,events:replay.events,
    reconciliation:replay.reconciliation,orders:checks.filter(row=>String(row.label).startsWith('multi wallet'))}));
} finally {
  await journal?.close();
  try {await flush();} finally {ws.close();}
}
