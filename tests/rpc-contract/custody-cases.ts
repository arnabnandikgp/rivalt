import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { address, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import { Keypair } from '@solana/web3.js';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';
import {
  TOKEN_PROGRAM_ADDRESS, getInitializeMint2Instruction, getInitializeAccount3Instruction,
  getMintToInstruction, getTokenDecoder, getTransferCheckedInstruction,
} from '@solana-program/token';
import {
  CLEARING_PROGRAM_ADDRESS, findMarketPda, findParticipantPda, findRegistryPda, findVaultPda,
  getInitializeMarketInstructionAsync, getRegisterParticipantInstructionAsync,
  getDepositInstructionAsync, getWithdrawInstructionAsync, getFundInsuranceInstructionAsync,
  getClassifySurplusInstructionAsync, getSetCustodyPauseInstructionAsync,
  getMarketStateDecoder, getParticipantDecoder, getParticipantRegistryDecoder,
} from '@rivalt/sdk';

export const LOADER = address('BPFLoaderUpgradeab1e11111111111111111111111');
export const program = CLEARING_PROGRAM_ADDRESS;
export const fixtureKey = (role: string) => Keypair.fromSeed(createHash('sha256').update(`rivalt/p02/local-only/${role}`).digest());
export const payerKey = () => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('.local/keys/payer.json', 'utf8'))));
export async function addresses() {
  const [market] = await findMarketPda();
  const [registry] = await findRegistryPda({ market });
  const [vault] = await findVaultPda({ market });
  const [eventAuthority] = await getProgramDerivedAddress({ programAddress: program, seeds: [Buffer.from('__event_authority')] });
  const [programData] = await getProgramDerivedAddress({ programAddress: LOADER, seeds: [getAddressEncoder().encode(program)] });
  return { market, registry, vault, eventAuthority, program, programData };
}
export type Harness = {
  send(label: string, instructions: Instruction[], signers?: Keypair[], expectedError?: number): Promise<void>;
  read(key: Address): Promise<Buffer | null>;
  rent(bytes: number): Promise<bigint>;
};

