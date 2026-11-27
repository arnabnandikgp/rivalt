// Reconcile the native market-indexed solver to the actual venue before and after collecting loss.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import type {Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {appendCoverage,coverageProvisioning} from './coverage-provisioning.js';
import {verifyVenueDefault} from './venue-default-verifier.js';
import {routerBuild} from './execution-router-build.js';
import {payerKey} from './harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const build=routerBuild(),directory=process.env.RIVALT_RUN_DIR!;
const {rpc,ws,h:transport,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,
  process.env.RIVALT_WS_URL!,directory,{deferFinality:true,heapSize:label=>label.startsWith('verify default')?128*1024:undefined,
  computeUnitLimit:label=>label.startsWith('verify default')?500_000:undefined});
try {
  const payer=await payerKey(),{h,members}=coverageProvisioning(transport,payer);
  const setup=await liquidityExecutionSetup(h,rpc,{shape:symmetricPayoutShape,traderCount:1,makerCash:12_500n,
    recoveryCapacity:7,marginLayout:'ledger-lanes',marketCheckpoints:true,verifyRejections:false});
  const {route,root,withCheckpoints}=executionTestHelpers(h,setup);
  const owner=setup.traderOwner,[trader]=setup.roots,[makerA,makerB]=setup.instances;
  const roster=[trader,...setup.instances.map(maker=>maker.capital)];
  const identity={...setup.identity,closedQuantity:true,boundedEntry:true};
  const capture=async(keys:Address[]=roster,phase:'active-preview'|'frozen'='active-preview')=>{
    const result=await sdk.readVenueSettlementBook(rpc,identity,keys,phase);
    const input=JSON.stringify(result.book)+'\n';
    const native=JSON.parse(execFileSync('target/debug/examples/market_settlement',{input,encoding:'utf8'}));
    const independent=JSON.parse(execFileSync('python3',['-c',
      "import sys,json; sys.path.insert(0,'tests/financial'); from market_indexed_reference import expected; print(json.dumps(expected(json.load(sys.stdin))))"],
      {input,encoding:'utf8'}));
    assert.deepEqual(native,independent);
    return {...result,outcome:native};
  };
  await setup.sample(); await flush();
  const empty=await capture();
  await assert.rejects(()=>capture(roster.slice(1)),/Incomplete financial membership/);
  await assert.rejects(()=>capture([roster[0],...roster.slice(0,-1)]),/Invalid complete settlement roster/);
  const covered=(ix:Parameters<typeof appendCoverage>[0],keys:Address[])=>appendCoverage(ix,keys.map(key=>members.get(key)!));
  async function fill(label:string,side:0|1,maker:typeof makerA) {
    const ix=await route({trader,actor:owner,marketIndex:0,side,makers:[maker],lots:[1n],minimalMarkets:true});
    await h.send(label,await withCheckpoints(covered(ix,[trader,maker.capital])),[owner]);
  }
  await setup.sample(); await fill('buy one BTC at 60002',0,makerA);
  setup.sourcePrices.btc=61_000_000_000n;
  await setup.qualify(); await fill('sell one BTC at 60998',1,makerB); await flush();
  const before=await capture([...roster].reverse());
  const ids=await Promise.all([trader,makerA.capital,makerB.capital].map(async key=>(await root(key)).id.toString()));
  const claims=(capture:typeof before)=>ids.map(id=>BigInt(capture.book.rows.find(row=>row.id===id)!.claims[0]));
  const scale=1_000_000_000n;
  assert.deepEqual(claims(before),[996n,-998n,2n].map(value=>value*scale));
  const funds=(result:typeof before)=>result.book.markets.map(m=>[BigInt(m.pool),BigInt(m.insurance),BigInt(m.fees)]);
  const [btc,eth]=funds(empty);
  assert.deepEqual(funds(before),[[btc[0],btc[1]+6n,btc[2]+20n],eth]); // 13 + 13 fee atoms
  await setup.sample();
  const collect=sdk.getCollectAccountLossInstruction({...setup.common,btc:setup.markets[0],eth:setup.markets[1],
    actor:payer,margin:makerA.capital,marketIndex:0,amount:996n});
  await h.send('collect 996 BTC loss atoms into custody',await withCheckpoints(covered(collect,[makerA.capital])));
  await flush();
  const after=await capture();
  assert.deepEqual(claims(after),[996n,-2n,2n].map(value=>value*scale));
  assert.deepEqual(funds(after),[[btc[0]+996n,btc[1]+6n,btc[2]+20n],eth]);
  assert.equal(after.book.vault,before.book.vault);
  assert.deepEqual(after.outcome.rows.map((row:{cash:string})=>row.cash),before.outcome.rows.map((row:{cash:string})=>row.cash));
  await assert.rejects(()=>capture(roster,'frozen'),/Expected a newly valued/);
  // Maker A still holds the short. Its 11,504 funded atoms cannot cover the new price.
  setup.sourcePrices.btc=80_000_000_000n;
  await setup.freshSources();
  const [primaryBtc,primaryCollateral,guardBtc,guardCollateral,primaryEth,guardEth]=setup.feeds.map(f=>f.feed);
  const safety=sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!);
  const header=sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const freeze=sdk.getFreezeAccountsInstruction({...setup.safetyCommon,caller:payer,target:makerA.capital,
    members:(await sdk.deriveMemberPage(setup.venue,BigInt(ids[1])/64n))[0],
    primaryBtc,primaryCollateral,guardBtc,guardCollateral,primaryEth,guardEth,
    safetyEpoch:safety.epoch,resolutionEpoch:header.epoch,emergency:false});
  await h.send('freeze insolvent short at independent BTC index',await withCheckpoints(freeze));
  await flush();
  const frozen=await capture(roster,'frozen');
  assert.deepEqual(claims(frozen),[996n,-19_002n,19_002n].map(value=>value*scale));
  assert.equal(frozen.episode,1n);
  assert.equal(frozen.outcome.spent[0],frozen.book.markets[0].insurance);
  assert.equal(frozen.outcome.spent[1],'0');
  await assert.rejects(()=>capture(),/Expected an active venue/);
  const certificate=build.artifactSet===sdk.INDEXED_DEFAULT_ARTIFACT_SET?await verifyVenueDefault(setup,roster,{h,rpc,checks,flush},directory):undefined;
  const journal=await openSettlementJournal(rpc,setup,checks.map(row=>String(row.signature)),build);
  const replay=await journal.finish();
  writeFileSync(directory+'/venue-book.json',json({program:build.revision,empty,before,after,frozen,certificate,transactions:checks.length,events:replay.events}));
  console.log('Reconciled venue settlement inputs and unchanged terminal wallets across collection;',replay.events,'events.');
} finally {await ws.close();}
