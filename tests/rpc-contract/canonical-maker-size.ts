// Offline wire measurement using the same addresses and generated instructions as
// canonical-maker-cases. This is serialization evidence, not RPC execution evidence.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { blockhash, getAddressEncoder, getProgramDerivedAddress, type ReadonlyUint8Array } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { fixtureKey, payerKey, addresses, LOADER } from './custody-cases.js';
import { accountPda, accountMarket } from './account-custody-cases.js';
import { goldenShape } from './canonical-maker-cases.js';
const payer = await payerKey(), owner = await fixtureKey('p30-owner'), updater = await fixtureKey('p30-updater');
const keyBytes = getAddressEncoder();
const domain = createHash('sha256').update('rivalt/p30/canonical-makers/profile4').digest();
const venue = await accountPda('venue-v3', domain), market = await accountMarket(venue, 0);
const portfolio = await accountPda('portfolio-v3', keyBytes.encode(venue), keyBytes.encode(owner.address), Uint8Array.of(0,0));
const capital = await accountPda('margin-v3', keyBytes.encode(portfolio), Uint8Array.of(1,0));
const pricingProgram = sdk.makerA.MAKER_A_PROGRAM_ADDRESS;
const makerPda = async (...seeds: ReadonlyUint8Array[]) => (await getProgramDerivedAddress({ programAddress: pricingProgram, seeds }))[0];
const config = await makerPda(Buffer.from('curve-v4'), keyBytes.encode(capital));
const price = await makerPda(Buffer.from('price-v4'), keyBytes.encode(config));
const makerEventAuthority = await makerPda(Buffer.from('__event_authority'));
const [programData] = await getProgramDerivedAddress({ programAddress: LOADER, seeds: [keyBytes.encode(pricingProgram)] });
const deployment = await addresses();
const control = { actor: owner, venue, market, capital, config, price, pricingProgram, programData, makerEventAuthority,
  controller: await accountPda('liquidity-control-v4', keyBytes.encode(venue), keyBytes.encode(capital)),
  custody: await accountPda('custody-v3', keyBytes.encode(venue)), safety: await accountPda('safety-v3', keyBytes.encode(venue)),
  registration: await accountPda('maker-v4', keyBytes.encode(market), Uint8Array.of(0)),
  eventAuthority: deployment.eventAuthority, program: deployment.program };
const maker = { config, price, eventAuthority: makerEventAuthority, program: pricingProgram };
const cases = [
  ['full-shape-control', sdk.getControlLiquidityInstruction({ ...control, expectedAuthority: 1n, expectedControl: 1n,
    expectedShape: 1n, action: { __kind: 'Shape', fields: [goldenShape] } }), [owner], 400_000],
  ['curve-initialization', await sdk.makerA.getInitializeCurveInstructionAsync({ ...maker, owner, venue, market, capital,
    instance: 0, shape: goldenShape, updater: updater.address, expiry: 1_000_000n }), [owner], 400_000],
  ['pure-reprice', sdk.makerA.getRepriceInstruction({ ...maker, actor: owner, expectedControl: 1n, expectedSequence: 0n, anchor: 100n }), [owner], 100_000],
  ['joint-code-approval', sdk.getApproveLiquidityInstruction({ ...control, coSigner: payer, expectedAuthority: 2n }), [owner], 400_000],
] as const;
const results = [];
for (const [label, instruction, signers, computeUnitLimit] of cases) {
  const { transaction, v0Bytes, wireBytes } = await sdk.signCanonicalInstructions({ getLatestBlockhash: async () => ({
    blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n }) }, payer, [instruction],
    { computeUnitLimit, loadedAccountsDataSizeLimit: 8 * 1024 * 1024 }, [...signers]);
  results.push({ label, v0Bytes, aboveV0Limit: Math.max(v0Bytes - 1232, 0), selectedVersion: transaction.version,
    wireBytes, signatures: transaction.signatures.length, instructionDataBytes: instruction.data!.length,
    accounts: transaction.message.staticAccountKeys.length });
}
const report = { scope: 'offline signed serialization; no RPC execution claimed', results };
writeFileSync('.local/canonical-maker/packet-sizes.json', JSON.stringify(report, null, 2)+'\n');
console.log(JSON.stringify(report, null, 2));
