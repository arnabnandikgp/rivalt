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
      await h.send('open actual populated-cohort exposure',[await route({trader:item.margin,actor:item.owner,marketIndex,side,makers:[maker],lots:[lots],minimalMarkets:true})],[item.owner]);
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

/** Per-account actions while the real 128-root cohort is present. Expected cash
 * movements and the 27-atom reward are literal independent values. */
export async function exercisePopulatedActions(h:CanonicalHarness,setup:Setup,cohort:Awaited<ReturnType<typeof populateDefaultCohort>>) {
  const {root,guard,route}=executionTestHelpers(h,setup),[cross,receiver]=setup.roots,owner=setup.traderOwner;
  const common={...setup.common,btc:setup.markets[0],eth:setup.markets[1]};
  const withdraw=async(amount:bigint)=>sdk.getWithdrawFundedAccountInstruction({...common,owner,margin:cross,
    quoteMint:setup.mint.address,userToken:setup.traderToken.address,guard:await guard(cross),amount});
  const reject=async(label:string,instructions:Parameters<typeof h.send>[1],keys:Address[],error:number)=>{
    const before=await Promise.all(keys.map(h.read));await h.send(label,instructions,[owner],error);
    assert.deepEqual(await Promise.all(keys.map(h.read)),before);
  };
  await setup.sample();
  const before=await root(cross),slot=await setup.slot(),orderId=before.book.lastOrderId+1n,oldExit=await withdraw(1n);
  const terms={side:1,lots:2n,limit:58_000n,feeBudget:500n,startSlot:slot,expirySlot:slot+2000n,
    reduceOnly:true,generation:before.positions[0].generation};
  await h.send('populated whole-account existing-position TP/SL',[sdk.getManageAccountOrderInstruction({...common,actor:owner,margin:cross,
    guard:await guard(cross),marketIndex:0,operation:{__kind:'Protect',expectedId:orderId,
      takeProfit:{...terms,trigger:1,threshold:60_100n},stopLoss:{...terms,trigger:2,threshold:59_900n}}})],[owner]);
  const protectedRoot=await root(cross);assert(protectedRoot.reserved>0n);
  await reject('populated reservation invalidates prepared exit',[oldExit],[cross,setup.custody,setup.vault,...setup.ledgers],sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);
  await reject('populated exit preserves whole-account margin',[await withdraw(protectedRoot.cash-1n)],
    [cross,setup.custody,setup.vault,...setup.ledgers],sdk.CLEARING_ERROR__ARITHMETIC);
  setup.sourcePrices.btc=59_800_000_000n;await setup.qualify();
  const stop=(await root(cross)).book.orders.find(entry=>entry.order.id===orderId+1n)!.order;
  const filled=await route({trader:cross,actor:setup.payer,marketIndex:0,side:1,makers:[setup.instances[0]],lots:[1n],
    stored:{id:stop.id,version:stop.version,filled:stop.filled}});
  await h.send('populated reduce-only stop partial fill',[filled]);
  assert.equal((await root(cross)).positions[0].lots,before.positions[0].lots-1n);
  const current=await root(cross),group=current.book.protections[0].protection;
  await h.send('populated cancellation preserves remaining position',[sdk.getManageAccountOrderInstruction({...common,actor:owner,margin:cross,
    guard:await guard(cross),marketIndex:0,operation:{__kind:'Cancel',id:group.id,version:group.version,protectionGroup:true}})],[owner]);
  assert.equal((await root(cross)).reserved,0n);
  const donorBefore=await root(cross),receiverBefore=await root(receiver);
  await h.send('populated guarded funded transfer',[sdk.getTransferFundedAccountInstruction({...common,owner,donor:cross,recipient:receiver,
    amount:2n,guard:await guard(cross)})],[owner]);
  assert.equal((await root(cross)).cash,donorBefore.cash-2n);assert.equal((await root(receiver)).cash,receiverBefore.cash+2n);
  await h.send('populated guarded token withdrawal',[await withdraw(1n)],[owner]);
  await h.send('populated actual token redeposit',[await sdk.getDepositAccountInstructionAsync({...setup.common,owner,margin:cross,
    quoteMint:setup.mint.address,userToken:setup.traderToken.address,amount:1n})],[owner]);
  assert.equal((await root(cross)).cash,donorBefore.cash-2n);

  const target=cohort.additional.find(item=>item.ordinal>=64&&item.mode===1&&item.market===0&&!item.receiver&&Math.floor(item.ordinal/2)%2===0)!.margin;
  assert((await root(target)).id>64n);
  setup.sourcePrices.btc=53_500_000_000n;await setup.qualify();
  const targetBefore=await root(target),capitalBefore=await root(receiver);
  const liquidation=async(price=53_500n,lots=1n)=>sdk.getLiquidateAccountInstruction({...common,target,receiver,receiverOwner:owner,
    targetGuard:await guard(target),receiverGuard:await guard(receiver),marketIndex:0,price,lots});
  await reject('populated liquidation cannot flip target',[await liquidation(53_500n,targetBefore.positions[0].lots+1n)],
    [target,receiver,...setup.ledgers],sdk.CLEARING_ERROR__ARITHMETIC);
  await reject('populated liquidation requires post-fee deficit progress',[await liquidation(48_150n)],
    [target,receiver,...setup.ledgers],sdk.CLEARING_ERROR__ARITHMETIC);
  const instruction=await liquidation();await h.send('populated consenting funded partial liquidation',[instruction],[owner]);
  const targetAfter=await root(target),capitalAfter=await root(receiver);
  assert.equal(targetAfter.positions[0].lots,targetBefore.positions[0].lots-1n);
  assert.equal(capitalAfter.positions[0].lots,capitalBefore.positions[0].lots+1n);
  assert.equal(targetAfter.cash,targetBefore.cash-27n);assert.equal(capitalAfter.cash,capitalBefore.cash+27n);
  // Evaluate both target states at the very same executed funding checkpoint.
  // With one BTC lot removed at 53,500, MM falls 2,675 atoms; the funded
  // ceil(53,500 * 5 / 10,000)=27 reward leaves 2,648 atoms strict progress.
  const scale=1_000_000_000n,positionBefore=targetBefore.positions[0],positionAfter=targetAfter.positions[0];
  const claimBefore=positionBefore.lots*53_500n*scale+positionBefore.virtualScaled
    -positionBefore.lots*(positionAfter.fundingCheckpointScaled-positionBefore.fundingCheckpointScaled);
  const claimAfter=positionAfter.lots*53_500n*scale+positionAfter.virtualScaled;
  assert(claimBefore<0n&&claimAfter===claimBefore);
  const deficitBefore=((positionBefore.lots*53_500n+19n)/20n-targetBefore.cash)*scale-claimBefore;
  const deficitAfter=((positionAfter.lots*53_500n+19n)/20n-targetAfter.cash)*scale-claimAfter;
  assert(deficitBefore>0n&&deficitAfter>=0n);assert.equal(deficitBefore-deficitAfter,2648n*scale);

  await reject('populated liquidation guards cannot replay',[instruction],[target,receiver,...setup.ledgers],sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);
  setup.sourcePrices.btc=60_000_000_000n;await setup.qualify();
  return {reservation:protectedRoot.reserved.toString(),reducedLots:'1',transferredAtoms:'2',tokenRoundTripAtoms:'1',
    liquidation:{target,targetBefore,targetAfter,capitalBefore,capitalAfter,rewardAtoms:'27'}};
}

