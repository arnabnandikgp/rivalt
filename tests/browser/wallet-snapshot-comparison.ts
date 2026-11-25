import { readAccountTradeSnapshot } from '../../packages/sdk/src/account-snapshot.js';
import { fromBase64 } from '../../packages/sdk/src/wallet-client.js';
import { compareWalletTimings, replayWallet, type BankAccount } from '../performance/wallet-snapshot-replay.js';
import type { loadSnapshotFixture } from '../performance/wallet-snapshot-fixture.js';

export { fromBase64, readAccountTradeSnapshot };
type Reader = { readAccountTradeSnapshot: typeof readAccountTradeSnapshot; fromBase64: typeof fromBase64 };
type Fixture = Pick<ReturnType<typeof loadSnapshotFixture>, 'identity' | 'slot' | 'wallets'> & {
  accounts: [string, BankAccount][];
  makerProgramData: string;
};

export async function compare(legacy: Reader, fixture: Fixture) {
  const { accounts, identity, slot, wallets, makerProgramData } = fixture;
  const bank = new Map(accounts);
  const readers = { legacy, sdk: { readAccountTradeSnapshot, fromBase64 } };
  for (const { data: [encoded] } of bank.values()) {
    const expected = atob(encoded);
    for (const reader of Object.values(readers)) {
      const bytes = reader.fromBase64(encoded);
      if (bytes.length !== expected.length || !bytes.every((byte, i) => byte === expected.charCodeAt(i)))
        throw new Error('Decoded account bytes differ');
    }
  }
  for (const reader of Object.values(readers)) {
    for (const invalid of ['Y', 'Y!==', '===', '-_']) {
      let failure: unknown;
      try { reader.fromBase64(invalid); } catch (error) { failure = error; }
      if (!(failure instanceof DOMException && failure.name === 'InvalidCharacterError'))
        throw new Error('Unexpected outcome for malformed base64');
    }
  }
  const replay = (reader: Reader, wallet: typeof wallets[number], source = bank) =>
    replayWallet(reader.readAccountTradeSnapshot, source, slot, identity, wallet);
  const serialize = (snapshot: unknown) => JSON.stringify(snapshot, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item instanceof Map ? [...item.entries()] : item);
  for (const wallet of wallets) {
    const previous = await replay(legacy, wallet);
    const current = await replay(readers.sdk, wallet);
    if (serialize(previous.snapshot) !== serialize(current.snapshot)) throw new Error('Wallet state changed');
  }
  const program = bank.get(makerProgramData)!;
  const code = atob(program.data[0]);
  const tampered = code.slice(0, -1) + String.fromCharCode(code.charCodeAt(code.length - 1) ^ 1);
  const altered = new Map(bank).set(makerProgramData, { ...program, data: [btoa(tampered), 'base64'] });
  for (const market of [0, 1]) {
    const wallet = wallets.find(wallet => wallet.market === market)!;
    for (const reader of Object.values(readers)) {
      const { snapshot } = await replay(reader, wallet, altered);
      const affected = snapshot.liquidity!.adapters.filter(
        adapter => adapter.registrationState.programData === makerProgramData,
      );
      if (!affected.length || !affected.every(adapter => adapter.unavailable === 'unapproved-code'))
        throw new Error('Altered maker program passed verification');
    }
  }
  return compareWalletTimings(wallets, (variant, wallet) => replay(readers[variant], wallet));
}
