// Compare approved joint recovery with a real frozen cross debtor and two isolated makers.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {getTokenDecoder} from '@solana-program/token';
import {AccountRole,address,getAddressEncoder,getBase58Encoder} from '@solana/kit';
import * as paged from '@rivalt/sdk/paged-recovery';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {accountDefaultStep} from '../../packages/services/src/account-default-worker.js';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {loadRecoverySelection} from '../../packages/services/src/recovery-selection.js';
import {accountDefaultContext, readAccountResolution} from '../../packages/services/src/account-worker-state.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {financialRoots} from './membership-scan-helper.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {measurePagedRecovery} from './paged-recovery-cost.js';
import {openSharedInventory} from './shared-inventory-trades.js';
import {openForeignWinnerBook} from './foreign-winner-trades.js';
import {verifyProfitBuild} from './profit-attribution-build.js';
import {eventually} from './wire.js';

const directory = process.env.RIVALT_RUN_DIR!, url = process.env.RIVALT_RPC_URL!;
const revision = execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const gated = process.env.RIVALT_SETTLEMENT_PROBE === 'profit-attribution-btc-allocation-linked';
const probe = process.env.RIVALT_SETTLEMENT_PROBE;
const integrated=probe==='profit-attribution-owned-integrated';
const pagedWallet=probe==='profit-attribution-owned-paged';
const additionalInsurancePass=pagedWallet && process.env.RIVALT_FROZEN_PLAN_CASE==='paged-insurance';
const contestedDeposit=additionalInsurancePass?30_029n:30_000n;
const ownedCross=integrated||probe==='profit-attribution-owned-cross', ownedTie=pagedWallet||probe==='profit-attribution-owned-tie';
const owned=ownedCross||ownedTie;
const automatic=owned && process.env.RIVALT_RECOVERY_SCHEDULE_BUDGET!==undefined;
const expandedBook=probe==='profit-attribution-inventory-book-expanded-apply';
const bookApply=expandedBook||probe==='profit-attribution-inventory-book-apply';
const populationBook=bookApply||probe==='profit-attribution-inventory-book-ordinary';
const scarceProbe=probe?.startsWith('profit-attribution-scarce-inventory-')??false;
const zeroDebtorBudget=probe==='profit-attribution-scarce-inventory-floor-apply';
const partialInventory=scarceProbe && !zeroDebtorBudget;
const partialApply=scarceProbe && probe!.endsWith('-apply');
const smallWinnerEntry=partialInventory?(probe!.includes('-zero-')?40_000n:40_001n):undefined;
const sharedApply=partialApply||probe==='profit-attribution-shared-inventory-apply';
const sharedInventory=populationBook||partialInventory||sharedApply||probe==='profit-attribution-shared-inventory';
const foreignGate=probe==='profit-attribution-foreign-winner-gate';
const foreignApply=probe==='profit-attribution-foreign-winner-apply';
const foreignBook=ownedCross||foreignApply||foreignGate||probe==='profit-attribution-foreign-winner-ordinary';
const pagedMeter=process.env.RIVALT_FROZEN_PLAN_CASE==='paged-meter';
const pagedCoverage=process.env.RIVALT_FROZEN_PLAN_CASE==='paged-coverage';
const pagedRead=pagedCoverage||pagedMeter||process.env.RIVALT_FROZEN_PLAN_CASE==='paged-read';
const secondPage=pagedWallet||pagedRead;
const equalWinners=secondPage||process.env.RIVALT_FROZEN_PLAN_CASE==='equal-winners';
if(pagedRead)assert(ownedTie && automatic);
if(equalWinners)assert((ownedTie||probe==='profit-attribution-linked-contested') && process.env.RIVALT_FROZEN_PLAN_PROOF==='1');
const allocationProfile = probe === 'profit-attribution-linked-allocation';
const contested = ownedTie || allocationProfile || probe === 'profit-attribution-linked-contested';
const flatCreditor = contested || probe === 'profit-attribution-linked-flat' || probe === 'profit-attribution-linked-flat-apply';
const linked = contested || probe === 'profit-attribution-linked-apply' || probe === 'profit-attribution-linked-flat-apply';
const selection = pagedWallet?'paged-recovery-candidate':integrated?'integrated-recovery-candidate':owned?'recovery-search-candidate':expandedBook?'book-capacity-candidate':bookApply?'book-inventory-candidate':partialApply?'partial-inventory-candidate':sharedApply?'shared-inventory-candidate':foreignApply?'foreign-creditor-candidate':allocationProfile||foreignGate ? 'linked-allocation-candidate' : linked ? (flatCreditor ? 'linked-flat-candidate' : 'linked-pair-candidate') :
  gated ? 'btc-allocation-candidate' : 'profit-attribution-candidate';
