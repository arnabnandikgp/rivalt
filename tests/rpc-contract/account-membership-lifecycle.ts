// Signed owner lifecycle acceptance. Empty registered identities are deliberately
// distinguished from the much smaller admitted Financial population.
import assert from 'node:assert/strict';
import {type Address,type Instruction} from '@solana/kit';
import {getCreateAccountInstruction,getTransferSolInstruction} from '@solana-program/system';
import {TOKEN_PROGRAM_ADDRESS,getInitializeAccount3Instruction,getMintToInstruction} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {fixtureKey,payerKey,addresses} from './harness.js';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {WireRpc} from './wire.js';

type Common=Awaited<ReturnType<typeof addresses>>&{venue:Address;safety:Address;storage:Address;custody:Address;vault:Address};
type Allocation={kind:number;register:number;page:bigint;key:Address;receipt:Address};
export async function prepareMembershipLifecycle(h:CanonicalHarness,rpc:WireRpc,flush:()=>Promise<void>,common:Common,
  mint:Address,markets:Address[],ledgers:Address[],tracked:Set<Address>,checks:Record<string,unknown>[]) {
  const payer=await payerKey(),[registry]=await sdk.deriveVenueComponent(common.venue,'registry');
  const base={...common,registry},admin={...base,authority:payer};
  const parity=new Map<Address,string>();
  const track=(key:Address,name:string)=>{tracked.add(key);parity.set(key,name);};
  const roots: {owner:Awaited<ReturnType<typeof fixtureKey>>;portfolio:Address;margin:Address;members:Address}[]=[];
  const registryState=async()=>sdk.getVenueRegistryDecoder().decode((await h.read(registry))!);
  const rootState=async(index:number)=>sdk.getMarginAccountDecoder().decode((await h.read(roots[index].margin))!);
  const balances=async(key:Address)=>BigInt((await rpc.call('getBalance',[key,{commitment:'confirmed'}])).value);
  const snapshot=async()=>Promise.all([...tracked].map(async key=>(await h.read(key))?.toString('base64')??null));
  const reject=async(label:string,instruction:Instruction,error:number,signers:Awaited<ReturnType<typeof payerKey>>[]=[])=>{
    const before=await snapshot();await h.send(`P55 reject ${label}`,[instruction],signers,error);
    assert.deepEqual(await snapshot(),before,`${label}: atomic rollback`);
  };
  await h.send('P55 initialize scalar membership registry',[await sdk.getInitializeVenueRegistryInstructionAsync(admin)]);
  track(registry,'venueRegistry');
  for(const pageIndex of [0n,1n]) {
    const [allocation]=await sdk.deriveMemberPage(common.venue,pageIndex),[receipt]=await sdk.deriveStorageFunding(common.venue,allocation);
    await h.send('P55 fund permanent identity page',[await sdk.getFundMemberPageInstructionAsync({...base,payer,allocation,receipt,pageIndex})]);
    track(allocation,'memberPage');track(receipt,'storageFunding');
  }
  const register=async(index:number)=>{
    const owner=await fixtureKey(`p55a2-schema9-owner-${index}`);
    const [portfolio]=await sdk.deriveAccountPortfolio(common.venue,owner.address,0),[margin]=await sdk.deriveMarginAccount(portfolio,0);
    const [members]=await sdk.deriveMemberPage(common.venue,BigInt(index)/64n);
    await h.send(`P55 create owner portfolio ${index}`,[getTransferSolInstruction({source:payer,destination:owner.address,amount:20_000_000n}),
      await sdk.getCreatePortfolioInstructionAsync({...base,owner,portfolio,index:0})],[owner]);
    await h.send(`P55 register stable identity ${index}`,[await sdk.getRegisterMarginInstructionAsync({...base,owner,portfolio,margin,members,
      subaccountIndex:0,mode:0,isolatedMarketIndex:255,role:0})],[owner]);
    roots.push({owner,portfolio,margin,members});track(portfolio,'portfolio');track(margin,'marginAccount');
    assert.equal((await rootState(index)).id,BigInt(index));
  };
  for(let index=0;index<70;index++)await register(index);
  let registryBefore=await registryState();
  assert.equal(registryBefore.registeredCount,70n);assert.equal(registryBefore.financialCount,0n);
  assert.equal(registryBefore.nextId,70n);assert.equal(registryBefore.membershipEpoch,1n);
  const path=await sdk.deriveMemberPath(common.venue,65n);
  for(const [level,[allocation]] of path.entries()) {
    const [receipt]=await sdk.deriveStorageFunding(common.venue,allocation);
    await h.send('P55 fund canonical financial index node',[await sdk.getFundMemberIndexInstructionAsync({...base,payer,allocation,receipt,level,prefix:0n})]);
    track(allocation,'memberIndexNode');track(receipt,'storageFunding');
  }
  const membership=async(index:number,activate:boolean)=>{
    await flush();const root=roots[index];
    const state=await sdk.readMarginMembership(rpc,common.venue,root.owner.address,root.margin);
    const input={...base,...state,owner:root.owner};
    const instruction=activate?sdk.getActivateMarginInstruction(input):sdk.getDeactivateMarginInstruction(input);
    return {...instruction,accounts:[...instruction.accounts,...state.remaining]};
  };
  const change=async(index:number,activate:boolean)=>h.send(`P55 ${activate?'activate':'deactivate'} Financial identity ${index}`,
    [await membership(index,activate)],[roots[index].owner]);
  const retire=async(index:number)=>{
    await flush();const root=roots[index],before=await rootState(index),balance=await balances(root.owner.address);
    const registryBefore=await registryState();
    const state=await sdk.readMarginMembership(rpc,common.venue,root.owner.address,root.margin,false);
    const instruction=sdk.getRetireMarginInstruction({...base,...state,owner:root.owner});
    await h.send(`P55 permanently retire empty identity ${index}`,[instruction],[root.owner]);
    assert.equal((await h.read(root.margin))!.length,135);
    const tomb=sdk.getMarginTombstoneDecoder().decode((await h.read(root.margin))!);
    assert.equal(tomb.id,before.id);assert.equal(tomb.activationGeneration,before.activationGeneration);
    assert.equal(tomb.revision,before.revision+1n);
    assert.equal(await balances(root.owner.address)-balance,await h.rent(995)-await h.rent(135));
    assert.equal((await registryState()).membershipEpoch,registryBefore.membershipEpoch);
    assert.equal((await registryState()).registeredCount,registryBefore.registeredCount-1n);
    assert.equal(sdk.getPortfolioDecoder().decode((await h.read(root.portfolio))!).activeChildren,0);
    track(root.margin,'marginTombstone');
  };
  await reject('Financial entry without funded recovery capacity',await membership(65,true),sdk.CLEARING_ERROR__CAPACITY,[roots[65].owner]);
  await retire(0);
  const retired=roots[0];
  await reject('retired identity recreation',await sdk.getRegisterMarginInstructionAsync({...base,...retired,subaccountIndex:0,
    mode:0,isolatedMarketIndex:255,role:0}),0,[retired.owner]);

  return {parity,async complete(allocations:Allocation[]) {
    const first=await membership(65,true),competing=await membership(66,true);
    await h.send('P55 accept first shared-index predecessor',[first],[roots[65].owner]);
    await reject('stale concurrent shared-index predecessor',competing,sdk.CLEARING_ERROR__RESOLUTION,[roots[66].owner]);
    await change(66,true);await change(65,false);await change(65,true);
    assert.equal((await rootState(65)).activationGeneration,2n);
    await reject('previous activation replay',first,sdk.CLEARING_ERROR__RESOLUTION,[roots[65].owner]);
    registryBefore=await registryState();await register(70);
    assert.equal((await registryState()).membershipEpoch,registryBefore.membershipEpoch);
    assert.equal((await registryState()).financialCount,2n);assert.equal((await registryState()).nextId,71n);
    const token=await fixtureKey('p55a2-schema9-token'),owner=roots[65].owner;
    await h.send('P55 mint five valueless collateral atoms',[getCreateAccountInstruction({payer,newAccount:token,
      lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
      getInitializeAccount3Instruction({account:token.address,mint,owner:owner.address}),
      getMintToInstruction({mint,token:token.address,mintAuthority:payer,amount:5n})],[token]);
    tracked.add(token.address);
    const cash={...base,owner,margin:roots[65].margin,quoteMint:mint,userToken:token.address,btcLedger:undefined,ethLedger:undefined,amount:5n};
    await h.send('P55 deposit funded cash into Financial account',[await sdk.getDepositAccountInstructionAsync(cash)],[owner]);
    assert.equal((await rootState(65)).cash,5n);
    await reject('cash cannot be removed from financial cohort',await membership(65,false),sdk.CLEARING_ERROR__RESOLUTION,[owner]);
    await h.send('P55 withdraw actual collateral before leaving cohort',[await sdk.getWithdrawAccountCustodyInstructionAsync(cash)],[owner]);
    assert.equal((await rpc.call('getTokenAccountBalance',[token.address,{commitment:'confirmed'}])).value.amount,'5');
    assert.equal((await rpc.call('getTokenAccountBalance',[common.vault,{commitment:'confirmed'}])).value.amount,'0');
    await change(65,false);await retire(65);await change(66,false);
    assert.equal((await registryState()).financialCount,0n);
    const [certificate]=await sdk.deriveVenueComponent(common.venue,'retirement');
    const identity={...admin,btc:markets[0],eth:markets[1],btcLedger:ledgers[0],ethLedger:ledgers[1],certificate};
    await h.send('P55 initialize terminal retirement certificate',[await sdk.getInitializeAccountRetirementInstructionAsync({...base,payer,certificate})]);
    track(certificate,'retirementCertificate');
    const refundable=allocations.filter(item=>item.page===0n&&item.register===0);
    const refund=async(item:Allocation)=>sdk.getRefundRecoveryAllocationInstruction({...admin,allocation:item.key,receipt:item.receipt,rentPayer:payer.address,
      kind:item.kind,register:item.register,page:item.page,revision:(await h.read(item.key))!.readBigUInt64LE(10)});
    await reject('live venue cannot reclaim recovery rent',await refund(refundable[0]),sdk.CLEARING_ERROR__RESOLUTION);
    await h.send('P55 pause empty venue for terminal proof',[sdk.getPauseVenueInstruction({...identity,paused:true})]);
    const certificateState=sdk.getRetirementCertificateDecoder().decode((await h.read(certificate))!);
    await h.send('P55 prove complete empty Financial cohort',[sdk.getCheckAccountRetirementInstruction({...identity,
      revision:certificateState.revision,restart:true})]);
    const safetyState=sdk.getVenueSafetyDecoder().decode((await h.read(common.safety))!);
    await h.send('P55 terminally retire whole venue',[sdk.getRetireAccountsInstruction({...identity,resolution:undefined,safetyEpoch:safetyState.epoch})]);
    let refundTotal=0n;
    for(const item of refundable) {
      const before=await balances(item.key),payerBefore=await balances(payer.address),instruction=await refund(item);
      await h.send('P55 refund terminal allocation to recorded rent payer',[instruction]);
      await flush();
      const after=await balances(item.key),tomb=sdk.getStorageTombstoneDecoder().decode((await h.read(item.key))!);
      assert.equal((await h.read(item.key))!.length,72);assert.equal(after,await h.rent(72));
      assert.equal(tomb.originalKind,[17,22,23,18,21][item.kind]);assert.equal(tomb.register,item.register);assert.equal(tomb.pageIndex,item.page);
      assert.equal(sdk.getStorageFundingDecoder().decode((await h.read(item.receipt))!).rentPayer,payer.address);
      assert.equal(await balances(payer.address)-payerBefore,before-after-BigInt(String(checks.at(-1)!.feeLamports)));
      refundTotal+=before-after;track(item.key,'storageTombstone');
    }
    assert.equal(refundable.length,5);
    assert.equal(sdk.getRecoveryStorageDecoder().decode((await h.read(common.storage))!).readyCapacity,0n);
    await retire(66);
    await reject('terminal venue cannot reactivate an account',await membership(70,true),sdk.CLEARING_ERROR__RESOLUTION,[roots[70].owner]);
    return {registeredIdentities:71,financialPeak:2,reactivationGeneration:2,retiredIdentities:3,terminalRefundKinds:5,refundTotal};
  }};
}
