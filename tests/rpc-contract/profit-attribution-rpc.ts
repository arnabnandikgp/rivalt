// Exercise actual candidate fills, a certified payment, a keeper reduction and freeze.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {backingStep,financialRoots} from './membership-scan-helper.js';
import {verifyProfitBuild} from './profit-attribution-build.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const directory=process.env.RIVALT_RUN_DIR!, build=verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!);
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:()=>1_000_000});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined;
try {
  const setup=await liquidityExecutionSetup(h,rpc,{marginLayout:'profit-attribution',shape:symmetricPayoutShape,verifyRejections:false});
  const [trader]=setup.roots,owner=setup.traderOwner,first=setup.instances[0],second=setup.instances[2];
  const {guard,route,root}=executionTestHelpers(h,setup);
  const common={...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  const scale=1_000_000_000n;
  async function checkTrader(lots:bigint,paidPerLot:bigint) {
    const {root,positions}=sdk.decodeProfitAttribution((await h.read(trader))!);
    assert.equal(root.positions[0].lots,lots);
    assert.deepEqual(positions[0],{entryScaled:60_002n*scale,paidScaled:paidPerLot*scale,denominator:1n});
    assert.deepEqual(positions[1],{entryScaled:0n,paidScaled:0n,denominator:1n});
  }
  const bus=async()=>Promise.all([trader,first.capital,first.registration,setup.ledgers[0],setup.markets[0]].map(key=>h.read(key)));
  await setup.sample();
  const original=await bus();
  await h.send('reject risk increase without reserved payment capacity',[await route({actor:owner,trader,marketIndex:0,
    side:0,makers:[first],lots:[129n]})],[owner],sdk.CLEARING_ERROR__CAPACITY);
  assert.deepEqual(await bus(),original);
  await h.send('attribution buy four BTC lots',[await route({actor:owner,trader,marketIndex:0,side:0,makers:[first],lots:[4n]})],[owner]);
  await checkTrader(4n,0n);
  setup.sourcePrices.btc=61_000_000_000n;await setup.qualify();
  await h.send('attribution close two against another maker',[await route({actor:owner,trader,marketIndex:0,side:1,makers:[second],
    lots:[2n],reduceOnly:true,generation:(await root(trader)).positions[0].generation})],[owner]);
  await checkTrader(2n,0n);
  // 1,992 closed atoms and 1,996 still open. Pay all the former plus 500 of the latter.
  await h.send('attribution collect actual maker loss',[sdk.getCollectAccountLossInstruction({...common,
    actor:setup.payer,margin:first.capital,marketIndex:0,amount:2_500n})]);
  const [certificate]=await sdk.deriveSettlementCertificate(setup.venue,0);
  await h.send('initialize backing for attributed payment',[sdk.getInitializeMarketBackingInstruction({...common,
    payer:setup.payer,certificate,marketIndex:0})]);
  const proof=async()=>sdk.getSettlementCertificateDecoder().decode((await h.read(certificate))!);
  for(let step=0;!(await proof()).complete;step++) {
    assert(step<60,'eight-member backing traversal');
    if(step%4===0)await setup.sample();
    const next=await backingStep(h,{...common,certificate,ledger:setup.ledgers[0]},step===0);
    await h.send('certify attributed payment '+step,[next.instruction]);
  }
  await setup.sample();
  await h.send('certified closed-first payment',[sdk.getPayAccountGainInstruction({...common,actor:setup.payer,
    margin:trader,marketIndex:0,amount:2_492n,certificate})]);
  await checkTrader(2n,250n);
  const remainingCash=23_000n;
  await h.send('withdraw free cash before price shock',[sdk.getWithdrawFundedAccountInstruction({...common,owner,margin:trader,
    quoteMint:setup.mint.address,userToken:setup.traderToken.address,amount:(await root(trader)).cash-remainingCash,guard:await guard(trader)})],[owner]);
  setup.sourcePrices.btc=50_000_000_000n;await setup.qualify();
  const before=(await h.read(trader))!;
  await h.send('keeper reduction with pre-funded attribution',[await route({actor:setup.payer,trader,marketIndex:0,side:1,makers:[second],
    lots:[1n],liquidation:true,reduceOnly:true,generation:(await root(trader)).positions[0].generation})]);
  const after=(await h.read(trader))!;
  assert.deepEqual(after.subarray(sdk.getMarginAccountSize()),before.subarray(sdk.getMarginAccountSize()));
  await checkTrader(1n,250n);
  // A separate isolated account flips through two differently priced makers.
  // The trader has one aggregate execution price, independent of the leg order.
  const isolated=setup.roots[1], shifted=setup.instances[1];
  const config=await shifted.state(), publication=shifted.module.getMakerPriceDecoder().decode((await h.read(shifted.price))!).state;
  await h.send('move second maker one atom',[shifted.module.getRepriceInstruction({...shifted.makerCommon,actor:setup.updater,
    expectedControl:config.controlEpoch,expectedSequence:publication.sequence,anchor:50_001n})],[setup.updater]);
  await h.send('two-maker fractional entry',[await route({actor:owner,trader:isolated,marketIndex:0,side:0,
    makers:[first,shifted],lots:[1n,2n]})],[owner]);
  const isolatedBasis=async()=>sdk.decodeProfitAttribution((await h.read(isolated))!).positions[0];
  assert.deepEqual(await isolatedBasis(),{entryScaled:150_008n*scale,paidScaled:0n,denominator:3n});
  await h.send('two-maker aggregate flip',[await route({actor:owner,trader:isolated,marketIndex:0,side:1,
    makers:[first,shifted],lots:[1n,3n]})],[owner]);
  assert.equal((await root(isolated)).positions[0].lots,-1n);
  assert.deepEqual(await isolatedBasis(),{entryScaled:199_995n*scale/4n,paidScaled:0n,denominator:1n});
  const sources={primaryBtc:setup.feeds[0].feed,primaryCollateral:setup.feeds[1].feed,guardBtc:setup.feeds[2].feed,
    guardCollateral:setup.feeds[3].feed,primaryEth:setup.feeds[4].feed,guardEth:setup.feeds[5].feed};
  setup.sourcePrices.btc=25_000_000_000n;await setup.freshSources();
  const resolution=async()=>sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  await h.send('freeze with exact surviving paid profit',[sdk.getFreezeAccountsInstruction({...setup.safetyCommon,...sources,
    caller:setup.payer,target:trader,members:(await sdk.deriveMemberPage(setup.venue,(await root(trader)).id/64n))[0],
    safetyEpoch:sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!).epoch,resolutionEpoch:(await resolution()).epoch,emergency:false})]);
  await flush();
  const frozen=await resolution();
  assert.equal(frozen.stage,2);assert.equal(frozen.prices[0],25_000n);
  assert.deepEqual(await h.read(trader),after);
  const members=await financialRoots(h,setup.venue,setup.registry);
  const rows=await Promise.all(members.map(async key=>{
    const {root,positions}=sdk.decodeProfitAttribution((await h.read(key))!);
    return {key,id:root.id,lots:root.positions.map(position=>position.lots),positions};
  }));
  journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  const cutoff=journal.initialEvents.filter(event=>event.type==='AccountResolutionFrozenV3');
  assert.equal(cutoff.length,1);assert.equal(cutoff[0].data.trigger,trader);
  const history=journal.initialEvents.slice(0,journal.initialEvents.indexOf(cutoff[0]));
  const economic=history.filter(event=>event.type==='LiquidityRouteExecutedV4'||
    (event.type==='AccountFinancialChangedV3'&&event.data.kind===3));
  assert.equal(economic.length,6);
  const probe={rows,economic:economic.map(event=>({kind:event.type,data:event.data})),trader,first:first.capital,second:second.capital};
  execFileSync('python3',['tests/financial/check_profit_attribution.py'],{input:json(probe),stdio:['pipe','inherit','inherit']});
  await journal.checkpoint('frozen-attribution',true);
  const sql=await journal.finish();
  assert.equal(sql.state.roots[trader].cash,'22990');
  const measurements=checks.filter(check=>/attribution buy|attribution close|closed-first payment|keeper reduction|freeze with|reject risk increase|two-maker/.test(String(check.label)));
  writeFileSync(directory+'/profit-attribution.json',json({revision,build,cutoff:cutoff[0].signature,rows,economic:probe.economic,
    financial:measurements,events:sql.events,checks:checks.length,marginBytes:after.length}));
  console.log('Profit attribution',json({events:sql.events,checks:checks.length,marginBytes:after.length}));
} finally {
  await journal?.close();
  try {await flush();}finally{ws.close();}
}
