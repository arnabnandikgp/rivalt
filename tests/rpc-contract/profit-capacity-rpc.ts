// Contributor SOL is independent of both token collateral and the transaction fee payer.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import type {Address,TransactionSigner} from '@solana/kit';
import {getTransferSolInstruction} from '@solana-program/system';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {verifyProfitBuild} from './profit-attribution-build.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const directory=process.env.RIVALT_RUN_DIR!,build=verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,true);
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:()=>1_000_000});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined;
try {
  const setup=await liquidityExecutionSetup(h,rpc,{marginLayout:'sponsored-profit',shape:symmetricPayoutShape,verifyRejections:false});
  const {route,root}=executionTestHelpers(h,setup);
  const trader=setup.roots[0],maker=setup.instances[0],owner=setup.traderOwner;
  const firstSponsor=setup.primary,secondSponsor=setup.guard;
  const balance=async(key:Address)=>BigInt((await rpc.call('getBalance',[key,{commitment:'confirmed'}])).value);
  const rent=async(size:number)=>BigInt(await rpc.call('getMinimumBalanceForRentExemption',[size]));
  const margin=async(key:Address)=>sdk.decodeProfitAttribution((await h.read(key))!,true);
  const original=await h.read(trader);assert(original);
  const initial=original.length;
  const size=(width:number)=>initial+40+2*(width-128);
  const resize=async(key:Address,actor:TransactionSigner,payer:TransactionSigner,prior:Address,width:number,limit:bigint)=>
    sdk.getManageProfitCapacityInstructionAsync({...setup.common,margin:key,actor,payer,previousContributor:prior,slotBytes:width,
      revision:(await root(key)).revision,maxPayment:limit});
  const trade=async(side:0|1)=>route({trader,actor:owner,marketIndex:0,side,makers:[maker],lots:[129n],
    reduceOnly:side===1,generation:side===1?(await root(trader)).positions[0].generation:undefined});
  await setup.sample();
  await h.send('reject 129 lots before trader and maker reserve capacity',[await trade(0)],[owner],sdk.CLEARING_ERROR__CAPACITY);
  await h.send('donate uncredited lamports to flat margin',[getTransferSolInstruction({source:setup.payer,destination:trader,amount:17n})]);
  const initialBalance=await balance(trader);
  const makerInitialBalance=await balance(maker.capital);
  const firstBefore=await balance(firstSponsor.address);
  const credit=await rent(size(224))-initialBalance;
  assert(credit>0n);
  await h.send('reject unauthorized sponsor growth',[await resize(trader,firstSponsor,firstSponsor,owner.address,224,credit)],[firstSponsor],sdk.CLEARING_ERROR__AUTHORITY);
  await h.send('reject debit above signed ceiling',[await resize(trader,owner,firstSponsor,owner.address,224,credit-1n)],[owner,firstSponsor],sdk.CLEARING_ERROR__CAPACITY);
  assert.deepEqual(await h.read(trader),original);
  assert.equal(await balance(trader),initialBalance);assert.equal(await balance(firstSponsor.address),firstBefore);
  const stale=await resize(trader,owner,firstSponsor,owner.address,224,credit+1n);
  const first=await resize(trader,owner,firstSponsor,owner.address,224,credit);
  await h.send('sponsor 224 bytes per trader market',[first],[owner,firstSponsor]);
  assert.deepEqual((await margin(trader)).credit,{contributor:firstSponsor.address,lamports:credit});
  assert.equal(await balance(firstSponsor.address),firstBefore-credit);
  await h.send('reject replayed sponsor funding',[stale],[owner,firstSponsor],sdk.CLEARING_ERROR__PROFILE);
  await setup.sample();
  const before=await h.read(trader);
  await h.send('reject 129 lots while maker still lacks capacity',[await trade(0)],[owner],sdk.CLEARING_ERROR__CAPACITY);
  assert.deepEqual(await h.read(trader),before);
  const makerCredit=await rent(size(256))-makerInitialBalance;
  await h.send('maker owner funds its own 256-byte capacity',[await resize(maker.capital,setup.owner,setup.owner,setup.owner.address,256,makerCredit)],[setup.owner]);
  await h.send('open 129 lots against funded maker',[await trade(0)],[owner]);
  const live=await margin(trader);assert.equal(live.root.positions[0].lots,129n);
  await h.send('reject sponsor refund with open exposure',[await resize(trader,firstSponsor,firstSponsor,firstSponsor.address,128,0n)],[firstSponsor],sdk.CLEARING_ERROR__RESOLUTION);
  const secondBefore=await balance(secondSponsor.address),extra=await rent(size(256))-await balance(trader);
  await h.send('reject redirected previous contribution',[await resize(trader,owner,secondSponsor,owner.address,256,credit+extra)],[owner,secondSponsor],sdk.CLEARING_ERROR__AUTHORITY);
  await h.send('replace sponsor and grow live position',[await resize(trader,owner,secondSponsor,firstSponsor.address,256,credit+extra)],[owner,secondSponsor]);
  const grown=await margin(trader);
  assert.deepEqual(grown.positions,live.positions);
  assert.deepEqual(grown.credit,{contributor:secondSponsor.address,lamports:credit+extra});
  assert.equal(await balance(firstSponsor.address),firstBefore);
  assert.equal(await balance(secondSponsor.address),secondBefore-credit-extra);
  const vault=await h.read(setup.vault);
  await setup.sample();
  await h.send('close 129 lots with no sponsor signature',[await trade(1)],[owner]);
  assert.equal((await root(trader)).positions[0].lots,0n);
  const flat=await root(trader);
  await h.send('reject refund to an unrelated address',[await resize(trader,owner,owner,owner.address,128,0n)],[owner],sdk.CLEARING_ERROR__AUTHORITY);
  await h.send('return principal to absent sponsor',[await resize(trader,owner,owner,secondSponsor.address,128,0n)],[owner]);
  await h.send('return self-funded maker principal',[await resize(maker.capital,setup.owner,setup.owner,setup.owner.address,128,0n)],[setup.owner]);
  assert.equal(await balance(trader),initialBalance);assert.equal(await balance(maker.capital),makerInitialBalance);
  assert.equal(await balance(secondSponsor.address),secondBefore);
  const released=await margin(trader);assert.equal(released.credit,null);
  assert.deepEqual(released.root,{...flat,revision:flat.revision+1n});assert.deepEqual(await h.read(setup.vault),vault);
  await flush();
  journal=await openSettlementJournal(rpc,setup,checks.map(row=>String(row.signature)),build);
  await journal.checkpoint('sponsor-principal-returned',true);
  const replay=await journal.finish();
  const measured=checks.filter(row=>/129 lots|sponsor|principal|signed ceiling|contribution|256-byte/.test(String(row.label)));
  writeFileSync(directory+'/profit-capacity.json',json({revision,build,checks:checks.length,events:replay.events,credit,extra,
    makerCredit,initialBalance,initialBytes:initial,expandedBytes:size(256),measured})+'\n');
  console.log('Sponsored capacity',json({checks:checks.length,events:replay.events,credit,extra,makerCredit}));
} finally { await journal?.close();try {await flush();} finally {ws.close();} }
