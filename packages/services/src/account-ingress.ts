import {AccountRole,address,type AccountMeta,type Decoder,type Instruction,type InstructionWithAccounts,type InstructionWithData,type ReadonlyUint8Array} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {signedWire} from './queue.js';
import type {AccountAuthority} from './account-authority.js';

type ParsedInput=Instruction&InstructionWithAccounts<readonly AccountMeta[]>&InstructionWithData<ReadonlyUint8Array>;
type Parser=(instruction:ParsedInput)=>{accounts:Record<string,AccountMeta|undefined>;data:unknown};
const action=(discriminator:ReadonlyUint8Array,parse:Parser,decoder:Decoder<unknown>,wallet:'owner'|'actor',root?:'trader'|'margin'|'donor')=>
  ({discriminator,parse,decoder,wallet,root});
const actions=[
  action(sdk.EXECUTE_ACCOUNT_ROUTE_V3_DISCRIMINATOR,sdk.parseExecuteAccountRouteV3Instruction,sdk.getExecuteAccountRouteV3InstructionDataDecoder(),'actor','trader'),
  action(sdk.WITHDRAW_FUNDED_ACCOUNT_V3_DISCRIMINATOR,sdk.parseWithdrawFundedAccountV3Instruction,sdk.getWithdrawFundedAccountV3InstructionDataDecoder(),'owner','margin'),
  action(sdk.TRANSFER_FUNDED_ACCOUNT_V3_DISCRIMINATOR,sdk.parseTransferFundedAccountV3Instruction,sdk.getTransferFundedAccountV3InstructionDataDecoder(),'owner','donor'),
  action(sdk.MANAGE_ACCOUNT_ORDER_V3_DISCRIMINATOR,sdk.parseManageAccountOrderV3Instruction,sdk.getManageAccountOrderV3InstructionDataDecoder(),'actor','margin'),
  action(sdk.SET_ACCOUNT_DELEGATE_V3_DISCRIMINATOR,sdk.parseSetAccountDelegateV3Instruction,sdk.getSetAccountDelegateV3InstructionDataDecoder(),'owner','margin'),
  action(sdk.NET_ACCOUNT_CLAIMS_V3_DISCRIMINATOR,sdk.parseNetAccountClaimsV3Instruction,sdk.getNetAccountClaimsV3InstructionDataDecoder(),'owner','margin'),
  action(sdk.CREATE_PORTFOLIO_V3_DISCRIMINATOR,sdk.parseCreatePortfolioV3Instruction,sdk.getCreatePortfolioV3InstructionDataDecoder(),'owner'),
  action(sdk.REGISTER_MARGIN_V3_DISCRIMINATOR,sdk.parseRegisterMarginV3Instruction,sdk.getRegisterMarginV3InstructionDataDecoder(),'owner'),
  action(sdk.DEPOSIT_ACCOUNT_V3_DISCRIMINATOR,sdk.parseDepositAccountV3Instruction,sdk.getDepositAccountV3InstructionDataDecoder(),'owner'),
  action(sdk.WITHDRAW_ACCOUNT_CUSTODY_V3_DISCRIMINATOR,sdk.parseWithdrawAccountCustodyV3Instruction,sdk.getWithdrawAccountCustodyV3InstructionDataDecoder(),'owner'),
  action(sdk.TRANSFER_ACCOUNT_CUSTODY_V3_DISCRIMINATOR,sdk.parseTransferAccountCustodyV3Instruction,sdk.getTransferAccountCustodyV3InstructionDataDecoder(),'owner'),
];

/** Opaque signed wallet bytes, one qualified financial action, explicit zero
 * priority fee. Generated schema parsers bind account roles; no V2 index reuse. */
export function accountUserAuthority(wire:string,venue:string):AccountAuthority|null {
  const {tx,keys}=signedWire(wire);if(tx.signatures.length!==1)throw new Error('Expected one account wallet signer');
  let economic:ParsedInput|undefined,limit:Buffer|undefined,price=false;
  for(const instruction of tx.message.compiledInstructions) {
    const data=Buffer.from(instruction.data);
    if(keys[instruction.programIdIndex]==='ComputeBudget111111111111111111111111111111') {
      if(economic||instruction.accountKeyIndexes.length)throw new Error('Misplaced account compute budget');
      if(data.equals(Buffer.from(sdk.zeroPriorityFee().data!))) {if(price)throw new Error('Duplicate account priority price');price=true;}
      else {
        if(limit||![sdk.routeComputeBudget(),sdk.groupRouteComputeBudget()].some(budget=>data.equals(Buffer.from(budget.data!))))throw new Error('Unsupported account compute budget');
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
  if(!economic||!limit||!price)throw new Error('Missing explicit account action/budget/zero price');
  const entry=actions.find(entry=>sdk.hex(entry.discriminator)===sdk.hex(economic!.data.slice(0,8)));
  if(!entry)throw new Error('Unsupported account wallet action');
  const required=entry.root==='trader'?sdk.groupRouteComputeBudget():sdk.routeComputeBudget();
  if(!limit.equals(Buffer.from(required.data!)))throw new Error('Incorrect account action budget');
  const [,end]=entry.decoder.read(economic.data,0);if(end!==economic.data.length)throw new Error('Trailing account instruction bytes');
  const parsed=entry.parse(economic);
  if(Object.keys(parsed.accounts).length!==economic.accounts.length)throw new Error('Unexpected account instruction dependencies');
  if(parsed.accounts.venue?.address!==venue||parsed.accounts[entry.wallet]?.address!==keys[0])throw new Error('Wallet/venue binding mismatch');
  if(!entry.root)return null; // No signed pre-state stamp: missing history cannot license a replacement.
  const guard=(parsed.data as {guard:sdk.AccountGuardV3}).guard,root=parsed.accounts[entry.root];
  if(!guard||!root)throw new Error('Missing account intent guard');
  return {kind:'accountStateVersion',venue,account:root.address,value:guard.stateVersion.toString()};
}