export async function custodyCases(h: Harness) {
  const payer = await payerKey();
  const [trader, attacker, mint, badMint, userToken, wrongOwnerToken, wrongMintToken, insuranceToken] =
    await Promise.all(['trader', 'attacker', 'mint', 'bad-mint', 'user-token', 'wrong-owner-token', 'wrong-mint-token', 'insurance-token'].map(fixtureKey));
  const a = await addresses();
  const [participant] = await findParticipantPda({ market: a.market, owner: trader.address });
  const common = { ...a, participant, owner: trader, quoteMint: mint.address, userToken: userToken.address };
  const admin = { ...a, authority: payer };
  async function createMint(key: Keypair, decimals: number) {
    await h.send(`fixture mint ${decimals} decimals`, [
      getCreateAccountInstruction({ payer, newAccount: key, lamports: await h.rent(82), space: 82n, programAddress: TOKEN_PROGRAM_ADDRESS }),
      getInitializeMint2Instruction({ mint: key.address, decimals, mintAuthority: payer.address }),
    ], [key]);
  }
  async function createToken(key: Keypair, mintKey: Address, owner: Address, amount: bigint) {
    await h.send('fixture token account and mint', [
      getCreateAccountInstruction({ payer, newAccount: key, lamports: await h.rent(165), space: 165n, programAddress: TOKEN_PROGRAM_ADDRESS }),
      getInitializeAccount3Instruction({ account: key.address, mint: mintKey, owner }),
      getMintToInstruction({ mint: mintKey, token: key.address, mintAuthority: payer, amount }),
    ], [key]);
  }
  await h.send('fixture SOL rent funding', [
    getTransferSolInstruction({ source: payer, destination: trader.address, amount: 1_000_000_000n }),
    getTransferSolInstruction({ source: payer, destination: attacker.address, amount: 1_000_000_000n }),
  ]);
  await createMint(mint, 6);
  await createMint(badMint, 9);
  await createToken(userToken, mint.address, trader.address, 2_000_000n);
  await createToken(wrongOwnerToken, mint.address, attacker.address, 0n);
  await createToken(wrongMintToken, badMint.address, trader.address, 0n);
  await createToken(insuranceToken, mint.address, payer.address, 1_000_000n);
  const domain = createHash('sha256').update('rivalt/local/custody-profile-1').digest();
  await h.send('reject unauthorized initialization', [await getInitializeMarketInstructionAsync({ ...a, authority: attacker, quoteMint: mint.address, domain })], [attacker], 6102);
  await h.send('reject wrong collateral precision', [await getInitializeMarketInstructionAsync({ ...admin, quoteMint: badMint.address, domain })], [], 6103);
  assert.equal(await h.read(a.market), null);
  await h.send('initialize custody market', [await getInitializeMarketInstructionAsync({ ...admin, quoteMint: mint.address, domain })]);
  await h.send('register trader', [await getRegisterParticipantInstructionAsync({ ...a, owner: trader })], [trader]);
  const tracked = [a.market, participant, a.vault, userToken.address, a.registry];
  const snapshot = async () => Promise.all(tracked.map(async k => (await h.read(k))?.toString('hex')));
  async function rejected(label: string, instructions: Instruction[], signers: Keypair[], code: number) {
    const before = await snapshot();
    await h.send(label, instructions, signers, code);
    assert.deepEqual(await snapshot(), before, `${label}: financial bytes changed`);
  }
  const market = async () => getMarketStateDecoder().decode((await h.read(a.market))!);
  const participantState = async () => getParticipantDecoder().decode((await h.read(participant))!);
  const vaultState = async () => getTokenDecoder().decode((await h.read(a.vault))!);
  async function reconcile(cash: bigint, insurance: bigint) {
    const m = await market(), p = await participantState(), v = await vaultState();
    assert.equal(p.cash, cash);
    assert.equal(p.lots, 0n);
    assert.equal(p.virtualScaled, 0n);
    assert.equal(m.totalCash, cash);
    assert.equal(m.insurance, insurance);
    assert.equal(m.settlement, 0n);
    assert.equal(m.fees, 0n);
    assert.equal(m.allocatedVault, cash + insurance);
    assert(v.amount >= m.allocatedVault);
    assert.equal(v.owner, a.market);
    assert.equal(v.mint, mint.address);
  }
  await h.send('deposit real test collateral', [await getDepositInstructionAsync({ ...common, amount: 1_000_000n })], [trader]);
  await reconcile(1_000_000n, 0n);
  await rejected('reject wrong participant owner', [await getWithdrawInstructionAsync({ ...common, owner: attacker, amount: 1n })], [attacker], 2006);
  await rejected('reject wrong destination owner', [await getWithdrawInstructionAsync({ ...common, userToken: wrongOwnerToken.address, amount: 1n })], [trader], 2015);
  await rejected('reject wrong token mint', [await getDepositInstructionAsync({ ...common, userToken: wrongMintToken.address, amount: 1n })], [trader], 2014);
  await rejected('reject vault/source alias', [await getDepositInstructionAsync({ ...common, userToken: a.vault, amount: 1n })], [trader], 2040);
  await rejected('reject overdraw', [await getWithdrawInstructionAsync({ ...common, amount: 1_000_001n })], [trader], 6100);
  await rejected('reject zero amount', [await getDepositInstructionAsync({ ...common, amount: 0n })], [trader], 6106);
  await rejected('reject arithmetic maximum', [await getDepositInstructionAsync({ ...common, amount: (1n << 64n) - 1n })], [trader], 6100);
  await rejected('rollback earlier successful token CPI and event', [
    await getDepositInstructionAsync({ ...common, amount: 11n }),
    await getWithdrawInstructionAsync({ ...common, amount: 1_000_012n }),
  ], [trader], 6100);
  const unsigned = await getWithdrawInstructionAsync({ ...common, amount: 1n });
  await rejected('reject missing owner signature', [{ ...unsigned, accounts: unsigned.accounts.map((m, i) => i === 0 ? { address: m.address, role: 0 } : m) }], [], 3010);
  await h.send('withdraw admissible cash', [await getWithdrawInstructionAsync({ ...common, amount: 400_000n })], [trader]);
  await reconcile(600_000n, 0n);
  await h.send('fund insurance by real token CPI', [await getFundInsuranceInstructionAsync({ ...admin, quoteMint: mint.address, source: insuranceToken.address, amount: 10_000n })]);
  await h.send('unsolicited token transfer fixture', [getTransferCheckedInstruction({
    source: userToken.address, mint: mint.address, destination: a.vault, authority: trader, amount: 7n, decimals: 6,
  })], [trader]);
  await reconcile(600_000n, 10_000n);
  assert.equal((await vaultState()).amount - (await market()).allocatedVault, 7n);
  await h.send('deposit preserves unassigned surplus', [await getDepositInstructionAsync({ ...common, amount: 37n })], [trader]);
  await rejected('reject unauthorized surplus classification', [await getClassifySurplusInstructionAsync({ ...a, authority: attacker })], [attacker], 2001);
  await h.send('classify surplus explicitly to insurance', [await getClassifySurplusInstructionAsync(admin)]);
  await reconcile(600_037n, 10_007n);
  await h.send('pause custody', [await getSetCustodyPauseInstructionAsync({ ...admin, paused: true })]);
  await rejected('paused withdrawal', [await getWithdrawInstructionAsync({ ...common, amount: 1n })], [trader], 6101);
  await rejected('paused deposit', [await getDepositInstructionAsync({ ...common, amount: 1n })], [trader], 6101);
  await rejected('paused registration', [await getRegisterParticipantInstructionAsync({ ...a, owner: attacker })], [attacker], 6101);
  const [attackerParticipant] = await findParticipantPda({ market: a.market, owner: attacker.address });
  assert.equal(await h.read(attackerParticipant), null);
  await h.send('unpause reconciled custody', [await getSetCustodyPauseInstructionAsync({ ...admin, paused: false })]);
  await h.send('withdraw remaining funded cash', [await getWithdrawInstructionAsync({ ...common, amount: 600_037n })], [trader]);
  await reconcile(0n, 10_007n);
  const registry = getParticipantRegistryDecoder().decode((await h.read(a.registry))!);
  assert.equal(registry.count, 1);
  assert.deepEqual(registry.members, [participant]);
  assert.equal(getTokenDecoder().decode((await h.read(userToken.address))!).amount, 1_999_993n);
  assert.equal(getTokenDecoder().decode((await h.read(insuranceToken.address))!).amount, 990_000n);
  return { addresses: { ...a, participant, quoteMint: mint.address }, finalMarket: await market(), finalParticipant: await participantState(), actualVault: (await vaultState()).amount };
}
