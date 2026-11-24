import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import type {Address} from '@solana/kit';
import {getTokenDecoder} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {routerBuild} from './execution-router-build.js';
import {fixtureKey} from './harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {backingStep} from './membership-scan-helper.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const directory = process.env.RIVALT_RUN_DIR!;
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
assert.equal(execFileSync('git', ['status','--porcelain','--untracked-files=no'], {encoding:'utf8'}).trim(), '');
const build = routerBuild('closed-quantity');
const budget = process.env.RIVALT_MAKER_STORAGE_BUDGET ?? 'wallet';
assert(budget==='wallet'||budget==='diagnostic','Expected a wallet or diagnostic compute budget');
const routeUnits = budget==='wallet'?800_000:1_400_000;
const observed = (label:string) => budget==='wallet' && label.startsWith('cycle increase ');
const originals = new Map<string,string>();
const scale = 1_000_000_000n, cash = 10_000_000_000n, depth = 2_000_000n;
const high = 16_383n, seedLots = 4n, seedAsk = 60_001n, ask = 60_002n, bid = 59_998n;
const seedOwner = await fixtureKey('p32-trader'), cyclingOwner = await fixtureKey('p32-scale-trader-1');
const isFill = (label:string) => label.startsWith('seed ') || label.startsWith('cycle ');
const {h,rpc,ws,checks,flush} = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,{
  deferFinality:true, payerFor:label => label.startsWith('seed ')?seedOwner:label.startsWith('cycle ')?cyclingOwner:undefined,
  computeUnitLimit:label => isFill(label)?routeUnits:undefined,
  observeOutcomes:observed, measureComputeBoundary:label => budget==='wallet' && isFill(label),
  signedOriginal:(label,signature) => {if(observed(label)) originals.set(label,signature);},
  heapSize:label => isFill(label)?sdk.BEST_ROUTE_HEAP_BYTES:undefined,
});

