// Compare approved joint recovery with a real frozen cross debtor and two isolated makers.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {getTokenDecoder} from '@solana-program/token';
import {AccountRole,getAddressEncoder} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {accountDefaultContext, readAccountResolution} from '../../packages/services/src/account-worker-state.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {financialRoots} from './membership-scan-helper.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {openSharedInventory} from './shared-inventory-trades.js';
import {openForeignWinnerBook} from './foreign-winner-trades.js';
import {verifyProfitBuild} from './profit-attribution-build.js';
import {eventually} from './wire.js';

const directory = process.env.RIVALT_RUN_DIR!, url = process.env.RIVALT_RPC_URL!;
const revision = execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const gated = process.env.RIVALT_SETTLEMENT_PROBE === 'profit-attribution-btc-allocation-linked';
const probe = process.env.RIVALT_SETTLEMENT_PROBE;
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
const foreignBook=foreignApply||foreignGate||probe==='profit-attribution-foreign-winner-ordinary';
const allocationProfile = probe === 'profit-attribution-linked-allocation';
const contested = allocationProfile || probe === 'profit-attribution-linked-contested';
const flatCreditor = contested || probe === 'profit-attribution-linked-flat' || probe === 'profit-attribution-linked-flat-apply';
const linked = contested || probe === 'profit-attribution-linked-apply' || probe === 'profit-attribution-linked-flat-apply';
const selection = expandedBook?'book-capacity-candidate':bookApply?'book-inventory-candidate':partialApply?'partial-inventory-candidate':sharedApply?'shared-inventory-candidate':foreignApply?'foreign-creditor-candidate':allocationProfile||foreignGate ? 'linked-allocation-candidate' : linked ? (flatCreditor ? 'linked-flat-candidate' : 'linked-pair-candidate') :
  gated ? 'btc-allocation-candidate' : 'profit-attribution-candidate';
