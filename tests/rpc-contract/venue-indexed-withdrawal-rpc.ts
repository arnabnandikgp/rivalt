// Authenticated venue markets, real maker fills and a signed SPL-token exit.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {getTokenDecoder} from '@solana-program/token';
import type {Address, Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {appendCoverage,coverageProvisioning} from './coverage-provisioning.js';
import {routerBuild} from './execution-router-build.js';
import type {ExpectedInstructionError} from './instruction-errors.js';
import {payerKey} from './harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const build=routerBuild(), directory=process.env.RIVALT_RUN_DIR!;
assert.equal(build.artifactSet,sdk.INDEXED_WITHDRAWAL_ARTIFACT_SET);
const {rpc,ws,h:transport,checks,flush}=await openCanonicalRpcHarness(
  process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,{deferFinality:true,
    computeUnitLimit:label=>label.startsWith('exit ') ? 400_000 : undefined});
try {
  const {h,members,lanes}=coverageProvisioning(transport,await payerKey());
  const setup=await liquidityExecutionSetup(h,rpc,{traderCount:2,recoveryCapacity:8,marketCheckpoints:true,
    marginLayout:'ledger-lanes',shape:symmetricPayoutShape,verifyRejections:false});
  const {root,route,guard,withCheckpoints}=executionTestHelpers(h,setup);
  const [trader,recipient]=setup.roots, owner=setup.traderOwner, wallet=setup.traderToken.address;
  const common={...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  const identity={...setup.identity,boundedEntry:true,closedQuantity:true};
  const read=()=>sdk.readAccountSnapshot(rpc,identity,[trader],'confirmed');
  const checkpointAccounts=await sdk.venueMarketCheckpoints(setup.venue);
  const prefix=(ix:Instruction)=>[...sdk.marketCheckpointsFor(checkpointAccounts,ix),ix];
  const covered=(ix:Instruction,keys:Address[])=>appendCoverage(ix,keys.map(key=>members.get(key)!));
  const watched=[trader,recipient,...setup.instances.flatMap(maker=>[maker.capital,maker.registration]),
    ...lanes,...setup.markets,...setup.ledgers,setup.custody,setup.vault,wallet];
  const state=()=>Promise.all(watched.map(h.read));
  const tokens=async(key:Address)=>getTokenDecoder().decode((await h.read(key))!).amount;
  async function refuse(label:string,ix:Instruction,error:ExpectedInstructionError) {
    const before=await state();
    await h.send(label,prefix(ix),[owner],error);
    assert.deepEqual(await state(),before,label);
  }
  const withdraw=async(amount:bigint)=>sdk.groupedFundedWithdrawal(await read(),owner.address,trader,wallet,amount);
  const omitEth=async()=>covered(sdk.getWithdrawFundedAccountInstruction({...setup.common,btc:setup.markets[0],
    owner,margin:trader,userToken:wallet,quoteMint:setup.mint.address,guard:await guard(trader),amount:1n}),[trader]);

  await setup.sample();
  const startSlot=await setup.slot();
  const order=sdk.getManageAccountOrderInstruction({...common,actor:owner,margin:trader,guard:await guard(trader),
    marketIndex:1,operation:{__kind:'Place',expectedId:1n,terms:{side:0,lots:1n,limit:33_000n,feeBudget:100n,
      startSlot,expirySlot:startSlot+2000n,trigger:0,threshold:0n,reduceOnly:false,generation:0n}}});
  await h.send('place ETH reservation',await withCheckpoints(covered(order,[trader])),[owner]);
  assert((await root(trader)).reserved>0n);
  const orderOnly=await withdraw(1n);
  assert(orderOnly.accounts.some(meta=>meta.address===setup.markets[1]));
  assert(!orderOnly.accounts.some(meta=>meta.address===setup.markets[0]));
  await refuse('exit omitting reserved ETH',await omitEth(),sdk.CLEARING_ERROR__ORDER_STATE);
  const wrongMarket={...orderOnly, accounts:orderOnly.accounts.map(meta=>meta.address===setup.markets[1]
    ? {...meta,address:setup.markets[0]} : meta)};
  await refuse('exit substituting BTC for reserved ETH',wrongMarket,'InvalidSeeds');
  const cancel=sdk.getManageAccountOrderInstruction({...common,actor:owner,margin:trader,guard:await guard(trader),
    marketIndex:1,operation:{__kind:'Cancel',id:1n,version:1n,protectionGroup:false}});
  await h.send('cancel ETH reservation',await withCheckpoints(covered(cancel,[trader])),[owner]);

  for (const marketIndex of [0,1] as const) {
    await setup.sample();
    const maker=setup.instances[3*marketIndex];
    const fill=await route({trader,actor:owner,marketIndex,side:marketIndex,makers:[maker],lots:[10n],minimalMarkets:true});
    await h.send('open '+(marketIndex===0?'ten BTC long':'ten ETH short'),
      await withCheckpoints(covered(fill,[trader,maker.capital])),[owner]);
  }
  await setup.sample();
  await refuse('exit omitting open ETH',await omitEth(),sdk.CLEARING_ERROR__ORDER_STATE);
  const view=await read(), margin=view.roots[trader];
  // Independent cash floor for two signed fills against a symmetric spread.
  // In this book the held premium is zero. Charge each negative claim and 10% IM
  // rounded up separately per market. No call to the SDK risk calculator here.
  const [btc,eth]=view.marketStates;
  assert.deepEqual(view.marketStates.map(m=>[m.oracle.premiumScaled,m.oracle.fundingBase]),[[0n,0n],[0n,0n]]);
  const scale=1_000_000_000n;
  assert.deepEqual(margin.positions.map(p=>[p.lots,p.virtualScaled]),[[10n,-600_020n*scale],[-10n,299_980n*scale]]);
  assert.equal(margin.reserved,0n);
  const debt=(signedClaim:bigint)=>signedClaim<0n ? -signedClaim : 0n;
  const cashFloor=(10n*btc.upper+9n)/10n+(10n*eth.upper+9n)/10n
    +debt(10n*btc.lower-600_020n)+debt(299_980n-10n*eth.upper);
  const transferable=margin.cash-cashFloor;
  const transfer=async(amount:bigint)=>covered(sdk.getTransferFundedAccountInstruction({...common,owner,
    donor:trader,recipient,guard:await guard(trader),amount}),[trader,recipient]);
  await refuse('transfer one atom beyond margin',await transfer(transferable+1n),sdk.CLEARING_ERROR__ARITHMETIC);
  const recipientCash=(await root(recipient)).cash;
  await h.send('transfer one funded atom',prefix(await transfer(1n)),[owner]);
  assert.equal((await root(recipient)).cash,recipientCash+1n);
  const maximum=transferable-1n;
  await refuse('exit one atom beyond margin',await withdraw(maximum+1n),sdk.CLEARING_ERROR__ARITHMETIC);
  const beforeWallet=await tokens(wallet),beforeVault=await tokens(setup.vault);
  const instruction=await withdraw(maximum);
  await h.send('exit maximum funded cash',prefix(instruction),[owner]);
  assert.equal((await root(trader)).cash,cashFloor);
  assert.equal(await tokens(wallet),beforeWallet+maximum);
  assert.equal(await tokens(setup.vault),beforeVault-maximum);
  await flush();
  const journal=await openSettlementJournal(rpc,setup,checks.map(row=>String(row.signature)),build);
  const replay=await journal.finish();
  const result={program:build.revision,harness:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    maximum,cashFloor,events:replay.events,transactions:checks.length,exits:checks.filter(row=>String(row.label).startsWith('exit '))};
  writeFileSync(directory+'/indexed-withdrawal.json',json(result));
  console.log('Reconciled indexed venue withdrawal',maximum.toString(),'atoms, cash floor',cashFloor.toString(),'events',replay.events);
} finally {await ws.close();}
