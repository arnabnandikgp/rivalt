import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction, type ReadonlyUint8Array } from '@solana/kit';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';
import { TOKEN_PROGRAM_ADDRESS, getInitializeMint2Instruction, getInitializeAccount3Instruction,
  getMintToInstruction, getTokenDecoder, getTransferCheckedInstruction } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { fixtureKey, payerKey, addresses, type Harness } from './custody-cases.js';

const keyBytes = getAddressEncoder();
const u16 = (value: number) => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; };
export const groupPda = async (...seeds: (string | ReadonlyUint8Array)[]) => (await getProgramDerivedAddress({
  programAddress: sdk.CLEARING_PROGRAM_ADDRESS, seeds: seeds.map(seed => typeof seed === 'string' ? Buffer.from(seed) : Uint8Array.from(seed)),
}))[0];
export const groupMarket = (group: Address, index: number) => groupPda('market-v2', keyBytes.encode(group), Uint8Array.of(index));

export async function groupCustodyCases(h: Harness) {
  const payer = await payerKey();
  const owner = await fixtureKey('p18a-owner'), attacker = await fixtureKey('p18a-attacker');
  const mint = await fixtureKey('p18a-mint'), badMint = await fixtureKey('p18a-bad-mint');
  const token = await fixtureKey('p18a-token'), wrongOwnerToken = await fixtureKey('p18a-wrong-owner-token');
  const deployment = await addresses();
  const domain = createHash('sha256').update('rivalt/p18a/fresh-two-market-custody').digest();
  const group = await groupPda('group-v2', domain);
  const registry = await groupPda('registry-v2', keyBytes.encode(group));
  const vault = await groupPda('vault-v2', keyBytes.encode(group));
  const common = { group, registry, vault, eventAuthority: deployment.eventAuthority, program: deployment.program };
  const admin = { ...common, authority: payer, programData: deployment.programData, quoteMint: mint.address };
  const groupState = async () => sdk.getClearingGroupV2Decoder().decode((await h.read(group))!);
  const rootState = async (margin: Address) => sdk.getMarginAccountV2Decoder().decode((await h.read(margin))!);
  const roots: Address[] = [];
  const portfolios: Address[] = [];
  const tracked = [group, registry, vault, token.address];
  const snapshot = async () => Promise.all([...tracked, ...roots, ...portfolios].map(async key => (await h.read(key))?.toString('hex') ?? null));
  async function rejected(label: string, instructions: Instruction[], signers: Awaited<ReturnType<typeof fixtureKey>>[], error: number) {
    const before = await snapshot();
    await h.send(label, instructions, signers, error);
    assert.deepEqual(await snapshot(), before, `${label}: committed financial/registry bytes changed`);
  }
  await h.send('fixture owner rent funds', [owner, attacker].map(account => getTransferSolInstruction({
    source: payer, destination: account.address, amount: 1_000_000_000n,
  })));
  for (const [key, decimals] of [[mint, 6], [badMint, 9]] as const) {
    await h.send(`fixture mint ${decimals}`, [getCreateAccountInstruction({ payer, newAccount: key,
      lamports: await h.rent(82), space: 82n, programAddress: TOKEN_PROGRAM_ADDRESS }),
    getInitializeMint2Instruction({ mint: key.address, decimals, mintAuthority: payer.address })], [key]);
  }
  for (const [key, authority, amount] of [[token, owner.address, 2_000_000n], [wrongOwnerToken, attacker.address, 0n]] as const) {
    await h.send('fixture token account', [getCreateAccountInstruction({ payer, newAccount: key,
      lamports: await h.rent(165), space: 165n, programAddress: TOKEN_PROGRAM_ADDRESS }),
    getInitializeAccount3Instruction({ account: key.address, mint: mint.address, owner: authority }),
    getMintToInstruction({ mint: mint.address, token: key.address, mintAuthority: payer, amount })], [key]);
  }
  await h.send('reject foreign upgrade authority', [await sdk.getInitializeGroupV2InstructionAsync({ ...admin, domain, authority: attacker })], [attacker], 6102);
  await h.send('reject wrong group collateral precision', [await sdk.getInitializeGroupV2InstructionAsync({ ...admin, domain, quoteMint: badMint.address })], [], 6103);
  assert.equal(await h.read(group), null);
  await h.send('initialize fresh clearing group', [await sdk.getInitializeGroupV2InstructionAsync({ ...admin, domain })]);
  const markets = [await groupMarket(group, 0), await groupMarket(group, 1)];
  await rejected('reject reversed market registration', [sdk.getInitializeGroupMarketV2Instruction({ ...admin, index: 1, market: markets[1] })], [], 6108);
  for (const index of [0, 1]) {
    await h.send(`initialize ${index === 0 ? 'BTC' : 'ETH'} market`, [sdk.getInitializeGroupMarketV2Instruction({ ...admin, index, market: markets[index] })]);
    const market = sdk.getGroupMarketV2Decoder().decode((await h.read(markets[index]))!);
    assert.equal(market.group, group); assert.equal(market.index, index);
    assert.equal(market.lotsPerUnit, index === 0 ? 1_000_000n : 100_000n);
    assert.equal(market.fundingIndexScaled, 0n);
  }
  await rejected('reject third market', [sdk.getInitializeGroupMarketV2Instruction({ ...admin, index: 2, market: await groupMarket(group, 2) })], [], 6108);
  async function portfolio(index: number, signer = owner) {
    const address = await groupPda('portfolio-v2', keyBytes.encode(group), keyBytes.encode(signer.address), u16(index));
    await h.send(`create portfolio ${index}`, [await sdk.getCreatePortfolioV2InstructionAsync({ ...common, owner: signer, portfolio: address, index })], [signer]);
    portfolios.push(address); return address;
  }
  const first = await portfolio(0), second = await portfolio(1), foreign = await portfolio(0, attacker);
  async function register(portfolio: Address, subaccountIndex: number, mode: number, isolatedMarketIndex: number, signer = owner, role = 0) {
    const margin = await groupPda('margin-v2', keyBytes.encode(portfolio), u16(subaccountIndex));
    await h.send(`register root ${roots.length}`, [await sdk.getRegisterMarginV2InstructionAsync({ ...common, owner: signer,
      portfolio, margin, subaccountIndex, mode, isolatedMarketIndex, role })], [signer]);
    roots.push(margin); return margin;
  }
  const cross = await register(first, 0, 0, 255), btc = await register(first, 1, 1, 0);
  const eth = await register(first, 2, 1, 1), separate = await register(second, 1, 1, 0);
  const otherOwner = await register(foreign, 0, 0, 255, attacker);
  for (const [subaccountIndex, mode, isolatedMarketIndex, role] of [[3,0,255,0],[0,1,0,0],[3,1,2,0],[9,1,0,0],[3,1,0,3]]) {
    const portfolio = subaccountIndex === 0 ? second : first;
    const margin = await groupPda('margin-v2', keyBytes.encode(portfolio), u16(subaccountIndex));
    await rejected('reject invalid immutable mode/identity', [await sdk.getRegisterMarginV2InstructionAsync({ ...common, owner, portfolio,
      margin, subaccountIndex, mode, isolatedMarketIndex, role })], [owner], 6108);
    assert.equal(await h.read(margin), null);
  }
  const crossMaker = await groupPda('margin-v2', keyBytes.encode(second), u16(0));
  await rejected('reject cross maker capital', [await sdk.getRegisterMarginV2InstructionAsync({ ...common, owner, portfolio: second,
    margin: crossMaker, subaccountIndex: 0, mode: 0, isolatedMarketIndex: 255, role: 1 })], [owner], 6108);
  const cash = { ...common, owner, quoteMint: mint.address, userToken: token.address };
  const transfer = { ...common, owner, donor: cross, recipient: btc };
  await h.send('deposit funded cash into cross root with trading disabled', [await sdk.getDepositGroupV2InstructionAsync({ ...cash, margin: cross, amount: 1_000_000n })], [owner]);
  await h.send('allocate isolated BTC cash', [await sdk.getTransferGroupCustodyV2InstructionAsync({ ...transfer, amount: 250_000n })], [owner]);
  await h.send('allocate isolated ETH cash', [await sdk.getTransferGroupCustodyV2InstructionAsync({ ...transfer, recipient: eth, amount: 300_000n })], [owner]);
  await h.send('explicit allocation across portfolios', [await sdk.getTransferGroupCustodyV2InstructionAsync({ ...transfer, donor: btc, recipient: separate, amount: 50_000n })], [owner]);
  await h.send('withdraw from independently funded ETH account', [await sdk.getWithdrawGroupCustodyV2InstructionAsync({ ...cash, margin: eth, amount: 100_000n })], [owner]);
  const expected = [450_000n, 200_000n, 200_000n, 50_000n, 0n];
  for (const [index, margin] of roots.entries()) {
    const state = await rootState(margin);
    assert.equal(state.cash, expected[index]); assert.equal(state.id, index);
    assert(state.positions.every(position => position.lots === 0n && position.virtualScaled === 0n && position.fundingCheckpointScaled === 0n));
  }
  assert.equal((await groupState()).totalCash, 900_000n);
  assert.equal(getTokenDecoder().decode((await h.read(vault))!).amount, 900_000n);
  await rejected('reject transfer to another owner', [await sdk.getTransferGroupCustodyV2InstructionAsync({ ...transfer, recipient: otherOwner, amount: 1n })], [owner], 2001);
  await rejected('reject root alias transfer', [await sdk.getTransferGroupCustodyV2InstructionAsync({ ...transfer, recipient: cross, amount: 1n })], [owner], 2040);
  await rejected('reject overdraw without sibling bailout', [await sdk.getWithdrawGroupCustodyV2InstructionAsync({ ...cash, margin: btc, amount: 200_001n })], [owner], 6100);
  await rejected('reject wrong token owner', [await sdk.getWithdrawGroupCustodyV2InstructionAsync({ ...cash, margin: btc, userToken: wrongOwnerToken.address, amount: 1n })], [owner], 2015);
  await rejected('reject amount bound', [await sdk.getDepositGroupV2InstructionAsync({ ...cash, margin: btc, amount: (1n << 64n)-1n })], [owner], 6100);
  await rejected('reject zero deposit', [await sdk.getDepositGroupV2InstructionAsync({ ...cash, margin: btc, amount: 0n })], [owner], 6106);
  await rejected('rollback transfer when subsequent withdrawal fails', [
    await sdk.getTransferGroupCustodyV2InstructionAsync({ ...transfer, recipient: separate, amount: 100n }),
    await sdk.getWithdrawGroupCustodyV2InstructionAsync({ ...cash, margin: separate, amount: 50_101n }),
  ], [owner], 6100);
  const signed = await sdk.getWithdrawGroupCustodyV2InstructionAsync({ ...cash, margin: btc, amount: 1n });
  await rejected('reject missing owner signature', [{ ...signed, accounts: signed.accounts.map((account, index) => index === 0 ? { address: account.address, role: 0 } : account) }], [], 3010);
  await rejected('reject extra unrecognized dependency', [{ ...signed, accounts: [...signed.accounts, { address: badMint.address, role: 0 }] }], [owner], 6108);
  await h.send('unsolicited seven atom token transfer', [getTransferCheckedInstruction({ source: token.address, mint: mint.address,
    destination: vault, authority: owner, amount: 7n, decimals: 6 })], [owner]);
  assert.equal((await groupState()).allocatedVault, 900_000n);
  await h.send('classify group surplus as insurance only', [await sdk.getClassifyGroupSurplusV2InstructionAsync(admin)]);
  await h.send('pause group custody', [await sdk.getPauseGroupCustodyV2InstructionAsync({ ...admin, paused: true })]);
  await rejected('paused deposit', [await sdk.getDepositGroupV2InstructionAsync({ ...cash, margin: btc, amount: 1n })], [owner], 6101);
  await rejected('paused transfer', [await sdk.getTransferGroupCustodyV2InstructionAsync({ ...transfer, amount: 1n })], [owner], 6101);
  await rejected('paused withdrawal', [signed], [owner], 6101);
  await h.send('unpause reconciled group', [await sdk.getPauseGroupCustodyV2InstructionAsync({ ...admin, paused: false })]);
  for (const [index, margin] of roots.slice(0, 4).entries()) {
    await h.send(`exit funded root ${index}`, [await sdk.getWithdrawGroupCustodyV2InstructionAsync({ ...cash, margin, amount: expected[index] })], [owner]);
  }
  const final = await groupState();
  assert.equal(final.totalCash, 0n); assert.equal(final.allocatedVault, 7n);
  assert.equal(final.insurance, 7n); assert.equal(final.settlement, 0n); assert.equal(final.fees, 0n);
  assert.equal(final.mode, 0); assert.equal(final.marketCount, 2);
  assert.deepEqual(final.markets, markets);
  assert.equal(getTokenDecoder().decode((await h.read(vault))!).amount, 7n);
  assert.equal(getTokenDecoder().decode((await h.read(token.address))!).amount, 1_999_993n);
  const membership = sdk.getGroupRegistryV2Decoder().decode((await h.read(registry))!);
  assert.deepEqual(membership.members, roots);
  return { group, registry, vault, markets, roots, portfolios, quoteMint: mint.address, userToken: token.address,
    owner: owner.address, final, tokenAtoms: '1999993', insuranceAtoms: '7' };
}
