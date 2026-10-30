import {AccountRole,address,type AccountMeta,type Decoder,type Instruction,type InstructionWithAccounts,type InstructionWithData,type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {signedWire} from './queue.js';
import type {AccountAuthority} from './account-authority.js';

type ParsedInput=Instruction&InstructionWithAccounts<readonly AccountMeta[]>&InstructionWithData<ReadonlyUint8Array>;
type Parser=(instruction:ParsedInput)=>{accounts:Record<string,AccountMeta|undefined>;data:unknown};
const action=(discriminator:ReadonlyUint8Array,parse:Parser,decoder:Decoder<unknown>,wallet:'owner'|'actor',root?:'trader'|'margin'|'donor')=>
  ({discriminator,parse,decoder,wallet,root});
const actions=[
  action(sdk.EXECUTE_LIQUIDITY_ROUTE_DISCRIMINATOR,sdk.parseExecuteLiquidityRouteInstruction,sdk.getExecuteLiquidityRouteInstructionDataDecoder(),'actor','trader'),
  action(sdk.WITHDRAW_FUNDED_ACCOUNT_DISCRIMINATOR,sdk.parseWithdrawFundedAccountInstruction,sdk.getWithdrawFundedAccountInstructionDataDecoder(),'owner','margin'),
  action(sdk.TRANSFER_FUNDED_ACCOUNT_DISCRIMINATOR,sdk.parseTransferFundedAccountInstruction,sdk.getTransferFundedAccountInstructionDataDecoder(),'owner','donor'),
  action(sdk.MANAGE_ACCOUNT_ORDER_DISCRIMINATOR,sdk.parseManageAccountOrderInstruction,sdk.getManageAccountOrderInstructionDataDecoder(),'actor','margin'),
  action(sdk.SET_ACCOUNT_DELEGATE_DISCRIMINATOR,sdk.parseSetAccountDelegateInstruction,sdk.getSetAccountDelegateInstructionDataDecoder(),'owner','margin'),
  action(sdk.NET_ACCOUNT_CLAIMS_DISCRIMINATOR,sdk.parseNetAccountClaimsInstruction,sdk.getNetAccountClaimsInstructionDataDecoder(),'owner','margin'),
  action(sdk.CREATE_PORTFOLIO_DISCRIMINATOR,sdk.parseCreatePortfolioInstruction,sdk.getCreatePortfolioInstructionDataDecoder(),'owner'),
  action(sdk.REGISTER_MARGIN_DISCRIMINATOR,sdk.parseRegisterMarginInstruction,sdk.getRegisterMarginInstructionDataDecoder(),'owner'),
  action(sdk.DEPOSIT_ACCOUNT_DISCRIMINATOR,sdk.parseDepositAccountInstruction,sdk.getDepositAccountInstructionDataDecoder(),'owner'),
  action(sdk.WITHDRAW_ACCOUNT_CUSTODY_DISCRIMINATOR,sdk.parseWithdrawAccountCustodyInstruction,sdk.getWithdrawAccountCustodyInstructionDataDecoder(),'owner'),
  action(sdk.TRANSFER_ACCOUNT_CUSTODY_DISCRIMINATOR,sdk.parseTransferAccountCustodyInstruction,sdk.getTransferAccountCustodyInstructionDataDecoder(),'owner'),
];

/** Opaque signed wallet bytes, one qualified financial action, explicit zero
 * priority fee. Generated schema parsers bind account roles; no V2 index reuse. */
export function accountUserAuthority(wire:string,venue:string,profile:4=4):AccountAuthority|null {
  if(profile!==4)throw new Error('Unsupported account service profile');
  const {tx,keys}=signedWire(wire,1);if(tx.signatures.length!==1)throw new Error('Expected one account wallet signer');
  let economic:ParsedInput|undefined,limit:Buffer|undefined,price=false,loaded=false;
  const canonicalLimit=Buffer.alloc(5);canonicalLimit[0]=2;canonicalLimit.writeUInt32LE(800_000,1);
  const loadedLimit=Buffer.alloc(5);loadedLimit[0]=4;loadedLimit.writeUInt32LE(8*1024*1024,1);
  for(const instruction of tx.message.compiledInstructions) {
    const data=Buffer.from(instruction.data);
    if(keys[instruction.programIdIndex]==='ComputeBudget111111111111111111111111111111') {
      if(tx.message.version===1||economic||instruction.accountKeyIndexes.length)throw new Error('Misplaced account compute budget');
      if(data.equals(Buffer.from(sdk.zeroPriorityFee().data!))) {if(price)throw new Error('Duplicate account priority price');price=true;}
      else if(data.equals(loadedLimit)){if(loaded)throw new Error('Duplicate loaded account budget');loaded=true;}
      else {
        const allowed=[Buffer.from(sdk.routeComputeBudget().data!),canonicalLimit];
        if(limit||!allowed.some(budget=>data.equals(budget)))throw new Error('Unsupported account compute budget');
        limit=data;
      }
    }else {
      if(economic||keys[instruction.programIdIndex]!==sdk.CLEARING_PROGRAM_ADDRESS)throw new Error('Unsupported account transaction');
      const {numRequiredSignatures,numReadonlySignedAccounts,numReadonlyUnsignedAccounts}=tx.message.header;
      economic={programAddress:sdk.CLEARING_PROGRAM_ADDRESS,data,accounts:instruction.accountKeyIndexes.map(index=>{
        const signer=index<numRequiredSignatures,writable=signer?index<numRequiredSignatures-numReadonlySignedAccounts:index<keys.length-numReadonlyUnsignedAccounts;
        return {address:address(keys[index]),role:signer?(writable?AccountRole.WRITABLE_SIGNER:AccountRole.READONLY_SIGNER):(writable?AccountRole.WRITABLE:AccountRole.READONLY)};
      })};
    }
  }
  if(!economic||tx.message.version===0&&(!limit||!price||!loaded))throw new Error('Missing explicit account action/budget/zero price');
  const entry=actions.find(entry=>sdk.hex(entry.discriminator)===sdk.hex(economic!.data.slice(0,8)));
  if(!entry)throw new Error('Unsupported account wallet action');
  const canonicalRoute=sdk.hex(entry.discriminator)===sdk.hex(sdk.EXECUTE_LIQUIDITY_ROUTE_DISCRIMINATOR);
  if(entry.root==='trader'&&!canonicalRoute)throw new Error('Foreign account route profile');
  const units=entry.root==='trader'?800_000:400_000;
  if(tx.message.version===1) {
    const config=tx.message.transactionConfig;
    if(!config||Object.keys(config).some(key=>!['computeUnitLimit','loadedAccountsDataSizeLimit','priorityFeeLamports'].includes(key))
      ||config.computeUnitLimit!==units||config.loadedAccountsDataSizeLimit!==8*1024*1024||config.priorityFeeLamports!==0n)
      throw new Error('Incorrect canonical header budget/priority fee');
  } else if(!limit||limit.readUInt32LE(1)!==units)throw new Error('Incorrect account action budget');
  const [,end]=entry.decoder.read(economic.data,0);if(end!==economic.data.length)throw new Error('Trailing account instruction bytes');
  const parsed=entry.parse(economic);
  if(Object.keys(parsed.accounts).length!==economic.accounts.length)throw new Error('Unexpected account instruction dependencies');
  if(parsed.accounts.venue?.address!==venue||parsed.accounts[entry.wallet]?.address!==keys[0])throw new Error('Wallet/venue binding mismatch');
  if(!entry.root)return null; // No signed pre-state stamp: missing history cannot license a replacement.
  const guard=(parsed.data as {guard:sdk.AccountGuard}).guard,root=parsed.accounts[entry.root];
  if(!guard||!root)throw new Error('Missing account intent guard');
  return {kind:'accountStateVersion',venue,account:root.address,value:guard.stateVersion.toString()};
}
