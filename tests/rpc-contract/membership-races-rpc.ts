/** Lifecycle optimistic-concurrency acceptance with real fills and custody.
 * Prepared guards precede intervening transactions; this is not a load benchmark. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {AccountRole,type Address,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
const directory=process.env.RIVALT_RUN_DIR!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const {h,rpc,ws,checks,conformance,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:()=>800_000});
const json=(value:unknown)=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2)+'\n';
try {
  const setup=await liquidityExecutionSetup(h,rpc,{verifyRejections:false}),{root,guard,route}=executionTestHelpers(h,setup);
  const owner=setup.traderOwner,cross=setup.roots[0],portfolio=(await root(cross)).portfolio;
  const registry=async()=>sdk.getVenueRegistryDecoder().decode((await h.read(setup.registry))!);
  const safety=async()=>sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!);
  const register=async(index:number)=>{
    const [margin]=await sdk.deriveMarginAccount(portfolio,index),state=await registry();
    const [members]=await sdk.deriveMemberPage(setup.venue,state.nextId/64n);
    return {margin,instruction:await sdk.getRegisterMarginInstructionAsync({...setup.common,owner,portfolio,margin,members,
      subaccountIndex:index,mode:1,isolatedMarketIndex:1,role:0})};
  };
  const first=await register(2);await h.send('race register empty target',[first.instruction],[owner]);
  const member=async(margin:Address,activate:boolean)=>{
    await flush();const state=await sdk.readMarginMembership(rpc,setup.venue,owner.address,margin);
    const input={...setup.common,...state,owner};
    const instruction=activate?sdk.getActivateMarginInstruction(input):sdk.getDeactivateMarginInstruction(input);
    return {...instruction,accounts:[...instruction.accounts,...state.remaining]};
  };
  const retiring=async(margin:Address)=>{await flush();return sdk.getRetireMarginInstruction({...setup.common,
    ...await sdk.readMarginMembership(rpc,setup.venue,owner.address,margin,false),owner});};
  const preparedEntry=await member(first.margin,true),epoch=(await registry()).membershipEpoch;
  const second=await register(3);await h.send('race unrelated empty registration',[second.instruction],[owner]);
  assert.equal((await registry()).membershipEpoch,epoch);
  await setup.sample();
  const fill=await route({trader:cross,actor:owner,marketIndex:0,side:0,makers:[setup.instances[0]],lots:[50n]});
  assert(!fill.accounts!.some(meta=>meta.address===setup.registry&&(meta.role&AccountRole.WRITABLE)!==0),'Ordinary trade does not write membership registry');
  await h.send('race real trade while empty entry is prepared',[fill],[owner]);
  assert.equal((await registry()).membershipEpoch,epoch);
  await h.send('race prepared entry survives empty registration and unrelated trade',[preparedEntry],[owner]);
  assert.equal((await registry()).financialCount,9n);assert.equal((await root(first.margin)).activationGeneration,1n);
  const staleExit=await member(first.margin,false),identity={...setup.common,btc:setup.markets[0],eth:setup.markets[1],owner};
  await h.send('race actual transfer changes prepared exit root',[sdk.getTransferFundedAccountInstruction({...identity,
    donor:cross,recipient:first.margin,amount:1n,guard:await guard(cross)})],[owner]);
  const [members]=await sdk.deriveMemberPage(setup.venue,0n),path=await sdk.deriveMemberPath(setup.venue,(await root(first.margin)).id);
  const tracked=[...new Set([...setup.tracked,first.margin,second.margin,members,setup.storage,setup.resolution,...path.map(([key])=>key)])];
  const raw=async()=>Promise.all(tracked.map(h.read));
  const reject=async(label:string,instruction:Instruction,error:number)=>{
    const before=await raw();await h.send(label,[instruction],[owner],error);assert.deepEqual(await raw(),before);
  };
  await reject('race stale pre-transfer exit rejects',staleExit,sdk.CLEARING_ERROR__RESOLUTION);
  await reject('race current cash-bearing exit rejects',await member(first.margin,false),sdk.CLEARING_ERROR__RESOLUTION);
  await h.send('race owner withdraws actual transferred atom',[sdk.getWithdrawFundedAccountInstruction({...identity,margin:first.margin,
    quoteMint:setup.mint.address,userToken:setup.traderToken.address,amount:1n,guard:await guard(first.margin)})],[owner]);
  await h.send('race empty Financial exit',[await member(first.margin,false)],[owner]);
  const oldRetirement=await retiring(first.margin);
  await h.send('race reentry before prepared retirement',[await member(first.margin,true)],[owner]);
  await h.send('race second exit preserves generations',[await member(first.margin,false)],[owner]);
  await reject('race stale pre-reentry retirement rejects',oldRetirement,sdk.CLEARING_ERROR__AUTHORITY);
  await h.send('race current empty retirement',[await retiring(first.margin)],[owner]);
  assert.equal(sdk.getMarginTombstoneDecoder().decode((await h.read(first.margin))!).activationGeneration,2n);
  const frozenEntry=await member(second.margin,true),frozenRetirement=await retiring(second.margin),third=await register(4);
  const pendingTrade=await route({trader:cross,actor:owner,marketIndex:0,side:1,makers:[setup.instances[0]],lots:[1n]});
  setup.sourcePrices.btc=40_000_000_000n;setup.sourcePrices.eth=2_000_000_000n;await setup.fresh();
  const feeds={primaryBtc:setup.feeds[0].feed,primaryCollateral:setup.feeds[1].feed,guardBtc:setup.feeds[2].feed,
    guardCollateral:setup.feeds[3].feed,primaryEth:setup.feeds[4].feed,guardEth:setup.feeds[5].feed};
  const source=sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  await h.send('race actual bankruptcy freezes Financial cohort',[sdk.getFreezeAccountsInstruction({...setup.safetyCommon,...feeds,
    caller:setup.payer,target:cross,members,safetyEpoch:(await safety()).epoch,resolutionEpoch:source.epoch,emergency:false})]);
  await reject('race pre-freeze activation cannot alter cohort',frozenEntry,sdk.CLEARING_ERROR__RESOLUTION);
  await reject('race pre-freeze empty retirement cannot alter registry',frozenRetirement,sdk.CLEARING_ERROR__RESOLUTION);
  await reject('race pre-freeze registration cannot enter frozen venue',third.instruction,sdk.CLEARING_ERROR__PROFILE);
  await reject('race pre-freeze trade cannot execute',pendingTrade,sdk.CLEARING_ERROR__PROFILE);
  assert.equal(await h.read(third.margin),null);
  const frozen=sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  assert.equal(frozen.count,8n);assert.equal((await registry()).financialCount,8n);
  await flush();
  const parity=await conformance.finish(directory,[{program:sdk.CLEARING_PROGRAM_ADDRESS,name:'marginTombstone',key:first.margin},
    {program:sdk.CLEARING_PROGRAM_ADDRESS,name:'venueRegistry',key:setup.registry},
    {program:sdk.CLEARING_PROGRAM_ADDRESS,name:'resolution',key:setup.resolution}],h.read);
  const build=JSON.parse(readFileSync(`${process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR}/build-manifest.json`,'utf8'));
  writeFileSync(`${directory}/result.json`,json({revision,trackedDirty:false,endTrackedDirty:!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),
    build,checks,parity,frozen,limitations:['optimistic guard interleavings, not a throughput load test','complete default and SQL acceptance are separate pinned runs']}));
}finally {try{await flush();}finally{ws.close();}}
