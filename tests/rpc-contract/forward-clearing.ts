import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AccountRole,type Instruction} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from '@rivalt/sdk';
import {ORACLE_FIXTURE} from './oracle-fixture.js';

/** The qualified local forwarding fixture adds a real external CPI frame without a PDA signer. */
export function forwardClearing(instructions:Instruction[]):Instruction {
  assert(instructions.length>0 && instructions.length<=2);
  const accounts=instructions[0].accounts!;
  const chunks=[createHash('sha256').update('global:forward_clearing').digest().subarray(0,8)];
  const size=(length:number)=>{const data=Buffer.alloc(4);data.writeUInt32LE(length);return data;};
  chunks.push(size(instructions.length));
  for(const instruction of instructions){
    assert.equal(instruction.programAddress,CLEARING_PROGRAM_ADDRESS);
    assert.deepEqual(instruction.accounts,accounts);
    chunks.push(size(instruction.data!.length),Buffer.from(instruction.data!));
  }
  return {programAddress:ORACLE_FIXTURE,accounts:[{address:CLEARING_PROGRAM_ADDRESS,role:AccountRole.READONLY},...accounts],
    data:Buffer.concat(chunks)};
}
