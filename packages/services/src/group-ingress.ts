import * as sdk from '@rivalt/sdk';
import type {Address, Decoder} from '@solana/kit';
import {signedWire} from './queue.js';
import type {GroupAuthority} from './group-authority.js';

/** Validate the submitted immutable wallet envelope. On-chain owner/delegate,
 * group/market, risk and sequence checks remain the financial authority. */
export function groupUserAuthority(wire: string, group: string, program: Address = sdk.CLEARING_PROGRAM_ADDRESS): GroupAuthority | null {
  const {tx,keys} = signedWire(wire);
  if (tx.signatures.length !== 1) throw new Error('Expected one wallet signer');
  const economic: {accounts:string[]; data:Uint8Array}[] = [];
  let limit: Buffer | undefined, price = false;
  for (const instruction of tx.message.compiledInstructions) {
    const bytes = Buffer.from(instruction.data);
    if (keys[instruction.programIdIndex] === 'ComputeBudget111111111111111111111111111111') {
      if (economic.length || instruction.accountKeyIndexes.length) throw new Error('Misplaced compute budget');
      if (bytes.equals(Buffer.from(sdk.zeroPriorityFee().data!))) {
        if (price) throw new Error('Duplicate priority price');
        price = true;
      } else {
        if (limit || ![sdk.routeComputeBudget(),sdk.groupRouteComputeBudget(),sdk.groupTransferRouteComputeBudget()].some(budget => bytes.equals(Buffer.from(budget.data!)))) throw new Error('Unsupported group compute budget');
        limit = bytes;
      }
    } else {
      if (keys[instruction.programIdIndex] !== program || economic.length >= 2) throw new Error('Unsupported group transaction');
      const accounts = instruction.accountKeyIndexes.map(index => keys[index]);
      if (accounts[0] !== keys[0] || accounts[1] !== group) throw new Error('Wallet/group binding');
      economic.push({accounts,data:instruction.data});
    }
  }
  if (!economic.length || !limit) throw new Error('Missing explicit group action/budget');
  const is = (index: number, discriminator: ArrayLike<number>) => Buffer.from(economic[index].data).subarray(0,8).equals(Buffer.from(discriminator));
  const exact = <T>(index: number, decoder: Decoder<T>): T => {
    const [value,end] = decoder.read(economic[index].data,0);
    if (end !== economic[index].data.length) throw new Error('Trailing wallet instruction bytes');
    return value;
  };
  const hasRoute = economic.some((_,index) => is(index,sdk.EXECUTE_MARGIN_ROUTE_V2_DISCRIMINATOR) || is(index,sdk.EXECUTE_GROUP_ROUTE_V2_DISCRIMINATOR));
  const requiredBudget = economic.length === 2 ? sdk.groupTransferRouteComputeBudget() : hasRoute ? sdk.groupRouteComputeBudget() : sdk.routeComputeBudget();
  if (!limit.equals(Buffer.from(requiredBudget.data!))) throw new Error('Incorrect group action budget');
  if (economic.length === 2) {
    if (!is(0,sdk.TRANSFER_TRADING_CASH_V2_DISCRIMINATOR) || !is(1,sdk.EXECUTE_MARGIN_ROUTE_V2_DISCRIMINATOR)) throw new Error('Only transfer-and-route may be combined');
    const transfer = exact(0,sdk.getTransferTradingCashV2InstructionDataDecoder()), route = exact(1,sdk.getExecuteMarginRouteV2InstructionDataDecoder());
    if (economic[0].accounts[5] !== economic[1].accounts[4] || route.sequence !== transfer.sequence + 1n) throw new Error('Atomic recipient/sequence mismatch');
    return {kind:'groupSequence',group,account:group,value:transfer.sequence.toString()};
  }
  const accounts = economic[0].accounts;
  if (is(0,sdk.EXECUTE_MARGIN_ROUTE_V2_DISCRIMINATOR)) {
    const data = exact(0,sdk.getExecuteMarginRouteV2InstructionDataDecoder());
    return {kind:'marginNonce',group,account:accounts[4],value:data.intent.nonce.toString()};
  }
  if (is(0,sdk.EXECUTE_GROUP_ROUTE_V2_DISCRIMINATOR)) {
    const data = exact(0,sdk.getExecuteGroupRouteV2InstructionDataDecoder());
    return {kind:'marginNonce',group,account:accounts[4],value:data.intent.nonce.toString()};
  }
  if (is(0,sdk.GROUP_TRADING_CASH_V2_DISCRIMINATOR)) {
    const data = exact(0,sdk.getGroupTradingCashV2InstructionDataDecoder());
    return {kind:'groupSequence',group,account:group,value:data.sequence.toString()};
  }
  if (is(0,sdk.TRANSFER_TRADING_CASH_V2_DISCRIMINATOR)) {
    const data = exact(0,sdk.getTransferTradingCashV2InstructionDataDecoder());
    return {kind:'groupSequence',group,account:group,value:data.sequence.toString()};
  }
  // These actions have on-chain durable versions but no general nonexecution
  // proof here. Missing history never licenses replacement signing.
  const unstamped = [
    [sdk.MANAGE_MARGIN_ORDER_V2_DISCRIMINATOR,sdk.getManageMarginOrderV2InstructionDataDecoder()],
    [sdk.MANAGE_GROUP_ORDER_V2_DISCRIMINATOR,sdk.getManageGroupOrderV2InstructionDataDecoder()],
    [sdk.DEPOSIT_GROUP_V2_DISCRIMINATOR,sdk.getDepositGroupV2InstructionDataDecoder()],
    [sdk.SET_MARGIN_DELEGATE_V2_DISCRIMINATOR,sdk.getSetMarginDelegateV2InstructionDataDecoder()],
    [sdk.NET_MARGIN_CLAIMS_V2_DISCRIMINATOR,sdk.getNetMarginClaimsV2InstructionDataDecoder()],
    [sdk.CREATE_PORTFOLIO_V2_DISCRIMINATOR,sdk.getCreatePortfolioV2InstructionDataDecoder()],
    [sdk.REGISTER_MARGIN_V2_DISCRIMINATOR,sdk.getRegisterMarginV2InstructionDataDecoder()],
  ] as const;
  const entry = unstamped.find(([discriminator]) => is(0,discriminator));
  if (!entry) throw new Error('Unsupported group wallet action');
  exact(0,entry[1] as Decoder<unknown>);
  return null;
}
