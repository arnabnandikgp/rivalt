// Registration is metadata-only. All cash and active market writes below are
// independently observed through the deployed program, its SPL vault and journal.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {type Address,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {CanonicalConformance} from './canonical-maker-conformance.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {coverageProvisioning,appendCoverage} from './coverage-provisioning.js';
import {routerBuild} from './execution-router-build.js';
import {payerKey} from './harness.js';
import type {ExpectedInstructionError} from './instruction-errors.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {initializeFixtureFeed} from './oracle-fixture.js';
import {qualifyListingIndex} from './listing-index-qualification.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const build=routerBuild(),directory=process.env.RIVALT_RUN_DIR!;
let observer:Awaited<ReturnType<typeof payerKey>>|undefined;
const {rpc,ws,h:transport,checks,flush}=await openCanonicalRpcHarness(
  process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,{deferFinality:true,payerFor:label=>label.startsWith('SOL sample ')?observer:undefined});
try {
  const payer=await payerKey(),{h,members,lanes}=coverageProvisioning(transport,payer);
  const setup=await liquidityExecutionSetup(h,rpc,{traderCount:1,recoveryCapacity:7,marketCheckpoints:true,
    marginLayout:'ledger-lanes',shape:symmetricPayoutShape,verifyRejections:false});
  const {venue,primary,traderOwner:owner}=setup, [trader]=setup.roots;
  const {route,root,guard,withCheckpoints}=executionTestHelpers(h,setup);
  const symbol=sdk.listingSymbol('SOL'),marketId=2,lotsPerUnit=1_000_000n;
  const {feed,feedId}=await sdk.listingOracle('SOL',primary.address);
  const [listing]=await sdk.findListingPda({venue,marketId});
  const [binding]=await sdk.findSymbolBindingPda({venue,symbol});
  const [unusedId]=await sdk.findListingPda({venue,marketId:258});
  const [unusedSymbol]=await sdk.findSymbolBindingPda({venue,symbol:sdk.listingSymbol('AVAX')});
  const financialKeys=[...setup.tracked,trader,...setup.instances.flatMap(maker=>[maker.capital,maker.registration]),...lanes];
  const read=(keys:Address[])=>Promise.all(keys.map(h.read));
  const register=(overrides:Partial<Parameters<typeof sdk.getRegisterMarketListingInstructionAsync>[0]>={})=>
    sdk.getRegisterMarketListingInstructionAsync({venue,safety:setup.safety,authority:payer,program:sdk.CLEARING_PROGRAM_ADDRESS,
      marketId,symbol,lotsPerUnit,oraclePublisher:primary.address,oracleFeed:feed,...overrides});
  const reject=async(label:string,instructions:Instruction[],signers:(typeof payer)[],error:ExpectedInstructionError)=>{
    const watched=[...financialKeys,listing,binding,unusedId,unusedSymbol,feed];
    const before=await read(watched);
    await h.send(label,instructions,signers,error);
    assert.deepEqual(await read(watched),before,label);
  };
  await h.send('initialize SOL/USD index identity',[initializeFixtureFeed(feed,primary.address,feedId)],[primary]);
  assert.deepEqual(await sdk.readInactiveMarketListings(rpc,venue),[]);
  await reject('owner cannot list a market',[await register({authority:owner})],[owner],sdk.CLEARING_ERROR__AUTHORITY);
  await reject('refuse BTC price feed for SOL',[await register({oracleFeed:setup.feeds[0].feed})],[],sdk.CLEARING_ERROR__ORACLE_SOURCE);
  await reject('refuse wrong publisher for SOL',[await register({oraclePublisher:setup.guard.address})],[],sdk.CLEARING_ERROR__ORACLE_SOURCE);
  await reject('refuse legacy ETH market ID',[await register({marketId:1})],[],sdk.CLEARING_ERROR__PROFILE);
  const financialBefore=await read(financialKeys);
  const registration=await register();
  await h.send('register inactive SOL market',[registration]);
  assert.deepEqual(await read(financialKeys),financialBefore,'registration changed trading or custody');
  await reject('refuse reused market ID',[await register({symbol:sdk.listingSymbol('AVAX')})],[],0);
  await reject('refuse reused symbol',[await register({marketId:258})],[],0);
  await flush();
  const discovered=await sdk.readInactiveMarketListings(rpc,venue);
  assert.equal(discovered.length,1);
  const {record,ticker,address:key}=discovered[0];
  assert.deepEqual([key,ticker,record.marketId,record.oracleFeed,record.oraclePublisher,record.lotsPerUnit,
    record.quoteMint,record.status],[listing,'SOL',2,feed,primary.address,lotsPerUnit,setup.mint.address,0]);

  observer=owner;
  const indexProbe=build.artifactSet===sdk.LISTING_INDEX_ARTIFACT_SET
    ? await qualifyListingIndex(h,setup,listing,feed,financialKeys) : undefined;
  if(indexProbe) await setup.qualify();
  else await setup.sample();
  const common={...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  const startSlot=await setup.slot();
  const order=sdk.getManageAccountOrderInstruction({...common,actor:owner,margin:trader,guard:await guard(trader),marketIndex:marketId,
    operation:{__kind:'Place',expectedId:1n,terms:{side:0,lots:1n,limit:10_000n,feeBudget:10n,startSlot,expirySlot:startSlot+2000n,
      trigger:0,threshold:0n,reduceOnly:false,generation:0n}}});
  await reject('refuse order on inactive market ID',await withCheckpoints(appendCoverage(order,[members.get(trader)!])),[owner],sdk.CLEARING_ERROR__PROFILE);
  const maker=setup.instances[0];
  const fill=appendCoverage(await route({trader,actor:owner,marketIndex:0,side:0,makers:[maker],lots:[1n],minimalMarkets:true}),
    [members.get(trader)!,members.get(maker.capital)!]);
  const substitution={...fill,accounts:fill.accounts!.map(meta=>meta.address===setup.markets[0]?{...meta,address:listing}:meta)};
  await reject('refuse listing PDA as routed market',await withCheckpoints(substitution),[owner],'InvalidAccountData');
  await h.send('fill one BTC lot after listing',await withCheckpoints(fill),[owner]);
  assert.equal((await root(trader)).positions[0].lots,1n);
  await flush();
  const accepted=checks.find(row=>row.label==='register inactive SOL market')!;
  const receipt=await rpc.call('getTransaction',[accepted.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
  const parity=new CanonicalConformance();
  parity.record([registration],receipt);
  const keys=[{program:sdk.CLEARING_PROGRAM_ADDRESS,name:'marketListing',key:listing},
    {program:sdk.CLEARING_PROGRAM_ADDRESS,name:'listedSymbol',key:binding}];
  if(indexProbe) {
    for(const [label,instruction] of [['bind SOL index',indexProbe.binding],
      ['SOL sample at 99-cent collateral',indexProbe.sample],['SOL sample after source recovery',indexProbe.sample]] as const) {
      const landed=checks.find(row=>row.label===label)!;
      const tx=await rpc.call('getTransaction',[landed.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
      if(label.startsWith('SOL sample ')) {
        assert.deepEqual(tx.transaction.message.accountKeys.slice(0,tx.transaction.message.header.numRequiredSignatures),[owner.address]);
      }
      parity.record([instruction],tx);
    }
    keys.push({program:sdk.CLEARING_PROGRAM_ADDRESS,name:'listingIndex',key:indexProbe.listingIndex});
  }
  await parity.finish(directory,keys,h.read);
  const journal=await openSettlementJournal(rpc,setup,checks.map(row=>String(row.signature)),build);
  const replay=await journal.finish();
  assert.equal(Object.keys(replay.state.listings??{}).length,1);
  assert.equal(replay.state.listings?.[listing]?.oracleFeed,feed);
  assert.equal(replay.state.listedSymbols?.[binding]?.listing,listing);
  assert.deepEqual(replay.state.venue?.markets,setup.markets);
  if(indexProbe) {
    const projected=replay.state.listingIndices?.[indexProbe.listingIndex];
    assert.equal(projected?.reference,indexProbe.recovered.reference.toString());
    assert.equal(projected?.revision,'3');
  }
  const result={index:indexProbe?{initial:indexProbe.initial,recovered:indexProbe.recovered,
    bytes:(await h.read(indexProbe.listingIndex))!.length,receipts:checks.filter(row=>!row.error &&
      (row.label==='bind SOL index'||String(row.label).startsWith('SOL sample ')))}:undefined,program:build.revision,harness:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    transactions:checks.length,events:replay.events,registration:accepted,listingBytes:(await h.read(listing))!.length,
    symbolBytes:(await h.read(binding))!.length,rejections:checks.filter(row=>row.error).map(row=>({label:row.label,error:row.error}))};
  writeFileSync(directory+'/listing-result.json',json(result));
  console.log('Reconciled one inactive SOL listing and the BTC fill;',replay.events,'events.');
} finally {await ws.close();}
