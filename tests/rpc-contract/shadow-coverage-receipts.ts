import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getBase58Encoder} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {FinalizedBlock} from '../../packages/indexer/src/finalized-block.js';
import type {AccountInvocation} from '../../packages/indexer/src/account-events.js';
import type {startShadow} from './shadow-coverage.js';

const program = sdk.CLEARING_PROGRAM_ADDRESS;
const base58 = getBase58Encoder();
const tag = (name: string) => createHash('sha256').update('global:'+name).digest('hex').slice(0,16);
const record = tag('record_coverage_row'), observe = tag('observe_coverage');
type Meter = {program:string; units:number; logs:string[]};
function topLevelLogs(lines: string[]) {
  const frames: Meter[] = [], stack: {program:string; frame:Meter}[] = [];
  for (const line of lines) {
    const call = /^Program (\w+) invoke \[(\d+)\]$/.exec(line);
    if (call) {
      assert.equal(Number(call[2]),stack.length+1);
      const frame = {program:call[1],units:0,logs:[] as string[]};
      if (!stack.length) frames.push(frame);
      stack.push({program:call[1],frame});
      continue;
    }
    const end = /^Program (\w+) success$/.exec(line);
    if (end) {assert.equal(stack.pop()?.program,end[1]);continue;}
    if (stack.length !== 1) continue;
    const cost = /^Program (\w+) consumed (\d+) of \d+ compute units$/.exec(line);
    if (cost) {assert.equal(cost[1],stack[0].program);stack[0].frame.units=Number(cost[2]);}
    if (line.startsWith('Program log: coverage ')) stack[0].frame.logs.push(line);
  }
  assert.equal(stack.length,0,'Missing invocation logs for the CU measurement');
  return frames;
}

export function checkShadowReceipts(blocks:FinalizedBlock[], invocations:AccountInvocation[], checks:Record<string,unknown>[],
  shadow:Awaited<ReturnType<typeof startShadow>>) {
  const labels = new Map(checks.map(row=>[row.signature,String(row.label)]));
  const writes = new Map<string,string[]>();
  for (const invocation of invocations) writes.set(invocation.signature+'/'+invocation.outer,
    invocation.writes.filter(write=>write.kind===5).map(write=>write.account).sort());
  const fills = [], decisions = [];
  const completedEth = invocations.flatMap(invocation => invocation.events.filter(event =>
    event.type === 'AccountBackingChangedV3' && event.data.state.marketIndex === 1 && event.data.state.complete)
    .map(() => Number(invocation.slot)));
  assert(completedEth.length);
  const firstCompleteEthSlot = Math.min(...completedEth);
  let seeded = false, verifiedRootWrites = 0;
  for (const block of blocks) for (const {tx,signature} of block.transactions) {
    if (tx.meta.err !== null) continue;
    const label = labels.get(signature);
    if (label==='observe initial ETH debtors') seeded = true;
    if (!seeded) continue;
    const message = tx.transaction.message, keys:string[]=message.accountKeys;
    // This fixture signs static-key v0/v1 messages without lookup tables.
    assert(!(tx.meta.loadedAddresses?.writable?.length || tx.meta.loadedAddresses?.readonly?.length));
    const instructions = message.instructions.map((ix:{programIdIndex:number;data:string;accounts:number[]})=>({
      program:keys[ix.programIdIndex], accounts:ix.accounts.map(index=>keys[index]), data:Buffer.from(base58.encode(ix.data)),
    })) as {program:string;accounts:string[];data:Buffer}[];
    const tags = instructions.map(ix=>ix.program===program?ix.data.subarray(0,8).toString('hex'):'');
    const fill = label?.startsWith('traffic ') || label?.startsWith('open creditor ') || label?.startsWith('close creditor ');
    const meters = fill || tags.includes(observe) ? topLevelLogs(tx.meta.logMessages) : null;
    if (meters) assert.deepEqual(meters.map(row=>row.program),instructions.map(ix=>ix.program));
    for (const [index,ix] of instructions.entries()) {
      const changed = writes.get(signature+'/'+index);
      if (changed?.length) {
        const copied:string[]=[];
        for(let next=index+1+Number(tags[index+1]===observe); tags[next]===record; next++) copied.push(instructions[next].accounts[0]);
        assert(changed.every(key=>copied.includes(key)), 'Financial write without an atomic mirror: '+signature);
        verifiedRootWrites += changed.length;
      }
      if (tags[index] === observe) {
        const verdict = meters![index].logs.join('');
        assert.match(verdict,/members=12 exact=\d+ covered=1$/);
        const paid = tags[index-1]===sdk.hex(sdk.PAY_ACCOUNT_GAIN_DISCRIMINATOR);
        if(paid) assert.equal(ix.data[8],instructions[index-1].data[8]);
        decisions.push({label,signature,slot:block.slot,target:ix.data[8],verdict,units:meters![index].units,transactionCU:tx.meta.computeUnitsConsumed,paid});
      }
      if(tags[index] === sdk.hex(sdk.PAY_ACCOUNT_GAIN_DISCRIMINATOR)) assert.equal(tags[index+1],observe);
    }
    if(fill) {
      const records=tags.flatMap((value,index)=>value===record?[index]:[]);
      assert.equal(records.length,2,'Each measured one-maker fill changes two roots');
      const lanes=[...new Set(records.map(index=>instructions[index].accounts[1]))];
      assert(lanes.every(key=>shadow.lanes.some(lane=>lane===key)));
      const addedCU=records.reduce((sum,index)=>sum+meters![index].units,0);
      assert(addedCU>0);
      const header=message.header;
      const writable=keys.filter((_,index)=>index<header.numRequiredSignatures
        ? index<header.numRequiredSignatures-header.numReadonlySignedAccounts : index<keys.length-header.numReadonlyUnsignedAccounts);
      assert(lanes.every(key=>writable.includes(key)));
      const priorKeys = keys.filter(key=>!lanes.includes(key));
      fills.push({label,signature,slot:block.slot,totalCU:tx.meta.computeUnitsConsumed,addedCU,
        otherCU:tx.meta.computeUnitsConsumed-addedCU,addedWritable:lanes,priorKeys,priorWritable:writable.filter(key=>!lanes.includes(key))});
    }
  }
  assert.equal(fills.length,52);
  assert(decisions.some(row=>row.label==='observe funded ETH before first certificate' && row.slot < firstCompleteEthSlot),
    'Require a finalized cold observation strictly before the first complete ETH certificate');
  assert(decisions.some(row=>row.paid && row.target===1));
  const traffic = fills.filter(row=>row.label!.startsWith('traffic '));
  let disjointOriginal=0, newConflicts=0;
  for(const [index,left] of traffic.entries()) for(const right of traffic.slice(index+1)) {
    if(left.priorWritable.some(key=>right.priorKeys.includes(key)) || right.priorWritable.some(key=>left.priorKeys.includes(key))) continue;
    disjointOriginal++;
    if(left.addedWritable.some(key=>right.addedWritable.includes(key))) newConflicts++;
  }
  return {fills,decisions,firstCompleteEthSlot,verifiedRootWrites,disjointOriginal,newConflicts};
}
