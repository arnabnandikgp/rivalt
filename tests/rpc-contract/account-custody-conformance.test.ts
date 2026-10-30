import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNoopSigner, getAddressDecoder, type Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';

test('schema-7 custody bytes, roles and bounded amounts match isolated Anchor', async () => {
  const key = (value: number) => getAddressDecoder().decode(new Uint8Array(32).fill(value));
  const owner = createNoopSigner(key(1)), authority = createNoopSigner(key(2));
  const reserveSigner = createNoopSigner(key(19));
  const program = sdk.CLEARING_PROGRAM_ADDRESS;
  const common = { venue: key(3), registry: key(4), vault: key(5), quoteMint: key(6),
    eventAuthority: key(7), program, programData: key(8), authority, owner, donor: owner,
    portfolio: key(9), margin: key(10), market: key(11), userToken: key(12), donorToken: key(12),
    recipient: key(13), custody: key(14), safety: key(15), btcLedger: key(16), ethLedger: key(17), ledger: key(16) };
  const domain = new Uint8Array(32).fill(27), amount = 9007199254740993n;
  const value = (value: unknown) => ({ kind: 'value', value });
  const integer = (value: bigint) => ({ kind: 'u64', value: value.toString() });
  const publicKey = (value: string) => ({ kind: 'pubkey', value });
  const end = ['eventAuthority','program'];
  const base = ['venue','custody','safety'];
  const ledgerBase = [...base,'btcLedger','ethLedger'];
  const cases: { name: string; args: unknown[]; instruction: Instruction; names: string[] }[] = [
    { name: 'initializeLiquidityVenue', args: [value([...domain]),publicKey(key(18)),publicKey(key(19)),publicKey(key(20))],
      instruction: await sdk.getInitializeLiquidityVenueInstructionAsync({ ...common, domain, feeAuthority: key(18), reserveAuthority: key(19), reserveDestinationOwner: key(20) }),
      names: ['authority','clearingProgram','programData','quoteMint',...base,'vault','tokenProgram','systemProgram',...end] },
    { name: 'initializeVenueRegistry', args: [], instruction: await sdk.getInitializeVenueRegistryInstructionAsync(common),
      names: ['authority',...base,'registry','systemProgram',...end] },
    { name: 'initializeMarket', args: [value(1)], instruction: sdk.getInitializeMarketInstruction({ ...common, index: 1 }),
      names: ['authority',...base,'market','ledger','systemProgram',...end] },
    { name: 'createPortfolio', args: [value(3)], instruction: await sdk.getCreatePortfolioInstructionAsync({ ...common, index: 3 }),
      names: ['owner',...base,'portfolio','systemProgram',...end] },
    { name: 'registerMargin', args: [value(8),value(1),value(1),value(2)], instruction: await sdk.getRegisterMarginInstructionAsync({ ...common, subaccountIndex: 8, mode: 1, isolatedMarketIndex: 1, role: 2 }),
      names: ['owner',...base,'registry','portfolio','margin','systemProgram',...end] },
    ...(['depositAccount','withdrawAccountCustody'] as const).map(name => ({ name, args: [integer(amount)],
      instruction: name === 'depositAccount' ? sdk.getDepositAccountInstruction({ ...common, amount }) : sdk.getWithdrawAccountCustodyInstruction({ ...common, amount }),
      names: ['owner',...ledgerBase,'margin','quoteMint','vault','userToken','tokenProgram',...end] })),
    { name: 'transferAccountCustody', args: [integer(amount)], instruction: await sdk.getTransferAccountCustodyInstructionAsync({ ...common, donor: key(10), amount }),
      names: ['owner','venue','safety','donor','recipient',...end] },
    { name: 'pauseVenue', args: [value(true)], instruction: await sdk.getPauseVenueInstructionAsync({ ...common, paused: true }),
      names: ['authority',...ledgerBase,'vault',...end] },
    { name: 'classifyMarketSurplus', args: [value(1),integer(amount)], instruction: await sdk.getClassifyMarketSurplusInstructionAsync({ ...common, reserveAuthority: reserveSigner, marketIndex: 1, amount }),
      names: ['reserveAuthority',...base,'ledger','vault',...end] },
    { name: 'seedMarketInsurance', args: [value(1),integer(amount)], instruction: await sdk.getSeedMarketInsuranceInstructionAsync({ ...common, reserveAuthority: reserveSigner, marketIndex: 1, amount }),
      names: ['reserveAuthority','donor',...base,'ledger','quoteMint','vault','donorToken','tokenProgram',...end] },
  ];
  const directory = mkdtempSync(join(tmpdir(), 'rivalt-account-conformance-'));
  try {
    const path = join(directory, 'input.json');
    writeFileSync(path, JSON.stringify({ instructions: cases.map(({name,args,instruction,names}) => {
      assert.equal(instruction.accounts!.length, names.length, `${name}: exact account list`);
      return {name,args, accounts: Object.fromEntries(names.map((name,index) => [name,instruction.accounts![index].address])) };
    }) }));
    const legacy = JSON.parse(execFileSync(process.execPath, ['tests/anchor-conformance/account-custody.cjs', path], { encoding: 'utf8' }));
    assert.equal(legacy.instructions.length, 11);
    for (const [index, result] of legacy.instructions.entries()) {
      const instruction = cases[index].instruction;
      assert.equal(result.data, Buffer.from(instruction.data!).toString('hex'));
      assert.deepEqual(result.accounts, instruction.accounts!.map(account => ({address: account.address,
        signer: account.role >= 2, writable: account.role % 2 === 1})));
    }
  } finally { rmSync(directory, {recursive:true,force:true}); }
});
