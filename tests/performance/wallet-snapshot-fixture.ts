import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as kit from '@solana/kit';
import type { BankAccount } from './wallet-snapshot-replay.js';

type Offer = { wallet: number; market: 0 | 1; slot: number };

export function loadSnapshotFixture([bankFile, runDir, slotArg]: string[]) {
  assert(
    bankFile && runDir && slotArg,
    'Pass a ledger-tool JSON account export, split run directory and bank slot',
  );
  const slot = Number(slotArg);
  assert(Number.isSafeInteger(slot) && slot > 0);
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
  const bank = new Map<string, BankAccount>(
    (read(bankFile).accounts as { pubkey: string; account: BankAccount }[]).map(({ pubkey, account }) => [
      pubkey,
      account,
    ]),
  );
  const { state, binding } = read(join(runDir, 'sql-wallet-contention-snapshot.json'));
  // The journal identifies the two deployed binaries. Verify their complete
  // ProgramData (including the loader header) independently on the exported bank.
  const codeAccounts = new Set<string>();
  for (const maker of Object.values(state.liquidity.makers) as {
    programData: string;
    approvedHash: string;
  }[]) {
    const account = bank.get(maker.programData);
    assert(account && !account.executable && account.owner === 'BPFLoaderUpgradeab1e11111111111111111111111');
    assert.equal(
      createHash('sha256').update(Buffer.from(account.data[0], 'base64')).digest('hex'),
      maker.approvedHash,
    );
    codeAccounts.add(maker.programData);
  }
  assert.equal(codeAccounts.size, 2);
  const codeStrings = new Set([...codeAccounts].map((key) => bank.get(key)!.data[0]));

  const { roles, windows, placement } = read(join(runDir, 'contention-windows.json'));
  assert.equal(placement, 'split');
  const window = windows.find((entry: { wallets: number }) => entry.wallets === 12);
  const offers: Offer[] = window.entries;
  assert(slot < Math.min(...offers.map((offer) => offer.slot)));
  const identity = {
    venue: kit.address(binding.venue),
    mint: kit.address(state.venue.quoteMint),
    domain: binding.domain,
    marginLayout: 'ledger-lanes',
  } as const;
  const wallets = [...new Set(offers.map((offer) => offer.wallet))].map((wallet) => {
    const market = offers.find((offer) => offer.wallet === wallet)!.market;
    const trader = Object.keys(roles).find((key) => roles[key] === 'wallet margin ' + wallet);
    assert(
      trader && offers.filter((offer) => offer.wallet === wallet).every((offer) => offer.market === market),
    );
    return { trader: kit.address(trader), market };
  });
  assert.equal(wallets.length, 12);
  return { bank, wallets, identity, slot, codeAccounts, codeStrings };
}
