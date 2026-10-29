import {expect,it} from 'vitest';
import {Keypair,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {address,blockhash,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {accountUserAuthority} from './account-ingress.js';

const payer=await Keypair.generate(),other=await Keypair.generate();
const [venue]=await sdk.deriveAccountVenue(new Uint8Array(32).fill(37));
const [portfolio]=await sdk.deriveAccountPortfolio(venue,payer.address,0);
const [margin]=await sdk.findMarginV3Pda(portfolio,0),[donor]=await sdk.findMarginV3Pda(portfolio,1);
const [[custody],[safety],[vault],[btc],[eth]]=await Promise.all([sdk.findVenueComponentV3Pda(venue,'custody'),sdk.findVenueComponentV3Pda(venue,'safety'),
  sdk.findVenueComponentV3Pda(venue,'vault'),sdk.findMarketV3Pda(venue,0),sdk.findMarketV3Pda(venue,1)]);
const [[btcLedger],[ethLedger]]=await Promise.all([sdk.findLedgerV3Pda(btc),sdk.findLedgerV3Pda(eth)]);
const placeholder=address('11111111111111111111111111111111');
const guard={safetyEpoch:2n,venueTermsEpoch:3n,nonce:7n,stateVersion:11n};
const common={venue,custody,safety,vault,btc,eth,btcLedger,ethLedger,eventAuthority:placeholder,program:sdk.CLEARING_PROGRAM_ADDRESS};
const withdrawal=()=>sdk.getWithdrawFundedAccountV3Instruction({...common,owner:payer,margin,quoteMint:placeholder,userToken:placeholder,guard,amount:1n});
const transfer=()=>sdk.getTransferFundedAccountV3Instruction({...common,owner:payer,donor,recipient:margin,guard,amount:1n});
const route=()=>sdk.getExecuteAccountRouteV3Instruction({...common,actor:payer,market:btc,otherMarket:eth,ledger:btcLedger,otherLedger:ethLedger,trader:margin,
  firstCapital:placeholder,firstRegistration:placeholder,firstProgram:sdk.makerA.MAKER_A_PROGRAM_ADDRESS,firstProgramData:placeholder,firstConfig:placeholder,
  guard,domain:new Uint8Array(32).fill(37),termsEpoch:1n,configEpoch:1n,startSlot:1n,expirySlot:100n,side:0,lots:1n,allInLimit:60013n,maxFee:13n,
  reduceOnly:false,generation:0n,legs:[{lots:1n,quoteEpoch:1n,authorityEpoch:1n,expectedConsumed:0n}]});
const connection={async getLatestBlockhash(){return {blockhash:blockhash(placeholder),lastValidBlockHeight:100n};}} satisfies Parameters<typeof sdk.signInstructions>[0];
async function wire(instructions:Instruction[]){const {transaction}=await sdk.signInstructions(connection,payer,instructions);return Buffer.from(transaction.serialize()).toString('base64');}
const envelope=(instruction:Instruction)=>sdk.accountWalletInstructions([instruction]);
it('decodes account-local signed authority despite different generated account ordering',async()=>{
  expect(accountUserAuthority(await wire(envelope(withdrawal())),venue)).toEqual({kind:'accountStateVersion',venue,account:margin,value:'11'});
  expect(accountUserAuthority(await wire(envelope(transfer())),venue)).toEqual({kind:'accountStateVersion',venue,account:donor,value:'11'});
  expect(accountUserAuthority(await wire(envelope(route())),venue)).toEqual({kind:'accountStateVersion',venue,account:margin,value:'11'});
});
it('binds signed order/delegate changes to root state, and deposits have no invented retry proof',async()=>{
  const delegate=sdk.getSetAccountDelegateV3Instruction({...common,owner:payer,margin,guard,delegate:other.address,expirySlot:100n});
  expect(accountUserAuthority(await wire(envelope(delegate)),venue)).toMatchObject({account:margin,value:'11'});
  const cancel=sdk.getManageAccountOrderV3Instruction({...common,actor:payer,margin,guard,marketIndex:0,operation:sdk.groupOrderAction('Cancel',{id:1n,version:2n,protectionGroup:false})});
  expect(accountUserAuthority(await wire(envelope(cancel)),venue)).toMatchObject({account:margin,value:'11'});
  const deposit=await sdk.getDepositAccountV3InstructionAsync({...common,owner:payer,margin,quoteMint:placeholder,userToken:placeholder,amount:1n});
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
  const unknown=await wire([sdk.routeComputeBudget(),sdk.zeroPriorityFee(),{...instruction,data:sdk.FREEZE_ACCOUNTS_V3_DISCRIMINATOR}]);
  expect(()=>accountUserAuthority(unknown,venue)).toThrow(/Unsupported/);
});
it('rejects trailing payloads and combined envelopes outside the measured SDK contract',async()=>{
  const instruction=withdrawal(),extended={...instruction,data:Buffer.concat([Buffer.from(instruction.data),Buffer.from([0])])};
  const signed=await wire(envelope(extended));expect(()=>accountUserAuthority(signed,venue)).toThrow(/Trailing/);
  const combined=await wire([sdk.groupRouteComputeBudget(),sdk.zeroPriorityFee(),transfer(),route()]);
  expect(()=>accountUserAuthority(combined,venue)).toThrow(/Unsupported/);
});
it('requires exact measured compute limit and explicit zero price before the action',async()=>{
  const wrong=await wire([sdk.routeComputeBudget(),sdk.zeroPriorityFee(),route()]);expect(()=>accountUserAuthority(wrong,venue)).toThrow(/budget/);
  const missing=await wire([sdk.routeComputeBudget(),withdrawal()]);expect(()=>accountUserAuthority(missing,venue)).toThrow(/zero price/);
  const late=await wire([sdk.routeComputeBudget(),withdrawal(),sdk.zeroPriorityFee()]);expect(()=>accountUserAuthority(late,venue)).toThrow(/Misplaced/);
  const duplicate=await wire([sdk.routeComputeBudget(),sdk.zeroPriorityFee(),sdk.zeroPriorityFee(),withdrawal()]);expect(()=>accountUserAuthority(duplicate,venue)).toThrow(/Duplicate/);
  const price=Buffer.from(sdk.zeroPriorityFee().data!);price.writeBigUInt64LE(1n,1);
  const paid=await wire([sdk.routeComputeBudget(),{...sdk.zeroPriorityFee(),data:price},withdrawal()]);expect(()=>accountUserAuthority(paid,venue)).toThrow(/budget/);
});

it('accepts the canonical v0 cash envelope and rejects cross-profile or missing loaded limits',async()=>{
  const {transaction}=await sdk.signCanonicalInstructions(connection,payer,[withdrawal()],{computeUnitLimit:400_000,loadedAccountsDataSizeLimit:8*1024*1024});
  const signed=Buffer.from(transaction.serialize()).toString('base64');
  expect(accountUserAuthority(signed,venue,4)).toMatchObject({account:margin,value:'11'});
  expect(()=>accountUserAuthority(signed,venue)).toThrow(/budget/);
  const old=await wire(envelope(withdrawal()));expect(()=>accountUserAuthority(old,venue,4)).toThrow(/budget/);
});

it('validates v1 header budgets, zero priority fee and the canonical action profile',async()=>{
  const old=route(),parsed=sdk.parseExecuteAccountRouteV3Instruction(old);
  const canonical=sdk.getExecuteLiquidityRouteV4Instruction({...common,actor:payer,market:btc,otherMarket:eth,ledger:btcLedger,otherLedger:ethLedger,trader:margin,
    firstCapital:placeholder,firstRegistration:placeholder,firstProgram:sdk.makerA.MAKER_A_PROGRAM_ADDRESS,firstProgramData:placeholder,firstConfig:placeholder,
    firstPrice:placeholder,registry:placeholder,...parsed.data,
    legs:[{lots:1n,authorityEpoch:1n,controlEpoch:1n,shapeEpoch:1n,depthEpoch:1n}]});
  const encode=async(instruction:Instruction,units=800_000,priority=0n)=>{
    const transaction=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:blockhash(placeholder),instructions:[instruction]})
      .compileToV1Message({computeUnitLimit:units,loadedAccountsDataSizeLimit:8*1024*1024,priorityFeeLamports:priority}));
    await transaction.sign([payer]);return Buffer.from(transaction.serialize()).toString('base64');
  };
  const signed=await encode(canonical);
  expect(accountUserAuthority(signed,venue,4)).toMatchObject({account:margin,value:'11'});
  expect(()=>accountUserAuthority(signed,venue)).toThrow(/version/);
  for(const bad of [await encode(canonical,400_000),await encode(canonical,800_000,1n)])expect(()=>accountUserAuthority(bad,venue,4)).toThrow(/header/);
  expect(()=>accountUserAuthority('',venue,4)).toThrow();
  const oldSigned=await encode(old);expect(()=>accountUserAuthority(oldSigned,venue,4)).toThrow(/profile/);
});
