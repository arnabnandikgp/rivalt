import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { address, AccountRole, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import { Keypair } from '@solana/web3.js';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';
import { TOKEN_PROGRAM_ADDRESS, getInitializeAccount3Instruction, getInitializeMint2Instruction, getMintToInstruction } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { CORE_PROFILES, sponsoredFeeds } from './pyth-core.js';

export const profile = JSON.parse(readFileSync('ops/devnet-profile.json', 'utf8')) as {
  profile: string; genesis: string; deployer: string; programs: Record<string, string>; sourceMaxAgeSeconds?: 20 | 30;
};
const loader = address('BPFLoaderUpgradeab1e11111111111111111111111');
const hash = (s: string) => createHash('sha256').update(s).digest();
export async function privateKey(role: string, directory = '.local/devnet/keys') {
  assert(/^[a-z0-9-]{1,32}$/.test(role));
  const path = `${directory}/${role}.json`;
  if (directory === '.local/devnet/keys' && role === 'deployer') assert(existsSync(path), 'Pinned devnet deployer key is required; never substitute a generated or public fixture key');
  process.umask(0o077); mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!existsSync(path)) execFileSync('solana-keygen', ['new', '--no-bip39-passphrase', '--silent', '--outfile', path], { stdio: 'ignore' });
  assert.equal(statSync(path).mode & 0o077, 0, 'Private key file permissions');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}
export async function devnetContext(localKeys = false) {
  const key = (role: string) => privateKey(role, localKeys ? '.local/devnet-svm/keys' : '.local/devnet/keys');
  const payer = await key('deployer'); if (!localKeys) assert.equal(payer.address, profile.deployer);
  const program = address(profile.programs.clearing), options = { programAddress: program };
  const [market] = await sdk.findMarketPda(options), [registry] = await sdk.findRegistryPda({ market }, options);
  const [vault] = await sdk.findVaultPda({ market }, options), [routeState] = await sdk.findRouteStatePda({ market }, options);
  const [exitGuard] = await sdk.findGuardPda({ market }, options);
  const [eventAuthority] = await getProgramDerivedAddress({ programAddress: program, seeds: [Buffer.from('__event_authority')] });
  const [programData] = await getProgramDerivedAddress({ programAddress: loader, seeds: [getAddressEncoder().encode(program)] });
  const mint = await key('mint'), traderOwner = await key('trader'), traderToken = await key('trader-token');
  const [trader] = await sdk.findParticipantPda({ market, owner: traderOwner.address }, options);
  const domain = hash(`rivalt/${profile.profile}/${profile.genesis}/${program}/${mint.address}`);
  const makers = await Promise.all([0, 1].map(async id => {
    const owner = await key(`maker-${id}-owner`), token = await key(`maker-${id}-token`);
    const pricingProgram = address(profile.programs[id === 0 ? 'maker_a' : 'maker_b']);
    const [capital] = await sdk.findParticipantPda({ market, owner: owner.address }, options);
    const [registration] = await getProgramDerivedAddress({ programAddress: program, seeds: [Buffer.from('maker'), getAddressEncoder().encode(market), Uint8Array.of(id)] });
    const [config] = await getProgramDerivedAddress({ programAddress: pricingProgram, seeds: [Buffer.from('maker'), getAddressEncoder().encode(capital)] });
    const [makerProgramData] = await getProgramDerivedAddress({ programAddress: loader, seeds: [getAddressEncoder().encode(pricingProgram)] });
    return { owner, token, capital, registration, pricingProgram, config, programData: makerProgramData };
  }));
  const guardProgram = address(profile.programs.oracle_fixture), guardAuthority = await key('guard-authority');
  const guards = await Promise.all([2, 3].map(async index => ({ index, account: (await getProgramDerivedAddress({
    programAddress: guardProgram, seeds: [Buffer.from('feed'), getAddressEncoder().encode(guardAuthority.address), Buffer.alloc(32, index + 1)],
  }))[0] })));
  const primary = (await sponsoredFeeds()).filter(x => x.name === 'compatible');
  return { payer, program, options, market, registry, vault, routeState, exitGuard, eventAuthority, programData, mint, domain,
    traderOwner, traderToken, trader, makers, guardProgram, guardAuthority, guards, primary };
}
export type DevnetContext = Awaited<ReturnType<typeof devnetContext>>;
export type DevnetHarness = {
  send(label: string, instructions: Instruction[], signers?: Keypair[], error?: number | 'reject'): Promise<void>;
  rent(bytes: number): Promise<bigint>;
  read(key: Address): Promise<Buffer | null>;
  slot(): Promise<bigint>;
  now(): Promise<bigint>;
};

