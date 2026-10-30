// P41: real signed optional-market transitions and a fresh PostgreSQL replay.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {AccountRole,type Address,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {LiquidityIndexer} from '../../packages/indexer/src/liquidity-indexer.js';
import {json} from '../../packages/indexer/src/events.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {initializationSignature,fetchScopedHistory} from './liquidity-journal.js';
import {transactionLocks} from '../performance/lock-model.js';

const directory=process.env.RIVALT_RUN_DIR!,databaseUrl=process.env.RIVALT_DATABASE_URL!;
assert(databaseUrl,'Actual PostgreSQL required');
const {h,rpc,ws,checks,conformance,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:()=>800_000});
let indexer:LiquidityIndexer|undefined,replay:LiquidityIndexer|undefined;
const isolated:{label:string;omitted:Address[]}[]=[];
try {
  const setup=await liquidityExecutionSetup(h,rpc,{verifyRejections:false}),helper=executionTestHelpers(h,setup);
  const {root,guard}=helper,owner=setup.traderOwner,[cross,btcOnly]=setup.roots;
  const omit=(instruction:Instruction,market:Address):Instruction=>({...instruction,accounts:instruction.accounts!.map(meta=>
    meta.address===market?{address:sdk.CLEARING_PROGRAM_ADDRESS,role:AccountRole.READONLY}:meta)});
  const sendIsolated=async(label:string,instruction:Instruction,omitted:Address[])=>{
    const before=await Promise.all(omitted.map(h.read));
    await h.send(label,[instruction],[owner]);
    assert.deepEqual(await Promise.all(omitted.map(h.read)),before,'Omitted market bytes/revision must not change');
    assert(omitted.every(key=>!instruction.accounts!.some(meta=>meta.address===key)));
    isolated.push({label,omitted});
  };
  const route=async(trader:Address,marketIndex:0|1,side:0|1=0)=>helper.route({trader,actor:owner,marketIndex,side,
    makers:[setup.instances[marketIndex*3]],lots:[1n],minimalMarkets:true});
  const financial={...setup.common,owner,quoteMint:setup.mint.address,userToken:setup.traderToken.address};
  await sendIsolated('P41 flat funded exit without markets',sdk.getWithdrawFundedAccountInstruction({...financial,margin:cross,
    guard:await guard(cross),amount:1n}),setup.markets);
  assert.equal((await root(cross)).cash,999_999n);
  await setup.sample();
  const ethPosition=(await root(btcOnly)).positions[1],ethReserve=(await root(btcOnly)).book.reserveObservations[1];
  await sendIsolated('P41 isolated BTC fill',await route(btcOnly,0),[setup.markets[1]]);
  assert.equal((await root(btcOnly)).cash,999_987n);
  assert.deepEqual((await root(btcOnly)).positions[1],ethPosition);
  assert.equal((await root(btcOnly)).book.reserveObservations[1],ethReserve);
  const transfer=sdk.getTransferFundedAccountInstruction({...financial,donor:cross,recipient:btcOnly,btc:setup.markets[0],
    guard:await guard(cross),amount:1n});
  const beforeTransfer=await Promise.all(setup.roots.map(root));
  await h.send('P41 transfer cannot omit receiver BTC',[omit(transfer,setup.markets[0])],[owner],sdk.CLEARING_ERROR__ORDER_STATE);
  assert.deepEqual(await Promise.all(setup.roots.map(root)),beforeTransfer);
  await sendIsolated('P41 transfer includes receiver only market',transfer,[setup.markets[1]]);
  assert.equal((await root(cross)).cash,999_998n);assert.equal((await root(btcOnly)).cash,999_988n);

  await setup.sample();
  const slot=await setup.slot(),orderAccounts={...setup.common,actor:owner,margin:cross,eth:setup.markets[1]};
  await sendIsolated('P41 ETH order without BTC',sdk.getManageAccountOrderInstruction({...orderAccounts,guard:await guard(cross),marketIndex:1,
    operation:{__kind:'Place',expectedId:1n,terms:{side:0,lots:1n,limit:33_000n,feeBudget:100n,startSlot:slot,
      expirySlot:slot+200n,trigger:0,threshold:0n,reduceOnly:false,generation:0n}}}),[setup.markets[0]]);
  const requiredOrder=await route(cross,0),beforeOrder=await root(cross);
  await h.send('P41 BTC route cannot omit active ETH order',[omit(requiredOrder,setup.markets[1])],[owner],sdk.CLEARING_ERROR__ORDER_STATE);
  assert.deepEqual(await root(cross),beforeOrder);
  await sendIsolated('P41 cancel ETH without BTC',sdk.getManageAccountOrderInstruction({...orderAccounts,guard:await guard(cross),marketIndex:1,
    operation:{__kind:'Cancel',id:1n,version:1n,protectionGroup:false}}),[setup.markets[0]]);
  await setup.sample();
  await sendIsolated('P41 cross ETH-only fill',await route(cross,1),[setup.markets[0]]);
  assert.equal((await root(cross)).cash,999_991n);
  const coupled=await route(cross,0),beforeCoupled=await root(cross);
  assert(coupled.accounts!.some(meta=>meta.address===setup.markets[1]&&meta.role===AccountRole.WRITABLE));
  await h.send('P41 route cannot omit open ETH loss',[omit(coupled,setup.markets[1])],[owner],sdk.CLEARING_ERROR__ORDER_STATE);
  assert.deepEqual(await root(cross),beforeCoupled);
  await h.send('P41 coupled cross fill consumes both markets',[coupled],[owner]);
  assert.equal((await root(cross)).cash,999_978n);
  await setup.sample();
  await h.send('P41 close ETH retains fractional or whole claim',[await route(cross,1,1)],[owner]);
  const claimRoot=await root(cross);assert.equal(claimRoot.positions[1].lots,0n);
  assert(claimRoot.positions[1].virtualScaled<0n,'Adverse five-atom round-trip spread plus funding stays unpaid');
  const claimWithdrawal=sdk.getWithdrawFundedAccountInstruction({...financial,margin:cross,btc:setup.markets[0],eth:setup.markets[1],guard:await guard(cross),amount:1n});
  await h.send('P41 cannot omit flat negative ETH claim',[omit(claimWithdrawal,setup.markets[1])],[owner],sdk.CLEARING_ERROR__ORDER_STATE);
  assert.deepEqual(await root(cross),claimRoot);
  await h.send('P41 complete claim-aware funded withdrawal',[claimWithdrawal],[owner]);
  assert.equal((await root(cross)).cash,999_971n);
  await flush();
  const anchor=await initializationSignature(rpc,checks.map(check=>String(check.signature)),setup.deployment.eventAuthority);
  const config={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl,runId:'p41-markets',venue:setup.venue,
    anchor,profile:'liquidity-execution-qualification' as const,pageSize:37};
  indexer=new LiquidityIndexer(config);await indexer.open();await indexer.cycle();
  const snapshot=await indexer.store.snapshot(),reconciliation=await indexer.reconcile();
  await indexer.close();indexer=undefined;
  indexer=new LiquidityIndexer(config);await indexer.open();await indexer.cycle();
  assert.deepEqual((await indexer.store.snapshot()).state,snapshot.state,'Actual SQL close/restart is idempotent');
  await indexer.store.pool.query('CREATE DATABASE rivalt_p41_replay');
  const replayUrl=new URL(databaseUrl);replayUrl.pathname='/rivalt_p41_replay';
  replay=new LiquidityIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p41-fresh-replay'});await replay.open();await replay.cycle();
  assert.deepEqual((await replay.store.snapshot()).state,snapshot.state,'Fresh complete RPC/SQL replay');
  const history=await fetchScopedHistory(rpc,anchor,setup.deployment.eventAuthority,setup.venue,setup.domain.toString('hex'));
  for(const test of isolated) {
    const index=checks.findIndex(check=>check.label===test.label);assert(index>=0);
    const signed=JSON.parse(readFileSync(`${directory}/wire-${index}.json`,'utf8'));
    const locks=transactionLocks(Buffer.from(signed.wireBase64,'base64'));
    for(const key of test.omitted) {
      assert(![...locks.read,...locks.write].includes(key),'Omission must hold in actual signed message');
      for(const invocation of history.invocations.filter(value=>value.signature===checks[index].signature))
        assert(![...invocation.reads,...invocation.writes].some(entity=>entity.account===key),'Omitted footer dependency');
    }
  }
  const roots=await Promise.all([...setup.roots,...setup.instances.map(maker=>maker.capital)].map(root));
  const ledgers=await Promise.all(setup.ledgers.map(async key=>sdk.getMarketLedgerDecoder().decode((await h.read(key))!)));
  const markets=await Promise.all([0,1].map(setup.marketState));
  assert.equal(roots.reduce((sum,account)=>sum+account.cash,0n),7_999_959n);
  assert.deepEqual(ledgers.map(ledger=>[ledger.insurance,ledger.fees,ledger.insuranceFeeRemainder]),[[6n,20n,2],[3n,10n,1]]);
  for(const index of [0,1]) {
    assert.equal(roots.reduce((sum,account)=>sum+account.positions[index].lots,0n),0n);
    assert.equal(roots.reduce((sum,account)=>{const position=account.positions[index];return sum+position.virtualScaled
      -position.lots*(markets[index].fundingIndexScaled-position.fundingCheckpointScaled);},0n),0n);
  }
  assert.equal(BigInt(reconciliation.actualVault),7_999_998n);
  const parity=await conformance.finish(directory,[],h.read);
  writeFileSync(`${directory}/summary.json`,json({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    trackedDirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',
    build:JSON.parse(readFileSync('.local/liquidity-execution/build-manifest.json','utf8')),checks,isolated,reconciliation,parity,roots,markets,ledgers,
    state:snapshot.state,phaseAcceptance:false}));
  console.log(json({stage:'p41-dependency-rpc-pg-pass',outcomes:checks.length,isolatedCases:isolated.length,events:snapshot.state.sequence,reconciliation}));
} finally {await replay?.close();await indexer?.close();try{await flush();}finally{ws.close();}}