/** Distinct-owner/payer isolated fills overlap with all 128 roots active. This
 * checks one real scheduler pair, not a saturated throughput benchmark. */
export async function exercisePopulatedConcurrency(h:CanonicalHarness,setup:Setup,cohort:Awaited<ReturnType<typeof populateDefaultCohort>>) {
  const {root,route}=executionTestHelpers(h,setup);
  const candidates=[cohort.additional.find(item=>item.ordinal===2)!,cohort.additional.find(item=>item.ordinal===17)!];
  const instructions=await Promise.all(candidates.map(async(item,index)=>{
    assert(item.mode===1&&item.market===index&&!item.receiver);
    const owner=await fixtureKey(`p56-scale-owner-${Math.floor(item.ordinal/16)}`),before=await root(item.margin);
    const side=before.positions[index].lots>0n?1:0;
    return {item,owner,before,side,instruction:await route({trader:item.margin,actor:owner,marketIndex:index as 0|1,
      side,makers:[setup.instances[index*3+item.ordinal%3]],lots:[1n],reduceOnly:true,generation:before.positions[index].generation,minimalMarkets:true})};
  }));
  const labels=['populated concurrent isolated BTC','populated concurrent isolated ETH'];
  await Promise.all(instructions.map((value,index)=>h.send(labels[index],[value.instruction],[value.owner])));
  for(const [index,value] of instructions.entries()) {
    const after=await root(value.item.margin);
    assert.equal(after.positions[index].lots,value.before.positions[index].lots+(value.side===0?1n:-1n));
    assert.equal(after.stateVersion,value.before.stateVersion+1n);
  }
  return {labels,margins:instructions.map(value=>value.item.margin),owners:instructions.map(value=>value.owner.address)};
}
