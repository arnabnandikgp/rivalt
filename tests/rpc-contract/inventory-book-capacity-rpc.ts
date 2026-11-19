// Measure the same pinned certificate on a real, larger cohort with a flat maker.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {AccountRole} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {accountDefaultStep} from '../../packages/services/src/account-default-worker.js';
import {accountDefaultContext,readAccountResolution} from '../../packages/services/src/account-worker-state.js';
import {json} from '../../packages/indexer/src/events.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {verifyProfitBuild} from './profit-attribution-build.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const pairs=Number(process.env.RIVALT_INVENTORY_PAIRS),stride=Number(process.env.RIVALT_INVENTORY_STRIDE??1);
const traderCount=(2*pairs-1)*stride+1;
assert(Number.isSafeInteger(pairs)&&pairs>=1&&Number.isSafeInteger(stride)&&stride>=1&&6+traderCount<=1024,
  'Use a population within the qualification storage fixture');
const activeIndices=Array.from({length:2*pairs},(_,index)=>index*stride);
const directory=process.env.RIVALT_RUN_DIR!, url=process.env.RIVALT_RPC_URL!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const build=verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,false,false,false,false,'book');
const label='certify every active BTC lot';
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(url,process.env.RIVALT_WS_URL!,directory,{
  deferFinality:true,computeUnitLimit:value=>value===label?1_200_000:1_000_000,observeOutcomes:value=>value===label,
});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined,worker:AccountRuntime|undefined;
try {
  const setup=await liquidityExecutionSetup(h,rpc,{traderCount,traderCash:20_000n,marginLayout:'sponsored-profit',
    shape:symmetricPayoutShape,verifyRejections:false});
  const {root,route}=executionTestHelpers(h,setup);
  for(const [index,local] of activeIndices.entries()) {
    const trader=setup.roots[local];
    // Each long and short trades against the same flat-spread maker. Alternating
    // keeps that maker flat after each pair and earns it exactly four claim atoms.
    await setup.sample();
    const side=index%2===0?0:1,actor=setup.traderOwners[local];
    await h.send('open funded BTC trader '+index,[await route({trader,actor,marketIndex:0,
      side,makers:[setup.instances[0]],lots:[1n],maxFee:13n,allInLimit:side===0?60_015n:59_986n})],[actor]);
  }
  setup.sourcePrices.btc=40_000_000_000n;
  await setup.freshSources();
  const safety=sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!);
  const resolution=sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const target=setup.roots[0],id=(await root(target)).id;
  await h.send('freeze the funded population from signed prices',[sdk.getFreezeAccountsInstruction({...setup.safetyCommon,
    primaryBtc:setup.feeds[0].feed,primaryCollateral:setup.feeds[1].feed,guardBtc:setup.feeds[2].feed,
    guardCollateral:setup.feeds[3].feed,primaryEth:setup.feeds[4].feed,guardEth:setup.feeds[5].feed,
    caller:setup.payer,target,members:(await sdk.deriveMemberPage(setup.venue,id/64n))[0],safetyEpoch:safety.epoch,resolutionEpoch:resolution.epoch,emergency:false})]);
  await flush();
  journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  await journal.checkpoint('frozen-population',true);
  worker=new AccountRuntime(process.env.RIVALT_DATABASE_URL!,'p55b2-application',url,4,'book-inventory-candidate');
  await worker.open();
  let measured=false;
  for(let steps=0;steps<2*setup.roots.length+125;steps++) {
    const state=await readAccountResolution(worker.rpc,setup.venue),header=state.preparedState;
    const common=await accountDefaultContext(worker.rpc,state);
    const next=await accountDefaultStep(worker,setup.payer,state,common);
    if(next.status==='ready' && next.reason!=='verify-inventory-book') {
      await h.send(next.reason,[next.instruction]);continue;
    }
    const expectedInsurance=BigInt(25*pairs)/4n, loss=BigInt(15*pairs);
    const charge=15n*(loss-expectedInsurance)/loss;
    assert.deepEqual([header.insurance,header.gross,header.count],[[expectedInsurance,0n],[BigInt(pairs*2),0n],BigInt(6+traderCount)]);
    const ordinals=activeIndices.map(index=>BigInt(index+6));
    const pageIndices=[...new Set(ordinals.map(ordinal=>ordinal/8n))];
    const activePages=pageIndices.length;
    const pages=await Promise.all(pageIndices.map(async index=>(await sdk.deriveFrozenMarginPage(setup.venue,index))[0]));
    const scopeExceeded=activePages>sdk.INVENTORY_BOOK_ACTIVE_PAGE_LIMIT;
    assert.equal(next.status,scopeExceeded?'blocked':'ready');
    let instruction;
    if(next.status==='blocked') {
      assert.equal(next.reason,'inventory-book-requires-paged-verification');
      const attempted=sdk.getVerifyInventoryBookInstruction({...common,epoch:header.epoch,revision:header.revision,ordinals});
      instruction={...attempted,accounts:[...attempted.accounts,...pages.map(address=>({address,role:AccountRole.WRITABLE}))]};
    } else instruction=next.instruction;
    const watched=[common.prepared,...pages,setup.resolution,setup.vault,...setup.roots];
    const snapshot=()=>Promise.all(watched.map(account=>h.read(account)));
    const before=await snapshot();
    await h.send(label,[instruction]);
    await flush();
    const outcome=checks.find(check=>check.label===label)!;
    assert(outcome && typeof outcome.computeUnits==='number' && typeof outcome.bytes==='number');
    const after=await snapshot();
    if(outcome.error===null) {
      assert(!scopeExceeded);
      const receipt=sdk.inventoryBookReceipt(sdk.getPreparedSettlementDecoder().decode(after[0]!));
      assert(receipt && receipt.total===charge*BigInt(pairs) && receipt.count===BigInt(pairs));
      assert.deepEqual(after.slice(1+pages.length),before.slice(1+pages.length),'certification changed custody or financial roots');
    } else {
      const tx=JSON.parse(readFileSync(directory+'/transaction-'+checks.indexOf(outcome)+'.json','utf8'));
      const reason=[JSON.stringify(tx.meta.err),...tx.meta.logMessages].join(' ');
      if(scopeExceeded)assert.deepEqual(tx.meta.err?.InstructionError?.[1],{Custom:sdk.CLEARING_ERROR__PROFILE});
      else assert(/memory allocation failed|exceeded.*(?:CUs|compute units)|ComputationalBudgetExceeded/i.test(reason),'Unclassified certificate failure: '+reason);
      assert.deepEqual(after,before,'rejected certificate modified frozen state');
    }
    await journal.checkpoint('measured-certificate',true);
    const replay=await journal.finish(), certificate=replay.state.resolution?.inventoryBook;
    if(outcome.error===null) {
      assert(certificate && certificate.pairs.length===pairs);
      assert.deepEqual(certificate.pairs.map(row=>row.slice(2)),Array.from({length:pairs},()=>[String(charge),String(40_000n+charge)]));
    } else assert.equal(certificate,undefined);
    const result={revision,sbf:build.revision,active:pairs*2,financialMembers:6+traderCount,stride,activePages,expectedCharge:String(charge),
      finalized:outcome,freshEvents:replay.events,harnessChecks:checks.length};
    writeFileSync(directory+'/inventory-capacity.json',json(result));
    console.log(json(result));
    measured=true;break;
  }
  assert(measured,'The frozen book never reached the certificate');
} finally {
  await worker?.close();await journal?.close();
  try {await flush();} finally {ws.close();}
}
