// Evidence for the ordinary worker's first ETH backing scan on the 12-member cashout book.
import assert from 'node:assert/strict';
import { AccountRole, type Address } from '@solana/kit';
import { getTokenDecoder } from '@solana-program/token';
import type { VersionedTransaction } from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';

// Two ETH wallets each complete six round trips of ten lots at a four-atom spread.
export const ethSpreadGain = 2n * 6n * 10n * 4n;
export const makerExitLabel = 'withdraw closed ETH maker profit';
const scale = 1_000_000_000n;

export function readMakerExit(capital: Buffer, destination: Buffer, certificate: Buffer | null,
  venue: Address, owner: Address, mint: Address) {
  const account = sdk.getMarginAccountDecoder().decode(capital), wallet = getTokenDecoder().decode(destination);
  assert.equal(account.owner, owner);
  assert.equal(account.isolatedMarketIndex, 1);
  assert.equal(wallet.owner, owner);
  assert.equal(wallet.mint, mint);
  const proof = certificate && sdk.getSettlementCertificateDecoder().decode(certificate);
  if (proof) {
    assert.equal(proof.venue, venue);
    assert.equal(proof.marketIndex, 1);
  }
  return { cash: account.cash, lots: account.positions[1].lots, virtualScaled: account.positions[1].virtualScaled,
    wallet: wallet.amount, proof: proof && { complete: proof.complete, members: proof.count, visited: proof.next } };
}

export function makerProofWork(message: VersionedTransaction['message'], certificate: Address, margin: Address) {
  let initialize = false, page = false, restart = false, paid = 0n;
  for (const ix of message.compiledInstructions) {
    if (message.staticAccountKeys[ix.programIdIndex].address !== sdk.CLEARING_PROGRAM_ADDRESS) continue;
    const tag = sdk.hex(ix.data.subarray(0, 8));
    const instruction = { programAddress: sdk.CLEARING_PROGRAM_ADDRESS, data: ix.data,
      accounts: Array.from(ix.accountKeyIndexes, index => ({
        address: message.staticAccountKeys[index].address,
        role: message.isAccountSigner(index)
          ? (message.isAccountWritable(index) ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER)
          : (message.isAccountWritable(index) ? AccountRole.WRITABLE : AccountRole.READONLY),
      })) };
    if (tag === sdk.hex(sdk.INITIALIZE_MARKET_BACKING_DISCRIMINATOR)) {
      const parsed = sdk.parseInitializeMarketBackingInstruction(instruction);
      if (parsed.accounts.certificate.address === certificate) initialize = true;
    } else if (tag === sdk.hex(sdk.CHECK_MARKET_BACKING_DISCRIMINATOR)) {
      const parsed = sdk.parseCheckMarketBackingInstruction(instruction);
      if (parsed.accounts.certificate.address === certificate) { page = true; restart = parsed.data.restart; }
    } else if (tag === sdk.hex(sdk.PAY_ACCOUNT_GAIN_DISCRIMINATOR)) {
      const parsed = sdk.parsePayAccountGainInstruction(instruction);
      if (parsed.data.marketIndex === 1) {
        assert.equal(parsed.accounts.certificate?.address, certificate);
        assert.equal(parsed.accounts.margin.address, margin);
        paid += parsed.data.amount;
      }
    }
  }
  return initialize || page || paid > 0n ? { initialize, page, restart, paid } : undefined;
}

export type ProofReceipt = ReturnType<typeof makerProofWork> & { signature: string; slot: number; fee: bigint };
type Sample = { ms: number; slot: number; ethPool: bigint; maker?: ReturnType<typeof readMakerExit> };

export function summarizeMakerExit(samples: Sample[], receipts: ProofReceipt[], withdrawal: { signature: string; slot: number }) {
  const initial = samples[0].maker!;
  const find = (predicate: (maker: typeof initial, sample: Sample) => boolean) => {
    const found = samples.find(sample => sample.maker && predicate(sample.maker, sample));
    assert(found, 'Missing confirmed ETH maker milestone');
    return { ms: found.ms, slot: found.slot };
  };
  const flatClaim = find(maker => maker.lots === 0n && maker.virtualScaled === ethSpreadGain * scale);
  const fundedPool = find((_, sample) => sample.ethPool === ethSpreadGain);
  const certificateCreated = find(maker => maker.proof !== null);
  const backingComplete = find(maker => maker.proof?.complete === true);
  const credited = find(maker => maker.lots === 0n && maker.virtualScaled === 0n && maker.cash === initial.cash + ethSpreadGain);
  const wallet = find(maker => maker.wallet === initial.wallet + ethSpreadGain && maker.cash === initial.cash);
  assert.equal(initial.proof, null);
  assert(samples.some(sample => sample.maker?.lots === 0n && sample.maker.virtualScaled === ethSpreadGain * scale
    && sample.ethPool === ethSpreadGain && !sample.maker.proof?.complete), 'Expected a funded claim waiting on backing');
  assert(backingComplete.slot <= credited.slot && credited.slot <= wallet.slot);
  const pages = receipts.filter(row => row.page), payments = receipts.filter(row => row.paid > 0n);
  assert.equal(receipts.filter(row => row.initialize).length, 1);
  assert(pages.length && payments.length);
  assert.equal(payments.reduce((sum, row) => sum + row.paid, 0n), ethSpreadGain);
  assert(payments.every(row => row.slot <= withdrawal.slot));
  const last = samples.at(-1)!.maker!;
  assert(last.proof?.complete && last.proof.members === 12n && last.proof.visited === 12n);
  return { expectedGain: ethSpreadGain, flatClaim, fundedPool, certificateCreated, backingComplete, credited, wallet,
    flatToWalletMs: wallet.ms - flatClaim.ms, pages: pages.length, restartPages: pages.filter(row => row.restart).length,
    members: last.proof.members, paymentSharesPage: payments.some(row => row.page), withdrawal, receipts,
    workerFeesLamports: receipts.reduce((sum, row) => sum + row.fee, 0n) };
}
