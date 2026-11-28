import assert from 'node:assert/strict';
import {getTokenDecoder} from '@solana-program/token';
import type {Address,Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import {appendCoverage} from './coverage-provisioning.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';

export async function qualifyListedMargin(h:CanonicalHarness,setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>,
  members:Map<Address,Address>,capitals:Address[],extraCash=0n) {
  const {traderOwner:owner,markets,vault}=setup,[trader]=setup.roots,wallet=setup.traderToken.address;
  const {route,guard,withCheckpoints}=executionTestHelpers(h,setup);
  const covered=(ix:Instruction,...roots:Address[])=>appendCoverage(ix,roots.map(key=>members.get(key)!));
  const raw=async(key:Address)=>(await h.read(key))!;
  const token=async(key:Address)=>getTokenDecoder().decode(await raw(key)).amount;
  for(const capital of capitals) {
    const bytes=await raw(capital), directory=sdk.decodeListedMargin(bytes);
    assert.deepEqual([bytes.length,directory.capacity,directory.lastIncarnation,directory.records,directory.root.cash],
      [1215,1,0n,[],100_000n]);
  }
  for(const maker of setup.instances) assert.equal((await raw(maker.capital)).length,1099);
  const before=await raw(trader);
  const initial=sdk.decodeListedMargin(before);
  assert.deepEqual([before.length,initial.capacity,initial.lastIncarnation,initial.records],[1705,6,0n,[]]);
  await setup.sample();
  const maker=setup.instances[3];
  const sell=await route({trader,actor:owner,marketIndex:1,side:1,makers:[maker],lots:[10n],minimalMarkets:true});
  await h.send('open ETH beside BTC in wider root',await withCheckpoints(covered(sell,trader,maker.capital)),[owner]);
  await setup.sample();
  const after=await raw(trader),state=sdk.decodeListedMargin(after);
  assert.deepEqual(after.subarray(sdk.INLINE_MARGIN_BYTES),before.subarray(sdk.INLINE_MARGIN_BYTES));
  const scale=1_000_000_000n;
  assert.deepEqual(state.root.positions.map(position=>[position.lots,position.virtualScaled]),
    [[1n,-60_002n*scale],[-10n,299_980n*scale]]);
  const [btc,eth]=await Promise.all([setup.marketState(0),setup.marketState(1)]);
  for(const market of [btc,eth]) assert.deepEqual([market.oracle.premiumScaled,market.oracle.fundingBase],[0n,0n]);
  // IM is rounded separately in each market. A profitable claim never offsets debt.
  const debt=(claim:bigint)=>claim<0n?-claim:0n;
  const minimumCash=(btc.upper+9n)/10n+eth.upper+debt(btc.lower-60_002n)+debt(299_980n-10n*eth.upper);
  const maximum=state.root.cash-minimumCash;
  assert(maximum>0n);
  const withdraw=async(amount:bigint)=>covered(sdk.getWithdrawFundedAccountInstruction({...setup.common,
    btc:markets[0],eth:markets[1],btcLedger:setup.ledgers[0],ethLedger:setup.ledgers[1],owner,margin:trader,
    userToken:wallet,quoteMint:setup.mint.address,guard:await guard(trader),amount}),trader);
  const balances=()=>Promise.all([token(vault),token(wallet)]);
  const [vaultBefore,walletBefore]=await balances();
  await h.send('refuse excess exit from wider root',await withCheckpoints(await withdraw(maximum+1n)),[owner],sdk.CLEARING_ERROR__ARITHMETIC);
  assert.deepEqual(await raw(trader),after);
  assert.deepEqual(await balances(),[vaultBefore,walletBefore]);
  const withdrawn=maximum-extraCash;
  await h.send(extraCash===0n?'exit maximum from wider root':'reserve cash for listed trade',await withCheckpoints(await withdraw(withdrawn)),[owner]);
  const final=await raw(trader);
  assert.deepEqual(final.subarray(sdk.INLINE_MARGIN_BYTES),before.subarray(sdk.INLINE_MARGIN_BYTES));
  assert.equal(sdk.decodeListedMargin(final).root.cash,minimumCash+extraCash);
  assert.deepEqual(await balances(),[vaultBefore-withdrawn,walletBefore+withdrawn]);
  return {minimumCash,withdrawn,crossBytes:before.length,listedMakerBytes:1215,inlineMakerBytes:1099};
}
