// Real BTC/ETH clearing supplies every account image. The sparse directory is replayed natively.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Address, Instruction} from '@solana/kit';
import {getTokenDecoder} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {appendCoverage, coverageProvisioning} from './coverage-provisioning.js';
import {routerBuild} from './execution-router-build.js';
import {payerKey} from './harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const directory = process.env.RIVALT_RUN_DIR!;
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
const build = routerBuild();
assert.equal(build.artifactSet, sdk.GROUPED_CREDIT_ARTIFACT_SET);
const payer = await payerKey();
const {rpc, ws, h: transport, checks, flush} = await openCanonicalRpcHarness(
  process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, directory, {deferFinality:true});
const {h, members, lanes} = coverageProvisioning(transport, payer);
try {
  const setup = await liquidityExecutionSetup(h, rpc, {traderCount:1, marketCheckpoints:true,
    marginLayout:'ledger-lanes', shape:symmetricPayoutShape, verifyRejections:false});
  const {root, guard, route, withCheckpoints} = executionTestHelpers(h, setup);
  const [trader] = setup.roots, owner = setup.traderOwner, maker = setup.instances[3];
  const common = {...setup.common, btc:setup.markets[0], eth:setup.markets[1]};
  const wallet = async () => getTokenDecoder().decode((await h.read(maker.token.address))!).amount;
  const initialTokens = await wallet();
  const manifests: string[][] = [[], []];
  async function snapshot(label:string, traderBindings:string, makerBindings:string) {
    await flush();
    const keys = [trader, maker.capital];
    const raw = await rpc.call('getMultipleAccounts', [keys, {commitment:'finalized', encoding:'base64'}]);
    const expected = [traderBindings, makerBindings];
    for (const [index, account] of keys.entries()) {
      assert.equal(raw.value[index].owner, sdk.CLEARING_PROGRAM_ADDRESS);
      const bytes = Buffer.from(raw.value[index].data[0], 'base64');
      const name = label + '-' + account + '.bin';
      writeFileSync(join(directory, name), bytes);
      manifests[index].push(name+'\t'+expected[index]);
    }
  }
  async function financial(ix:Instruction, roots:Address[]) {
    return [...(await withCheckpoints(ix)).slice(0,-1), appendCoverage(ix, roots.map(key=>members.get(key)!))];
  }
  async function place(marketIndex:0|1) {
    const state = await root(trader), startSlot = await setup.slot();
    const expectedId = state.book.lastOrderId + 1n;
    const ix = sdk.getManageAccountOrderInstruction({...common, actor:owner, margin:trader,
      guard:await guard(trader), marketIndex, operation:{__kind:'Place', expectedId, terms:{
        side:0, lots:1n, limit:marketIndex === 0 ? 66_000n : 33_000n, feeBudget:100n,
        startSlot, expirySlot:startSlot+2000n, trigger:0, threshold:0n, reduceOnly:false, generation:0n}}});
    await h.send('place order '+expectedId, await financial(ix,[trader]), [owner]);
    assert((await root(trader)).reserved > 0n);
    return expectedId;
  }
  async function cancel(marketIndex:0|1, id:bigint) {
    const ix = sdk.getManageAccountOrderInstruction({...common, actor:owner, margin:trader,
      guard:await guard(trader), marketIndex, operation:{__kind:'Cancel',id,version:1n,protectionGroup:false}});
    await h.send('cancel order '+id, await financial(ix,[trader]), [owner]);
  }
  async function omitEth(label:string) {
    const watch = [trader, maker.capital, ...lanes, ...setup.markets, ...setup.ledgers, setup.vault, setup.traderToken.address];
    const before = await Promise.all(watch.map(h.read));
    const ix = sdk.getWithdrawFundedAccountInstruction({...setup.common, btc:setup.markets[0],
      owner, margin:trader, userToken:setup.traderToken.address, quoteMint:setup.mint.address,
      guard:await guard(trader), amount:1n});
    await h.send(label, await financial(ix,[trader]), [owner], sdk.CLEARING_ERROR__ORDER_STATE);
    assert.deepEqual(await Promise.all(watch.map(h.read)), before, label);
  }
  async function fill(side:0|1) {
    const ix = await route({trader, actor:owner, marketIndex:1, side, makers:[maker], lots:[10n],
      marketLane:true, minimalMarkets:true, reduceOnly:side === 1,
      generation:side === 1 ? (await root(trader)).positions[1].generation : undefined});
    await h.send(side === 0 ? 'open ten ETH lots' : 'reduce last ten ETH lots',
      [appendCoverage(ix, [members.get(trader)!, members.get(maker.capital)!])], [owner]);
  }
  const liveChildren = async () => (await root(trader)).book.orders.filter(({order}) =>
    order.groupId > 0n && (order.state === 1 || order.state === 2)).length;

  await snapshot('empty','','');
  await setup.sample();
  const first = await place(1);
  await snapshot('order-only','1=1','');
  await omitEth('withdrawal omitting order-only ETH');
  await cancel(1, first);
  await snapshot('cancelled','','');
  const btc = await place(0);
  await snapshot('btc-order','0=2','');
  await setup.sample();
  await fill(0);
  await snapshot('two-occupied','0=2,1=3','1=1');
  const state = await root(trader), slot = await setup.slot(), child = state.book.lastOrderId + 1n;
  const terms = {side:1, lots:10n, limit:27_000n, feeBudget:500n, startSlot:slot, expirySlot:slot+2000n,
    reduceOnly:true, generation:state.positions[1].generation};
  const protection = sdk.getManageAccountOrderInstruction({...common, actor:owner, margin:trader,
    guard:await guard(trader), marketIndex:1, operation:{__kind:'Protect',expectedId:child,
      takeProfit:{...terms,trigger:1,threshold:33_000n}, stopLoss:{...terms,trigger:2,threshold:27_000n}}});
  await h.send('protect the ten ETH lots', await financial(protection,[trader]), [owner]);
  assert.equal(await liveChildren(),2);
  await snapshot('protected','0=2,1=3','1=1');
  await cancel(1,child);
  assert.equal(await liveChildren(),1);
  await snapshot('one-child','0=2,1=3','1=1');
  await setup.sample();
  await fill(1);
  assert.equal(await liveChildren(),0);
  assert((await root(trader)).book.protections.some(entry=>entry.protection.id > 0n));
  const scale = 1_000_000_000n;
  for (const [key, claim] of [[trader,-40n],[maker.capital,40n]] as const) {
    const position = (await root(key)).positions[1];
    assert.equal(position.lots,0n);
    assert.equal(position.virtualScaled,claim*scale);
  }
  await snapshot('closed-with-claims','0=2,1=3','1=1');
  await omitEth('withdrawal omitting ETH debt after close');
  for (const amount of [39n,1n]) {
    const ix = sdk.getCollectAccountLossInstruction({...common, actor:payer, margin:trader, marketIndex:1, amount});
    await h.send('collect ETH loss '+amount, await financial(ix,[trader]));
    assert.equal((await root(trader)).positions[1].virtualScaled, (amount === 39n ? -1n : 0n)*scale);
    await snapshot('collected-'+amount, amount === 39n ? '0=2,1=3' : '0=2','1=1');
  }
  const credit = await sdk.directClosedProfitCredit({actor:payer, artifactSet:build.artifactSet,
    margin:await root(maker.capital), marketIndex:1, amount:40n});
  await h.send('fund the flat maker claim',credit);
  await snapshot('credited','0=2','');
  const exit = sdk.getWithdrawFundedAccountInstruction({...setup.common, owner:maker.owner, margin:maker.capital,
    userToken:maker.token.address, quoteMint:setup.mint.address, guard:await guard(maker.capital), amount:40n});
  await h.send('withdraw credited cash with no market accounts', await financial(exit,[maker.capital]), [maker.owner]);
  assert.equal(await wallet(), initialTokens+40n);
  await setup.sample();
  const reopened = await place(1);
  await snapshot('reopened','0=2,1=4','');
  await cancel(0,btc);
  await snapshot('compacted','1=4','');
  await cancel(1,reopened);
  await snapshot('all-released','','');
  for (const [index, rows] of manifests.entries()) {
    const file = join(directory, 'root-'+index+'.tsv');
    writeFileSync(file, rows.join('\n')+'\n');
    execFileSync(join(process.env.CARGO_TARGET_DIR ?? 'target','debug/examples/occupied-markets'), [file], {stdio:'inherit'});
  }
  const journal = await openSettlementJournal(rpc,setup,checks.map(row=>String(row.signature)),build);
  const replay = await journal.finish();
  writeFileSync(join(directory,'occupied-market-slots.json'),json({revision,program:build.revision,
    snapshotsPerRoot:manifests[0].length,creditedAtoms:40,withdrawnAtoms:40,events:replay.events}));
  console.log('Sparse slot bindings verified. Replayed events:',replay.events);
} finally {await ws.close();}
