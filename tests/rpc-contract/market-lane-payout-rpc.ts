// A complete BTC backing certificate is already live when an unrelated fill
// changes covered positions. Follow a closed gain from maker loss to wallet.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {getTokenDecoder} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {backingStep,financialRoots} from './membership-scan-helper.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {verifyProfitBuild} from './profit-attribution-build.js';

const directory=process.env.RIVALT_RUN_DIR!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const build=verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,false,false,false,false,'lane');
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,{deferFinality:true});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined;
try {
  const setup=await liquidityExecutionSetup(h,rpc,{shape:symmetricPayoutShape,marginLayout:'market-lanes',marketCheckpoints:true,verifyRejections:false});
  const {root,route,guard}=executionTestHelpers(h,setup);
  const [trader,neighbor]=setup.roots,owner=setup.traderOwner;
  const [makerA,makerOther,makerB]=setup.instances;
  assert.notEqual(makerA.pricingProgram,makerB.pricingProgram);
  const common={...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  const both=()=>Promise.all(([0,1] as const).map(setup.checkpoint));
  const [certificate]=await sdk.deriveSettlementCertificate(setup.venue,0);
  const proof=async()=>sdk.getSettlementCertificateDecoder().decode((await h.read(certificate))!);
  const ledger=async()=>sdk.decodeFeeLedger((await h.read(setup.ledgers[0]))!).state;
  const wallet=async()=>getTokenDecoder().decode((await h.read(setup.traderToken.address))!).amount;
  const keys=await financialRoots(h,setup.venue,setup.registry);
  assert.equal(keys.length,8);
  const initialWallet=await wallet(),initialCash=(await root(trader)).cash;
  const fill=async(label:string,account:typeof trader,side:0|1,maker:typeof makerA)=>{
    await h.send(label,[await route({trader:account,actor:owner,marketIndex:0,side,lots:[1n],makers:[maker],minimalMarkets:true,marketLane:true})],[owner]);
  };
  await setup.sample();
  await fill('open claimant against maker A',trader,0,makerA);
  setup.sourcePrices.btc=61_000_000_000n;
  await setup.qualify();
  await fill('close claimant against maker B',trader,1,makerB);
  const gain=996n,fees=26n; // 60,998 sale less 60,002 purchase. Each fill costs 13.
  const closed=await root(trader);
  assert.deepEqual([closed.positions[0].lots,closed.positions[0].virtualScaled,closed.cash],[0n,gain*1_000_000_000n,initialCash-fees]);
  await h.send('collect the maker loss into the BTC pool',[...await both(),sdk.getCollectAccountLossInstruction({
    ...common,actor:setup.payer,margin:makerA.capital,marketIndex:0,amount:gain})]);
  assert.equal((await ledger()).settlement,gain);
  await h.send('initialize BTC backing check',[sdk.getInitializeMarketBackingInstruction({...setup.common,payer:setup.payer,certificate,marketIndex:0})]);
  const pay=()=>sdk.getPayAccountGainInstruction({...common,actor:setup.payer,margin:trader,marketIndex:0,amount:gain,certificate});
  await h.send('refuse payout without completed coverage',[...await both(),pay()],[],sdk.CLEARING_ERROR__EXIT_COHORT);
  assert.deepEqual(await root(trader),closed);
  for(let step=0;!(await proof()).complete;step++){
    assert(step<60,'bounded eight-root traversal');
    if(step%4===0)await setup.sample();
    const next=await backingStep(h,{...common,certificate,ledger:setup.ledgers[0]},step===0);
    await h.send('scan BTC backing '+step,[...await both(),next.instruction]);
  }
  const complete=await proof(),priorBacking=(await ledger()).backing;
  assert.equal(complete.next,8n);
  await setup.sample();
  await fill('fill on a fully scanned BTC backing book',neighbor,0,makerOther);
  const account=await root(neighbor),maker=await root(makerOther.capital);
  assert.deepEqual([account.positions[0].lots,maker.positions[0].lots],[1n,-1n]);
  const snapshot=await sdk.readAccountSnapshot(rpc,setup.identity,[trader],'confirmed');
  const backing=snapshot.ledgerStates[0].backing,summary=sdk.decodeBackingSummary(backing.summary);
  assert.equal(backing.epoch,priorBacking.epoch);
  assert.notDeepEqual(backing.summary,priorBacking.summary,'the fill changes the active proof');
  const members=await Promise.all(keys.map(root));
  const values=members.map(member=>{
    const position=member.positions[0];return position.virtualScaled+position.lots*position.fundingCheckpointScaled;
  });
  assert.deepEqual([summary.count,summary.bad,summary.quantity,summary.positive,summary.negative],[8n,0n,0n,
    values.reduce((sum,value)=>sum+(value>0n?value:0n),0n),values.reduce((sum,value)=>sum+(value<0n?-value:0n),0n)]);
  await h.send('pay fully backed closed BTC profit',[...await both(),pay()]);
  const paid=await root(trader);
  assert.deepEqual([paid.cash,paid.positions[0].virtualScaled,(await ledger()).settlement],[initialCash-fees+gain,0n,0n]);
  const net=gain-fees;
  await h.send('withdraw settled net profit to the wallet',[...await both(),sdk.getWithdrawFundedAccountInstruction({...common,owner,
    margin:trader,userToken:setup.traderToken.address,quoteMint:setup.mint.address,amount:net,guard:await guard(trader)})],[owner]);
  assert.deepEqual([(await root(trader)).cash,await wallet()],[initialCash,initialWallet+net]);
  await flush();
  journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  await journal.checkpoint('paid-and-withdrawn',true);
  const replay=await journal.finish();
  const result={revision,sbf:build.revision,closedGain:gain,tradingFees:fees,netWallet:net,members:keys.length,events:replay.events,outcomes:checks.length};
  writeFileSync(directory+'/market-lane-payout.json',json(result));console.log(json(result));
}finally{await journal?.close();try{await flush();}finally{ws.close();}}
