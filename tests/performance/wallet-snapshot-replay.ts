import type { Address } from '@solana/kit';
import type { AccountIdentity, readAccountTradeSnapshot } from '../../packages/sdk/src/account-snapshot.js';

export type BankAccount = { owner: string; executable: boolean; data: [string, 'base64'] };

// Before the SDK switch, each base64 byte passed through a mapping callback.
export const decodeWithMapping = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));

function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
}

export async function replayWallet(
  readSnapshot: typeof readAccountTradeSnapshot,
  bank: ReadonlyMap<string, BankAccount>,
  slot: number,
  identity: AccountIdentity,
  wallet: { trader: Address; market: 0 | 1 },
  onFinalRead?: () => void,
) {
  let reads = 0,
    start = 0;
  const rpc = {
    async call(method: string, params: unknown[] = []) {
      equal(method, 'getMultipleAccounts');
      const [keys, opts] = params as [string[], { encoding: string; minContextSlot?: number }];
      equal(opts.encoding, 'base64');
      if ((opts.minContextSlot ?? 0) > slot) throw new Error('Bank predates requested slot');
      const values = keys.map((key) => {
        const account = bank.get(key);
        if (!account) throw new Error('Missing bank account ' + key);
        return account;
      });
      equal(keys.length, [1, 4, 5, 44][reads++]);
      if (reads === 4) {
        onFinalRead?.();
        start = performance.now();
      }
      return { context: { slot }, value: values };
    },
  };
  const snapshot = await readSnapshot(rpc, identity, wallet.trader, wallet.market);
  const end = performance.now();
  equal(reads, 4);
  equal(snapshot.slot, BigInt(slot)); // Verify the bank export against its real Clock bytes.
  equal(snapshot.liquidity!.adapters.length, 4);
  return { start, end, snapshot };
}

export const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p: number) => Number(sorted[Math.ceil(sorted.length * p) - 1].toFixed(2));
  return { samples: values.length, p50Ms: quantile(0.5), p95Ms: quantile(0.95) };
};

export async function compareWalletTimings<Wallet>(
  wallets: Wallet[],
  replay: (variant: 'sdk' | 'legacy', wallet: Wallet) => Promise<{ start: number; end: number }>,
) {
  const timings = {
    legacy: { single: [] as number[], twelve: [] as number[] },
    sdk: { single: [] as number[], twelve: [] as number[] },
  };
  for (let round = 0; round < 6; round++) {
    const variants = round % 2 ? (['sdk', 'legacy'] as const) : (['legacy', 'sdk'] as const);
    for (const variant of variants) {
      for (const wallet of wallets) {
        const { start, end } = await replay(variant, wallet);
        timings[variant].single.push(end - start);
      }
      const batch = await Promise.all(wallets.map(wallet => replay(variant, wallet)));
      timings[variant].twelve.push(...batch.map(({ start, end }) => end - start));
    }
  }
  return Object.fromEntries(Object.entries(timings).map(([variant, { single, twelve }]) =>
    [variant, { single: summary(single), twelve: summary(twelve) }]));
}
