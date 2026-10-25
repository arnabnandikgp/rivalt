import {expect,it} from 'vitest';
import {Keypair} from '@solana/web3.js';
import {address, blockhash, type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {groupUserAuthority} from './group-ingress.js';

const payer=await Keypair.generate(), other=await Keypair.generate();
const [group]=await sdk.findGroupPda({domain:new Uint8Array(32).fill(7)});
const [btc]=await sdk.findGroupMarketPda(group,0),[eth]=await sdk.findGroupMarketPda(group,1);
const [portfolio]=await sdk.findPortfolioPda({group,owner:payer.address,index:0});
const [margin]=await sdk.findMarginPda({portfolio,subaccountIndex:0});
const [donor]=await sdk.findMarginPda({portfolio,subaccountIndex:1});
const placeholder=address('11111111111111111111111111111111');
const common={group,btc,eth,guard:placeholder,vault:placeholder,eventAuthority:placeholder,program:sdk.CLEARING_PROGRAM_ADDRESS};
const deposit=()=>sdk.getGroupTradingCashV2Instruction({...common,owner:payer,margin,quoteMint:placeholder,userToken:placeholder,amount:1n,withdraw:false,sequence:12n,observations:[1n,2n]});
const transfer=()=>sdk.getTransferTradingCashV2Instruction({...common,owner:payer,donor,recipient:margin,amount:1n,sequence:12n,observations:[1n,2n]});
const route=(sequence=13n)=>sdk.getExecuteMarginRouteV2Instruction({...common,actor:payer,market:btc,otherMarket:eth,trader:margin,
  firstCapital:placeholder,firstRegistration:placeholder,firstProgram:sdk.makerA.MAKER_A_PROGRAM_ADDRESS,firstProgramData:placeholder,firstConfig:placeholder,
  sequence,observations:[1n,2n],intent:{domain:new Uint8Array(32).fill(7),termsEpoch:1n,configEpoch:1n,observationSequence:1n,nonce:4n,startSlot:1n,expirySlot:10n,
    side:0,lots:1n,allInLimit:60001n,maxFee:13n,reduceOnly:false,generation:1n,legs:[{lots:1n,quoteEpoch:1n,authorityEpoch:1n}]}});
const connection={async getLatestBlockhash(){return {blockhash:blockhash(placeholder),lastValidBlockHeight:100n};}} satisfies Parameters<typeof sdk.signInstructions>[0];
async function wire(instructions: Instruction[]) {
  const {transaction}=await sdk.signInstructions(connection,payer,instructions);
  return Buffer.from(transaction.serialize()).toString('base64');
}
it('binds a signed wallet cash action to its group sequence and fee payer',async()=>{
  const bytes=await wire([sdk.routeComputeBudget(),sdk.zeroPriorityFee(),deposit()]);
  expect(groupUserAuthority(bytes,group)).toEqual({kind:'groupSequence',group,account:group,value:'12'});
  expect(()=>groupUserAuthority(bytes,other.address)).toThrow(/binding/);
  expect(()=>groupUserAuthority(bytes,group,sdk.makerA.MAKER_A_PROGRAM_ADDRESS)).toThrow(/Unsupported/);
});
it('uses account nonce for a single route and the original group stamp for atomic transfer/open',async()=>{
  expect(groupUserAuthority(await wire([sdk.groupRouteComputeBudget(),route()]),group)).toEqual({kind:'marginNonce',group,account:margin,value:'4'});
  expect(groupUserAuthority(await wire([sdk.groupTransferRouteComputeBudget(),transfer(),route()]),group)).toEqual({kind:'groupSequence',group,account:group,value:'12'});
  expect(()=>groupUserAuthority('',group)).toThrow();
});
it('rejects an underbudgeted combined path and an inconsistent atomic sequence',async()=>{
  const under=await wire([sdk.groupRouteComputeBudget(),transfer(),route()]);
  expect(()=>groupUserAuthority(under,group)).toThrow(/budget/);
  const sequence=await wire([sdk.groupTransferRouteComputeBudget(),transfer(),route(12n)]);
  expect(()=>groupUserAuthority(sequence,group)).toThrow(/sequence/);
  const duplicate=await wire([sdk.groupTransferRouteComputeBudget(),deposit(),deposit()]);
  expect(()=>groupUserAuthority(duplicate,group)).toThrow(/combined/);
});
it('rejects duplicate, late and nonzero compute prices before enqueue',async()=>{
  const duplicate=await wire([sdk.routeComputeBudget(),sdk.routeComputeBudget(),deposit()]);
  expect(()=>groupUserAuthority(duplicate,group)).toThrow(/budget/);
  const late=await wire([sdk.routeComputeBudget(),deposit(),sdk.zeroPriorityFee()]);
  expect(()=>groupUserAuthority(late,group)).toThrow(/Misplaced/);
  const price=sdk.zeroPriorityFee();const bytes=Buffer.from(price.data!);bytes.writeBigUInt64LE(1n,1);
  const nonzero=await wire([sdk.routeComputeBudget(),{...price,data:bytes},deposit()]);
  expect(()=>groupUserAuthority(nonzero,group)).toThrow(/budget/);
});
it('rejects trailing payloads and leaves durable authority changes without invented retry proof',async()=>{
  const instruction=deposit(), extended=await wire([sdk.routeComputeBudget(),{...instruction,data:Buffer.concat([Buffer.from(instruction.data),Buffer.from([0])])}]);
  expect(()=>groupUserAuthority(extended,group)).toThrow(/Trailing/);
  const delegate=sdk.getSetMarginDelegateV2Instruction({...common,owner:payer,margin,delegate:other.address,expirySlot:100n});
  expect(groupUserAuthority(await wire([sdk.routeComputeBudget(),delegate]),group)).toBeNull();
});