// Common setup is actual signed token/account instructions in both SVM and devnet.
// The devnet runner must journal each signed wire before submission and resume it.
export async function setupDevnet(h: DevnetHarness, a: DevnetContext) {
  const { payer, options } = a;
  const allocatedAtEntry = await h.read(a.routeState);
  await h.send('create-test-mint', [getCreateAccountInstruction({ payer, newAccount: a.mint, lamports: await h.rent(82), space: 82n, programAddress: TOKEN_PROGRAM_ADDRESS }),
    getInitializeMint2Instruction({ mint: a.mint.address, decimals: 6, mintAuthority: payer.address })], [a.mint]);
  await h.send('initialize-market', [await sdk.getInitializeMarketInstructionAsync({ ...a, clearingProgram: a.program, authority: payer, quoteMint: a.mint.address }, options)]);
  for (const [i, participant] of [
    { owner: a.traderOwner, token: a.traderToken, capital: a.trader, amount: 100_000_000n },
    ...a.makers.map(m => ({ ...m, amount: 500_000_000n })),
  ].entries()) {
    await h.send(`participant-${i}-accounts`, [getTransferSolInstruction({ source: payer, destination: participant.owner.address, amount: 20_000_000n }),
      await sdk.getRegisterParticipantInstructionAsync({ ...a, owner: participant.owner }, options),
      getCreateAccountInstruction({ payer, newAccount: participant.token, lamports: await h.rent(165), space: 165n, programAddress: TOKEN_PROGRAM_ADDRESS }),
      getInitializeAccount3Instruction({ account: participant.token.address, mint: a.mint.address, owner: participant.owner.address }),
      getMintToInstruction({ mint: a.mint.address, token: participant.token.address, mintAuthority: payer, amount: participant.amount }),
    ], [participant.owner, participant.token]);
    await h.send(`participant-${i}-deposit`, [await sdk.getDepositInstructionAsync({ ...a, owner: participant.owner, participant: participant.capital,
      quoteMint: a.mint.address, userToken: participant.token.address, amount: participant.amount }, options)], [participant.owner]);
  }
  for (const [id, m] of a.makers.entries()) {
    const api = id === 0 ? sdk.makerA : sdk.makerB;
    await h.send(`maker-${id}-config`, [await api.getInitializeConfigInstructionAsync({ ...m, market: a.market, domain: a.domain, duration: 3600n }, { programAddress: m.pricingProgram })], [m.owner]);
    await h.send(`maker-${id}-registration`, [await sdk.getRegisterMakerInstructionAsync({ ...a, ...m, authority: payer, makerId: id, inventoryLimit: 100_000n }, options)], [m.owner]);
  }
  await h.send('reject-synthetic-route-bootstrap', [await sdk.getInitializeTestRoutesInstructionAsync({ ...a, authority: payer, reference: 60_000n, duration: 3600n }, options)], [], 6108);
  if (!allocatedAtEntry) assert.equal(await h.read(a.routeState), null);
  await h.send('allocate-disabled-risk-state', [await sdk.getInitializeTestRoutesInstructionAsync({ ...a, authority: payer, reference: 0n, duration: 0n }, options),
    await sdk.getInitializeExitGuardInstructionAsync({ ...a, payer }, options)]);
  await h.send('fund-guard-rent', [getTransferSolInstruction({ source: payer, destination: a.guardAuthority.address, amount: 20_000_000n })]);
  for (const g of a.guards) {
    await h.send(`guard-${g.index}-account`, [{ programAddress: a.guardProgram,
      accounts: [{ address: a.guardAuthority.address, role: AccountRole.WRITABLE_SIGNER }, { address: g.account, role: AccountRole.WRITABLE }, { address: address('11111111111111111111111111111111'), role: AccountRole.READONLY }],
      data: Buffer.concat([hash('global:initialize').subarray(0, 8), Buffer.alloc(32, g.index + 1)]) }], [a.guardAuthority]);
  }
  await h.send('reject-fixture-primary', [await sdk.getInitializeOracleInstructionAsync({ ...a, authority: payer, primary: a.guardAuthority.address, guard: payer.address }, options)], [], 6123);
  await h.send('bind-sponsored-primary', [await sdk.getInitializeOracleInstructionAsync({ ...a, authority: payer, primary: address(CORE_PROFILES[1].receiver), guard: a.guardAuthority.address }, options)]);
  await h.send('reject-synthetic-setter', [await sdk.getPublishTestRiskInstructionAsync({ ...a, authority: payer, reference: 90_000n, duration: 3600n }, options)], [], 6108);
}

export async function sampleInstruction(a: DevnetContext) {
  const [x, y] = a.makers;
  return sdk.getSampleOracleInstructionAsync({ ...a, primaryBtc: a.primary[0].account, primaryCollateral: a.primary[1].account,
    guardBtc: a.guards[0].account, guardCollateral: a.guards[1].account,
    firstCapital: x.capital, firstRegistration: x.registration, firstProgram: x.pricingProgram, firstProgramData: x.programData, firstConfig: x.config,
    secondCapital: y.capital, secondRegistration: y.registration, secondProgram: y.pricingProgram, secondProgramData: y.programData, secondConfig: y.config }, a.options);
}
export function guardInstruction(a: DevnetContext, index: number, price: bigint, confidence: bigint, published: bigint): Instruction {
  const g = a.guards[index], b = Buffer.alloc(69);
  b.set(hash('global:publish').subarray(0, 8)); b.set(getAddressEncoder().encode(a.guardProgram), 8); b[40] = 2;
  b.writeBigInt64LE(price, 41); b.writeBigUInt64LE(confidence, 49); b.writeInt32LE(-6, 57); b.writeBigInt64LE(published, 61);
  return { programAddress: a.guardProgram, accounts: [{ address: a.guardAuthority.address, role: AccountRole.READONLY_SIGNER }, { address: g.account, role: AccountRole.WRITABLE }], data: b };
}
