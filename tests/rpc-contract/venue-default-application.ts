import assert from 'node:assert/strict';
import {AccountRole, type Address, type Instruction} from '@solana/kit';
import {getTokenDecoder} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {accountDefaultStep} from '../../packages/services/src/account-default-worker.js';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {accountDefaultContext,readAccountResolution} from '../../packages/services/src/account-worker-state.js';
import {appendCoverage} from './coverage-provisioning.js';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';

type Setup=Awaited<ReturnType<typeof liquidityExecutionSetup>>;

export async function applyVenueDefault(setup:Setup,h:CanonicalHarness,lanes:Map<Address,Address>) {
  const runtime=new AccountRuntime(process.env.RIVALT_DATABASE_URL!,'p55b2-application',process.env.RIVALT_RPC_URL!,4,'venue-default-application');
  const {root,guard}=executionTestHelpers(h,setup);
  const owners=[...setup.instances.map(maker=>({...maker,margin:maker.capital})),
    {owner:setup.traderOwner,token:setup.traderToken,margin:setup.roots[0]}];
  const balances=()=>Promise.all(owners.map(async ({margin})=>(await root(margin)).cash));
  const tokens=async (address:Address)=>getTokenDecoder().decode((await h.read(address))!).amount;
  const original=await balances(),startVault=await tokens(setup.vault);
  assert.deepEqual(original,[11504n,12500n,12500n,12500n,12500n,12500n,999974n]);
  assert.equal(startVault,1_075_000n);
  const expected=[0n,24_010n,12_500n,12_500n,12_500n,12_500n,1_000_970n];
  const covered=(ix:Instruction)=>appendCoverage(ix,(ix.accounts??[]).flatMap(meta=>
    (meta.role&1)!==0&&lanes.has(meta.address)?[lanes.get(meta.address)!]:[]));
  const steps:string[]=[];
  let bound=false;
  await runtime.open();
  try {
    for (;;) {
      const current=await readAccountResolution(runtime.rpc,setup.venue),{header,preparedState}=current;
      if (header.stage===11) {
        assert.deepEqual(header.insuranceSpent,[6n,0n]);
        break;
      }
      assert(steps.length<5000,'Settlement did not reach completion within the signed continuation budget');
      const common=await accountDefaultContext(runtime.rpc,current);
      if (!bound && preparedState.epoch===header.epoch && [4,20].includes(preparedState.stage)) {
        const pages=await Promise.all(Array.from({length:Math.ceil(Number(header.count)/8)},async (_,index)=>({
          address:(await sdk.deriveFrozenMarginPage(setup.venue,BigInt(index)))[0],role:AccountRole.WRITABLE})));
        const rates=[9999,6253,9999,1,1,1];
        const make=(selected=1,revision=preparedState.revision,witness=rates,accounts=pages)=>{
          const ix=sdk.getBindIndexedDefaultInstruction({...common,epoch:header.epoch,revision,denominator:0,selected,rates:witness});
          return {...ix,accounts:[...ix.accounts,...accounts]};
        };
        const snapshot=()=>Promise.all([common.prepared,...pages.map(p=>p.address),...owners.map(o=>o.margin),setup.vault].map(h.read));
        const before=await snapshot();
        const refusals=[['skip gain',make(0)],['stale revision',make(1,preparedState.revision+1n)],
          ['trailing rates',make(1,preparedState.revision,[...rates,1])],['missing page',make(1,preparedState.revision,rates,[])]] as const;
        for(const [label,ix] of refusals) {
          await h.send('bind indexed reject '+label,[ix],[],sdk.CLEARING_ERROR__RESOLUTION);
          assert.deepEqual(await snapshot(),before);
        }
        await h.send('bind indexed settlement on frozen pages',[make()]);
        assert.deepEqual(await balances(),original);
        assert.equal(await tokens(setup.vault),startVault);
        const after=await snapshot();
        await h.send('bind indexed reject replay',[make()],[],sdk.CLEARING_ERROR__RESOLUTION);
        assert.deepEqual(await snapshot(),after);
        bound=true;
        steps.push('bind-indexed');
      } else {
        const step=await accountDefaultStep(runtime,setup.payer,current,common);
        assert(step.status==='ready',JSON.stringify({stage:header.stage,prepared:preparedState.stage,reason:step.reason}));
        await h.send('settle indexed '+steps.length+' '+step.reason,[covered(step.instruction)]);
        steps.push(step.reason);
      }
    }
    assert(bound);
    assert.deepEqual(await balances(),expected);
    assert.equal(await tokens(setup.vault),startVault);
    assert.equal(sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!).mode,3);
    for(const [index,{margin,owner,token}] of owners.entries()) {
      const amount=expected[index];
      if(amount===0n)continue;
      const previousWallet=await tokens(token.address),previousVault=await tokens(setup.vault);
      const ix=sdk.getWithdrawFundedAccountInstruction({...setup.common,btc:setup.markets[0],eth:setup.markets[1],
        owner,margin,quoteMint:setup.mint.address,userToken:token.address,guard:await guard(margin),amount});
      await h.send('withdraw indexed settlement '+index,[covered(ix)],[owner]);
      assert.equal(await tokens(token.address),previousWallet+amount);
      assert.equal(await tokens(setup.vault),previousVault-amount);
      assert.equal((await root(margin)).cash,0n);
    }
    assert.equal(await tokens(setup.vault),20n);
    return {steps,original,expected,startVault,finalVault:20n,withdrawals:expected.filter(v=>v>0n).length};
  } finally {await runtime.close();}
}
