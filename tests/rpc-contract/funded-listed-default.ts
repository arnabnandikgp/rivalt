import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {getTokenDecoder} from '@solana-program/token';
import {AccountRole,type Address,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {publishFixtureFeed} from './oracle-fixture.js';

type Setup=Awaited<ReturnType<typeof liquidityExecutionSetup>>;
export async function qualifyFundedListedDefault(h:CanonicalHarness, setup:Setup, market:{
  listing:Address; funding:Address; book:Address; directory:Address; capitals:Address[]; recipient:Address;
}) {
  const {venue,payer,feeds}=setup, {guard,root,withCheckpoints}=executionTestHelpers(h,setup);
  const owners=[...setup.instances.map(maker=>({margin:maker.capital,owner:maker.owner,token:maker.token})),
    ...setup.roots.map((margin,i)=>({margin,owner:setup.traderOwners[i],token:setup.traderTokens[i]})),
    {margin:market.recipient,owner:setup.traderOwner,token:setup.traderToken},
    ...market.capitals.map(margin=>({margin,owner:setup.traderOwners[1],token:setup.traderTokens[1]}))];
  const read=async(key:Address)=>(await h.read(key))!;
  const tokens=async(key:Address)=>getTokenDecoder().decode(await read(key)).amount;
  const safety=async()=>sdk.getVenueSafetyDecoder().decode(await read(setup.safety));
  const [episode]=await sdk.deriveListedDefault(venue);
  const [members]=await sdk.deriveMemberPage(venue,0n);
  const registered=await Promise.all(owners.map(({margin})=>root(margin)));
  assert.deepEqual(registered.map(r=>r.id),Array.from({length:12},(_,i)=>BigInt(i)));
  const sol=sdk.getListedFundingDecoder().decode(await read(market.funding)).values.oracle.sources;
  const base={...setup.common,btc:setup.markets[0],eth:setup.markets[1],btcLedger:setup.ledgers[0],ethLedger:setup.ledgers[1],episode};
  const freeze=await sdk.getFreezeListedDefaultInstructionAsync({...base,payer,directory:market.directory,members,target:setup.roots[0],
    primaryBtc:feeds[0].feed,primaryCollateral:feeds[1].feed,guardBtc:feeds[2].feed,guardCollateral:feeds[3].feed,
    primaryEth:feeds[4].feed,guardEth:feeds[5].feed,safetyEpoch:(await safety()).epoch});
  const withExtra=(ix:Instruction,keys:Address[],role:AccountRole):Instruction=>({...ix,accounts:[
    ...(ix.accounts??[]),...keys.map(address=>({address,role}))]});
  const freezeIx=withExtra(freeze,[market.listing,market.funding,market.book,sol[0],sol[2]],AccountRole.READONLY);
  const watched=[...owners.map(o=>o.margin),setup.vault,setup.safety,setup.venue,...setup.markets,...setup.ledgers,market.book,episode];
  const image=()=>Promise.all(watched.map(key=>h.read(key)));
  async function refuse(label:string,instructions:Instruction[],code:number,signers:typeof setup.traderOwners=[]) {
    const before=await image();
    await h.send(label,instructions,signers,code);
    assert.deepEqual(await image(),before,label);
  }
  async function prices(btc:bigint,eth:bigint,solPrice:bigint) {
    setup.sourcePrices.btc=btc;
    setup.sourcePrices.eth=eth;
    const now=await setup.now();
    const writes=await setup.sourceInstructions();
    writes.push(publishFixtureFeed(sol[0],setup.primary.address,now,{price:solPrice}),
      publishFixtureFeed(sol[2],setup.guard.address,now,{price:solPrice}));
    await h.send('publish independent default scenario prices',writes,[setup.primary,setup.guard]);
  }
  await prices(60_000_000_000n,3_000_000_000n,150_000_000n);
  await refuse('wider default refuses solvent trader',await withCheckpoints(freezeIx),sdk.CLEARING_ERROR__RESOLUTION);
  await prices(53_002_000_000n,3_349_800_000n,332_000_000n);
  await refuse('wider default refuses missing listing',await withCheckpoints(freeze),sdk.CLEARING_ERROR__RESOLUTION);
  const signed:[string,Instruction][]=[];
  await h.send('wider default freezes funded venue',await withCheckpoints(freezeIx));
  signed.push(['wider default freezes funded venue',freezeIx]);
  const header=sdk.getListedDefaultDecoder().decode(await read(episode)).snapshot;
  const frozen=header.markets.slice(0,header.width);
  assert.deepEqual(frozen.map(m=>[m.market,m.reference,m.funding,m.grossLots,m.settlement,m.insurance,m.fees]),
    [[0,53002n,0n,2n,0n,3n,10n],[1,33498n,0n,20n,0n,15n,45n],[2,332n,0n,20n,0n,0n,1n]]);
  assert.deepEqual([header.target,header.memberCount,header.allocatedVault,(await safety()).mode],
    [setup.roots[0],12n,7_340_248n,2]);
  const withdraw=async(account:typeof owners[number],amount:bigint)=>sdk.getWithdrawFundedAccountInstruction({
    ...setup.common,btc:undefined,eth:undefined,btcLedger:undefined,ethLedger:undefined,owner:account.owner,margin:account.margin,userToken:account.token.address,quoteMint:setup.mint.address,
    guard:await guard(account.margin),amount});
  await refuse('wider default blocks frozen owner withdrawal',[await withdraw(owners[7],1n)],sdk.CLEARING_ERROR__PROFILE,[owners[7].owner]);
  // Independent historical fills: [signed lots, gross entry notional]. The
  // Python reference enumerates every candidate and computes its exact rates.
  const positions=owners.map(()=>[[0,0],[0,0],[0,0]]);
  positions[0][0]=[-1,60002];positions[3][1]=[10,299980];
  positions[6]=[[1,60002],[-10,299980],[10,1520]];positions[9][2]=[-10,1520];
  const claims=positions.map(row=>row.map(([lots,gross],m)=>lots*Number(frozen[m].reference)-Math.sign(lots)*gross));
  const rows=registered.map((r,i)=>[Number(r.cash),claims[i]]);
  const proof=JSON.parse(execFileSync('python3',['tests/financial/indexed_default_certificate.py'],
    {encoding:'utf8',input:JSON.stringify({rows,positions:positions.map((row,i)=>row.map(([lots],m)=>[lots,Math.max(0,claims[i][m])])),
      fees:frozen.map(m=>Number(m.fees+m.insurance)),framed:true})}));
  assert.deepEqual([proof.selected,proof.totalPlans,proof.spent,proof.charges],[13,14,[3,15,0],[1,6,0]]);
  const expected:bigint[]=proof.cash.map(BigInt);
  assert.deepEqual(expected,[1006999n,1000000n,1000000n,1034993n,1000000n,1000000n,0n,1000000n,0n,98200n,100000n,100000n]);
  const settle=async(selected:number,numerators:number[],accounts=owners.map(o=>o.margin))=>withExtra(
    await sdk.getSettleListedDefaultInstructionAsync({...base,epoch:header.epoch,selected,denominator:proof.denominator,numerators}),
    [market.book,...accounts],AccountRole.WRITABLE);
  await refuse('wider default refuses missing creditor',[await settle(proof.selected,proof.numerators,owners.slice(1).map(o=>o.margin))],
    sdk.CLEARING_ERROR__RESOLUTION);
  await refuse('wider default refuses incorrect selection',[await settle(0,proof.numerators)],sdk.CLEARING_ERROR__RESOLUTION);
  const rates=proof.numerators.slice();rates[1]--;
  await refuse('wider default refuses incorrect rate',[await settle(proof.selected,rates)],sdk.CLEARING_ERROR__RESOLUTION);
  const settleIx=await settle(proof.selected,proof.numerators);
  await h.send('wider default settles complete funded venue',[settleIx]);
  signed.push(['wider default settles complete funded venue',settleIx]);
  assert.equal((await safety()).mode,3);
  assert(sdk.getListedDefaultDecoder().decode(await read(episode)).completed);
  assert.deepEqual(await Promise.all(owners.map(async({margin})=>(await root(margin)).cash)),expected);
  await refuse('wider default refuses settlement replay',[settleIx],sdk.CLEARING_ERROR__RESOLUTION);
  for(const [i,account] of owners.entries()) {
    const amount=expected[i];
    if(amount===0n)continue;
    const wallet=await tokens(account.token.address),vault=await tokens(setup.vault);
    await h.send('wider owner withdraws settled cash '+i,[await withdraw(account,amount)],[account.owner]);
    assert.equal(await tokens(account.token.address),wallet+amount);
    assert.equal(await tokens(setup.vault),vault-amount);
    assert.equal((await root(account.margin)).cash,0n);
  }
  assert.equal(await tokens(setup.vault),56n);
  return {signed,episode,expected,withdrawals:expected.filter(amount=>amount>0n).length,retained:56n};
}
