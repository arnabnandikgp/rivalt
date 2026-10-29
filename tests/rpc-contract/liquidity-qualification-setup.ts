import assert from 'node:assert/strict';
import {type Address} from '@solana/kit';
import {getMintToInstruction} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {WireRpc} from './wire.js';
import {continuationSetup} from './liquidity-continuation-setup.js';
import type {Profile} from './liquidity-continuation-model.js';

/** Fresh matched capital/account boundaries; no injected account bytes. */
export async function qualificationSetup(h:CanonicalHarness,rpc:WireRpc,profile:Profile) {
  const setup=await continuationSetup(h,rpc,profile),{baseline,canonical}=setup;
  const owner=setup.owner,token=canonical?canonical.traderToken:baseline!.operators[0].token;
  const [portfolio]=await sdk.deriveAccountPortfolio(setup.venue,owner.address,0);
  const roots=[...setup.allRoots];
  const cross=canonical?canonical.roots[0]:baseline!.cross;
  const isolated:[Address,Address]=[setup.trader,canonical?await register(2,1,1,0,1_000_000n):baseline!.operators[0].capital[1]];
  if(baseline)await deposit(cross,1_000_000n);
  // A separate account keeps order-worker and own-cash exit tests from changing
  // the timed traders' independent before/after accounting snapshots.
  const operations=await register(3,1,0,0,1_000_000n);
  const makerRoots=canonical?canonical.instances.map(maker=>maker.capital):baseline!.makers.flat().map(maker=>maker.capital);
  if(baseline)for(const market of [0,1])makerRoots.push(await register(4+market,1,market,1,500_000_000n));
  async function deposit(margin:Address,amount:bigint) {
    await h.send('P34 mint explicit matching collateral',[getMintToInstruction({mint:setup.mint.address,token:token.address,mintAuthority:setup.payer,amount})]);
    await h.send('P34 fund matching account',[await sdk.getDepositAccountV3InstructionAsync({...setup.common,owner,margin,quoteMint:setup.mint.address,userToken:token.address,amount})],[owner]);
  }
  async function register(subaccountIndex:number,mode:number,isolatedMarketIndex:number,role:number,amount:bigint) {
    const [margin]=await sdk.findMarginV3Pda(portfolio,subaccountIndex);
    await h.send('P34 register explicit comparison account',[await sdk.getRegisterMarginV3InstructionAsync({...setup.common,owner,portfolio,margin,subaccountIndex,mode,isolatedMarketIndex,role})],[owner]);
    roots.push(margin);await deposit(margin,amount);return margin;
  }
  assert.equal(new Set(makerRoots).size,6);
  const read=(trader:Address,marketIndex:0|1)=>canonical?sdk.readLiquidityTradeSnapshot(rpc,setup.identity,trader,marketIndex):sdk.readAccountTradeSnapshot(rpc,setup.identity,trader,marketIndex);
  const observedRoots=await Promise.all(roots.map(async root=>sdk.getMarginAccountV3Decoder().decode((await h.read(root))!)));
  assert.equal(observedRoots.reduce((sum,root)=>sum+root.cash,0n),3_004_000_000n);
  // Refresh after provisioning, preserving consumed depth and the legacy epoch.
  for(let round=0;round<4;round++){await setup.sources();await setup.reprice(round);await setup.funding();await new Promise(resolve=>setTimeout(resolve,2000));}
  return {...setup,owner,token,cross,isolated,operations,makerRoots,allRoots:roots,read};
}
export type QualificationSetup=Awaited<ReturnType<typeof qualificationSetup>>;