const build = verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,gated,gated,gated,gated,pagedWallet?'paged':integrated?'integrated':owned?'owned':expandedBook?'capacity':bookApply?'book':partialApply?'partial':sharedApply?'shared':foreignApply?'foreign':allocationProfile||foreignGate ? 'allocation' : linked && flatCreditor ? 'flat' : linked);
const {h,rpc,ws,checks,flush} = await openCanonicalRpcHarness(url,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,heapSize:label=>label.includes('joint search')?256*1024:undefined,computeUnitLimit:()=>1_000_000});
let journal: Awaited<ReturnType<typeof openSettlementJournal>> | undefined;
let worker: AccountRuntime | undefined;
try {
  const makerDeposit = 1_000_000n;
  const setup = await liquidityExecutionSetup(h,rpc,{marketCheckpoints:integrated,marginLayout:integrated?'ledger-lanes':owned||bookApply||gated||linked||foreignGate||foreignApply||sharedApply?'sponsored-profit':'profit-attribution',
    shape:symmetricPayoutShape,traderCount:secondPage||partialInventory||populationBook?3:2, traderCash:populationBook?20_011n:zeroDebtorBudget?20_013n:partialInventory?20_000n:sharedInventory?20_010n:foreignBook?20_000n:contested?contestedDeposit:flatCreditor?19_996n:20_012n, makerCash:makerDeposit,verifyRejections:false});
  const {guard,route,root,classify} = executionTestHelpers(h,setup);
  const [debtor,otherTrader] = foreignBook?[setup.roots[1],setup.roots[0]]:secondPage?[setup.roots[0],setup.roots[2]]:setup.roots;
  const makers = populationBook?setup.instances.slice(0,3):[setup.instances[partialInventory?1:0], setup.instances[sharedInventory?2:3]];
  const sources = {primaryBtc:setup.feeds[0].feed,primaryCollateral:setup.feeds[1].feed,guardBtc:setup.feeds[2].feed,
    guardCollateral:setup.feeds[3].feed,primaryEth:setup.feeds[4].feed,guardEth:setup.feeds[5].feed};
  const safety = async () => sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!);
  const resolution = async () => sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const wallet = async () => getTokenDecoder().decode((await h.read(setup.token.address))!).amount;
  const traderWallet = async () => getTokenDecoder().decode((await h.read(setup.traderToken.address))!).amount;
  const vault = async () => getTokenDecoder().decode((await h.read(setup.vault))!).amount;
  const before = {wallet:await wallet(),traderWallet:await traderWallet(),vault:await vault()};
  if(sharedInventory)await openSharedInventory(h,setup,smallWinnerEntry,populationBook);
  else if(foreignBook)await openForeignWinnerBook(h,setup);
  else for (const market of [0,1] as const) {
    await setup.sample();
    const gross = market===0 ? 60_002n : 30_002n;
    const fee = market===0 ? 13n : 7n;
    await h.send('open one lot against isolated maker '+market,[await route({trader:debtor,actor:setup.traderOwner,
      marketIndex:market, side:0, makers:[makers[market]], lots:[1n], allInLimit:gross+fee,maxFee:fee})],[setup.traderOwner]);
  }
  const secondMaker=setup.instances[2];
  if (contested) {
    await setup.sample();
    await h.send('cross debtor buys another BTC lot from an independent capital account',[
      await route({trader:debtor,actor:setup.traderOwner,marketIndex:0,side:0,makers:[secondMaker],
        lots:[1n],allInLimit:60_015n,maxFee:13n})],[setup.traderOwner]);
  }
  const flatCounterparty=equalWinners?setup.instances[1]:makers[0];
  if (flatCreditor) {
    setup.sourcePrices.btc=65_000_000_000n;
    await setup.qualify();
    await h.send('open the second trader short at 64998',[await route({trader:otherTrader,actor:setup.traderOwner,
      marketIndex:0, side:1, makers:[flatCounterparty], lots:[1n], allInLimit:64_985n,maxFee:13n})],[setup.traderOwner]);
    setup.sourcePrices.btc=60_000_000_000n;
    await setup.qualify();
    await h.send('close the second trader at 60002 leaving an unpaid BTC claim',[await route({trader:otherTrader,actor:setup.traderOwner,
      marketIndex:0, side:0, makers:[flatCounterparty], lots:[1n], allInLimit:60_015n,maxFee:13n,
      reduceOnly:true,generation:(await root(otherTrader)).positions[0].generation})],[setup.traderOwner]);
    const closed=await root(otherTrader);
    assert.deepEqual([closed.cash,closed.positions[0].lots,closed.positions[0].virtualScaled],[contested?contestedDeposit-26n:19_970n,0n,4_996_000_000_000n]);
  }
  setup.sourcePrices.btc = sharedInventory||foreignBook?40_000_000_000n:50_000_000_000n;
  setup.sourcePrices.eth = sharedInventory?3_000_000_000n:foreignBook?1_250_000_000n:2_000_000_000n;
  await setup.freshSources();
  const freeze=sdk.getFreezeAccountsInstruction({...setup.safetyCommon,...sources,
    caller:setup.payer,target:debtor,members:(await sdk.deriveMemberPage(setup.venue,(await root(debtor)).id/64n))[0],
    safetyEpoch:(await safety()).epoch,resolutionEpoch:(await resolution()).epoch,emergency:false});
  const checkpoint=integrated?await Promise.all(([0,1] as const).map(setup.checkpoint)):[];
  if(integrated)await h.send('refuse unclassified fees at freeze',[...checkpoint,freeze],[],sdk.CLEARING_ERROR__MARKET_CHECKPOINT);
  await h.send(sharedInventory?'freeze the first of two insolvent BTC debtors':foreignBook?'freeze the insolvent isolated BTC debtor':'freeze a cross debtor with both BTC and ETH losses',integrated?[classify(0),classify(1),...checkpoint,freeze]:[freeze]);
  await flush();
  const frozen = await resolution();
  assert.deepEqual(frozen.prices,sharedInventory?[40_000n,30_000n]:foreignBook?[40_000n,12_500n]:[50_000n,20_000n]);
  if(integrated) {
    // Signed fills collected 13 and 11 atoms on BTC, 13 on ETH before the freeze.
    assert.deepEqual(frozen.insuranceBefore,[6n,3n]);
    assert.deepEqual(frozen.feesBefore,[18n,10n]);
  }
  const members = await financialRoots(h,setup.venue,setup.registry);
  const rows = await Promise.all(members.map(async key=>{
    const {root:value,positions:basis} = sdk.decodeProfitAttribution((await h.read(key))!,owned||bookApply||gated||linked||foreignGate||foreignApply||sharedApply);
    const claims = value.positions.map((position,index)=>position.lots*frozen.prices[index]*1_000_000_000n+
      position.virtualScaled-position.lots*(frozen.funding[index]-position.fundingCheckpointScaled));
    return {key,id:value.id,revision:value.revision,generation:value.activationGeneration,cash:value.cash,
      lots:value.positions.map(pos=>pos.lots),claims,basis};
  }));
  journal = await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  const events = journal.initialEvents;
  const freezes = events.filter(event=>event.type==='AccountResolutionFrozenV3');
  assert.equal(freezes.length,1);
  assert.equal(freezes[0].data.trigger,debtor);
  const history = events.slice(0,events.indexOf(freezes[0]));
  assert(!history.some(event=>event.type==='AccountFinancialChangedV3' && [2,3].includes(event.data.kind)));
  const fills = history.filter(event => ['LedgerLaneFilled','LiquidityRouteFeeRecorded','LiquidityRouteExecutedV4'].includes(event.type));
  if (integrated) assert.deepEqual(fills.map(event=>event.type), ['LedgerLaneFilled','LedgerLaneFilled','LiquidityRouteFeeRecorded']);
  const input = {additionalInsurancePass,inactiveTrader:secondPage?setup.roots[1]:undefined,flatCreditor,flatCounterparty:equalWinners?flatCounterparty.capital:undefined,traders:populationBook?setup.roots:undefined,smallWinnerEntry,zeroDebtorBudget,thirdTrader:partialInventory?setup.roots[2]:undefined,flatMaker:partialInventory?setup.instances[0].capital:undefined,secondBtcWinner:contested?secondMaker.capital:undefined,epoch:frozen.epoch,marks:frozen.prices,funding:frozen.funding,pools:frozen.poolsBefore,
    insurance:frozen.insuranceBefore,fees:frozen.feesBefore,markets:setup.markets,rows,makerDeposit,debtor,otherTrader,
    winners:makers.map(maker=>maker.capital),venueHex:Buffer.from(getAddressEncoder().encode(setup.venue)).toString('hex'),
    sourceDigest:createHash('sha256').update(json([setup.venue,frozen,rows,freezes[0].signature])).digest('hex'),
    fills:fills.map(event=>event.data)};
  const reference=populationBook?'inventory_book_comparison':sharedInventory?'shared_inventory_comparison':foreignBook?'foreign_winner_comparison':'linked_default_comparison';
  const comparison = JSON.parse(execFileSync('python3',[`tests/financial/${reference}.py`],{input:json(input),encoding:'utf8'}));
  await journal.checkpoint(sharedInventory?'frozen-competing-debtors':'frozen-two-market-debtor',true);
  const openWorker = async () => {
    const runtime = new AccountRuntime(process.env.RIVALT_DATABASE_URL!,'p55b2-application',url,4,
      selection);
    await runtime.open();
    return runtime;
  };
  process.env.RIVALT_DEFAULT_BATCH_STEPS = owned||bookApply||gated||linked||foreignGate||foreignApply||sharedApply?'1':'32';
  worker = await openWorker();
  const originals: string[] = [];
  const workerCosts: {request:string; units:number; bytes:number; fee:number; payerDebit:number}[] = [];
  let refused = false, partialChecked = false, jointChecked = false;
  let proofRestarted=false;
  if(automatic && !pagedRead)mkdirSync(directory+'/keeper-proof');
  let pagedSelection: {rank:bigint;count:bigint;pages:string[]}|undefined;
  let pagedCost: Awaited<ReturnType<typeof measurePagedRecovery>> | undefined;
  let badAttempt:bigint|undefined,rejectionChecked=false;
  const financialSnapshot=()=>Promise.all([setup.resolution,setup.vault,setup.token.address,setup.traderToken.address,
    ...setup.ledgers,...members].map(key=>h.read(key)));
  let beforeScoring:Awaited<ReturnType<typeof financialSnapshot>>|undefined;
  while ((await resolution()).stage !== 11) {
    assert(originals.length<(pagedWallet?170:128),'bounded recovery exceeded the test continuation budget');
    const current = await readAccountResolution(worker.rpc,setup.venue);
    const prepared=current.preparedState;
    if(pagedRead && prepared.stage===4) {
      assert.equal(members.length,9);
      assert.equal(members[8],otherTrader);
      assert.deepEqual(await worker.riskWork(setup.payer),{status:'blocked',reason:'recovery-unsupported-cohort'});
      const prior=await financialSnapshot();
      const {book,outcome}=await loadRecoverySelection(worker.rpc,setup.venue,'recovery-search-candidate',frozen.epoch,
        prepared.revision,Number(process.env.RIVALT_RECOVERY_SCHEDULE_BUDGET),{format:'paged',count:9n});
      assert(!('blocked' in outcome));
      assert.deepEqual([outcome.rank,outcome.count],[BigInt(comparison.tieTest.best),BigInt(comparison.assignments)]);
      assert.equal(book.pages.length,2);
      assert.equal(book.rows[8].member,otherTrader);
      assert.deepEqual(book.rows[8].lots,[0n,0n]);
      assert.deepEqual(book.rows[8].claims,[4_996_000_000_000n,0n]);
      if(pagedCoverage) {
        writeFileSync(directory+'/paged-source.json',json({venue:setup.venue,resolution:current.resolution,epoch:frozen.epoch,
          revision:prepared.revision,members:prepared.count}));
        for(const phase of ['start','resume'])await new Promise<void>((resolve,reject)=>{
          const child=spawn(process.execPath,['--import','tsx','tests/rpc-contract/paged-search-rpc.ts',phase],{stdio:'inherit'});
          child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Paged search '+phase+' exited '+code)));
        });
        const result=JSON.parse(readFileSync(directory+'/paged-search-resume/result.json','utf8'));
        assert.deepEqual([result.rank,result.cursor,result.count],[String(outcome.rank),String(outcome.count),String(outcome.count)]);
        assert.deepEqual(result.cash,members.map(key=>comparison.cash[key]));
        assert.deepEqual(result.movements,comparison.terminal.movements);
        assert.deepEqual(result.remainingInsurance,comparison.terminal.remainingInsurance);
        assert.deepEqual(result.retainedFees,comparison.terminal.retainedFees);
      }
      if(pagedMeter)pagedCost=await measurePagedRecovery(setup.venue,current.resolution,frozen.epoch,prepared.revision,book,outcome,comparison);
      assert.deepEqual(await financialSnapshot(),prior);
      pagedSelection={rank:outcome.rank,count:outcome.count,pages:book.pages};
      refused=true;
      break;
    }
    if(automatic && prepared.stage===4 && !rejectionChecked) {
      const allocated=process.env.RIVALT_RECOVERY_SCHEDULE_BUDGET!;
      try {
        process.env.RIVALT_RECOVERY_SCHEDULE_BUDGET='1';
        assert.deepEqual(await worker.riskWork(setup.payer),{status:'blocked',reason:'recovery-schedule-budget'});
      } finally {process.env.RIVALT_RECOVERY_SCHEDULE_BUDGET=allocated;}
      beforeScoring=await financialSnapshot();
      rejectionChecked=true;
    }
    const recoveryHeader=pagedWallet?sdk.pagedRecoveryHeader(prepared):sdk.boundRecoveryReceipt(prepared);
    if(automatic && rejectionChecked && !jointChecked && prepared.epoch===frozen.epoch && recoveryHeader) {
      let cash:bigint[], movements:bigint[][];
      if('finalCash' in recoveryHeader) {
        cash=recoveryHeader.finalCash;movements=recoveryHeader.movements;
      } else {
        const rows=[];
        for(let index=0n;index<prepared.count;index+=8n) {
          const [key]=await sdk.deriveFrozenMarginPage(setup.venue,index/8n);
          const page=paged.getFrozenMarginPageDecoder().decode((await h.read(key))!);
          assert.equal(page.epoch,frozen.epoch);assert.equal(page.pageIndex,index/8n);
          rows.push(...page.rows.slice(0,page.rowCount));
        }
        assert.deepEqual(rows.map(row=>row.member),members);
        assert.deepEqual(rows.at(-1)!.claims,[4_996_000_000_000n,0n]);
        cash=rows.map(row=>row.recoveryPayout.finalCash);movements=rows.map(row=>row.recoveryPayout.movements);
      }
      const bound=recoveryHeader;
      if(additionalInsurancePass) {
        const proof=paged.getPagedRecoverySearchDecoder().decode((await h.read(bound.search))!);
        assert.deepEqual(proof.original.rates.map(row=>row.map(String)),comparison.beforeRates,'Both original insurance passes');
        const transactions=workerCosts.filter(cost=>cost.request.endsWith(':verify-winner'));
        assert.equal(transactions.length,1);
        const landed=JSON.parse(readFileSync(directory+'/keeper-proof/transaction-'+(workerCosts.indexOf(transactions[0])+1)+'.json','utf8'));
        const instructions=landed.transaction.message.instructions;
        const tag=Buffer.from(paged.VERIFY_INCUMBENT_DISCRIMINATOR);
        const payload=instructions.filter((ix:any)=>landed.transaction.message.accountKeys[ix.programIdIndex]===sdk.CLEARING_PROGRAM_ADDRESS)
          .map((ix:any)=>Buffer.from(getBase58Encoder().encode(ix.data))).find((data:Buffer)=>data.subarray(0,8).equals(tag));
        assert(payload);
        const {after}=paged.getVerifyIncumbentInstructionDataDecoder().decode(payload);
        assert.deepEqual(after.rates.map(row=>row.map(String)),comparison.afterRates,'Both proposed insurance passes');
      }
      const expectedRank=comparison.proposedRank??comparison.tieTest?.best??comparison.charges[0]*comparison.radices.at(-1)+comparison.charges[1];
      assert.equal(bound.schedule,BigInt(expectedRank));
      assert.equal(bound.schedulesChecked,BigInt(comparison.assignments));
      assert.deepEqual(cash.map(String),members.map(key=>comparison.cash[key]));
      assert.deepEqual(movements.map(row=>row.map(String)),comparison.terminal.movements);
      assert.deepEqual(await financialSnapshot(),beforeScoring);
      const margin=makers[0].capital;
      await h.send('refuse withdrawal after keeper proof before payment',[sdk.getWithdrawFundedAccountInstruction({
        ...setup.common,btc:setup.markets[0],eth:setup.markets[1],owner:setup.owner,margin,quoteMint:setup.mint.address,
        userToken:setup.token.address,guard:await guard(margin),amount:1n})],[setup.owner],sdk.CLEARING_ERROR__PROFILE);
      await flush();await journal.checkpoint('joint-selection-bound-before-any-payment',true);
      assert(proofRestarted,'Proof submission must resume from its landed cursor');
      process.env.RIVALT_DEFAULT_BATCH_STEPS='32';
      await worker.close();worker=await openWorker();jointChecked=true;
    }
    if(!automatic && owned && !rejectionChecked && prepared.epoch===frozen.epoch && prepared.stage===4) {
      const common=await accountDefaultContext(worker.rpc,current);
      assert.deepEqual(await worker.riskWork(setup.payer),{status:'blocked',reason:'recovery-search-pending'});
      const best=comparison.tieTest?.best??comparison.charges[0]*comparison.radices.at(-1)+comparison.charges[1];
      const inferior=comparison.tieTest?.inferior??best-1;
      const keys=await Promise.all([best,inferior].map(nonce=>sdk.findSearchPda({payer:setup.payer.address,nonce})));
      const bind=(index:number,revision=prepared.revision)=>sdk.getBindRecoverySelectionInstruction({...common,
        epoch:frozen.epoch,revision,search:keys[index][0]});
      beforeScoring=await financialSnapshot();
      const header=await h.read(common.prepared);
      writeFileSync(directory+'/search-input.json',json({venue:setup.venue,prepared:current.prepared,
        resolution:setup.resolution,epoch:frozen.epoch,revision:prepared.revision,members,comparison}));
      // Keep the parent RPC and WebSocket finality watchers running during the restarted search.
      const run=(phase:string)=>new Promise<void>((resolve,reject)=>{
        const child=spawn(process.execPath,['--import','tsx','tests/rpc-contract/linked-search-rpc.ts',phase],{stdio:'inherit'});
        child.once('error',reject);
        child.once('exit',(code,signal)=>code===0?resolve():reject(new Error('Recovery search '+phase+' exited '+(signal??code))));
      });
      await run('start');
      await h.send('refuse incomplete joint search',[bind(0)],[],sdk.CLEARING_ERROR__RESOLUTION);
      await flush();
      await run('resume');
      await h.send('refuse defeated joint search',[bind(1)],[],sdk.CLEARING_ERROR__RESOLUTION);
      await h.send('refuse stale joint search revision',[bind(0,prepared.revision-1n)],[],sdk.CLEARING_ERROR__RESOLUTION);
      assert.deepEqual(await h.read(common.prepared),header);
      await h.send('bind sealed joint search to frozen clearing',[bind(0)]);
      await h.send('refuse replay of the bound joint search',[bind(0)],[],sdk.CLEARING_ERROR__RESOLUTION);
      const margin=makers[0].capital;
      await h.send('refuse withdrawal before applying the sealed payout',[sdk.getWithdrawFundedAccountInstruction({
        ...setup.common,btc:setup.markets[0],eth:setup.markets[1],owner:setup.owner,margin,quoteMint:setup.mint.address,
        userToken:setup.token.address,guard:await guard(margin),amount:1n})],[setup.owner],sdk.CLEARING_ERROR__PROFILE);
      assert.deepEqual(await financialSnapshot(),beforeScoring);
      const bound=sdk.boundRecoveryReceipt(sdk.getPreparedSettlementDecoder().decode((await h.read(common.prepared))!));
      assert(bound);
      assert.deepEqual([bound.search,bound.schedule,bound.schedulesChecked],[keys[0][0],BigInt(best),BigInt(comparison.assignments)]);
      assert.deepEqual(bound.memberIds,rows.map(row=>row.id));
      assert.deepEqual(bound.finalCash.map(String),members.map(key=>comparison.cash[key]));
      assert.deepEqual(bound.movements.map(row=>row.map(String)),comparison.terminal.movements);
      await flush();
      await journal.checkpoint('joint-selection-bound-before-any-payment',true);
      process.env.RIVALT_DEFAULT_BATCH_STEPS='32';
      await worker.close();worker=await openWorker();rejectionChecked=true;jointChecked=true;
      continue;
    }
    if(bookApply && prepared.epoch===frozen.epoch && prepared.stage===4 && !rejectionChecked) {
      const common=await accountDefaultContext(worker.rpc,current);
      const ordinals=rows.flatMap((row,index)=>row.lots.some(lots=>lots!==0n)?[BigInt(index)]:[]);
      const pageKeys=await Promise.all([...new Set(ordinals.map(ordinal=>ordinal/8n))]
        .map(async index=>(await sdk.deriveFrozenMarginPage(setup.venue,index))[0]));
      const scratch=()=>Promise.all([common.prepared,...pageKeys].map(key=>h.read(key)));
      const prior=await scratch();
      beforeScoring=await financialSnapshot();
      for(const [reason,indices,keys] of [
        ['missing active lot',ordinals.slice(1),pageKeys],
        ['repeated frozen ordinal',[ordinals[0],...ordinals.slice(0,-1)],pageKeys],
        ['missing active page',ordinals,pageKeys.slice(0,-1)],
      ] as const) {
        const instruction=sdk.getVerifyInventoryBookInstruction({...common,epoch:frozen.epoch,revision:prepared.revision,ordinals:[...indices]});
        await h.send('reject '+reason,[{...instruction,accounts:[...instruction.accounts,...keys.map(address=>({address,role:AccountRole.WRITABLE}))]}],[],sdk.CLEARING_ERROR__RESOLUTION);
      }
      assert.deepEqual(await scratch(),prior);
      assert.deepEqual(await financialSnapshot(),beforeScoring);
      await worker.close();worker=await openWorker();rejectionChecked=true;
    }
    if(bookApply && rejectionChecked && !jointChecked && prepared.epoch===frozen.epoch && prepared.stage===2) {
      const receipt=sdk.inventoryBookReceipt(prepared);
      assert(receipt && receipt.count===3n && receipt.total===5n);
      assert.deepEqual(await financialSnapshot(),beforeScoring);
      await journal.checkpoint('book-certified-before-apply',true);
      process.env.RIVALT_DEFAULT_BATCH_STEPS='32';
      await worker.close();worker=await openWorker();jointChecked=true;
    }
    if(sharedApply && prepared.epoch===frozen.epoch && prepared.stage===4 && !rejectionChecked) {
      const common=await accountDefaultContext(worker.rpc,current);
      const roleKeys=[debtor,otherTrader,makers[0].capital,makers[1].capital];
      const ordinals=roleKeys.map(key=>BigInt(members.indexOf(key)));
      const indices=[...new Set(ordinals.map(ordinal=>ordinal/8n))].sort((a,b)=>a<b?-1:1);
      const pages=await Promise.all(indices.map(async index=>(await sdk.deriveFrozenMarginPage(setup.venue,index))[0]));
      const verify={...common,epoch:frozen.epoch,revision:prepared.revision,ordinals,charges:comparison.charges.map(BigInt) as bigint[],
        firstPage:pages[0],secondPage:pages[1],thirdPage:pages[2],fourthPage:pages[3],
        firstWinner:makers[0].capital,secondWinner:makers[1].capital};
      beforeScoring=await financialSnapshot();
      const scratch=await h.read(common.prepared);
      for(const [reason,expectedError,overrides] of [
        ['one winning lot used twice',sdk.CLEARING_ERROR__ALIAS,{ordinals:[ordinals[0],ordinals[1],ordinals[2],ordinals[2]],secondWinner:verify.firstWinner}],
        ['less proportional assignment',sdk.CLEARING_ERROR__RESOLUTION,{ordinals:[ordinals[0],ordinals[1],ordinals[3],ordinals[2]],firstWinner:verify.secondWinner,secondWinner:verify.firstWinner}],
        ['charge above individual post-insurance budget',sdk.CLEARING_ERROR__RESOLUTION,{charges:[BigInt(comparison.debtorBudgets[0])+1n,verify.charges[1]]}],
      ] as const) {
        await h.send('reject '+reason,[sdk.getVerifySharedInventoryInstruction({...verify,...overrides,
          ordinals:[...('ordinals' in overrides?overrides.ordinals:ordinals)],charges:[...('charges' in overrides?overrides.charges:verify.charges)]})],[],expectedError);
      }
      assert.deepEqual(await h.read(common.prepared),scratch);
      assert.deepEqual(await financialSnapshot(),beforeScoring);
      await worker.close();worker=await openWorker();
      rejectionChecked=true;
    }
    if(sharedApply && rejectionChecked && !jointChecked && prepared.epoch===frozen.epoch && prepared.stage===2) {
      const certificate=sdk.sharedInventoryReceipt(prepared);
      assert(certificate);
      assert.deepEqual(certificate.charges,comparison.charges.map(BigInt));
      assert.deepEqual(certificate.members,[debtor,otherTrader,makers[0].capital,makers[1].capital].map(key=>rows.find(row=>row.key===key)!.id));
      assert.deepEqual(certificate.prices,certificate.members.slice(0,2).map(id=>{
        const pair=comparison.schedules.find((entry:{debtor:string})=>BigInt(entry.debtor)===id);
        return pair?BigInt(pair.fills[0][1]):0n;
      }));
      assert.deepEqual(await financialSnapshot(),beforeScoring);
      await journal.checkpoint('shared-inventory-certified-before-apply',true);
      process.env.RIVALT_DEFAULT_BATCH_STEPS='32';
      await worker.close();worker=await openWorker();
      jointChecked=true;
    }
    if(foreignApply && prepared.epoch===frozen.epoch && prepared.stage===4 && !rejectionChecked) {
      const common=await accountDefaultContext(worker.rpc,current);
      const ordinals=[debtor,makers[0].capital,otherTrader,makers[1].capital].map(key=>BigInt(members.indexOf(key)));
      const pages=[...new Set(ordinals.map(value=>value/8n))].sort((a,b)=>a<b?-1:1);
      const pageKeys=await Promise.all(pages.map(async index=>(await sdk.deriveFrozenMarginPage(setup.venue,index))[0]));
      const verify={...common,epoch:frozen.epoch,revision:prepared.revision,ordinals,
        firstPage:pageKeys[0],secondPage:pageKeys[1],thirdPage:pageKeys[2],fourthPage:pageKeys[3],
        crossWinner:otherTrader,ethWinner:makers[1].capital};
      beforeScoring=await financialSnapshot();
      if(process.env.RIVALT_FROZEN_PLAN_PROOF==='1') {
        writeFileSync(directory+'/search-input.json',json({venue:setup.venue,prepared:current.prepared,
          resolution:setup.resolution,epoch:frozen.epoch,revision:prepared.revision,members,comparison}));
        for(const phase of ['start','resume'])execFileSync(process.execPath,
          ['--import','tsx','tests/rpc-contract/linked-search-rpc.ts',phase],{stdio:'inherit'});
        assert.deepEqual(await financialSnapshot(),beforeScoring);
      }
      const scratch=await h.read(common.prepared);
      for(const [description,override] of [
        ['BTC alone',{charges:[9n,0n]}],['under-recovered joint plan',{charges:[8n,33n]}],
        ['substituted flat creditor',{charges:[9n,33n],ordinals:[ordinals[0],ordinals[2],ordinals[2],ordinals[3]]}],
      ] as const) {
        await h.send('reject '+description,[sdk.getVerifyForeignCreditorsInstruction({...verify,...override,ordinals:[...('ordinals' in override?override.ordinals:ordinals)],charges:[...override.charges]})],[],sdk.CLEARING_ERROR__RESOLUTION);
      }
      assert.deepEqual(await h.read(common.prepared),scratch);
      assert.deepEqual(await financialSnapshot(),beforeScoring);
      await worker.close();worker=await openWorker();
      rejectionChecked=true;
    }
    if(foreignApply && rejectionChecked && !jointChecked && prepared.epoch===frozen.epoch && prepared.stage===2) {
      const receipt=sdk.foreignCreditorReceipt(prepared);
      assert(receipt);
      assert.deepEqual(receipt.legs.map(leg=>leg.charge),comparison.charges.map(BigInt));
      assert.deepEqual(receipt.members,[debtor,makers[0].capital,otherTrader,makers[1].capital].map(key=>rows.find(row=>row.key===key)!.id));
      assert.deepEqual(receipt.legs.map(leg=>leg.matched),[1n,1n]);
      assert.deepEqual(await financialSnapshot(),beforeScoring);
      if(process.env.RIVALT_FROZEN_PLAN_PROOF==='1') {
        writeFileSync(directory+'/proof-kernel-input.json',json({venue:setup.venue,prepared:current.prepared,
          resolution:setup.resolution,epoch:frozen.epoch,revision:prepared.revision,members,comparison}));
        execFileSync(process.execPath,['--import','tsx','tests/rpc-contract/frozen-kernel-rpc.ts'],{stdio:'inherit'});
        assert.deepEqual(await financialSnapshot(),beforeScoring);
      }
      await journal.checkpoint('joint-foreign-creditors-certified-before-apply',true);
      process.env.RIVALT_DEFAULT_BATCH_STEPS='32';
      await worker.close();worker=await openWorker();
      jointChecked=true;
    }
    if(foreignGate && prepared.epoch===frozen.epoch && prepared.stage===4) {
      assert.deepEqual(await worker.riskWork(setup.payer),{status:'blocked',reason:'unsupported-linked-debtor'});
      const common=await accountDefaultContext(worker.rpc,current);
      const original=await financialSnapshot(),scratch=await h.read(common.prepared);
      for(const member of [debtor,otherTrader]) {
        const ordinal=BigInt(members.indexOf(member)),[page]=await sdk.deriveFrozenMarginPage(setup.venue,ordinal/8n);
        const beforePage=await h.read(page);
        await h.send('refuse treating either linked debtor as the sole debtor',[sdk.getAdvanceLinkedAllocationInstruction({...common,
          epoch:frozen.epoch,revision:prepared.revision,ordinal,page,margin:member,cutoffs:[[9n,14_998n,0n,(await root(otherTrader)).id],
            [33n,35_004n,0n,(await root(makers[1].capital)).id]]})],[],sdk.CLEARING_ERROR__RESOLUTION);
        assert.deepEqual(await h.read(page),beforePage);
      }
      const [page]=await sdk.deriveFrozenMarginPage(setup.venue,0n);
      await h.send('refuse payment while the foreign obligation is unverified',[sdk.getAcceptDenominatorRowInstruction({...common,
        epoch:frozen.epoch,revision:prepared.revision,page})],[],sdk.CLEARING_ERROR__RESOLUTION);
      assert.deepEqual(await financialSnapshot(),original);
      assert.deepEqual(await h.read(common.prepared),scratch);
      refused=true;
      break;
    }
    if(allocationProfile && prepared.epoch===frozen.epoch) {
      if(prepared.stage===4 && badAttempt===undefined) {
        const common=await accountDefaultContext(worker.rpc,current);
        const ordinal=BigInt(members.indexOf(debtor)),[page]=await sdk.deriveFrozenMarginPage(setup.venue,ordinal/8n);
        beforeScoring=await financialSnapshot();
        badAttempt=prepared.revision;
        // Admit the correct ETH prefix and zero BTC atoms, then drive the entire failed attempt through the worker.
        await h.send('propose insufficient BTC recovery alongside the full ETH charge',[sdk.getAdvanceLinkedAllocationInstruction({
          ...common,epoch:frozen.epoch,revision:prepared.revision,ordinal,page,margin:debtor,
          cutoffs:[[1n,0xffff_ffff_ffff_ffffn,0n,0n],[12n,10_002n,0n,(await root(makers[1].capital)).id]]})]);
        await flush();
        continue;
      }
      if(prepared.stage===4 && badAttempt!==undefined && !rejectionChecked) {
        assert.equal(sdk.linkedAllocationReceipt(prepared),null);
        assert.deepEqual(await financialSnapshot(),beforeScoring);
        await journal.checkpoint('insufficient-btc-cutoff-rejected',true);
        rejectionChecked=true;
      }
      const scan=sdk.linkedAllocationReceipt(prepared);
      if(scan && rejectionChecked && scan.cursor===3n && !partialChecked) {
        assert(scan.attempt>badAttempt!&&!scan.committed);
        const common=await accountDefaultContext(worker.rpc,current);
        const [page]=await sdk.deriveFrozenMarginPage(setup.venue,scan.cursor/8n);
        const beforeScratch=await Promise.all([common.prepared,page].map(key=>h.read(key)));
        for(const ordinal of [scan.cursor-1n,scan.cursor+1n]) {
          await h.send('refuse noncanonical linked member '+ordinal,[sdk.getAdvanceLinkedAllocationInstruction({...common,
            epoch:frozen.epoch,revision:prepared.revision,ordinal,page,margin:members[Number(ordinal)],cutoffs:null})],[],sdk.CLEARING_ERROR__RESOLUTION);
        }
        await h.send('refuse payment calculations during linked scan',[sdk.getAcceptDenominatorRowInstruction({...common,
          epoch:frozen.epoch,revision:prepared.revision,page})],[],sdk.CLEARING_ERROR__RESOLUTION);
        const margin=makers[0].capital;
        await h.send('refuse withdrawal during linked scan',[sdk.getWithdrawFundedAccountInstruction({...setup.common,
          btc:setup.markets[0],eth:setup.markets[1],owner:setup.owner,margin,quoteMint:setup.mint.address,userToken:setup.token.address,
          guard:await guard(margin),amount:1n})],[setup.owner],sdk.CLEARING_ERROR__PROFILE);
        assert.deepEqual(await financialSnapshot(),beforeScoring);
        assert.deepEqual(await Promise.all([common.prepared,page].map(key=>h.read(key))),beforeScratch);
        await worker.close();worker=await openWorker();
        await journal.checkpoint('linked-allocation-restart-at-member-three',true);
        partialChecked=true;
      }
      if(scan?.committed&&!jointChecked) {
        assert(rejectionChecked&&partialChecked);
        assert.deepEqual(scan.shares,comparison.collections.map(BigInt));
        assert.deepEqual(scan.recovered,comparison.charges.map(BigInt));
        for(let start=0;start<members.length;start+=8) {
          const [page]=await sdk.deriveFrozenMarginPage(setup.venue,BigInt(start/8));
          const frozenPage=sdk.getLinkedAllocationPageDecoder().decode((await h.read(page))!);
          for(const record of frozenPage.rows.slice(0,frozenPage.rowCount)) {
            const expected=BigInt(comparison.winnerCharges[record.member]??0);
            assert.deepEqual(record.linkedCharges,record.member===makers[1].capital?[0n,expected]:[expected,0n]);
          }
        }
        assert.deepEqual(await financialSnapshot(),beforeScoring);
        process.env.RIVALT_DEFAULT_BATCH_STEPS='32';
        await worker.close();worker=await openWorker();
        await journal.checkpoint('joint-allocation-certified-before-payment',true);
        jointChecked=true;
      }
    }
    if(!owned && contested && !allocationProfile && current.preparedState.epoch===frozen.epoch && current.preparedState.stage===4) {
      if(process.env.RIVALT_FROZEN_PLAN_PROOF==='1') {
        const stable=await financialSnapshot();
        writeFileSync(directory+'/proof-input.json',json({venue:setup.venue,prepared:current.prepared,
          resolution:setup.resolution,revision:current.preparedState.revision,epoch:frozen.epoch,
          registryHash:Array.from(frozen.registryHash),debtor,rows,comparison}));
        if(!equalWinners) {
          for(const phase of ['start','resume'])execFileSync(process.execPath,
            ['--import','tsx','tests/rpc-contract/frozen-plan-rpc.ts',phase],{stdio:'inherit'});
        }
        writeFileSync(directory+'/search-input.json',json({venue:setup.venue,prepared:current.prepared,
          resolution:setup.resolution,epoch:frozen.epoch,revision:current.preparedState.revision,members,comparison}));
        for(const phase of ['start','resume'])execFileSync(process.execPath,
          ['--import','tsx','tests/rpc-contract/linked-search-rpc.ts',phase],{stdio:'inherit'});
        assert.deepEqual(await financialSnapshot(),stable);
      }
      const blocked=await worker.riskWork(setup.payer);
      assert.deepEqual(blocked,{status:'blocked',reason:equalWinners?'unsupported-linked-debtor':'unsupported-linked-creditors'});
      const common=await accountDefaultContext(worker.rpc,current);
      const debtorOrdinal=BigInt(members.indexOf(debtor));
      const [page]=await sdk.deriveFrozenMarginPage(setup.venue,debtorOrdinal/8n);
      const watched=[common.prepared,page,setup.resolution,setup.vault,setup.token.address,setup.traderToken.address,...members];
      const snapshot=()=>Promise.all(watched.map(key=>h.read(key)));
      const beforeAttempt=await snapshot();
      for(const maker of [makers[0],secondMaker]) {
        const winnerOrdinal=BigInt(members.indexOf(maker.capital));
        const [winnerPage]=await sdk.deriveFrozenMarginPage(setup.venue,winnerOrdinal/8n);
        await h.send('refuse certifying just one of two open BTC winners',[sdk.getVerifyFrozenPairInstruction({...common,
          epoch:frozen.epoch,revision:current.preparedState.revision,debtorOrdinal,winnerOrdinal,debtor,winner:maker.capital,
          debtorPage:page,winnerPage:winnerPage===page?undefined:winnerPage})],[],sdk.CLEARING_ERROR__RESOLUTION);
      }
      await h.send('refuse releasing the contested book without a joint certificate',[sdk.getAcceptDenominatorRowInstruction({
        ...common,epoch:frozen.epoch,revision:current.preparedState.revision,page})],[],sdk.CLEARING_ERROR__RESOLUTION);
      assert.deepEqual(await snapshot(),beforeAttempt);
      refused=true;
      break;
    }
    if (!owned && !allocationProfile && linked && flatCreditor && current.preparedState.epoch===frozen.epoch && current.preparedState.stage===4) {
      const common=await accountDefaultContext(worker.rpc,current);
      const debtorOrdinal=BigInt(members.indexOf(debtor)), flatOrdinal=BigInt(members.indexOf(otherTrader));
      const [page]=await sdk.deriveFrozenMarginPage(setup.venue,debtorOrdinal/8n);
      const [creditorPage]=await sdk.deriveFrozenMarginPage(setup.venue,flatOrdinal/8n);
      const watched=[common.prepared,debtor,otherTrader,setup.vault,setup.traderToken.address];
      const snapshot=()=>Promise.all(watched.map(key=>h.read(key)));
      const prior=await snapshot();
      await h.send('refuse charging the flat BTC creditor as an open winner',[sdk.getVerifyFrozenPairInstruction({
        ...common,epoch:frozen.epoch,revision:current.preparedState.revision,debtorOrdinal,winnerOrdinal:flatOrdinal,
        debtor,winner:otherTrader,debtorPage:page,winnerPage:page===creditorPage?undefined:creditorPage})],[],sdk.CLEARING_ERROR__RESOLUTION);
      assert.deepEqual(await snapshot(),prior);
    }
    if (linked && current.preparedState.epoch===frozen.epoch && current.preparedState.stage===6 && !partialChecked) {
      const receipt=sdk.frozenJointReceipt(current.preparedState);
      assert(receipt && !receipt.complete && receipt.legs[0].charge===BigInt(comparison.charges[0]));
      const common=await accountDefaultContext(worker.rpc,current);
      const debtorOrdinal=BigInt(members.indexOf(debtor)), winnerOrdinal=BigInt(members.indexOf(makers[0].capital));
      const page=(await sdk.deriveFrozenMarginPage(setup.venue,debtorOrdinal/8n))[0];
      const watched=[setup.resolution,common.prepared,setup.vault,setup.token.address,...members];
      const snapshot=()=>Promise.all(watched.map(key=>h.read(key)));
      const original=await snapshot();
      await h.send('refuse BTC leg as an ETH winner',[sdk.getVerifyFrozenPairInstruction({...common,
        epoch:frozen.epoch,revision:current.preparedState.revision,debtorOrdinal,winnerOrdinal,
        debtor,winner:makers[0].capital,debtorPage:page})],[],sdk.CLEARING_ERROR__RESOLUTION);
      await h.send('refuse settlement after only BTC verified',[sdk.getAcceptDenominatorRowInstruction({...common,
        epoch:frozen.epoch,revision:current.preparedState.revision,page})],[],sdk.CLEARING_ERROR__RESOLUTION);
      const margin=makers[0].capital;
      await h.send('refuse funded withdrawal between verified legs',[sdk.getWithdrawFundedAccountInstruction({...setup.common,
        btc:setup.markets[0],eth:setup.markets[1],owner:setup.owner,margin,quoteMint:setup.mint.address,userToken:setup.token.address,
        guard:await guard(margin),amount:1n})],[setup.owner],sdk.CLEARING_ERROR__PROFILE);
      assert.deepEqual(await snapshot(),original);
      await worker.close(); worker=await openWorker();
      await journal.checkpoint('btc-verified-eth-pending',true);
      partialChecked=true;
    }
    if(!allocationProfile && linked && partialChecked && !jointChecked && [2,3].includes(current.preparedState.stage)) {
      const receipt=sdk.frozenJointReceipt(current.preparedState);
      assert(receipt?.complete);
      assert.deepEqual(receipt.shares,comparison.collections.map(BigInt));
      assert.deepEqual(receipt.legs.map(leg=>leg.charge),comparison.charges.map(BigInt));
      assert.deepEqual(receipt.legs.map(leg=>leg.price),comparison.matched.map(BigInt));
      assert.deepEqual(receipt.legs.map(leg=>leg.matched),[1n,1n]);
      process.env.RIVALT_DEFAULT_BATCH_STEPS='32';
      await worker.close(); worker=await openWorker();
      assert.equal(worker.defaultContinuationSteps,32);
      jointChecked=true;
    }
    if (gated && current.preparedState.epoch===frozen.epoch && current.preparedState.stage===4) {
      const common = await accountDefaultContext(worker.rpc,current);
      const ordinal = BigInt(members.indexOf(debtor)), page = (await sdk.deriveFrozenMarginPage(setup.venue,ordinal/8n))[0];
      const frozenRows = sdk.getBtcAllocationPageDecoder().decode((await h.read(page))!);
      for (const [index, row] of rows.entries()) {
        const stored = frozenRows.rows[index];
        assert.deepEqual([stored.id,stored.member,stored.originalRevision,stored.activationGeneration,stored.cash,stored.claims,stored.lots],
          [row.id,row.key,row.revision,row.generation,row.cash,row.claims,row.lots]);
      }
      const watched = [setup.vault,setup.resolution,common.prepared,page,...members];
      const snapshot = () => Promise.all(watched.map(key=>h.read(key)));
      const original = await snapshot();
      await h.send('refuse omitting ETH from the BTC-only certificate',[sdk.getAdvanceBtcAllocationInstruction({...common,
        epoch:frozen.epoch, revision:current.preparedState.revision,ordinal,margin:debtor,page,cutoff:[0n,0n,0n,0n]})],
        [],sdk.CLEARING_ERROR__RESOLUTION);
      await h.send('refuse bypassing linked selection',[sdk.getAcceptDenominatorRowInstruction({...common,
        epoch:frozen.epoch, revision:current.preparedState.revision,page})],[],sdk.CLEARING_ERROR__RESOLUTION);
      assert.deepEqual(await snapshot(),original);
      refused = true;
      break;
    }
    const work = await worker.riskWork(setup.payer);
    if(pagedWallet && work.status==='blocked') {
      const context=await accountDefaultContext(worker.rpc,current);
      const next=await accountDefaultStep(worker,setup.payer,current,context);
      if(next.status==='ready') {
        const instruction=next.instruction;
        const keys=[...new Set(instruction.accounts!.map(meta=>meta.address))];
        const accounts=await rpc.call('getMultipleAccounts',[keys,{encoding:'base64',commitment:'confirmed',minContextSlot:Number(current.contextSlot)}]);
        const simulations=[];
        for(const computeUnitLimit of [sdk.RESOLUTION_COMPUTE_UNITS,1_400_000]) {
          const {transaction}=await sdk.signCanonicalInstructions(worker.connection,setup.payer,[instruction],
            {computeUnitLimit,loadedAccountsDataSizeLimit:8*1024*1024,heapSize:sdk.inventoryBookHeap(selection,[instruction])});
          const wire=Buffer.from(transaction.serialize()).toString('base64');
          const result=await rpc.call('simulateTransaction',[wire,{encoding:'base64',sigVerify:true,commitment:'confirmed'}]);
          simulations.push({computeUnitLimit,wire,result});
        }
        writeFileSync(directory+'/blocked-paged-step.json',json({reason:next.reason,instruction,keys,accounts,simulations}));
        console.log(json({blocked:next.reason,simulations:simulations.map(({computeUnitLimit,result})=>({
          computeUnitLimit,error:result.value.err,units:result.value.unitsConsumed,logs:result.value.logs?.slice(-5)}))}));
      }
    }
    assert.equal(work.status,'queued',json(work));
    const pending: {request_id:string;signature:string;wire:string}[] = (await worker.store.pool.query("SELECT request_id,signature,wire FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[worker.runId])).rows;
    assert.equal(pending.length,1);
    const [intent] = pending;
    const subscription = await ws.call('signatureSubscribe',[intent.signature,{commitment:'finalized'}]);
    await eventually(async()=>{await worker!.queue.step(intent.request_id);return worker!.queue.get(intent.request_id);},
      value=>['finalized','failed'].includes(value?.status),'linked default continuation');
    assert.equal((await worker.queue.get(intent.request_id)).status,'finalized');
    assert.equal((await ws.notification(subscription)).params.result.value.err,null);
    const receipt = await rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(receipt.transaction[0],intent.wire);
    assert(Number.isSafeInteger(receipt.meta.computeUnitsConsumed) && receipt.meta.computeUnitsConsumed>0);
    workerCosts.push({request:intent.request_id,units:receipt.meta.computeUnitsConsumed,bytes:Buffer.from(intent.wire,'base64').length,
      fee:receipt.meta.fee,payerDebit:receipt.meta.preBalances[0]-receipt.meta.postBalances[0]});
    originals.push(intent.signature);
    if(automatic && intent.request_id.startsWith('risk:recovery:')) {
      const confirmed=await rpc.call('getTransaction',[intent.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
      assert.equal(confirmed.transaction.signatures[0],intent.signature);
      writeFileSync(directory+'/keeper-proof/transaction-'+originals.length+'.json',json(confirmed));
      if(pagedWallet && intent.request_id.endsWith(':seal')) {
        const common=await accountDefaultContext(worker.rpc,current);
        const search=address(intent.request_id.split(':')[2]);
        const bind=paged.getBindRecoverySelectionInstruction({...common,epoch:frozen.epoch,revision:prepared.revision,search});
        const pages=await Promise.all([0n,1n].map(async index=>({address:(await sdk.deriveFrozenMarginPage(setup.venue,index))[0],role:AccountRole.WRITABLE})));
        const snapshot=()=>Promise.all([common.prepared,...pages.map(page=>page.address)].map(key=>h.read(key)));
        const intact=await snapshot();
        for(const [label,passed] of [['omitted last page',pages.slice(0,1)],['reversed pages',[pages[1],pages[0]]]] as const) {
          await h.send('refuse paged recovery with '+label,[{...bind,accounts:[...bind.accounts,...passed]}],[],sdk.CLEARING_ERROR__RESOLUTION);
          assert.deepEqual(await snapshot(),intact,'Rejected binding changed the header or a frozen page');
        }
      }
      if(!proofRestarted && (intent.request_id.includes(':cover-range-') || pagedWallet && intent.request_id.includes(':range-'))) {
        await worker.close();worker=await openWorker();proofRestarted=true;
        assert.equal((await worker.queue.get(intent.request_id)).status,'finalized');
      }
    }
    if (originals.length===1) {
      await worker.close(); worker=await openWorker();
      assert.equal((await worker.queue.get(intent.request_id)).status,'finalized');
    }
  }
  assert.equal(refused,pagedRead||foreignGate||gated||contested&&!owned&&!allocationProfile);
  assert.equal(jointChecked,owned&&!pagedRead||bookApply||sharedApply||foreignApply||linked&&(!contested||allocationProfile));
  if (refused) {
    assert.equal((await resolution()).stage,2);
    assert.deepEqual([await wallet(),await traderWallet(),await vault()],[before.wallet,before.traderWallet,before.vault]);
  } else {
    assert.deepEqual((await resolution()).insuranceSpent,owned?frozen.insuranceBefore.map((before,i)=>before-BigInt(comparison.terminal.remainingInsurance[i])):populationBook?[9n,0n]:partialInventory?[(smallWinnerEntry===40_000n?10n:11n),0n]:sharedInventory?[6n,0n]:foreignBook?[6n,3n]:allocationProfile?[13n,1n]:flatCreditor?[9n,1n]:[3n,1n]);
    const target=owned||bookApply||linked||foreignApply||sharedApply?comparison.cash:comparison.ordinaryCash;
    for (const key of members) assert.equal(String((await root(key)).cash),target[key]);
    const traderPayout=flatCreditor?(linked?4_996n:4_994n):0n;
    if (flatCreditor) {
      const owner=setup.traderOwner;
      await h.send('withdraw the flat BTC claim into the trader wallet',[sdk.getWithdrawFundedAccountInstruction({...setup.common,
        btc:setup.markets[0],eth:setup.markets[1],owner,margin:otherTrader,quoteMint:setup.mint.address,
        userToken:setup.traderToken.address,guard:await guard(otherTrader),amount:traderPayout})],[owner]);
      assert.equal((await root(otherTrader)).cash,ownedTie||allocationProfile?contestedDeposit-26n:19_970n);
      assert.deepEqual([await traderWallet(),await vault()],[before.traderWallet+traderPayout,before.vault-traderPayout]);
    }
    const payoutAccounts=partialInventory?[setup.instances[0],...makers]:ownedTie||allocationProfile?[makers[0],secondMaker,makers[1]]:makers;
    const makerPayouts:bigint[]=owned?payoutAccounts.map(maker=>BigInt(comparison.cash[maker.capital])-makerDeposit):sharedInventory?(bookApply||sharedApply?comparison.successorCredits:comparison.ordinaryCredits).map(BigInt):foreignApply?[5_004n,34_968n]:foreignBook?[5_002n,34_970n]:allocationProfile?[5_002n,9_993n,9_990n]:flatCreditor?[linked?5_001n:5_003n,9_989n]:[9_999n,9_997n];
    for (const [index,amount] of makerPayouts.entries()) {
      const margin=payoutAccounts[index].capital;
      if(amount===0n) {
        assert(partialInventory);
        assert.equal((await root(margin)).cash,makerDeposit);
        continue;
      }
      await h.send('withdraw market recovery to maker wallet '+index,[sdk.getWithdrawFundedAccountInstruction({...setup.common,
        btc:setup.markets[0],eth:setup.markets[1],owner:setup.owner,margin,quoteMint:setup.mint.address,userToken:setup.token.address,
        guard:await guard(margin),amount})],[setup.owner]);
    }
    const makerTotal=makerPayouts.reduce((total,payout)=>total+payout,0n);
    for(const maker of payoutAccounts)assert.equal((await root(maker.capital)).cash,makerDeposit);
    assert.deepEqual([await wallet(),await vault()],[before.wallet+makerTotal,before.vault-makerTotal-traderPayout]);
  }
  await flush(); await journal.checkpoint(refused?'joint-certificate-required':'both-market-credits-withdrawn',true);
  const replay=await journal.finish();
  if(owned && !pagedRead)assert.deepEqual(replay.state.resolution?.boundRecovery, replay.checkpoints.find(point=>point.name==='joint-selection-bound-before-any-payment')!.state.resolution.boundRecovery);
  if(bookApply) {
    const certificate=replay.checkpoints.find(point=>point.name==='book-certified-before-apply')!.state.resolution.inventoryBook;
    const byDebtor=(a:string[],b:string[])=>Number(BigInt(a[0])-BigInt(b[0]));
    const expected=comparison.schedules.map((pair:{debtor:string;winner:string;charge:number;fills:number[][]})=>
      [pair.debtor,pair.winner,String(pair.charge),String(pair.fills[0][1])]).sort(byDebtor);
    assert.deepEqual([...certificate.pairs].sort(byDebtor),expected);
    assert.deepEqual(replay.state.resolution?.inventoryBook,certificate);
  }
  if(allocationProfile) {
    const failed=replay.checkpoints.find(point=>point.name==='insufficient-btc-cutoff-rejected')!.state.resolution.linkedAllocation;
    assert.deepEqual([failed.status,failed.cursor,failed.recovered],[2,'8',['0','12']]);
    assert.equal(replay.state.resolution?.linkedAllocation?.status,1);
  }
  const result={revision,rejectionChecked,pagedSelection,pagedCost,profile:pagedWallet?'nine-member paged clearing through wallet exit':pagedRead?'nine-member frozen selection before binding':owned?'clearing-owned joint search through wallet exit':bookApply?'verified three-debtor inventory':populationBook?'ordinary three-debtor inventory':zeroDebtorBudget?'verified zero debtor budget':partialInventory?(partialApply?'verified scarce winning inventory':'ordinary scarce winning inventory'):sharedApply?'verified shared winner inventory':sharedInventory?'ordinary shared winner inventory':foreignApply?'protected foreign creditor wallet exit':foreignGate?'linked winner with foreign obligation refused':foreignBook?'ordinary foreign winner settlement':allocationProfile?'verified linked winner allocation':contested?'contested BTC winner gate':linked?'verified linked clearing':gated?'BTC-only candidate':'ordinary settlement',freeze:freezes[0].signature,
    inputs:input,traderWalletAfter:await traderWallet(),comparison,refused,partialChecked,jointChecked,walletAfter:await wallet(),vaultAfter:await vault(),before,originals,workerCosts,events:replay.events,harnessChecks:checks.length};
  writeFileSync(directory+'/linked-default.json',json(result));
  console.log(json({profile:result.profile,events:replay.events,harnessChecks:checks.length,originals:originals.length,charges:comparison.charges,pagedSelection,pagedCost}));
} finally {
  await worker?.close(); await journal?.close();
  try {await flush();} finally {ws.close();}
}
