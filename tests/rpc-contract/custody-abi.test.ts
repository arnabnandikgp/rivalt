import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { address } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { addresses, payerKey, fixtureKey } from './custody-cases.js';

describe('custody IDL legacy/generated parity', () => {
  it('matches all seven instruction encodings, exact account roles and PDA seeds', async () => {
    const a = await addresses(), payer = await payerKey(), mint = await fixtureKey('mint'), token = await fixtureKey('user-token');
    const [participant] = await sdk.findParticipantPda({ market: a.market, owner: payer.address });
    const event = { eventAuthority: a.eventAuthority, program: a.program };
    const admin = { authority: payer.address, market: a.market, vault: a.vault, ...event };
    const cash = { owner: payer.address, market: a.market, participant, quoteMint: mint.address, vault: a.vault, userToken: token.address, tokenProgram: TOKEN_PROGRAM_ADDRESS, ...event };
    const domain = Array.from({ length: 32 }, (_, i) => i);
    const systemProgram = address('11111111111111111111111111111111');
    const amount = '9007199254740993';
    const input = { instructions: [
      { name: 'initializeMarket', args: [{ kind: 'bytes', value: domain }], accounts: { authority: payer.address, clearingProgram: a.program, programData: a.programData, quoteMint: mint.address, market: a.market, registry: a.registry, vault: a.vault, tokenProgram: TOKEN_PROGRAM_ADDRESS, systemProgram, ...event } },
      { name: 'registerParticipant', args: [], accounts: { owner: payer.address, market: a.market, registry: a.registry, participant, systemProgram, ...event } },
      ...['deposit', 'withdraw'].map(name => ({ name, args: [{ kind: 'u64', value: amount }], accounts: cash })),
      { name: 'fundInsurance', args: [{ kind: 'u64', value: amount }], accounts: { ...admin, quoteMint: mint.address, source: token.address, tokenProgram: TOKEN_PROGRAM_ADDRESS } },
      { name: 'classifySurplus', args: [], accounts: admin },
      { name: 'setCustodyPause', args: [{ kind: 'bool', value: true }], accounts: admin },
    ] };
    writeFileSync('.local/custody-conformance-input.json', JSON.stringify(input));
    const legacy = JSON.parse(execFileSync(process.execPath, ['tests/anchor-conformance/custody.cjs', '.local/custody-conformance-input.json'], { encoding: 'utf8' }));
    const modern = [
      await sdk.getInitializeMarketInstructionAsync({ ...a, authority: payer, quoteMint: mint.address, domain: Uint8Array.from(domain) }),
      await sdk.getRegisterParticipantInstructionAsync({ ...a, owner: payer }),
      await sdk.getDepositInstructionAsync({ ...cash, owner: payer, amount: BigInt(amount) }),
      await sdk.getWithdrawInstructionAsync({ ...cash, owner: payer, amount: BigInt(amount) }),
      await sdk.getFundInsuranceInstructionAsync({ ...a, authority: payer, quoteMint: mint.address, source: token.address, amount: BigInt(amount) }),
      await sdk.getClassifySurplusInstructionAsync({ ...a, authority: payer }),
      await sdk.getSetCustodyPauseInstructionAsync({ ...a, authority: payer, paused: true }),
    ];
    modern.forEach((ix, i) => {
      assert.equal(Buffer.from(ix.data).toString('hex'), legacy.instructions[i].data);
      assert.deepEqual(ix.accounts.map(a => ({ address: a.address, signer: (a.role & 2) !== 0, writable: (a.role & 1) !== 0 })), legacy.instructions[i].accounts);
    });
    assert.equal(sdk.getDepositInstructionDataDecoder().decode(modern[2].data).amount, BigInt(amount));
  });
});
