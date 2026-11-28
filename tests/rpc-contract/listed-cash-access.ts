import assert from 'node:assert/strict';
import {getTokenDecoder} from '@solana-program/token';
import type {Address,Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import type {qualifyListedFunding} from './listed-funding.js';

export async function qualifyListedCash(h:CanonicalHarness,setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>,
  recipient:Address,published:Awaited<ReturnType<typeof qualifyListedFunding>>,listing:Address,foreignListing:Address) {
  const {venue,markets,traderOwner:owner,vault}=setup, [trader]=setup.roots, wallet=setup.traderToken.address;
  const {guard,withCheckpoints}=executionTestHelpers(h,setup);
  const raw=async(key:Address)=>(await h.read(key))!;
  const cash=async(key:Address)=>sdk.getMarginAccountDecoder().decode(await raw(key)).cash;
  const token=async(key:Address)=>getTokenDecoder().decode(await raw(key)).amount;
  const balances=()=>Promise.all([cash(trader),cash(recipient),token(vault),token(wallet)]);
  const watched=[trader,recipient,vault,wallet,setup.common.custody,...markets,published.funding,listing];
  const snapshot=()=>Promise.all(watched.map(raw));
  const refresh=async()=>{await setup.sample();await published.sampleActive();};
  const identity={...setup.common,btc:markets[0],eth:markets[1],btcLedger:undefined,ethLedger:undefined,owner};
  const signed: [string,Instruction][]=[];
  await refresh();
  const before=sdk.decodeListedMargin(await raw(trader));
  const [btc,eth]=await Promise.all([setup.marketState(0),setup.marketState(1)]);
  const sol=sdk.getListedFundingDecoder().decode(await raw(published.funding)).values;
  // Independently price the two longs at the lower bound and the ETH short at
  // the upper bound. Each market rounds initial margin up to the next atom.
  const scale=1_000_000_000n, lots=[1n,-10n,10n], costs=[-60_002n,299_980n,-1520n];
  assert.deepEqual([...before.root.positions,...before.records].map(p=>[p.lots,p.virtualScaled,p.fundingCheckpointScaled]),
    lots.map((size,i)=>[size,costs[i]*scale,0n]));
  let minimum=0n;
  for(const [i,market] of [btc,eth,sol].entries()) {
    assert.deepEqual([market.fundingIndexScaled,market.oracle.premiumScaled,market.oracle.fundingBase],[0n,0n,0n]);
    const size=lots[i], magnitude=size<0n?-size:size;
    const claim=costs[i]+size*(size<0n?market.upper:market.lower);
    minimum+=(magnitude*market.upper+9n)/10n+(claim<0n?-claim:0n);
  }
  const [start,childStart,vaultStart,walletStart]=await balances(), maximum=start-minimum;
  assert.equal(childStart,0n);assert(maximum>0n && minimum>0n);
  async function movement(from:Address,amount:bigint,to?:Address) {
    const ix=to?sdk.getTransferFundedAccountInstruction({...identity,donor:from,recipient:to,guard:await guard(from),amount}):
      sdk.getWithdrawFundedAccountInstruction({...identity,margin:from,userToken:wallet,quoteMint:setup.mint.address,guard:await guard(from),amount});
    assert(ix.accounts.every(meta=>!setup.ledgers.includes(meta.address)),'legacy fee ledgers in wider cash movement');
    const dynamic=await sdk.listedCashSourceAccounts(venue,await Promise.all((to?[from,to]:[from]).map(raw)));
    assert.deepEqual(dynamic.map(meta=>meta.address),[listing,published.funding]);
    return {...ix,accounts:[...ix.accounts,...dynamic]};
  }
  async function reject(label:string,ix:Instruction,error:number) {
    const bank=await snapshot();
    await h.send(label,await withCheckpoints(ix),[owner],error);
    assert.deepEqual(await snapshot(),bank,label);
  }
  async function accept(label:string,ix:Instruction) {
    await h.send(label,await withCheckpoints(ix),[owner]);
    signed.push([label,ix]);
  }
  const base=await movement(trader,1n);
  await reject('listed cash refuses missing SOL source',{...base,accounts:base.accounts.slice(0,-2)},sdk.CLEARING_ERROR__ORACLE_SOURCE);
  await reject('listed cash refuses substituted listing',{...base,accounts:base.accounts.map(meta=>
    meta.address===listing?{...meta,address:foreignListing}:meta)},sdk.CLEARING_ERROR__ORACLE_SOURCE);
  await refresh();
  await reject('listed cash refuses excess withdrawal',await movement(trader,maximum+1n),sdk.CLEARING_ERROR__ARITHMETIC);
  await reject('listed cash refuses excess transfer',await movement(trader,maximum+1n,recipient),sdk.CLEARING_ERROR__ARITHMETIC);
  await refresh();
  await accept('listed cash transfers maximum to sibling',await movement(trader,maximum,recipient));
  assert.deepEqual(await balances(),[minimum,maximum,vaultStart,walletStart]);
  // Only the recipient has SOL open on this return trip. Its funding must be supplied.
  await accept('listed cash transfers back to cross account',await movement(recipient,maximum,trader));
  assert.deepEqual(await balances(),[start,0n,vaultStart,walletStart]);
  await refresh();
  await accept('listed cash withdraws maximum to wallet',await movement(trader,maximum));
  assert.deepEqual(await balances(),[minimum,0n,vaultStart-maximum,walletStart+maximum]);
  await reject('listed cash refuses one more atom',await movement(trader,1n),sdk.CLEARING_ERROR__ARITHMETIC);
  const after=sdk.decodeListedMargin(await raw(trader));
  assert.deepEqual(after.records,before.records);assert.deepEqual(after.inlineEntries,before.inlineEntries);
  return {signed,minimum,maximum,recipient};
}
