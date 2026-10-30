// Mathematical pricing fixtures only. These inserted config/publication accounts
// prove real SBF quote evaluation, not deposits, fills or reachable financial state.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { address, getAddressEncoder, getProgramDerivedAddress, getTransactionDecoder, lamports } from '@solana/kit';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import * as sdk from '@rivalt/sdk';
import { fixtureKey } from './custody-cases.js';
const svm = new LiteSVM().withSigverify(true).withBlockhashCheck(true);
const payer = await fixtureKey('p30-sbf-parity');
svm.airdrop(payer.address, lamports(100_000_000_000n));
const clock = svm.getClock(); clock.unixTimestamp = 1_800_000_000n; clock.slot = 100n; svm.setClock(clock);
const keyBytes = getAddressEncoder();
const module = process.env.RIVALT_CANONICAL_PROGRAM === 'maker_b' ? sdk.makerB : sdk.makerA;
const program = process.env.RIVALT_CANONICAL_PROGRAM === 'maker_b' ? sdk.makerB.MAKER_B_PROGRAM_ADDRESS : sdk.makerA.MAKER_A_PROGRAM_ADDRESS;
svm.addProgramFromFile(program, `.local/canonical-maker/${process.env.RIVALT_CANONICAL_PROGRAM ?? 'maker_a'}.so`);
const [config, configBump] = await getProgramDerivedAddress({ programAddress: program, seeds: [Buffer.from('curve-v4'), keyBytes.encode(payer.address)] });
const [price, priceBump] = await getProgramDerivedAddress({ programAddress: program, seeds: [Buffer.from('price-v4'), keyBytes.encode(config)] });
const domain = new Uint8Array(32).fill(30);
for (const line of readFileSync(0, 'utf8').trim().split('\n')) {
  const [shapeHex, anchor, side, lots, inventory, consumed] = line.split(' ');
  const shape = module.getLiquidityShapeDecoder().decode(Buffer.from(shapeHex, 'hex'));
  const configData = module.getMakerCurveEncoder().encode({ state: { schemaVersion: 4,
    venue: payer.address, market: payer.address, capital: payer.address, controller: payer.address,
    owner: payer.address, updater: address('11111111111111111111111111111111'), updaterExpirySlot: 0n,
    controlEpoch: 1n, shapeEpoch: 1n, domain, instance: 0, capability: 1, shape, bump: configBump } });
  const priceData = module.getMakerPriceEncoder().encode({ state: { schemaVersion: 4, config, controlEpoch: 1n,
    sequence: 1n, anchor: BigInt(anchor), updatedSlot: clock.slot, updatedTime: clock.unixTimestamp, bump: priceBump } });
  for (const [key, data] of [[config, configData], [price, priceData]] as const) svm.setAccount({ address: key,
    data, executable: false, lamports: lamports(svm.minimumBalanceForRentExemption(BigInt(data.length))),
    programAddress: program, space: BigInt(data.length) });
  svm.expireBlockhash();
  const instruction = module.getQuoteCurveInstruction({ config, price, request: { version: 4, domain,
    market: payer.address, capital: payer.address, instance: 0, authorityEpoch: 1n, controlEpoch: 1n,
    shapeEpoch: 1n, depthEpoch: 1n, side: Number(side), lots: BigInt(lots), inventory: BigInt(inventory), consumed: BigInt(consumed) } });
  const { transaction } = await sdk.signCanonicalInstructions({ async getLatestBlockhash() {
    return { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n };
  } }, payer, [instruction], { computeUnitLimit: 100_000, loadedAccountsDataSizeLimit: 8 * 1024 * 1024 });
  const result = svm.sendTransaction(getTransactionDecoder().decode(transaction.serialize()));
  if (result instanceof FailedTransactionMetadata) {
    assert(result.meta().logs().some(log => log.includes('Error Number: 6003.')), result.meta().logs().join('\n'));
    console.log('ERR');
  } else {
    const response = module.getMakerQuoteResponseDecoder().decode(result.returnData().data());
    assert(result.computeUnitsConsumed() <= 80_000n);
    console.log(`OK ${response.gross} ${response.remaining}`);
  }
}