const build = verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,gated,gated,gated,gated,expandedBook?'capacity':bookApply?'book':partialApply?'partial':sharedApply?'shared':foreignApply?'foreign':allocationProfile||foreignGate ? 'allocation' : linked && flatCreditor ? 'flat' : linked);
const {h,rpc,ws,checks,flush} = await openCanonicalRpcHarness(url,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:()=>1_000_000});
let journal: Awaited<ReturnType<typeof openSettlementJournal>> | undefined;
let worker: AccountRuntime | undefined;
try {
  const makerDeposit = 1_000_000n;
  const setup = await liquidityExecutionSetup(h,rpc,{marginLayout:bookApply||gated||linked||foreignGate||foreignApply||sharedApply?'sponsored-profit':'profit-attribution',
    shape:symmetricPayoutShape,traderCount:partialInventory||populationBook?3:2, traderCash:populationBook?20_011n:zeroDebtorBudget?20_013n:partialInventory?20_000n:sharedInventory?20_010n:foreignBook?20_000n:contested?30_000n:flatCreditor?19_996n:20_012n, makerCash:makerDeposit,verifyRejections:false});
  const {guard,route,root} = executionTestHelpers(h,setup);
  const [debtor,otherTrader] = foreignBook?[setup.roots[1],setup.roots[0]]:setup.roots;
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
  if (flatCreditor) {
    setup.sourcePrices.btc=65_000_000_000n;
    await setup.qualify();
    await h.send('open the second trader short at 64998',[await route({trader:otherTrader,actor:setup.traderOwner,
      marketIndex:0, side:1, makers:[makers[0]], lots:[1n], allInLimit:64_985n,maxFee:13n})],[setup.traderOwner]);
    setup.sourcePrices.btc=60_000_000_000n;
    await setup.qualify();
    await h.send('close the second trader at 60002 leaving an unpaid BTC claim',[await route({trader:otherTrader,actor:setup.traderOwner,
      marketIndex:0, side:0, makers:[makers[0]], lots:[1n], allInLimit:60_015n,maxFee:13n,
      reduceOnly:true,generation:(await root(otherTrader)).positions[0].generation})],[setup.traderOwner]);
    const closed=await root(otherTrader);
    assert.deepEqual([closed.cash,closed.positions[0].lots,closed.positions[0].virtualScaled],[contested?29_974n:19_970n,0n,4_996_000_000_000n]);
  }
  setup.sourcePrices.btc = sharedInventory||foreignBook?40_000_000_000n:50_000_000_000n;
  setup.sourcePrices.eth = sharedInventory?3_000_000_000n:foreignBook?1_250_000_000n:2_000_000_000n;
  await setup.freshSources();
  await h.send(sharedInventory?'freeze the first of two insolvent BTC debtors':foreignBook?'freeze the insolvent isolated BTC debtor':'freeze a cross debtor with both BTC and ETH losses',[sdk.getFreezeAccountsInstruction({...setup.safetyCommon,...sources,
    caller:setup.payer,target:debtor,members:(await sdk.deriveMemberPage(setup.venue,(await root(debtor)).id/64n))[0],
    safetyEpoch:(await safety()).epoch,resolutionEpoch:(await resolution()).epoch,emergency:false})]);
  await flush();
  const frozen = await resolution();
  assert.deepEqual(frozen.prices,sharedInventory?[40_000n,30_000n]:foreignBook?[40_000n,12_500n]:[50_000n,20_000n]);
  const members = await financialRoots(h,setup.venue,setup.registry);
  const rows = await Promise.all(members.map(async key=>{
    const {root:value,positions:basis} = sdk.decodeProfitAttribution((await h.read(key))!,bookApply||gated||linked||foreignGate||foreignApply||sharedApply);
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
  const input = {flatCreditor,traders:populationBook?setup.roots:undefined,smallWinnerEntry,zeroDebtorBudget,thirdTrader:partialInventory?setup.roots[2]:undefined,flatMaker:partialInventory?setup.instances[0].capital:undefined,secondBtcWinner:contested?secondMaker.capital:undefined,epoch:frozen.epoch,marks:frozen.prices,funding:frozen.funding,pools:frozen.poolsBefore,
    insurance:frozen.insuranceBefore,fees:frozen.feesBefore,markets:setup.markets,rows,makerDeposit,debtor,otherTrader,
    winners:makers.map(maker=>maker.capital),venueHex:Buffer.from(getAddressEncoder().encode(setup.venue)).toString('hex'),
    sourceDigest:createHash('sha256').update(json([setup.venue,frozen,rows,freezes[0].signature])).digest('hex'),
    fills:history.filter(event=>event.type==='LiquidityRouteExecutedV4').map(event=>event.data)};
  const reference=populationBook?'inventory_book_comparison':sharedInventory?'shared_inventory_comparison':foreignBook?'foreign_winner_comparison':'linked_default_comparison';
  const comparison = JSON.parse(execFileSync('python3',[`tests/financial/${reference}.py`],{input:json(input),encoding:'utf8'}));
  await journal.checkpoint(sharedInventory?'frozen-competing-debtors':'frozen-two-market-debtor',true);
  const openWorker = async () => {
    const runtime = new AccountRuntime(process.env.RIVALT_DATABASE_URL!,'p55b2-application',url,4,
      selection);
    await runtime.open();
    return runtime;
  };
  process.env.RIVALT_DEFAULT_BATCH_STEPS = bookApply||gated||linked||foreignGate||foreignApply||sharedApply?'1':'32';
  worker = await openWorker();
  const originals: string[] = [];
  const workerCosts: {request:string; units:number; bytes:number}[] = [];
  let refused = false, partialChecked = false, jointChecked = false;
  let badAttempt:bigint|undefined,rejectionChecked=false;
  const financialSnapshot=()=>Promise.all([setup.resolution,setup.vault,setup.token.address,setup.traderToken.address,
    ...setup.ledgers,...members].map(key=>h.read(key)));
  let beforeScoring:Awaited<ReturnType<typeof financialSnapshot>>|undefined;
  while ((await resolution()).stage !== 11) {
    assert(originals.length<128,'eight-member recovery exceeded the test continuation budget');
    const current = await readAccountResolution(worker.rpc,setup.venue);
    const prepared=current.preparedState;
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
    if(contested && !allocationProfile && current.preparedState.epoch===frozen.epoch && current.preparedState.stage===4) {
      if(process.env.RIVALT_FROZEN_PLAN_PROOF==='1') {
        const stable=await financialSnapshot();
        writeFileSync(directory+'/proof-input.json',json({venue:setup.venue,prepared:current.prepared,
          resolution:setup.resolution,revision:current.preparedState.revision,epoch:frozen.epoch,
          registryHash:Array.from(frozen.registryHash),debtor,rows,comparison}));
        for(const phase of ['start','resume'])execFileSync(process.execPath,
          ['--import','tsx','tests/rpc-contract/frozen-plan-rpc.ts',phase],{stdio:'inherit'});
        assert.deepEqual(await financialSnapshot(),stable);
      }
      const blocked=await worker.riskWork(setup.payer);
      assert.deepEqual(blocked,{status:'blocked',reason:'unsupported-linked-creditors'});
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
    if (!allocationProfile && linked && flatCreditor && current.preparedState.epoch===frozen.epoch && current.preparedState.stage===4) {
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
    workerCosts.push({request:intent.request_id,units:receipt.meta.computeUnitsConsumed,bytes:Buffer.from(intent.wire,'base64').length});
    originals.push(intent.signature);
    if (originals.length===1) {
      await worker.close(); worker=await openWorker();
      assert.equal((await worker.queue.get(intent.request_id)).status,'finalized');
    }
  }
  assert.equal(refused,foreignGate||gated||contested&&!allocationProfile);
  assert.equal(jointChecked,bookApply||sharedApply||foreignApply||linked&&(!contested||allocationProfile));
  if (refused) {
    assert.equal((await resolution()).stage,2);
    assert.deepEqual([await wallet(),await traderWallet(),await vault()],[before.wallet,before.traderWallet,before.vault]);
  } else {
    assert.deepEqual((await resolution()).insuranceSpent,populationBook?[9n,0n]:partialInventory?[(smallWinnerEntry===40_000n?10n:11n),0n]:sharedInventory?[6n,0n]:foreignBook?[6n,3n]:allocationProfile?[13n,1n]:flatCreditor?[9n,1n]:[3n,1n]);
    const target=bookApply||linked||foreignApply||sharedApply?comparison.cash:comparison.ordinaryCash;
    for (const key of members) assert.equal(String((await root(key)).cash),target[key]);
    const traderPayout=flatCreditor?(linked?4_996n:4_994n):0n;
    if (flatCreditor) {
      const owner=setup.traderOwner;
      await h.send('withdraw the flat BTC claim into the trader wallet',[sdk.getWithdrawFundedAccountInstruction({...setup.common,
        btc:setup.markets[0],eth:setup.markets[1],owner,margin:otherTrader,quoteMint:setup.mint.address,
        userToken:setup.traderToken.address,guard:await guard(otherTrader),amount:traderPayout})],[owner]);
      assert.equal((await root(otherTrader)).cash,allocationProfile?29_974n:19_970n);
      assert.deepEqual([await traderWallet(),await vault()],[before.traderWallet+traderPayout,before.vault-traderPayout]);
    }
    const payoutAccounts=partialInventory?[setup.instances[0],...makers]:allocationProfile?[makers[0],secondMaker,makers[1]]:makers;
    const makerPayouts:bigint[]=sharedInventory?(bookApply||sharedApply?comparison.successorCredits:comparison.ordinaryCredits).map(BigInt):foreignApply?[5_004n,34_968n]:foreignBook?[5_002n,34_970n]:allocationProfile?[5_002n,9_993n,9_990n]:flatCreditor?[linked?5_001n:5_003n,9_989n]:[9_999n,9_997n];
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
  const result={revision,rejectionChecked,profile:bookApply?'verified three-debtor inventory':populationBook?'ordinary three-debtor inventory':zeroDebtorBudget?'verified zero debtor budget':partialInventory?(partialApply?'verified scarce winning inventory':'ordinary scarce winning inventory'):sharedApply?'verified shared winner inventory':sharedInventory?'ordinary shared winner inventory':foreignApply?'protected foreign creditor wallet exit':foreignGate?'linked winner with foreign obligation refused':foreignBook?'ordinary foreign winner settlement':allocationProfile?'verified linked winner allocation':contested?'contested BTC winner gate':linked?'verified linked clearing':gated?'BTC-only candidate':'ordinary settlement',freeze:freezes[0].signature,
    inputs:input,traderWalletAfter:await traderWallet(),comparison,refused,partialChecked,jointChecked,walletAfter:await wallet(),vaultAfter:await vault(),before,originals,workerCosts,events:replay.events,harnessChecks:checks.length};
  writeFileSync(directory+'/linked-default.json',json(result));
  console.log(json({profile:result.profile,events:replay.events,harnessChecks:checks.length,originals:originals.length,charges:comparison.charges}));
} finally {
  await worker?.close(); await journal?.close();
  try {await flush();} finally {ws.close();}
}
