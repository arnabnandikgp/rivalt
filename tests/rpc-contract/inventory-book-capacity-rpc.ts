// Measure the same pinned certificate on a real, larger cohort with a flat maker.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
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

const pairs=Number(process.env.RIVALT_INVENTORY_PAIRS);
assert(Number.isSafeInteger(pairs)&&pairs>=1&&pairs<=29,'Six makers plus the trader cohort must fit this fixture’s 64 provisioned roots');
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
  const setup=await liquidityExecutionSetup(h,rpc,{traderCount:2*pairs,traderCash:20_000n,marginLayout:'sponsored-profit',
    shape:symmetricPayoutShape,verifyRejections:false});
  const {root,route}=executionTestHelpers(h,setup);
  for(const [index,trader] of setup.roots.entries()) {
    // Each long and short trades against the same flat-spread maker. Alternating
    // keeps that maker flat after each pair and earns it exactly four claim atoms.
    await setup.sample();
    const side=index%2===0?0:1,actor=setup.traderOwners[index];
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
    assert(next.status==='ready',next.reason);
    if(next.reason!=='verify-inventory-book') {
      await h.send(next.reason,[next.instruction]);continue;
    }
    const expectedInsurance=BigInt(25*pairs)/4n, loss=BigInt(15*pairs);
    const charge=15n*(loss-expectedInsurance)/loss;
    assert.deepEqual([header.insurance,header.gross,header.count],[[expectedInsurance,0n],[BigInt(pairs*2),0n],BigInt(6+pairs*2)]);
    const activePages=Math.floor((5+2*pairs)/8)+1;
    const pages=await Promise.all(Array.from({length:activePages},async (_,index)=>(await sdk.deriveFrozenMarginPage(setup.venue,BigInt(index)))[0]));
    const watched=[common.prepared,...pages,setup.resolution,setup.vault,...setup.roots];
    const snapshot=()=>Promise.all(watched.map(account=>h.read(account)));
    const before=await snapshot();
    await h.send(label,[next.instruction]);
    await flush();
    const outcome=checks.find(check=>check.label===label)!;
    assert(outcome && typeof outcome.computeUnits==='number' && typeof outcome.bytes==='number');
    const after=await snapshot();
    if(outcome.error===null) {
      const receipt=sdk.inventoryBookReceipt(sdk.getPreparedSettlementDecoder().decode(after[0]!));
      assert(receipt && receipt.total===charge*BigInt(pairs) && receipt.count===BigInt(pairs));
      assert.deepEqual(after.slice(1+pages.length),before.slice(1+pages.length),'certification changed custody or financial roots');
    } else {
      const tx=JSON.parse(readFileSync(directory+'/transaction-'+checks.indexOf(outcome)+'.json','utf8'));
      const reason=[JSON.stringify(tx.meta.err),...tx.meta.logMessages].join(' ');
      assert(/memory allocation failed|exceeded.*(?:CUs|compute units)|ComputationalBudgetExceeded/i.test(reason),'Unclassified certificate failure: '+reason);
      assert.deepEqual(after,before,'rejected certificate modified frozen state');
    }
    await journal.checkpoint('measured-certificate',true);
    const replay=await journal.finish(), certificate=replay.state.resolution?.inventoryBook;
    if(outcome.error===null) {
      assert(certificate && certificate.pairs.length===pairs);
      assert.deepEqual(certificate.pairs.map(row=>row.slice(2)),Array.from({length:pairs},()=>[String(charge),String(40_000n+charge)]));
    } else assert.equal(certificate,undefined);
    const result={revision,sbf:build.revision,active:pairs*2,financialMembers:6+pairs*2,activePages,expectedCharge:String(charge),
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
