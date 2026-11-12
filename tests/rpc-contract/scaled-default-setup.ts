/** Actual populated-cohort provisioning for P56. Signed instructions create every
 * identity, deposit, position and fee; no synthetic financial account writes. */
import assert from 'node:assert/strict';
import {getTransferSolInstruction,getCreateAccountInstruction} from '@solana-program/system';
import {TOKEN_PROGRAM_ADDRESS,getInitializeAccount3Instruction,getMintToInstruction} from '@solana-program/token';
import type {Address} from '@solana/kit';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import {provisionRecoveryWorkspace,registerFinancialTestMargin} from './account-membership-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {fixtureKey} from './harness.js';
import * as sdk from '@rivalt/sdk';

type Setup=Awaited<ReturnType<typeof liquidityExecutionSetup>>;
export async function populateDefaultCohort(h:CanonicalHarness,setup:Setup,population:128|1024) {
  const before=sdk.getVenueRegistryDecoder().decode((await h.read(setup.registry))!);
  assert.equal(before.financialCount,8n);assert.equal(before.nextId,8n);
  await provisionRecoveryWorkspace(h,setup.common,setup.payer,BigInt(population));
  const {root,route}=executionTestHelpers(h,setup);
  const additional:{margin:Address;owner:Awaited<ReturnType<typeof fixtureKey>>;ordinal:number;mode:number;market:number;cash:bigint;receiver:boolean}[]=[];
  for(let start=0;start<population-8;start+=16) {
    const owner=await fixtureKey(`p56-scale-owner-${start/16}`),token=await fixtureKey(`p56-scale-token-${start/16}`);
    const count=Math.min(16,population-8-start);
    await h.send('fund populated-cohort owner rent',[getTransferSolInstruction({source:setup.payer,destination:owner.address,amount:2_000_000_000n})]);
    await h.send('mint valueless populated-cohort deposits',[
      getCreateAccountInstruction({payer:setup.payer,newAccount:token,lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
      getInitializeAccount3Instruction({account:token.address,mint:setup.mint.address,owner:owner.address}),
      getMintToInstruction({mint:setup.mint.address,token:token.address,mintAuthority:setup.payer,amount:BigInt(count)*500_000n})],[token]);
    for(let child=0;child<count;child++) {
      const ordinal=start+child,portfolioIndex=Math.floor(child/8),subaccountIndex=child%8;
      const [portfolio]=await sdk.deriveAccountPortfolio(setup.venue,owner.address,portfolioIndex);
      if(subaccountIndex===0)await h.send('create populated-cohort portfolio',[await sdk.getCreatePortfolioInstructionAsync({...setup.common,owner,portfolio,index:portfolioIndex})],[owner]);
      const [margin]=await sdk.deriveMarginAccount(portfolio,subaccountIndex),mode=subaccountIndex===0?0:1,market=ordinal%2;
      const receiver=child===7,cash=(mode===0?400_000n:market===0?300_000n:200_000n)+BigInt(ordinal);
      await registerFinancialTestMargin(h,setup.common,setup.payer,{owner,portfolio,margin,subaccountIndex,mode,
        isolatedMarketIndex:mode===0?255:market,role:receiver?2:0});
      await h.send('deposit actual populated-cohort collateral',[await sdk.getDepositAccountInstructionAsync({...setup.common,owner,margin,
        quoteMint:setup.mint.address,userToken:token.address,amount:cash})],[owner]);
      additional.push({margin,owner,ordinal,mode,market,cash,receiver});
    }
  }
  // Both signs and mixed-market claims give actual cross-market dependency cycles;
  // differing cash/quantities exercise fractional collection and atom ownership.
  await setup.qualify();
  let trades=0;
  for(const item of additional) {
    if(item.ordinal%4===0)await setup.sample();
    if(item.receiver)continue;
    const markets=item.mode===0?[0,1] as const:[item.market as 0|1];
    for(const marketIndex of markets) {
      const side=(item.mode===0?(Math.floor(item.ordinal/8)+marketIndex)%2:Math.floor(item.ordinal/2)%2) as 0|1;
      const lots=BigInt((marketIndex===0?35:30)+item.ordinal%5),maker=setup.instances[marketIndex*3+item.ordinal%3];
      await h.send('open actual populated-cohort exposure',[await route({trader:item.margin,actor:item.owner,marketIndex,side,makers:[maker],lots:[lots]})],[item.owner]);
      trades++;
    }
    const actual=await root(item.margin);
    assert(actual.positions.some(position=>position.lots!==0n));
  }
  const registry=sdk.getVenueRegistryDecoder().decode((await h.read(setup.registry))!);
  assert.equal(registry.financialCount,BigInt(population));
  return {population,additional:additional.map(({owner,...item})=>({...item,owner:owner.address})),trades,
    limitations:['internal test participants and synthetic independent sources','network test fees and account rent reported separately']};
}

export async function defaultStorageResources(rpc:{call(method:string,params?:unknown[]):Promise<any>}) {
  const response=await rpc.call('getProgramAccounts',[sdk.CLEARING_PROGRAM_ADDRESS,{encoding:'base64',commitment:'confirmed',withContext:true}]);
  const tags=new Set([sdk.PREPARED_SETTLEMENT_DISCRIMINATOR,sdk.SETTLEMENT_RATES_DISCRIMINATOR,sdk.SETTLEMENT_PLAN_DISCRIMINATOR,
    sdk.FROZEN_MARGIN_PAGE_DISCRIMINATOR,sdk.SETTLEMENT_LIMB_PAGE_DISCRIMINATOR].map(sdk.hex));
  let recoveryBytes=0,recoveryAccounts=0,recoveryRent=0n,allBytes=0,allRent=0n;
  for(const {account} of response.value) {
    assert.equal(account.owner,sdk.CLEARING_PROGRAM_ADDRESS);assert(Number.isSafeInteger(account.lamports));
    const bytes=Buffer.from(account.data[0],'base64');allBytes+=bytes.length;allRent+=BigInt(account.lamports);
    if(tags.has(sdk.hex(bytes.subarray(0,8)))){recoveryBytes+=bytes.length;recoveryAccounts++;recoveryRent+=BigInt(account.lamports);}
  }
  return {contextSlot:String(response.context.slot),recoveryBytes,recoveryAccounts,recoveryRentLamports:recoveryRent.toString(),
    allClearingBytes:allBytes,allClearingAccounts:response.value.length,allClearingRentLamports:allRent.toString()};
}
