// Signed, fresh-genesis lifecycle and financial-write checks for the local clearing profile.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {AccountRole, type Address, type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {coverageProvisioning, appendCoverage as append} from './coverage-provisioning.js';
import {registerFinancialTestMargin} from './account-membership-setup.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {routerBuild} from './execution-router-build.js';
import {payerKey} from './harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {auditCoverage, observeCoverage} from './shadow-coverage.js';

const dir = process.env.RIVALT_RUN_DIR!;
const build = routerBuild();
const revision = execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const {rpc, ws, h: transport, flush, checks} = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,
  process.env.RIVALT_WS_URL!, dir, {deferFinality:true});
const payer = await payerKey();
const controls = new Set<string>();
const capture = (keys: Address[]) => Promise.all(keys.map(key => transport.read(key)));
async function refuse(label: string, instructions: Instruction[], signers: Parameters<typeof transport.send>[2], expected=sdk.CLEARING_ERROR__EXIT_COHORT) {
  // Include the token vault, financial roots, registry, index and lane accounts if present.
  const touched = [...new Set([...instructions.flatMap(ix => (ix.accounts ?? []).filter(meta=>(meta.role & 1)!==0)
    .map(meta=>meta.address)), ...lanes])].filter(key=>key!==payer.address);
  const prior = await capture(touched);
  await transport.send(label,instructions,signers,expected);
  assert.deepEqual(await capture(touched),prior,label+' changed state');
  controls.add(label);
}

const {h, lanes, members} = coverageProvisioning(transport,payer,async (operation,ix,keys,signers) => {
  if (!controls.has('missing lane on '+operation)) {
    await refuse('missing lane on '+operation,[ix],signers);
    await refuse('wrong lane on '+operation,[append(ix,[lanes.find(key=>key!==keys[0])!])],signers);
  }
});

