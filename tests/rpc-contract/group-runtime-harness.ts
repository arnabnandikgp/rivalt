import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {address, type Address, type Instruction, type ReadonlyUint8Array} from '@solana/kit';
import {Connection} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {payerKey, program, type Harness} from './custody-cases.js';
import type {GroupTradingHarness} from './group-trading-cases.js';
import {WireRpc, eventually} from './wire.js';
import {json} from '../../packages/indexer/src/events.js';

/** Fresh signed fixture transport shared by P21 service checks. The normal
 * service queue remains the execution path under test, not this setup helper. */
export async function groupRuntimeHarness(url: string, directory: string) {
  assert.equal(new URL(url).hostname, '127.0.0.1');
  const rpc = new WireRpc(url), connection = new Connection(url, 'confirmed'), payer = await payerKey();
  const checks: {label:string; signature:string; expectedError?:number; feeLamports:string; history:any}[] = [];
  const clock = address('SysvarC1ock11111111111111111111111111111111');
  async function read(key: Address) {
    const response = await rpc.call('getAccountInfo', [key,{encoding:'base64',commitment:'confirmed'}]);
    return response.value ? Buffer.from(response.value.data[0], 'base64') : null;
  }
  async function send(label: string, instructions: Instruction[], signers: Parameters<Harness['send']>[2] = [], expectedError?:number) {
    const has = (discriminator: ReadonlyUint8Array) => instructions.some(instruction => instruction.programAddress === program && Buffer.from(instruction.data ?? []).subarray(0,8).equals(Buffer.from(discriminator)));
    const route = has(sdk.EXECUTE_GROUP_ROUTE_V2_DISCRIMINATOR) || has(sdk.EXECUTE_MARGIN_ROUTE_V2_DISCRIMINATOR) || has(sdk.EXECUTE_MARGIN_ORDER_V2_DISCRIMINATOR);
    const maintenance = has(sdk.SAMPLE_GROUP_ORACLE_V2_DISCRIMINATOR) || has(sdk.ADVANCE_GROUP_RESOLUTION_V2_DISCRIMINATOR);
    const combined = route && has(sdk.TRANSFER_TRADING_CASH_V2_DISCRIMINATOR);
    const budget = combined ? sdk.groupTransferRouteComputeBudget() : maintenance ? sdk.fundingComputeBudget() : route ? sdk.groupRouteComputeBudget() : sdk.routeComputeBudget();
    const {transaction} = await sdk.signInstructions(connection, payer, [budget,...instructions], signers);
    const encoded = Buffer.from(transaction.serialize()).toString('base64');
    assert(Buffer.from(encoded,'base64').length <= 1232, 'Packet budget');
    writeFileSync(`${directory}/wire-${checks.length}.json`, json({label, wire:encoded}));
    const signature = await rpc.call('sendTransaction', [encoded,{encoding:'base64',skipPreflight:true}]);
    await eventually(() => rpc.call('getSignatureStatuses', [[signature],{searchTransactionHistory:true}]),
      response => ['confirmed','finalized'].includes(response.value[0]?.confirmationStatus), label);
    const history = await eventually(() => rpc.call('getTransaction', [signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]), value => Boolean(value), label);
    writeFileSync(`${directory}/confirmed-${checks.length}.json`, json(history));
    assert.equal(history.transaction.signatures[0], signature);
    if (expectedError === undefined) assert.equal(history.meta.err, null, `${label}: ${history.meta.logMessages?.join('\n')}`);
    else assert.equal(history.meta.err?.InstructionError?.[1]?.Custom, expectedError, label);
    checks.push({label, signature, expectedError, feeLamports:String(history.meta.fee), history});
    return history;
  }
  const harness: GroupTradingHarness = {
    read, async rent(size) {return BigInt(await rpc.call('getMinimumBalanceForRentExemption',[size]));},
    async send(...args) {await send(...args);},
    async now() {return (await read(clock))!.readBigInt64LE(32);},
    async slot() {return (await read(clock))!.readBigUInt64LE(0);},
    async advance(seconds) {
      assert(seconds >= 0n && seconds <= 60n);
      const target = await this.now() + seconds, deadline = Date.now() + Number(seconds) * 1000 + 15000;
      while (await this.now() < target) {assert(Date.now() < deadline, 'Real clock advancement'); await delay(100);}
    },
    async quote(label, instruction) {
      const history = await send(label,[instruction]);
      assert.equal(history.meta.returnData?.programId, program);
      return Buffer.from(history.meta.returnData.data[0], 'base64');
    },
  };
  async function finalize() {
    for (const [index, check] of checks.entries()) {
      await eventually(() => rpc.call('getSignatureStatuses',[[check.signature],{searchTransactionHistory:true}]), response => response.value[0]?.confirmationStatus === 'finalized', check.label);
      const finalized = await rpc.call('getTransaction',[check.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
      assert.deepEqual(finalized, check.history, 'Original confirmed/finalized parity');
      writeFileSync(`${directory}/finalized-${index}.json`, json(finalized));
    }
  }
  return {harness, rpc, connection, checks, send, finalize};
}
