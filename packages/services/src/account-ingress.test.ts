import {expect,it} from 'vitest';
import {Keypair,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {address,blockhash,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {accountUserAuthority} from './account-ingress.js';

const payer=await Keypair.generate(),other=await Keypair.generate();
const [venue]=await sdk.deriveAccountVenue(new Uint8Array(32).fill(37));
const [portfolio]=await sdk.deriveAccountPortfolio(venue,payer.address,0);
const [margin]=await sdk.deriveMarginAccount(portfolio,0),[donor]=await sdk.deriveMarginAccount(portfolio,1);
const [[custody],[safety],[vault],[btc],[eth]]=await Promise.all([sdk.deriveVenueComponent(venue,'custody'),sdk.deriveVenueComponent(venue,'safety'),
  sdk.deriveVenueComponent(venue,'vault'),sdk.deriveAccountMarket(venue,0),sdk.deriveAccountMarket(venue,1)]);
const [[btcLedger],[ethLedger]]=await Promise.all([sdk.deriveMarketLedger(btc),sdk.deriveMarketLedger(eth)]);
const placeholder=address('11111111111111111111111111111111');
const guard={safetyEpoch:2n,venueTermsEpoch:3n,nonce:7n,stateVersion:11n};
const common={venue,custody,safety,vault,btc,eth,btcLedger,ethLedger,eventAuthority:placeholder,program:sdk.CLEARING_PROGRAM_ADDRESS};
const withdrawal=()=>sdk.getWithdrawFundedAccountInstruction({...common,owner:payer,margin,quoteMint:placeholder,userToken:placeholder,guard,amount:1n});
const transfer=()=>sdk.getTransferFundedAccountInstruction({...common,owner:payer,donor,recipient:margin,guard,amount:1n});
const route=()=>sdk.getExecuteLiquidityRouteInstruction({...common,actor:payer,market:btc,otherMarket:eth,ledger:btcLedger,otherLedger:ethLedger,trader:margin,
  firstCapital:placeholder,firstRegistration:placeholder,firstProgram:sdk.makerA.MAKER_A_PROGRAM_ADDRESS,firstProgramData:placeholder,firstConfig:placeholder,firstPrice:placeholder,registry:placeholder,
  guard,domain:new Uint8Array(32).fill(37),termsEpoch:1n,configEpoch:1n,startSlot:1n,expirySlot:100n,side:0,lots:1n,allInLimit:60013n,maxFee:13n,
  reduceOnly:false,generation:0n,legs:[{lots:1n,authorityEpoch:1n,controlEpoch:1n,shapeEpoch:1n,depthEpoch:1n}]});
const connection={async getLatestBlockhash(){return {blockhash:blockhash(placeholder),lastValidBlockHeight:100n};}} satisfies Parameters<typeof sdk.signInstructions>[0];
async function wire(instructions:Instruction[]){const {transaction}=await sdk.signInstructions(connection,payer,instructions);return Buffer.from(transaction.serialize()).toString('base64');}
const envelope=(instruction:Instruction)=>sdk.accountWalletInstructions([instruction]);
it('decodes account-local signed authority despite different generated account ordering',async()=>{
  expect(accountUserAuthority(await wire(envelope(withdrawal())),venue)).toEqual({kind:'accountStateVersion',venue,account:margin,value:'11'});
  expect(accountUserAuthority(await wire(envelope(transfer())),venue)).toEqual({kind:'accountStateVersion',venue,account:donor,value:'11'});
  expect(accountUserAuthority(await wire(envelope(route())),venue)).toEqual({kind:'accountStateVersion',venue,account:margin,value:'11'});
});
it('binds signed order/delegate changes to root state, and deposits have no invented retry proof',async()=>{
  const delegate=sdk.getSetAccountDelegateInstruction({...common,owner:payer,margin,guard,delegate:other.address,expirySlot:100n});
  expect(accountUserAuthority(await wire(envelope(delegate)),venue)).toMatchObject({account:margin,value:'11'});
  const cancel=sdk.getManageAccountOrderInstruction({...common,actor:payer,margin,guard,marketIndex:0,operation:sdk.orderAction('Cancel',{id:1n,version:2n,protectionGroup:false})});
  expect(accountUserAuthority(await wire(envelope(cancel)),venue)).toMatchObject({account:margin,value:'11'});
  const deposit=await sdk.getDepositAccountInstructionAsync({...common,owner:payer,margin,quoteMint:placeholder,userToken:placeholder,amount:1n});
  expect(accountUserAuthority(await wire(envelope(deposit)),venue)).toBeNull();
});
it('rejects foreign venue, wrong wallet actor, unknown action and account trailers',async()=>{
  const signed=await wire(envelope(withdrawal()));expect(()=>accountUserAuthority(signed,other.address)).toThrow(/binding/);
  const original=withdrawal(),wrongOwner:Instruction={...original,accounts:original.accounts.map((account,index)=>index===8?{address:other.address,role:0}:account)};
  const wrongWallet=await wire(envelope(wrongOwner));expect(()=>accountUserAuthority(wrongWallet,venue)).toThrow(/binding/);
  const instruction=withdrawal(),trailer={...instruction,accounts:[...instruction.accounts,{address:other.address,role:0 as const}]};
  expect(()=>accountUserAuthority('',venue)).toThrow();
  expect(()=>accountUserAuthority(signed,placeholder)).toThrow(/binding/);
  const trailing=await wire(envelope(trailer));expect(()=>accountUserAuthority(trailing,venue)).toThrow(/dependencies/);
  const unknown=await wire([...envelope(instruction).slice(0,3),{...instruction,data:sdk.FREEZE_ACCOUNTS_DISCRIMINATOR}]);
  expect(()=>accountUserAuthority(unknown,venue)).toThrow(/Unsupported/);
});
it('rejects trailing payloads and combined envelopes outside the measured SDK contract',async()=>{
  const instruction=withdrawal(),extended={...instruction,data:Buffer.concat([Buffer.from(instruction.data),Buffer.from([0])])};
  const signed=await wire(envelope(extended));expect(()=>accountUserAuthority(signed,venue)).toThrow(/Trailing/);
  const combined=await wire([sdk.liquidationComputeBudget(),sdk.zeroPriorityFee(),transfer(),route()]);
  expect(()=>accountUserAuthority(combined,venue)).toThrow(/Unsupported/);
});
it('requires exact measured compute limit, loaded-data limit and zero price before the action',async()=>{
  const valid=envelope(withdrawal()),budget=valid.slice(0,3);
  const wrong=await wire([...budget,route()]);expect(()=>accountUserAuthority(wrong,venue)).toThrow(/budget/);
  const missing=await wire([budget[0],budget[1],withdrawal()]);expect(()=>accountUserAuthority(missing,venue)).toThrow(/zero price/);
  const noLoaded=await wire([budget[0],budget[2],withdrawal()]);expect(()=>accountUserAuthority(noLoaded,venue)).toThrow(/budget/);
  const late=await wire([budget[0],budget[1],withdrawal(),budget[2]]);expect(()=>accountUserAuthority(late,venue)).toThrow(/Misplaced/);
  const duplicate=await wire([...budget,budget[2],withdrawal()]);expect(()=>accountUserAuthority(duplicate,venue)).toThrow(/Duplicate/);
  const paidPrice=Buffer.from(budget[2].data!);paidPrice.writeBigUInt64LE(1n,1);
  const paid=await wire([budget[0],budget[1],{...budget[2],data:paidPrice},withdrawal()]);expect(()=>accountUserAuthority(paid,venue)).toThrow(/budget/);
  expect(sdk.accountWalletInstructions(valid)).toEqual(valid);
  expect(()=>sdk.accountWalletInstructions([budget[0],budget[1],{...budget[2],data:paidPrice},withdrawal()])).toThrow(/Unsupported/);
});

it('accepts canonical v0 cash envelopes and rejects cross-profile or foreign programs',async()=>{
  const {transaction}=await sdk.signCanonicalInstructions(connection,payer,[withdrawal()],{computeUnitLimit:400_000,loadedAccountsDataSizeLimit:8*1024*1024});
  const signed=Buffer.from(transaction.serialize()).toString('base64');
  expect(accountUserAuthority(signed,venue)).toMatchObject({account:margin,value:'11'});
  expect(()=>accountUserAuthority(signed,venue,3 as 4)).toThrow(/profile/);
  const foreign=await wire([...envelope(withdrawal()).slice(0,3),{...withdrawal(),programAddress:sdk.makerA.MAKER_A_PROGRAM_ADDRESS}]);
  expect(()=>accountUserAuthority(foreign,venue)).toThrow(/Unsupported/);
});

it('validates v1 header budgets, zero priority fee and the canonical action profile',async()=>{
  const encode=async(instruction:Instruction,units=800_000,priority=0n,loaded=8*1024*1024)=>{
    const transaction=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:blockhash(placeholder),instructions:[instruction]})
      .compileToV1Message({computeUnitLimit:units,loadedAccountsDataSizeLimit:loaded,priorityFeeLamports:priority}));
    await transaction.sign([payer]);return Buffer.from(transaction.serialize()).toString('base64');
  };
  const signed=await encode(route());
  expect(accountUserAuthority(signed,venue)).toMatchObject({account:margin,value:'11'});
  for(const bad of [await encode(route(),400_000),await encode(route(),800_000,1n),await encode(route(),800_000,0n,1024)])
    expect(()=>accountUserAuthority(bad,venue)).toThrow(/header/);
  expect(()=>accountUserAuthority(signed,venue,3 as 4)).toThrow(/profile/);
  expect(()=>accountUserAuthority('',venue)).toThrow();
  // Frozen pre-retirement discriminator, derived independently of generated APIs.
  const retired={...route(),data:Buffer.from((await import('node:crypto')).createHash('sha256').update('global:execute_account_route_v3').digest().subarray(0,8))};
  const retiredSigned=await encode(retired);expect(()=>accountUserAuthority(retiredSigned,venue)).toThrow(/Unsupported/);
});
