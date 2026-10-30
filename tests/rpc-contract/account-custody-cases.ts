import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction, type ReadonlyUint8Array } from '@solana/kit';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';
import { TOKEN_PROGRAM_ADDRESS, getInitializeMint2Instruction, getInitializeAccount3Instruction,
  getMintToInstruction, getTokenDecoder, getTransferCheckedInstruction } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { fixtureKey, payerKey, addresses, type Harness } from './harness.js';

const keyBytes = getAddressEncoder();
const u16 = (value: number) => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; };
export const accountPda = async (...seeds: (string | ReadonlyUint8Array)[]) => (await getProgramDerivedAddress({
  programAddress: sdk.CLEARING_PROGRAM_ADDRESS, seeds: seeds.map(seed => typeof seed === 'string' ? Buffer.from(seed) : Uint8Array.from(seed)),
}))[0];
export const accountMarket = (venue: Address, index: number) => accountPda('market-v3', keyBytes.encode(venue), Uint8Array.of(index));

export async function accountCustodyCases(h: Harness) {
  const payer = await payerKey();
  const owner = await fixtureKey('p23-owner'), attacker = await fixtureKey('p23-attacker');
  const mint = await fixtureKey('p23-mint'), badMint = await fixtureKey('p23-bad-mint');
  const token = await fixtureKey('p23-token'), wrongOwnerToken = await fixtureKey('p23-wrong-owner-token');
  const deployment = await addresses();
  const domain = createHash('sha256').update('rivalt/p42/schema7/fresh-two-market-custody').digest();
  const venue = await accountPda('venue-v3', domain);
  const registry = await accountPda('registry-v3', keyBytes.encode(venue));
  const vault = await accountPda('vault-v3', keyBytes.encode(venue));
  const custody = await accountPda('custody-v3', keyBytes.encode(venue));
  const safety = await accountPda('safety-v3', keyBytes.encode(venue));
  const markets = [await accountMarket(venue, 0), await accountMarket(venue, 1)];
  const ledgers = await Promise.all(markets.map(market => accountPda('ledger-v3', keyBytes.encode(market))));
  const common = { venue, registry, vault, custody, safety, btcLedger: ledgers[0], ethLedger: ledgers[1], eventAuthority: deployment.eventAuthority, program: deployment.program };
  const admin = { ...common, authority: payer, programData: deployment.programData, quoteMint: mint.address,
    feeAuthority: owner.address, reserveAuthority: attacker.address, reserveDestinationOwner: attacker.address };
  const venueState = async () => {
    const ledgersNow = await Promise.all(ledgers.map(async key => sdk.getMarketLedgerDecoder().decode((await h.read(key))!)));
    const totalCash = (await Promise.all(roots.map(rootState))).reduce((sum, root) => sum + root.cash, 0n);
    return { totalCash, ...sdk.getVenueDecoder().decode((await h.read(venue))!),
      ...sdk.getCustodyDecoder().decode((await h.read(custody))!),
      ...sdk.getVenueSafetyDecoder().decode((await h.read(safety))!),
      insurance: ledgersNow.reduce((sum, ledger) => sum + ledger.insurance, 0n),
      settlement: ledgersNow.reduce((sum, ledger) => sum + ledger.settlement, 0n),
      fees: ledgersNow.reduce((sum, ledger) => sum + ledger.fees, 0n) };
  };
  const rootState = async (margin: Address) => sdk.getMarginAccountDecoder().decode((await h.read(margin))!);
  const roots: Address[] = [];
  const portfolios: Address[] = [];
  const tracked = [venue, custody, safety, registry, vault, token.address, ...markets, ...ledgers];
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
  await h.send('reject foreign upgrade authority', [await sdk.getInitializeLiquidityVenueInstructionAsync({ ...admin, domain, authority: attacker })], [attacker], 6102);
  await h.send('reject wrong venue collateral precision', [await sdk.getInitializeLiquidityVenueInstructionAsync({ ...admin, domain, quoteMint: badMint.address })], [], 6103);
  assert.equal(await h.read(venue), null);
  await h.send('initialize fresh clearing venue', [await sdk.getInitializeLiquidityVenueInstructionAsync({ ...admin, domain })]);
  await h.send('initialize complete venue registry', [await sdk.getInitializeVenueRegistryInstructionAsync(admin)]);
  await rejected('reject reversed market registration', [sdk.getInitializeMarketInstruction({ ...admin, index: 1, market: markets[1], ledger: ledgers[1] })], [], 6108);
  for (const index of [0, 1]) {
    await h.send(`initialize ${index === 0 ? 'BTC' : 'ETH'} market`, [sdk.getInitializeMarketInstruction({ ...admin, index, market: markets[index], ledger: ledgers[index] })]);
    const market = sdk.getMarketDecoder().decode((await h.read(markets[index]))!);
    assert.equal(market.venue, venue); assert.equal(market.index, index);
    assert.equal(market.lotsPerUnit, index === 0 ? 1_000_000n : 100_000n);
    assert.equal(market.fundingIndexScaled, 0n); assert.equal(market.crossEligible, true);
  }
  await rejected('reject third market', [sdk.getInitializeMarketInstruction({ ...admin, index: 2, market: await accountMarket(venue, 2),
      ledger: await accountPda('ledger-v3', keyBytes.encode(await accountMarket(venue, 2))) })], [], 6108);
  async function portfolio(index: number, signer = owner) {
    const address = await accountPda('portfolio-v3', keyBytes.encode(venue), keyBytes.encode(signer.address), u16(index));
    await h.send(`create portfolio ${index}`, [await sdk.getCreatePortfolioInstructionAsync({ ...common, owner: signer, portfolio: address, index })], [signer]);
    portfolios.push(address); return address;
  }
  const first = await portfolio(0), second = await portfolio(1), foreign = await portfolio(0, attacker);
  async function register(portfolio: Address, subaccountIndex: number, mode: number, isolatedMarketIndex: number, signer = owner, role = 0) {
    const margin = await accountPda('margin-v3', keyBytes.encode(portfolio), u16(subaccountIndex));
    await h.send(`register root ${roots.length}`, [await sdk.getRegisterMarginInstructionAsync({ ...common, owner: signer,
      portfolio, margin, subaccountIndex, mode, isolatedMarketIndex, role })], [signer]);
    roots.push(margin); return margin;
  }
  const cross = await register(first, 0, 0, 255), btc = await register(first, 1, 1, 0);
  const eth = await register(first, 2, 1, 1), separate = await register(second, 1, 1, 0);
  const otherOwner = await register(foreign, 0, 0, 255, attacker);
  for (const [subaccountIndex, mode, isolatedMarketIndex, role] of [[3,0,255,0],[0,1,0,0],[3,1,2,0],[9,1,0,0],[3,1,0,3]]) {
    const portfolio = subaccountIndex === 0 ? second : first;
    const margin = await accountPda('margin-v3', keyBytes.encode(portfolio), u16(subaccountIndex));
    await rejected('reject invalid immutable mode/identity', [await sdk.getRegisterMarginInstructionAsync({ ...common, owner, portfolio,
      margin, subaccountIndex, mode, isolatedMarketIndex, role })], [owner], 6108);
    assert.equal(await h.read(margin), null);
  }
  const crossMaker = await accountPda('margin-v3', keyBytes.encode(second), u16(0));
  await rejected('reject cross maker capital', [await sdk.getRegisterMarginInstructionAsync({ ...common, owner, portfolio: second,
    margin: crossMaker, subaccountIndex: 0, mode: 0, isolatedMarketIndex: 255, role: 1 })], [owner], 6108);
  const cash = { ...common, owner, quoteMint: mint.address, userToken: token.address };
  const transfer = { ...common, owner, donor: cross, recipient: btc };
  await h.send('deposit funded cash into cross root with trading disabled', [await sdk.getDepositAccountInstructionAsync({ ...cash, margin: cross, amount: 1_000_000n })], [owner]);
  await h.send('allocate isolated BTC cash', [await sdk.getTransferAccountCustodyInstructionAsync({ ...transfer, amount: 250_000n })], [owner]);
  await h.send('allocate isolated ETH cash', [await sdk.getTransferAccountCustodyInstructionAsync({ ...transfer, recipient: eth, amount: 300_000n })], [owner]);
  await h.send('explicit allocation across portfolios', [await sdk.getTransferAccountCustodyInstructionAsync({ ...transfer, donor: btc, recipient: separate, amount: 50_000n })], [owner]);
  await h.send('withdraw from independently funded ETH account', [await sdk.getWithdrawAccountCustodyInstructionAsync({ ...cash, margin: eth, amount: 100_000n })], [owner]);
  const expected = [450_000n, 200_000n, 200_000n, 50_000n, 0n];
  for (const [index, margin] of roots.entries()) {
    const state = await rootState(margin);
    assert.equal(state.cash, expected[index]); assert.equal(state.id, index);
    assert(state.positions.every(position => position.lots === 0n && position.virtualScaled === 0n && position.fundingCheckpointScaled === 0n));
  }
  assert.equal((await venueState()).totalCash, 900_000n);
  assert.equal(getTokenDecoder().decode((await h.read(vault))!).amount, 900_000n);
  await rejected('reject transfer to another owner', [await sdk.getTransferAccountCustodyInstructionAsync({ ...transfer, recipient: otherOwner, amount: 1n })], [owner], 2001);
  await rejected('reject root alias transfer', [await sdk.getTransferAccountCustodyInstructionAsync({ ...transfer, recipient: cross, amount: 1n })], [owner], 2040);
  await rejected('reject overdraw without sibling bailout', [await sdk.getWithdrawAccountCustodyInstructionAsync({ ...cash, margin: btc, amount: 200_001n })], [owner], 6100);
  await rejected('reject wrong token owner', [await sdk.getWithdrawAccountCustodyInstructionAsync({ ...cash, margin: btc, userToken: wrongOwnerToken.address, amount: 1n })], [owner], 2015);
  await rejected('reject amount bound', [await sdk.getDepositAccountInstructionAsync({ ...cash, margin: btc, amount: (1n << 64n)-1n })], [owner], 6100);
  await rejected('reject zero deposit', [await sdk.getDepositAccountInstructionAsync({ ...cash, margin: btc, amount: 0n })], [owner], 6106);
  await rejected('rollback transfer when subsequent withdrawal fails', [
    await sdk.getTransferAccountCustodyInstructionAsync({ ...transfer, recipient: separate, amount: 100n }),
    await sdk.getWithdrawAccountCustodyInstructionAsync({ ...cash, margin: separate, amount: 50_101n }),
  ], [owner], 6100);
  const signed = await sdk.getWithdrawAccountCustodyInstructionAsync({ ...cash, margin: btc, amount: 1n });
  await rejected('reject missing owner signature', [{ ...signed, accounts: signed.accounts.map((account, index) => index === 0 ? { address: account.address, role: 0 } : account) }], [], 3010);
  await rejected('reject extra unrecognized dependency', [{ ...signed, accounts: [...signed.accounts, { address: badMint.address, role: 0 }] }], [owner], 6108);
  await h.send('unsolicited seven atom token transfer', [getTransferCheckedInstruction({ source: token.address, mint: mint.address,
    destination: vault, authority: owner, amount: 7n, decimals: 6 })], [owner]);
  assert.equal((await venueState()).allocatedVault, 900_000n);
  await rejected('reject venue authority taking reserve authority', [await sdk.getClassifyMarketSurplusInstructionAsync({
    ...common, reserveAuthority: payer, ledger: ledgers[0], marketIndex: 0, amount: 7n })], [], 6102);
  await h.send('classify BTC surplus as insurance only', [await sdk.getClassifyMarketSurplusInstructionAsync({
    ...common, reserveAuthority: attacker, ledger: ledgers[0], marketIndex: 0, amount: 7n })], [attacker]);
  await rejected('reject duplicate surplus classification', [await sdk.getClassifyMarketSurplusInstructionAsync({
    ...common, reserveAuthority: attacker, ledger: ledgers[1], marketIndex: 1, amount: 1n })], [attacker], 6106);
  await rejected('reject foreign ledger alias', [await sdk.getDepositAccountInstructionAsync({
    ...cash, ethLedger: ledgers[0], margin: btc, amount: 1n })], [owner], 2040);
  await rejected('reject unapproved insurance donor attribution', [await sdk.getSeedMarketInsuranceInstructionAsync({
    ...common, reserveAuthority: payer, ledger: ledgers[1], donor: owner, donorToken: token.address, quoteMint: mint.address,
    marketIndex: 1, amount: 11n })], [owner], 6102);
  await h.send('seed ETH insurance with actual donor tokens', [await sdk.getSeedMarketInsuranceInstructionAsync({
    ...common, reserveAuthority: attacker, ledger: ledgers[1], donor: owner, donorToken: token.address, quoteMint: mint.address,
    marketIndex: 1, amount: 11n })], [owner, attacker]);
  const reserveStates = await Promise.all(ledgers.map(async key => sdk.getMarketLedgerDecoder().decode((await h.read(key))!)));
  assert.deepEqual(reserveStates.map(ledger => ledger.insurance), [7n, 11n]);
  assert(reserveStates.every(ledger => ledger.insuranceFeeRemainder === 0 && ledger.fees === 0n && ledger.settlement === 0n));
  await h.send('pause venue custody', [await sdk.getPauseVenueInstructionAsync({ ...admin, paused: true })]);
  await rejected('paused deposit', [await sdk.getDepositAccountInstructionAsync({ ...cash, margin: btc, amount: 1n })], [owner], 6101);
  await rejected('paused transfer', [await sdk.getTransferAccountCustodyInstructionAsync({ ...transfer, amount: 1n })], [owner], 6101);
  await rejected('paused withdrawal', [signed], [owner], 6101);
  await h.send('unpause reconciled venue', [await sdk.getPauseVenueInstructionAsync({ ...admin, paused: false })]);
  for (const [index, margin] of roots.slice(0, 4).entries()) {
    await h.send(`exit funded root ${index}`, [await sdk.getWithdrawAccountCustodyInstructionAsync({ ...cash, margin, amount: expected[index] })], [owner]);
  }
  const final = await venueState();
  assert.equal(final.totalCash, 0n); assert.equal(final.allocatedVault, 18n);
  assert.equal(final.insurance, 18n); assert.equal(final.settlement, 0n); assert.equal(final.fees, 0n);
  assert.equal(final.mode, 0); assert.equal(final.marketCount, 2);
  assert.deepEqual(final.markets, markets);
  assert.equal(getTokenDecoder().decode((await h.read(vault))!).amount, 18n);
  assert.equal(getTokenDecoder().decode((await h.read(token.address))!).amount, 1_999_982n);
  const membership = sdk.getVenueRegistryDecoder().decode((await h.read(registry))!);
  assert.deepEqual(membership.members, roots);
  return { venue, registry, vault, custody, safety, ledgers, markets, roots, portfolios, quoteMint: mint.address, userToken: token.address,
    owner: owner.address, final, tokenAtoms: '1999982', insuranceAtoms: '18' };
}