// A maker retains r lots before each increase to H. The new fraction of the original
// one-atom price difference is exactly r/H times the old one. H is coprime to 2 and
// to the accounting scale, so this closed form is already in lowest terms.
const basis = (gapWeight:bigint, divisor:bigint) => {
  const entryScaled = (ask*divisor-gapWeight)*scale;
  const octets = (value:bigint) => Math.ceil(value.toString(2).length/8);
  return {entryScaled, paidScaled:0n, denominator:divisor, bytes:6+octets(entryScaled)+octets(divisor)};
};
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined;
try {
  const setup = await liquidityExecutionSetup(h,rpc,{marketCheckpoints:true, marginLayout:'ledger-lanes', independentTraders:true,
    verifyRejections:false, makerCash:cash, traderCash:cash, shape:instance => {
      const region = [{endLots:depth,offset:instance===0?2n:8n,slope:0n}, ...symmetricPayoutShape.bids.slice(1)];
      return {...symmetricPayoutShape,longCap:depth,shortCap:depth,bids:region,asks:region};
    }});
  const {guard,withCheckpoints} = executionTestHelpers(h,setup);
  const [seed,cycling] = setup.roots, [maker,...alternates] = setup.instances.slice(0,3);
  assert.deepEqual(setup.traderOwners.map(owner=>owner.address),[seedOwner.address,cyclingOwner.address]);
  const common = {...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  const accounts = [...setup.tracked,...setup.roots,...setup.ledgers,...setup.instances.map(item=>item.registration)];
  const economicState = () => Promise.all(accounts.map(h.read));
  const history = async (margin:Address) => {
    const bytes=(await h.read(margin))!, data=sdk.decodeProfitAttribution(bytes,true);
    assert(data.closedQuantity);
    const raw=Buffer.from(data.histories[0]), lots=data.root.positions[0].lots;
    const used=lots===0n?0:6+raw.readUInt16LE(0)+raw.readUInt16LE(2)+raw.readUInt16LE(4);
    return {entry:data.positions[0], lots, cash:data.root.cash, claimAtFlat:data.root.positions[0].virtualScaled,
      used, width:data.width, accountBytes:bytes.length, revision:data.root.revision};
  };
  const token = async (key:Address) => getTokenDecoder().decode((await h.read(key))!).amount;
  const pool = async () => sdk.decodeFeeLedger((await h.read(setup.ledgers[0]))!).state.settlement;
  const initialWallet=await token(setup.token.address), initialVault=await token(setup.vault);
  const takerFees=[0n,0n];
  async function trade(actor:0|1,side:0|1,lots:bigint,price:bigint,detail:string,capacityRefusal=false) {
    const trader=setup.roots[actor], owner=setup.traderOwners[actor], gross=lots*price, fee=(gross+4_999n)/5_000n;
    const snapshot=await setup.snapshot(trader,0);
    const order=await sdk.buildBestRoute({snapshot,trader,marketIndex:0,side,lots,maxFee:fee,
      allInLimit:side===0?gross+fee:gross-fee,reduceOnly:side===1},owner.address);
    const label=(actor===0?'seed ':'cycle ')+detail;
    const before=capacityRefusal||observed(label)?await economicState():undefined;
    await h.send(label,order.instructions,[owner],capacityRefusal?sdk.CLEARING_ERROR__CAPACITY:undefined);
    if(observed(label)) {
      const signature=originals.get(label)!;
      const status=await rpc.call('getSignatureStatuses',[[signature],{searchTransactionHistory:true}]);
      assert(status.value[0],label);
      if(status.value[0].err) {
        await flush();
        const receipt=checks.find(check=>check.signature===signature)!;
        const tx=await rpc.call('getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
        assert.deepEqual(receipt.simulationError,receipt.error);
        assert.deepEqual(tx.meta.err,status.value[0].err);
        const [index,reason]=tx.meta.err.InstructionError;
        assert.equal(index,tx.transaction.message.instructions.length-1);
        assert(reason==='ComputationalBudgetExceeded'||(reason==='ProgramFailedToComplete' &&
          tx.meta.logMessages.some((line:string)=>/exceeded CUs meter|computational budget exceeded/i.test(line))),label+' unexpected failure '+reason);
        assert.deepEqual(await economicState(),before,label+' compute rollback');
        return false;
      }
    }
    if(capacityRefusal) assert.deepEqual(await economicState(),before,label+' storage rollback');
    else takerFees[actor]+=fee;
    return !capacityRefusal;
  }

  await maker.publish(setup.updater,59_999n);
  await trade(0,0,seedLots,seedAsk,'open four');
  await setup.sample(); // Restore the ordinary anchor. All remaining trades use the same book.
  let gapWeight=1n, divisor=1n, rounds=0, cycledLots=0n;
  const boundaries=[], fills=[];
  async function verifyMaker(lots:bigint) {
    const actual=await history(maker.capital);
    const {bytes,...entry}=basis(gapWeight,divisor);
    assert.deepEqual([actual.entry,actual.lots,actual.used],[entry,-lots,bytes]);
    return actual;
  }
  await verifyMaker(seedLots);
  for(const [width,retained] of [[128,4n],[256,2n]] as const) {
    const size=high-retained, start=rounds;
    while(true) {
      if((rounds-start)%2===0) await setup.sample();
      const needed=basis(gapWeight*retained,divisor*high).bytes;
      assert(rounds<100,'Mixed-entry vector exceeded its predicted boundary');
      const storageFull=needed>width;
      const accepted=await trade(1,0,size,ask,storageFull?'refuse increase at '+width+' bytes':'increase '+(rounds+1),storageFull);
      if(!accepted) {
        const prior=await verifyMaker(retained), flat=await history(cycling);
        assert.deepEqual([prior.width,flat.width,flat.used,flat.lots],[width,128,0,0n]);
        boundaries.push({width,reason:storageFull?'storage':'compute',rounds:rounds-start,totalRounds:rounds,
          liveLots:retained,makerBytes:prior.used,nextMakerBytes:needed,makerAccountBytes:prior.accountBytes,
          cyclingTraderBytes:flat.used,nextCyclingTraderBytes:13,seedTraderBytes:(await history(seed)).used,cyclingTraderAccountBytes:flat.accountBytes});
        break;
      }
      gapWeight*=retained; divisor*=high;
      const open=await history(cycling), increased=await verifyMaker(high);
      assert.deepEqual([open.lots,open.used,open.entry],[size,13,{entryScaled:ask*scale,paidScaled:0n,denominator:1n}]);
      await trade(1,1,size,bid,'reduce '+(rounds+1));
      await verifyMaker(retained);
      const flat=await history(cycling);
      assert.deepEqual([flat.used,flat.lots],[0,0n]);
      rounds++; cycledLots+=size;
      fills.push({round:rounds,lots:size,makerBytes:increased.used,traderOpenBytes:open.used,traderFlatBytes:flat.used});
    }
    await trade(0,1,retained/2n,bid,'partial close after '+width+' refusal');
    const remaining=await verifyMaker(retained/2n);
    if(width===128) {
      const newLength=remaining.accountBytes+2*(256-width)+40;
      const balance=await rpc.call('getBalance',[maker.capital,{commitment:'confirmed'}]);
      const rent=await h.rent(newLength)-BigInt(balance.value);
      await h.send('maker owner funds second slot size',[await sdk.getManageProfitCapacityInstructionAsync({...setup.common,
        margin:maker.capital,actor:setup.owner,payer:setup.owner,previousContributor:setup.owner.address,
        slotBytes:256,revision:remaining.revision,maxPayment:rent})],[setup.owner]);
      assert.equal((await verifyMaker(2n)).width,256);
    } else await trade(0,1,1n,bid,'close remaining lot');
  }
  const [initial,expanded]=boundaries;
  assert.deepEqual([initial.reason,initial.width,initial.totalRounds,initial.makerBytes,initial.nextMakerBytes],['storage',128,33,128,132]);
  assert.equal(expanded.width,256);
  if(budget==='diagnostic') assert.deepEqual([expanded.reason,expanded.totalRounds,expanded.makerBytes,expanded.nextMakerBytes],['storage',69,254,258]);
  else assert(expanded.reason==='compute' && expanded.nextMakerBytes<=expanded.width && expanded.totalRounds>initial.totalRounds);
  const debts=[seedLots*(seedAsk-bid),cycledLots*(ask-bid)], gain=debts[0]+debts[1];
  const makerFlat=await history(maker.capital);
  assert.deepEqual([makerFlat.lots,makerFlat.used,makerFlat.claimAtFlat,makerFlat.cash],[0n,0,gain*scale,cash]);
  for(const alternate of alternates) {
    const registered=await alternate.registrationState();
    assert.deepEqual([registered.buyConsumed,registered.sellConsumed],[0n,0n]);
  }
  await setup.sample();
  assert.equal(await pool(),0n);
  for(const [index,margin] of setup.roots.entries()) {
    const flat=await history(margin), debt=debts[index];
    assert.deepEqual([flat.lots,flat.used,flat.claimAtFlat,flat.cash],[0n,0,-debt*scale,cash-takerFees[index]]);
    await h.send('collect flat trader loss '+index,await withCheckpoints(sdk.getCollectAccountLossInstruction({
      ...common,actor:setup.payer,margin,amount:debt,marketIndex:0})));
  }
  assert.equal(await pool(),gain);
  const [certificate]=await sdk.deriveSettlementCertificate(setup.venue,0);
  await h.send('initialize backing for maker gain',[sdk.getInitializeMarketBackingInstruction({...common,payer:setup.payer,certificate,marketIndex:0})]);
  for(let step=0;!sdk.getSettlementCertificateDecoder().decode((await h.read(certificate))!).complete;step++) {
    assert(step<65,'Backing scan exceeded the eight-member fixture budget');
    if(step%4===0) await setup.sample();
    const next=await backingStep(h,{...common,certificate,ledger:setup.ledgers[0]},step===0);
    await h.send('certify maker backing '+step,await withCheckpoints(next.instruction));
  }
  await h.send('pay closed maker gain',await withCheckpoints(sdk.getPayAccountGainInstruction({...common,actor:setup.payer,
    margin:maker.capital,amount:gain,marketIndex:0,certificate})));
  const paid=await history(maker.capital);
  assert.deepEqual([paid.cash,paid.claimAtFlat,await pool()],[cash+gain,0n,0n]);
  const exit=cash+gain;
  await h.send('withdraw full maker cash',await withCheckpoints(sdk.getWithdrawFundedAccountInstruction({...common,
    owner:setup.owner,margin:maker.capital,userToken:setup.token.address,quoteMint:setup.mint.address,amount:exit,
    guard:await guard(maker.capital)})),[setup.owner]);
  assert.deepEqual([await token(setup.token.address),await token(setup.vault),(await history(maker.capital)).cash],
    [initialWallet+exit,initialVault-exit,0n]);
  await flush();
  journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  await journal.checkpoint('mixed-storage-maker-exit',true);
  const replay=await journal.finish();
  const routes=checks.filter(check=>isFill(String(check.label)));
  for(const receipt of routes) assert.deepEqual(receipt.simulationError,receipt.error,String(receipt.label));
  assert.equal(routes.filter(receipt=>receipt.error!==null).length,2);
  const result={revision,program:build.revision,budget,routeUnits,boundaries,fills,cycledLots,takerFees,debts,gain,exit,events:replay.events,routes};
  writeFileSync(directory+'/mixed-maker-storage.json',json(result));
  console.log(json({boundaries,rounds,gain,exit,events:replay.events}));
} finally {
  await journal?.close();
  try {await flush();} finally {ws.close();}
}
