/** Match stale order previews to finalized fills that consumed the same wallet guard. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBase58Decoder } from '@solana/kit';
import { VersionedTransaction } from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';

const directory = process.argv[2];
assert(directory, 'Pass a completed router-load directory');

function readArtifact(file: string) {
  return JSON.parse(readFileSync(join(directory, file), 'utf8'));
}

function readWalletGuard(wire: string, expectedSignature?: string) {
  const transaction = VersionedTransaction.deserialize(Buffer.from(wire, 'base64'));
  if (expectedSignature) {
    assert.equal(getBase58Decoder().decode(transaction.signatures[0]), expectedSignature);
  }
  const message = transaction.message;
  const order = message.compiledInstructions.at(-1);
  assert(order, 'Expected an order instruction');
  assert.equal(message.staticAccountKeys[order.programIdIndex].address, sdk.CLEARING_PROGRAM_ADDRESS);
  assert.equal(sdk.hex(order.data.subarray(0, 8)), sdk.hex(sdk.EXECUTE_BEST_ROUTE_DISCRIMINATOR));

  // Each funded wallet owns one trading margin account in this workload.
  const wallet = message.staticAccountKeys[0].address;
  const { guard } = sdk.getExecuteBestRouteInstructionDataDecoder().decode(order.data);
  const key = [wallet, guard.safetyEpoch, guard.venueTermsEpoch, guard.nonce, guard.stateVersion].join('/');
  return { wallet, key };
}

const fillSlotByGuard = new Map<string, number>();
for (const row of readArtifact('router-load.json').receipts) {
  if (row.role !== 'trader' || row.error) continue;
  const receipt = readArtifact(`landed-${row.signature}.json`);
  assert.equal(receipt.meta.err, null);
  assert.equal(receipt.slot, row.slot);
  const { key } = readWalletGuard(receipt.transaction[0], row.signature);
  assert(!fillSlotByGuard.has(key), 'Two successful originals used the same wallet guard');
  fillSlotByGuard.set(key, receipt.slot);
}

let stalePreviews = 0;
let matchedEarlierFills = 0;
const affectedWallets = new Set<string>();
for (const file of readdirSync(directory).filter(name => /^wallet-preview-\d+\.json$/.test(name))) {
  const preview = readArtifact(file);
  if (preview.error?.InstructionError?.[1]?.Custom !== sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE) continue;
  const { wallet, key } = readWalletGuard(preview.wire);
  const fillSlot = fillSlotByGuard.get(key);
  affectedWallets.add(wallet);
  stalePreviews++;
  if (fillSlot !== undefined && fillSlot <= preview.slot) matchedEarlierFills++;
}
console.log(JSON.stringify({ stalePreviews, matchedEarlierFills, affectedWallets: affectedWallets.size }));
