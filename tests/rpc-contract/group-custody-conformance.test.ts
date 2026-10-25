import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNoopSigner, getAddressDecoder, type Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';

test('V2 custody instruction bytes and all account flags match isolated legacy Anchor', async () => {
  const key = (value: number) => getAddressDecoder().decode(new Uint8Array(32).fill(value));
  const owner = createNoopSigner(key(1)), authority = createNoopSigner(key(2));
  const program = sdk.CLEARING_PROGRAM_ADDRESS;
  const common = { group: key(3), registry: key(4), vault: key(5), quoteMint: key(6),
    eventAuthority: key(7), program, programData: key(8), authority, owner,
    portfolio: key(9), margin: key(10), market: key(11), userToken: key(12),
    donor: key(10), recipient: key(13) };
  const domain = new Uint8Array(32).fill(19), amount = 9007199254740993n;
  const value = (value: unknown) => ({ kind: 'value', value });
  const integer = (value: bigint) => ({ kind: 'u64', value: value.toString() });
  const cases: { name: string; args: unknown[]; instruction: Instruction; names: string[] }[] = [
    { name: 'initializeGroupV2', args: [value([...domain])], instruction: await sdk.getInitializeGroupV2InstructionAsync({ ...common, domain }),
      names: ['authority','clearingProgram','programData','quoteMint','group','registry','vault','tokenProgram','systemProgram','eventAuthority','program'] },
    { name: 'initializeGroupMarketV2', args: [value(1)], instruction: sdk.getInitializeGroupMarketV2Instruction({ ...common, index: 1 }),
      names: ['authority','group','market','systemProgram','eventAuthority','program'] },
    { name: 'createPortfolioV2', args: [value(3)], instruction: await sdk.getCreatePortfolioV2InstructionAsync({ ...common, index: 3 }),
      names: ['owner','group','portfolio','systemProgram','eventAuthority','program'] },
    { name: 'registerMarginV2', args: [value(8),value(1),value(1),value(2)], instruction: await sdk.getRegisterMarginV2InstructionAsync({ ...common, subaccountIndex: 8, mode: 1, isolatedMarketIndex: 1, role: 2 }),
      names: ['owner','group','registry','portfolio','margin','systemProgram','eventAuthority','program'] },
    ...(['depositGroupV2', 'withdrawGroupCustodyV2'] as const).map(name => ({ name, args: [integer(amount)],
      instruction: name === 'depositGroupV2' ? sdk.getDepositGroupV2Instruction({ ...common, amount }) : sdk.getWithdrawGroupCustodyV2Instruction({ ...common, amount }),
      names: ['owner','group','margin','quoteMint','vault','userToken','tokenProgram','eventAuthority','program'] })),
    { name: 'transferGroupCustodyV2', args: [integer(amount)], instruction: await sdk.getTransferGroupCustodyV2InstructionAsync({ ...common, amount }),
      names: ['owner','group','donor','recipient','vault','eventAuthority','program'] },
    { name: 'pauseGroupCustodyV2', args: [value(true)], instruction: await sdk.getPauseGroupCustodyV2InstructionAsync({ ...common, paused: true }),
      names: ['authority','group','vault','eventAuthority','program'] },
    { name: 'classifyGroupSurplusV2', args: [], instruction: await sdk.getClassifyGroupSurplusV2InstructionAsync(common),
      names: ['authority','group','vault','eventAuthority','program'] },
  ];
  const directory = mkdtempSync(join(tmpdir(), 'rivalt-group-conformance-'));
  try {
    const path = join(directory, 'input.json');
    writeFileSync(path, JSON.stringify({ instructions: cases.map(({ name,args,instruction,names }) => ({ name,args,
      accounts: Object.fromEntries(names.map((name,index) => [name,instruction.accounts![index].address])) })) }));
    const legacy = JSON.parse(execFileSync(process.execPath, ['tests/anchor-conformance/custody.cjs', path], { encoding: 'utf8' }));
    assert.equal(legacy.instructions.length, 9);
    for (const [index, result] of legacy.instructions.entries()) {
      const instruction = cases[index].instruction;
      assert.equal(result.data, Buffer.from(instruction.data!).toString('hex'));
      assert.deepEqual(result.accounts, instruction.accounts!.map(account => ({ address: account.address,
        signer: account.role >= 2, writable: account.role % 2 === 1 })));
    }
  } finally { rmSync(directory, { recursive: true }); }
});