try {
  const setup = await liquidityExecutionSetup(h,rpc,{traderCount:1, marketCheckpoints:true,
    marginLayout:'ledger-lanes',shape:symmetricPayoutShape, verifyRejections:false});
  const {root, guard, route, withCheckpoints} = executionTestHelpers(h,setup);
  const {venue, registry, traderOwner:owner} = setup, trader=setup.roots[0], maker=setup.instances[0];
  const inputs = [venue,registry,...setup.markets], active = [...setup.instances.map(item=>item.capital),trader];
  const audits = [];
  async function audit(roots: Address[]) {
    await flush();
    return auditCoverage(rpc,venue,registry,lanes,roots,true);
  }
  audits.push(await audit(active));
  const [portfolio] = await sdk.deriveAccountPortfolio(venue,owner.address,0);
  const [child] = await sdk.deriveMarginAccount(portfolio,1);
  await registerFinancialTestMargin(h,setup.common,payer,{owner,portfolio,margin:child,subaccountIndex:1,mode:1,isolatedMarketIndex:0,role:0});
  audits.push(await audit([...active,child]));
  async function membership(enter:boolean) {
    await flush();
    const state = await sdk.readMarginMembership(rpc,venue,owner.address,child,true,setup.identity.marginLayout);
    const input = {...setup.common,...state,owner};
    const ix = enter?sdk.getActivateMarginInstruction(input):sdk.getDeactivateMarginInstruction(input);
    return {...ix,accounts:[...ix.accounts,...state.remaining]};
  }
  const transfer = async (donor: Address, recipient: Address) => sdk.getTransferFundedAccountInstruction({...setup.common,
    btc:setup.markets[0],eth:setup.markets[1],owner,donor,recipient,amount:100n,guard:await guard(donor)});
  const outbound = await withCheckpoints(await transfer(trader,child));
  await refuse('missing recipient lane on transfer',[...outbound.slice(0,-1),append(outbound.at(-1)!,[members.get(trader)!])],[owner]);
  await transport.send('transfer 100 atoms to child',[...outbound.slice(0,-1),append(outbound.at(-1)!,[members.get(trader)!,members.get(child)!])],[owner]);
  assert.equal((await root(child)).cash,100n);
  audits.push(await audit([...active,child]));
  const inbound = await withCheckpoints(await transfer(child,trader));
  await transport.send('return child balance',[...inbound.slice(0,-1),append(inbound.at(-1)!,[members.get(trader)!,members.get(child)!])],[owner]);
  assert.equal((await root(child)).cash,0n);
  const leave = await membership(false);
  await refuse('missing lane on leave',[leave],[owner]);
  await transport.send('remove empty financial member',[append(leave,[members.get(child)!])],[owner]);
  audits.push(await audit(active));
  const rejoin = await membership(true);
  await transport.send('rejoin with new generation',[append(rejoin,[members.get(child)!])],[owner]);
  assert.equal((await root(child)).activationGeneration,2n);
  audits.push(await audit([...active,child]));
  await transport.send('leave after rejoining',[append(await membership(false),[members.get(child)!])],[owner]);
  await flush();
  const retired = await sdk.readMarginMembership(rpc,venue,owner.address,child,false,setup.identity.marginLayout);
  await transport.send('retire registered identity',[sdk.getRetireMarginInstruction({...setup.common,...retired,owner})],[owner]);
  assert.equal(sdk.getMarginTombstoneDecoder().decode((await h.read(child))!).id,7n);
  audits.push(await audit(active));

  await setup.qualify();
  const traderCash = (await root(trader)).cash;
  const buy = await route({trader,actor:owner,marketIndex:0,side:0,makers:[maker],lots:[10n],marketLane:true,minimalMarkets:true});
  const traderLane=members.get(trader)!, makerLane=members.get(maker.capital)!;
  assert.notEqual(traderLane,makerLane);
  await refuse('missing maker lane on fill',[append(buy,[traderLane])],[owner]);
  await refuse('read-only maker lane on fill',[{...append(buy,[traderLane]),accounts:[
    ...append(buy,[traderLane]).accounts!,{address:makerLane,role:AccountRole.READONLY}]}],[owner]);
  await transport.send('record both sides inside BTC fill',[append(buy,[traderLane,makerLane])],[owner]);
  assert.equal((await root(trader)).positions[0].lots,10n);
  const filled = await root(trader), provided = await root(maker.capital);
  assert.equal(provided.positions[0].lots,-10n);
  // Ten lots at 60,002 atoms/lot, charged once at 2 bps with ceiling rounding.
  assert.equal(filled.cash,traderCash-121n);
  assert.equal(filled.positions[0].virtualScaled,-600_020n*1_000_000_000n);
  assert.equal(provided.positions[0].virtualScaled,600_020n*1_000_000_000n);
  audits.push(await audit(active));
  await setup.sample();
  const observation = observeCoverage(inputs,lanes,0);
  const observedLabel = 'observe covered BTC debt after join and exit';
  await transport.send(observedLabel,[observation]);
  await flush();
  const observed = checks.find(row=>row.label===observedLabel)!;
  const receipt = await rpc.call('getTransaction',[observed.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
  assert(receipt.meta.logMessages.some((log:string)=>/^Program log: coverage target=0 members=7 exact=\d+ covered=1$/.test(log)));
  const withdrawal = sdk.getWithdrawFundedAccountInstruction({...setup.common,btc:setup.markets[0],eth:setup.markets[1],
    btcLedger:setup.ledgers[0],ethLedger:setup.ledgers[1],owner,margin:trader,userToken:setup.traderToken.address,
    quoteMint:setup.mint.address,guard:await guard(trader),amount:100n});
  const prefixed = await withCheckpoints(withdrawal);
  await refuse('missing lane on withdrawal',prefixed,[owner]);
  await transport.send('withdraw 100 funded atoms with coverage',[...prefixed.slice(0,-1),append(withdrawal,[traderLane])],[owner]);
  assert.equal((await root(trader)).cash,traderCash-221n);
  audits.push(await audit(active));
  const journal = await openSettlementJournal(rpc,setup,checks.map(receipt=>String(receipt.signature)),build);
  const replay = await journal.finish();
  const result = {revision,program:build.revision,controls:[...controls],audits,events:replay.events,
    receipts:checks.filter(check=>controls.has(String(check.label)) || /both sides|100 funded|covered BTC|rejoin|remove empty|retire registered/.test(String(check.label)))};
  writeFileSync(dir+'/maintained-coverage.json',json(result));
  console.log('Verified maintained coverage',controls.size,'refusals,',replay.events,'replayed events.');
} finally {
  await ws.close();
}
