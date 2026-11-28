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
import {qualifyFundedListedDefault} from './funded-listed-default.js';
import {qualifyListedCash} from './listed-cash-access.js';
import {registerFinancialTestMargin} from './account-membership-setup.js';
import {qualifyListedExecution} from './listed-execution.js';
import {qualifyListedMargin} from './listed-margin.js';
import {qualifyListedFunding} from './listed-funding.js';
import {qualifyListedDirectory} from './listed-maker-directory.js';
import {qualifyListedMaker} from './listed-maker-admission.js';
import {qualifyListingIndex} from './listing-index-qualification.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const build=routerBuild(),execution=sdk.hasListedExecution(build.artifactSet),directory=process.env.RIVALT_RUN_DIR!;
const testCash=sdk.hasListedCash(build.artifactSet);
const testDefault=build.artifactSet===sdk.LISTED_DEFAULT_ARTIFACT_SET;
let observer:Awaited<ReturnType<typeof payerKey>>|undefined;
const {rpc,ws,h:transport,checks,flush}=await openCanonicalRpcHarness(
  process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,{deferFinality:true,computeUnitLimit:label=>label.startsWith('wider default ')?1_400_000:label.startsWith('listed trade ')?1_400_000:label.startsWith('listed cash ')?600_000:undefined,heapSize:label=>label.startsWith('wider default ')?256*1024:label.startsWith('listed trade ')?256*1024:label.startsWith('listed cash ')?96*1024:undefined,payerFor:label=>label.startsWith('SOL sample ')?observer:undefined});
