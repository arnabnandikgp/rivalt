import {AccountRole,type AccountMeta,type Instruction,type InstructionWithAccounts,type InstructionWithData,type ReadonlyUint8Array} from '@solana/kit';
import * as protocol from './generated/index.js';
import {hex,requireValue} from './wallet-client.js';

type ParsedInput=Instruction&InstructionWithAccounts<readonly AccountMeta[]>&InstructionWithData<ReadonlyUint8Array>;
/** The only two-action wallet envelope: activation of one empty root followed
 * by a positive deposit into that same root. No arbitrary instruction batching. */
export function validateActivationDeposit(instructions:Instruction[]) {
  requireValue(instructions.length===2&&instructions.every(instruction=>instruction.programAddress===protocol.CLEARING_PROGRAM_ADDRESS
    &&instruction.data&&instruction.accounts),'Unsupported activation/deposit envelope.');
  const [activate,deposit]=instructions as [ParsedInput,ParsedInput];
  requireValue(hex(activate.data.slice(0,8))===hex(protocol.ACTIVATE_MARGIN_DISCRIMINATOR)
    &&hex(deposit.data.slice(0,8))===hex(protocol.DEPOSIT_ACCOUNT_DISCRIMINATOR),'Expected activation then deposit.');
  const [,activationEnd]=protocol.getActivateMarginInstructionDataDecoder().read(activate.data,0);
  const [depositData,depositEnd]=protocol.getDepositAccountInstructionDataDecoder().read(deposit.data,0);
  requireValue(activationEnd===activate.data.length&&depositEnd===deposit.data.length&&depositData.amount>0n,'Invalid activation/deposit data.');
  const first=protocol.parseActivateMarginInstruction(activate),second=protocol.parseDepositAccountInstruction(deposit);
  const fixed=Object.keys(first.accounts).length;
  requireValue(activate.accounts.length===fixed+15&&deposit.accounts.length===Object.keys(second.accounts).length,'Unexpected activation/deposit dependencies.');
  for(const field of ['owner','venue','safety','margin','eventAuthority','program'] as const)
    requireValue(first.accounts[field]?.address===second.accounts[field]?.address,'Activation/deposit identity mismatch.');
  const nodes=activate.accounts.slice(fixed);
  requireValue(new Set(nodes.map(node=>node.address)).size===15&&nodes.every(node=>node.role===AccountRole.WRITABLE
    &&!activate.accounts.slice(0,fixed).some(meta=>meta.address===node.address)),'Invalid activation index path.');
  return {owner:first.accounts.owner.address,venue:first.accounts.venue.address,margin:first.accounts.margin.address};
}
