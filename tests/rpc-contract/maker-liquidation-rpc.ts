// Real local instruction execution. Gross prices, fees and maintenance shortfalls
// below are derived independently from the two flat quote shapes and signed index.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {getCreateAccountInstruction,getTransferSolInstruction} from '@solana-program/system';
import {getInitializeAccount3Instruction,getMintToInstruction,TOKEN_PROGRAM_ADDRESS} from '@solana-program/token';
import type {Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {registerFinancialTestMargin} from './account-membership-setup.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {goldenShape} from './canonical-maker-cases.js';
import {fixtureKey} from './harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {verifyLiquidationBuild} from './maker-liquidation-build.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const directory=process.env.RIVALT_RUN_DIR!;
const build=verifyLiquidationBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!);
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const scale=1_000_000_000n;
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:()=>800_000});
const shape=(instance:number)=>{
  const endLots=instance===2?10n:4096n,offset=instance===2?2n:1000n;
  const regions=[{endLots,offset,slope:0n},...Array.from({length:7},()=>({endLots:0n,offset:0n,slope:0n}))];
  return {...goldenShape,skewTick:0n,longCap:4096n,shortCap:4096n,bidCount:1,askCount:1,bids:regions,asks:regions};
};
try {
  const setup=await liquidityExecutionSetup(h,rpc,{shape,traderCash:564_000n,verifyRejections:false});
  const {root,route,guard}=executionTestHelpers(h,setup);
  const [target]=setup.roots, owner=setup.traderOwner, keeper=setup.payer;
  const receiverOwner=await fixtureKey('liquidation-backstop'),token=await fixtureKey('liquidation-backstop-token');
  const [portfolio]=await sdk.deriveAccountPortfolio(setup.venue,receiverOwner.address,0);
  const [receiver]=await sdk.deriveMarginAccount(portfolio,1);
  const common={...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  const publicKeys=[...new Set([...setup.tracked,target,receiver,setup.traderToken.address,token.address])];
  const snapshot=()=>Promise.all(publicKeys.map(h.read));
  async function reject(label:string,instruction:Instruction,expected:number,signers:Keypair[]=[]) {
    const prior=await snapshot();
    await h.send('liquidation '+label,[instruction],signers,expected);
    assert.deepEqual(await snapshot(),prior,label);
  }
  await h.send('fund separate local receiver and token account',[
    getTransferSolInstruction({source:keeper,destination:receiverOwner.address,amount:1_000_000_000n}),
    getCreateAccountInstruction({payer:keeper,newAccount:token,lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
    getInitializeAccount3Instruction({account:token.address,mint:setup.mint.address,owner:receiverOwner.address}),
    getMintToInstruction({mint:setup.mint.address,token:token.address,mintAuthority:keeper,amount:100_000n})],[token]);
  await h.send('create separate receiver portfolio',[await sdk.getCreatePortfolioInstructionAsync({...setup.common,owner:receiverOwner,portfolio,index:0})],[receiverOwner]);
  await registerFinancialTestMargin(h,common,keeper,{owner:receiverOwner,portfolio,margin:receiver,subaccountIndex:1,mode:1,isolatedMarketIndex:0,role:0});
  const fund=async(amount:bigint)=>h.send('fund receiver '+amount,[await sdk.getDepositAccountInstructionAsync({...setup.common,
    owner:receiverOwner,margin:receiver,quoteMint:setup.mint.address,userToken:token.address,amount})],[receiverOwner]);
  await fund(1n);
  const forced=async(lots:bigint,instance=2,liquidation=true)=>route({trader:target,actor:keeper,marketIndex:0,side:1,
    makers:[setup.instances[instance]],lots:[lots],liquidation,reduceOnly:true,generation:(await root(target)).positions[0].generation});
  const takeover=async(lots:bigint,signer=receiverOwner)=>sdk.getLiquidateAccountInstruction({...common,receiverOwner:signer,target,receiver,
    targetGuard:await guard(target),receiverGuard:await guard(receiver),marketIndex:0,lots,price:52_000n});
  await setup.sample();
  await h.send('liquidation open 50 BTC lots at 61000',[await route({trader:target,actor:owner,marketIndex:0,side:0,
    makers:[setup.instances[0]],lots:[50n]})],[owner]);
  await reject('healthy target',await forced(1n),sdk.CLEARING_ERROR__LIQUIDATION);
  const slot=await setup.slot();
  await h.send('place target risk-increasing order',[sdk.getManageAccountOrderInstruction({...common,actor:owner,margin:target,
    guard:await guard(target),marketIndex:0,operation:{__kind:'Place',expectedId:1n,terms:{side:0,lots:1n,
      limit:66_000n,feeBudget:100n,startSlot:slot,expirySlot:slot+5000n,trigger:0,threshold:0n,reduceOnly:false,generation:0n}}})],[owner]);
  setup.sourcePrices.btc=52_000_000_000n;
  await setup.qualify();
  const stages:{stage:string;lots:string;cash:string;deficit:string}[]=[];
  async function verifyTarget(stage:string,lots:bigint,cash:bigint,virtual:bigint,expectedDeficit:bigint) {
    const account=await root(target),market=await setup.marketState(0);
    assert.equal(market.lower,51_480n);assert.equal(market.upper,52_520n);
    assert.equal(account.positions[0].lots,lots);assert.equal(account.positions[0].virtualScaled,virtual*scale);
    assert.equal(account.positions[1].lots,0n);assert.equal(account.cash,cash);
    assert.equal(market.fundingIndexScaled,0n);assert.equal(market.oracle.premiumScaled,0n);
    const claim=lots*51_480n+virtual,equity=cash+(claim<0n?claim:0n);
    const gap=(lots*52_520n+19n)/20n-equity,deficit=gap>0n?gap:0n;
    assert.equal(deficit,expectedDeficit);
    stages.push({stage,lots:String(lots),cash:String(cash),deficit:String(deficit)});
  }
  await verifyTarget('Below maintenance',50n,563_390n,-3_050_000n,43_910n);
  // Expire the signed sources, then restore through the same oracle/publisher entrypoints.
  await setup.waitUntil((await setup.marketState(0)).oracle.sourceDeadline);
  await reject('expired sources',await forced(1n),sdk.CLEARING_ERROR__ORACLE_POLICY);
  await setup.qualify();
  await reject('ordinary route requires target authority',await forced(1n,2,false),sdk.CLEARING_ERROR__AUTHORITY);
  await reject('wide maker outside adverse oracle price',await forced(1n,0),sdk.CLEARING_ERROR__ROUTE_LIMIT);
  await reject('cannot request eleven tight lots',await forced(11n),sdk.CLEARING_ERROR__MAKER_QUOTE);
  const fill=await forced(10n);
  assert((await root(target)).reserved>0n);
  await h.send('liquidation keeper sells ten lots to maker B',[fill]);
  await verifyTarget('Maker filled ten',40n,563_286n,-2_530_020n,12_574n);
  assert.equal((await root(target)).reserved,0n);
  assert.equal((await root(setup.instances[2].capital)).positions[0].lots,10n);
  assert.equal((await setup.instances[2].registrationState()).sellConsumed,10n);
  await reject('competing maker original is stale',fill,sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);
  await reject('tight book exhausted',await forced(1n),sdk.CLEARING_ERROR__MAKER_QUOTE);
  await reject('remaining wide maker outside limit',await forced(1n,1),sdk.CLEARING_ERROR__ROUTE_LIMIT);
  await reject('receiver must consent',await takeover(5n,keeper),sdk.CLEARING_ERROR__AUTHORITY);
  await reject('receiver cannot finance five lots',await takeover(5n),sdk.CLEARING_ERROR__ARITHMETIC,[receiverOwner]);
  assert.equal(sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!).mode,1);
  await verifyTarget('No eligible liquidity or funded receiver',40n,563_286n,-2_530_020n,12_574n);
  await fund(99_999n);
  const transfer=await takeover(5n);
  await h.send('liquidation funded receiver takes five lots',[transfer],[receiverOwner]);
  await verifyTarget('Receiver restores maintenance',35n,563_156n,-2_270_020n,0n);
  const received=await root(receiver);
  assert.equal(received.cash,100_130n);assert.equal(received.positions[0].lots,5n);
  assert.equal(received.positions[0].virtualScaled,-260_000n*scale);
  await reject('competing receiver original is stale',transfer,sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE,[receiverOwner]);
  await reject('liquidation stops at restored maintenance',await forced(1n),sdk.CLEARING_ERROR__LIQUIDATION);
  await h.send('liquidation receiver unwinds at the remaining wide bid',[await route({trader:receiver,actor:receiverOwner,
    marketIndex:0,side:1,makers:[setup.instances[0]],lots:[5n],reduceOnly:true,generation:received.positions[0].generation})],[receiverOwner]);
  const unwound=await root(receiver);
  assert.equal(unwound.cash,100_079n);assert.equal(unwound.positions[0].lots,0n);
  assert.equal(unwound.positions[0].virtualScaled,-5000n*scale);
  await flush();
  const journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  try {
    await journal.checkpoint('maker-liquidation');
    const replay=await journal.finish();
    const summary={revision,artifactSet:build.artifactSet,stages,events:replay.events,
      results:checks.filter(check=>String(check.label).startsWith('liquidation '))};
    writeFileSync(directory+'/liquidation.json',json(summary));
    console.log('Maker liquidation',json({stages,events:replay.events}));
  } finally {await journal.close();}
} finally {try {await flush();}finally{ws.close();}}
