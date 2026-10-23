import assert from 'node:assert/strict';
import { getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import { Keypair } from '@solana/web3.js';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';
import { TOKEN_PROGRAM_ADDRESS, getInitializeAccount3Instruction, getMintToInstruction, getTokenDecoder } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { addresses, fixtureKey, LOADER, payerKey, type Harness } from './custody-cases.js';

export type MakerHarness = Omit<Harness, 'send'> & {
  send(label: string, instructions: Instruction[], signers?: Keypair[], expectedError?: number | 'reject'): Promise<void>;
  quote(label: string, instruction: Instruction): Promise<{ producer: Address; data: Uint8Array }>;
  slot(): Promise<bigint>;
  waitUntil(slot: bigint): Promise<void>;
};
export const makerIds = [sdk.makerA.MAKER_A_PROGRAM_ADDRESS, sdk.makerB.MAKER_B_PROGRAM_ADDRESS];
export async function makerAddresses(id: number) {
  const a = await addresses(), owner = await fixtureKey(`maker-owner-${id}`), token = await fixtureKey(`maker-token-${id}`);
  const [capital] = await sdk.findParticipantPda({ market: a.market, owner: owner.address });
  const [registration] = await getProgramDerivedAddress({ programAddress: a.program, seeds: [Buffer.from('maker'), getAddressEncoder().encode(a.market), Uint8Array.of(id)] });
  const pricingProgram = makerIds[id];
  const [config] = await getProgramDerivedAddress({ programAddress: pricingProgram, seeds: [Buffer.from('maker'), getAddressEncoder().encode(capital)] });
  const [programData] = await getProgramDerivedAddress({ programAddress: LOADER, seeds: [getAddressEncoder().encode(pricingProgram)] });
  return { ...a, owner, token, capital, registration, config, pricingProgram, programData };
}
export async function makerCases(h: MakerHarness) {
  const payer = await payerKey(), mint = await fixtureKey('mint');
  const makers = await Promise.all([0, 1].map(makerAddresses));
  const market = async () => sdk.getMarketStateDecoder().decode((await h.read(makers[0].market))!);
  const state = async (id: number) => sdk.makerA.getMakerConfigDecoder().decode((await h.read(makers[id].config))!).state;
  const registration = async (id: number) => sdk.getMakerRegistrationDecoder().decode((await h.read(makers[id].registration))!);
  const domain = (await market()).domain;
  for (const [id, a] of makers.entries()) {
    await h.send(`fund maker ${id} rent and register real participant`, [
      getTransferSolInstruction({ source: payer, destination: a.owner.address, amount: 1_000_000_000n }),
      await sdk.getRegisterParticipantInstructionAsync({ ...a, owner: a.owner }),
      getCreateAccountInstruction({ payer, newAccount: a.token, lamports: await h.rent(165), space: 165n, programAddress: TOKEN_PROGRAM_ADDRESS }),
      getInitializeAccount3Instruction({ account: a.token.address, mint: mint.address, owner: a.owner.address }),
      getMintToInstruction({ mint: mint.address, token: a.token.address, mintAuthority: payer, amount: 1_000_000_000n }),
    ], [a.owner, a.token]);
    const api = id === 0 ? sdk.makerA : sdk.makerB;
    const beforeCapital = await h.read(a.capital);
    await h.send(`reject unrelated signer claiming maker ${id} config`, [await api.getInitializeConfigInstructionAsync({ ...a, owner: payer, domain, duration: 3600n })], [], 6000);
    assert.equal(await h.read(a.config), null);
    assert.deepEqual(await h.read(a.capital), beforeCapital);
    if (id === 0) {
      await h.send('reject maker epoch shorter than profile minimum', [await api.getInitializeConfigInstructionAsync({ ...a, domain, duration:63n })], [a.owner], 6002);
      assert.equal(await h.read(a.config), null);
    }
    await h.send(`initialize maker ${id} config`, [await api.getInitializeConfigInstructionAsync({ ...a, domain, duration: 3600n })], [a.owner]);
  }
  const [a, b] = makers;
  const register = (id: number) => sdk.getRegisterMakerInstructionAsync({ ...makers[id], authority: payer, makerId: id, inventoryLimit: 100_000n });
  await h.send('reject unfunded capital', [await register(0)], [a.owner], 6111);
  assert.equal(await h.read(a.registration), null);
  for (const [id, x] of makers.entries()) {
    await h.send(`deposit maker ${id} capital through real SPL CPI`, [await sdk.getDepositInstructionAsync({ ...x, participant: x.capital, quoteMint: mint.address, userToken: x.token.address, amount: 500_000_000n })], [x.owner]);
  }
  await h.send('reject unauthorized maker registration', [await sdk.getRegisterMakerInstructionAsync({ ...a, authority: b.owner, makerId: 0, inventoryLimit: 100_000n })], [a.owner, b.owner], 2001);
  await h.send('reject wrong pricing module', [await sdk.getRegisterMakerInstructionAsync({ ...a, authority: payer, makerId: 0, inventoryLimit: 100_000n, pricingProgram: b.pricingProgram, programData: b.programData })], [a.owner], 6110);
  await h.send('register funded maker A', [await register(0)], [a.owner]);
  const [aliasConfig] = await sdk.makerB.findConfigPda({ capital: a.capital });
  await h.send('provision alternate B config for already bound capital', [await sdk.makerB.getInitializeConfigInstructionAsync({ owner: a.owner, capital: a.capital, market: a.market, domain, duration: 3600n })], [a.owner]);
  const beforeAlias = await h.read(a.registration);
  await h.send('reject reusing capital across maker modules', [await sdk.getRegisterMakerInstructionAsync({ ...b, capital: a.capital, owner: a.owner, config: aliasConfig, authority: payer, makerId: 1, inventoryLimit: 100_000n })], [a.owner], 'reject');
  assert.deepEqual(await h.read(a.registration), beforeAlias); assert.equal(await h.read(b.registration), null);
  await h.send('register funded maker B', [await register(1)], [b.owner]);

  async function previewInput(id: number, side = 0, lots = 10n) {
    const m = await market(), r = await registration(id);
    return { ...makers[id], side, lots, referencePrice: 60_000n, quoteEpoch: r.quoteEpoch,
      authorityEpoch: r.authorityEpoch, termsEpoch: m.termsEpoch, configEpoch: m.configEpoch };
  }
  const quoted: { id: number; side: number; lots: string; gross: string }[] = [];
  for (const id of [0, 1]) for (const side of [0, 1]) for (const lots of [10n, 100n, id === 0 ? 512n : 4096n]) {
    const input = await previewInput(id, side, lots), s = await state(id);
    const accounts = [input.market, input.capital, input.registration, input.config];
    const before = await Promise.all(accounts.map(k => h.read(k)));
    const result = await h.quote(`clearing maker ${id} side ${side} size ${lots}`, await sdk.getPreviewMakerInstructionAsync(input));
    assert.equal(result.producer, sdk.CLEARING_PROGRAM_ADDRESS);
    const response = sdk.makerA.getQuoteResponseDecoder().decode(result.data);
    const expected = sdk.quoteMaker(s, { version: 1, domain, market: input.market, capital: input.capital,
      quoteEpoch: s.quoteEpoch, authorityEpoch: input.authorityEpoch, termsEpoch: input.termsEpoch, marketConfigEpoch: input.configEpoch,
      side, lots, inventory: 0n, cash: 500_000_000n, inventoryLimit: 100_000n, consumed: 0n, referencePrice: 60_000n, slot: s.startSlot });
    assert.deepEqual(response, expected);
    assert.deepEqual(await Promise.all(accounts.map(k => h.read(k))), before, 'quote modified authoritative state');
    quoted.push({ id, side, lots: lots.toString(), gross: response.grossQuote.toString() });
  }
  assert.equal(quoted.find(x => x.id === 0 && x.side === 0 && x.lots === '10')!.gross, '600145');
  assert.equal(quoted.find(x => x.id === 1 && x.side === 0 && x.lots === '100')!.gross, '6003000');
  // Hypothetical direct quote snapshots, not injected positions or successful fills.
  for (const id of [0, 1]) for (const inventory of [-128n, 128n]) {
    const s = await state(id), api = id === 0 ? sdk.makerA : sdk.makerB;
    const request = { version: 1, domain, market: a.market, capital: makers[id].capital, quoteEpoch: s.quoteEpoch,
      authorityEpoch: 1n, termsEpoch: 1n, marketConfigEpoch: 1n, side: 0, lots: 10n, inventory, cash: 500_000_000n,
      inventoryLimit: 100_000n, consumed: 300n, referencePrice: 60_000n, slot: s.startSlot };
    const result = await h.quote(`hypothetical maker ${id} inventory ${inventory} prefix 300`, api.getQuoteInstruction({ config: makers[id].config, ...request }));
    assert.equal(result.producer, makers[id].pricingProgram);
    assert.deepEqual(api.getQuoteResponseDecoder().decode(result.data), sdk.quoteMaker(s, request));
  }
  await h.send('withdraw maker cash through ordinary owner authority', [await sdk.getWithdrawInstructionAsync({ ...a, participant:a.capital, quoteMint:mint.address, userToken:a.token.address, amount:500_000_000n })], [a.owner]);
  await h.send('reject quote after capital withdrawal', [await sdk.getPreviewMakerInstructionAsync(await previewInput(0))], [], 6111);
  await h.send('restore maker cash by real deposit', [await sdk.getDepositInstructionAsync({ ...a, participant:a.capital, quoteMint:mint.address, userToken:a.token.address, amount:500_000_000n })], [a.owner]);
  const original = await previewInput(0);
  await h.send('reject stale quote epoch', [await sdk.getPreviewMakerInstructionAsync({ ...original, quoteEpoch: 2n })], [], 6112);
  await h.send('reject wrong capital account', [await sdk.getPreviewMakerInstructionAsync({ ...original, capital: b.capital })], [], 2001);
  await h.send('reject config/capital role alias', [await sdk.getPreviewMakerInstructionAsync({ ...original, config: a.capital })], [], 2001);
  await h.send('reject exceeded maker depth', [await sdk.getPreviewMakerInstructionAsync({ ...original, lots: 513n })], [], 6115);
  await h.send('reject early epoch publication', [sdk.makerA.getPublishEpochInstruction({ owner: a.owner, config: a.config, duration: 64n })], [a.owner], 6002);
  await h.send('reject same-epoch consumption reset', [await sdk.getSyncMakerEpochInstructionAsync(a)], [], 6112);
  await h.send('quarantine maker A', [await sdk.getQuarantineMakerInstructionAsync({ ...a, authority: payer })]);
  await h.send('reject quarantined maker', [await sdk.getPreviewMakerInstructionAsync(original)], [], 6113);
  await h.send('reject approval without capital owner', [await sdk.getApproveMakerInstructionAsync({ ...a, owner: b.owner, authority: payer })], [b.owner], 2006);
  await h.send('jointly approve and reactivate maker A', [await sdk.getApproveMakerInstructionAsync({ ...a, authority: payer })], [a.owner]);
  await h.send('reject stale authority epoch after approval', [await sdk.getPreviewMakerInstructionAsync(original)], [], 6112);
  assert.equal((await registration(0)).buyConsumed, 0n);
  const end = (await state(0)).expirySlot;
  await h.waitUntil(end);
  await h.send('reject expired quote', [await sdk.getPreviewMakerInstructionAsync(await previewInput(0))], [], 6115);
  await h.send('publish next maker epoch after exclusive expiry', [sdk.makerA.getPublishEpochInstruction({ owner: a.owner, config: a.config, duration: 3600n })], [a.owner]);
  await h.send('reject unsynchronized config epoch', [await sdk.getPreviewMakerInstructionAsync(await previewInput(0))], [], 6112);
  await h.send('sync owner-published next epoch', [await sdk.getSyncMakerEpochInstructionAsync(a)]);
  assert.equal((await registration(0)).quoteEpoch, 2n);
  await h.quote('quote after authorized epoch sync', await sdk.getPreviewMakerInstructionAsync(await previewInput(0)));
  await h.send('reject replayed epoch sync', [await sdk.getSyncMakerEpochInstructionAsync(a)], [], 6112);
  const finalMarket = await market();
  assert.equal(finalMarket.totalCash, 1_000_000_000n);assert.equal(finalMarket.settlement, 0n);assert.equal(finalMarket.fees, 0n);
  const vault = getTokenDecoder().decode((await h.read(a.vault))!);
  assert.equal(vault.owner, a.market); assert.equal(vault.mint, mint.address);
  assert.equal(vault.amount, finalMarket.allocatedVault);
  assert.equal(vault.amount, finalMarket.totalCash + finalMarket.settlement + finalMarket.insurance + finalMarket.fees);
  for (const x of makers) { const p = sdk.getParticipantDecoder().decode((await h.read(x.capital))!);assert.equal(p.cash,500_000_000n);assert.equal(p.lots,0n);assert.equal(p.virtualScaled,0n); }
  return { quoted, registrations: await Promise.all([0, 1].map(registration)), configs: await Promise.all([0, 1].map(state)), finalMarket, actualVaultAtoms: vault.amount };
}