try {
  const payer=await payerKey(),{h,members,lanes}=coverageProvisioning(transport,payer);
  const testFunding=sdk.hasListedFunding(build.artifactSet);
  const sealDirectory=sdk.hasListedDirectory(build.artifactSet);
  const setup=await liquidityExecutionSetup(h,rpc,{traderCount:execution?2:1,independentTraders:execution,recoveryCapacity:testCash?12:execution?11:sealDirectory?10:build.artifactSet===sdk.LISTED_MAKER_ARTIFACT_SET?8:7,marketCheckpoints:true,
    marginLayout:'ledger-lanes',shape:symmetricPayoutShape,verifyRejections:false});
  const {venue,primary,traderOwner:owner}=setup, [trader]=setup.roots;
  let cashRecipient:Address|undefined;
  if(testCash) {
    const [portfolio]=await sdk.deriveAccountPortfolio(venue,owner.address,0);
    [cashRecipient]=await sdk.deriveMarginAccount(portfolio,1);
    await registerFinancialTestMargin(h,setup.common,payer,{owner,portfolio,margin:cashRecipient,subaccountIndex:1,
      mode:1,isolatedMarketIndex:0,role:0});
  }
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
  await flush();
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

  const makerSetup=execution?{...setup,traderOwner:setup.traderOwners[1],traderToken:setup.traderTokens[1]}:setup;
  const listedMaker=sealDirectory||build.artifactSet===sdk.LISTED_MAKER_ARTIFACT_SET?await qualifyListedMaker(h,makerSetup,listing,members):undefined;
  const sealed=sealDirectory && listedMaker?await qualifyListedDirectory(h,makerSetup,listing,listedMaker.listing,listedMaker.capital,testFunding?22_000n:undefined):undefined;
  observer=owner;
  const indexProbe=sealDirectory||build.artifactSet===sdk.LISTING_INDEX_ARTIFACT_SET
    ? await qualifyListingIndex(h,setup,listing,feed,financialKeys) : undefined;
  const published=testFunding && sealed && indexProbe?await qualifyListedFunding(h,rpc,setup,listing,sealed.registrations,indexProbe.listingIndex):undefined;
  if(indexProbe||listedMaker) await setup.qualify();
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
  const extraCash=execution?3_000n:0n;
  const wider=sdk.hasListedMargin(build.artifactSet) && sealed
    ? await qualifyListedMargin(h,setup,members,sealed.capitals,extraCash) : undefined;
  const executed=execution && sealed && published ? await qualifyListedExecution(h,setup,listing,sealed,published,testDefault && build.revision!=='8b5a08080663ef19610b9276bd3d599aa5cc37cf') : undefined;
  const cashAccess=cashRecipient && published && executed
    ? await qualifyListedCash(h,setup,cashRecipient,published,listing,unusedId):undefined;
  const settled=testDefault && executed && cashAccess && published && sealed
    ? await qualifyFundedListedDefault(h,setup,{listing,funding:published.funding,book:executed.book,
      directory:executed.directory,capitals:sealed.capitals,recipient:cashAccess.recipient}) : undefined;
  assert.equal(Boolean(settled),testDefault);
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
  if(listedMaker) {
    for(const [label,ix] of [['initialize SOL maker curve',listedMaker.curve],['admit funded SOL maker',listedMaker.admit],
      ['publish alternative curve for listing 258',listedMaker.otherCurve]] as const) {
      const landed=checks.find(row=>row.label===label)!;
      parity.record([ix],await rpc.call('getTransaction',[landed.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]));
    }
    keys.push({program:sdk.CLEARING_PROGRAM_ADDRESS,name:'makerRegistration',key:listedMaker.registration},
      {program:sdk.CLEARING_PROGRAM_ADDRESS,name:'capitalBinding',key:listedMaker.capitalBinding});
  }
  if(sealed) {
    const landed=checks.find(row=>row.label==='seal SOL maker directory')!;
    parity.record([sealed.instruction],await rpc.call('getTransaction',[landed.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]));
    keys.push({program:sdk.CLEARING_PROGRAM_ADDRESS,name:'liquidityRegistry',key:sealed.registry});
    const discovered=await sdk.discoverLiquidityAccounts(rpc,venue,listing,'finalized','ledger-lanes');
    assert.deepEqual(discovered.capitals,sealed.capitals);
    const listings=await sdk.readMarketListings(rpc,venue,build.artifactSet);
    assert.deepEqual(listings.map(({record})=>[record.marketId,record.status]),[[2,execution?2:1],[258,0]]);
  }
  if(published) {
    for(const [label,ix] of published.accepted) {
      const landed=checks.find(row=>row.label===label)!;
      parity.record([ix],await rpc.call('getTransaction',[landed.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]));
    }
    keys.push({program:sdk.CLEARING_PROGRAM_ADDRESS,name:'listedFunding',key:published.funding},
      {program:sdk.CLEARING_PROGRAM_ADDRESS,name:'fundingPublisher',key:published.configuration});
  }
  if(executed) {
    for(const [label,ix] of [['open funded wider venue for qualification',executed.begin],
      ['listed trade signed SOL buy beside BTC and ETH',executed.fill]] as const) {
      const landed=checks.find(row=>row.label===label)!;
      parity.record([ix],await rpc.call('getTransaction',[landed.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]));
    }
    keys.push({program:sdk.CLEARING_PROGRAM_ADDRESS,name:'listedVenue',key:executed.directory},
      {program:sdk.CLEARING_PROGRAM_ADDRESS,name:'listedMarketBook',key:executed.book});
  }
  for(const [label,ix] of cashAccess?.signed??[]) {
    const landed=checks.find(row=>row.label===label)!;
    parity.record([ix],await rpc.call('getTransaction',[landed.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]));
  }
  if(settled) {
    keys.push({program:sdk.CLEARING_PROGRAM_ADDRESS,name:'listedDefault',key:settled.episode});
    for(const [label,ix] of settled.signed) {
      const landed=checks.find(row=>row.label===label)!;
      parity.record([ix],await rpc.call('getTransaction',[landed.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]));
    }
  }
  await parity.finish(directory,keys,h.read);
  const journal=await openSettlementJournal(rpc,setup,checks.map(row=>String(row.signature)),build);
  const replay=await journal.finish();
  assert.equal(Object.keys(replay.state.listings??{}).length,listedMaker?2:1);
  assert.equal(replay.state.listings?.[listing]?.oracleFeed,feed);
  assert.equal(replay.state.listedSymbols?.[binding]?.listing,listing);
  assert.deepEqual(replay.state.venue?.markets,setup.markets);
  if(indexProbe) {
    const projected=replay.state.listingIndices?.[indexProbe.listingIndex];
    assert.equal(projected?.reference,indexProbe.recovered.reference.toString());
    assert.equal(projected?.revision,'3');
  }
  if(listedMaker) {
    assert.equal(replay.state.liquidity?.makers[listedMaker.registration]?.market,listing);
    assert.equal(replay.state.roots[listedMaker.capital]?.cash,sealed && !settled?'100000':'0');
  }
  if(sealed) {
    assert.deepEqual(replay.state.liquidity?.registries[sealed.registry]?.registrations,sealed.registrations);
    assert.equal(replay.state.listings?.[listing]?.status,execution?2:1);
    for(const capital of sealed.capitals)assert.equal(replay.state.roots[capital].cash,settled?'0':'100000');
  }
  if(published && !execution) {
    assert.equal(replay.state.listedFunding?.[published.funding]?.values.oracle.bid,'5960000');
    assert.equal(replay.state.liquidity?.publishers[published.configuration].lastSequence,'3');
  }
  if(wider && !settled) {
    assert.equal(replay.state.roots[trader].cash,(wider.minimumCash+extraCash-(executed?.fee??0n)-(cashAccess?.maximum??0n)).toString());
    assert.deepEqual(replay.state.roots[trader].positions.map(position=>position.lots),['1','-10']);
  }
  if(executed && !settled) {
    const account=replay.state.roots[trader];
    const payload=replay.state.listedPositions?.[trader];
    assert(payload);
    const slots=sdk.decodeListedRecords(Buffer.from(payload,'hex'),sdk.listedMarginCapacity(account),true);
    assert.deepEqual(slots.records.map(({market,lots,virtualScaled})=>[market,lots,virtualScaled]),[[2,10n,-1520n*1_000_000_000n]]);
    assert.equal(replay.state.listedBooks?.[executed.book]?.grossLots,'20');
  }
  const executedOrder=executed && {trader:executed.trader,listing,book:executed.book,directory:executed.directory,
    cash:executed.cash,lots:executed.lots,gross:executed.gross,fee:executed.fee,inlineLots:executed.inlineLots,
    receipt:checks.find(row=>row.label==='listed trade signed SOL buy beside BTC and ETH')};
  if(cashAccess)assert.equal(replay.state.roots[cashAccess.recipient].cash,'0');
  if(settled) {
    assert.equal(replay.state.safety?.mode,3);
    assert.equal(replay.state.listedDefaults?.[settled.episode]?.completed,true);
    assert(Object.values(replay.state.roots).every(root=>root.cash==='0'));
  }
  const result={reconciliation:replay.reconciliation,settled:settled && {episode:settled.episode,expected:settled.expected,withdrawals:settled.withdrawals,
    retained:settled.retained,receipts:checks.filter(row=>String(row.label).startsWith('wider '))},cashAccess:cashAccess && {minimum:cashAccess.minimum,maximum:cashAccess.maximum,
    receipts:checks.filter(row=>String(row.label).startsWith('listed cash '))},executed:executedOrder,wider,published:published?{funding:published.funding,receipts:checks.filter(row=>published.accepted.some(([label])=>label===row.label))}:undefined,sealed:sealed?{registry:sealed.registry,capitals:sealed.capitals,receipt:checks.find(row=>row.label==='seal SOL maker directory')}:undefined,maker:listedMaker?{registration:listedMaker.registration,capital:listedMaker.capital,withdrawn:listedMaker.amount}:undefined,index:indexProbe?{initial:indexProbe.initial,recovered:indexProbe.recovered,
    bytes:(await h.read(indexProbe.listingIndex))!.length,receipts:checks.filter(row=>!row.error &&
      (row.label==='bind SOL index'||String(row.label).startsWith('SOL sample ')))}:undefined,program:build.revision,harness:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    transactions:checks.length,events:replay.events,registration:accepted,listingBytes:(await h.read(listing))!.length,
    symbolBytes:(await h.read(binding))!.length,rejections:checks.filter(row=>row.error).map(row=>({label:row.label,error:row.error}))};
  writeFileSync(directory+'/listing-result.json',json(result));
  console.log(executed?'Reconciled the funded SOL fill alongside BTC and ETH.':'Reconciled the inactive SOL listing and the BTC fill.',replay.events,'events.');
} finally {await ws.close();}
