import { address, getAddressDecoder, type Address } from '@solana/kit';
import type { MarketV3 } from './generated/index.js';
import { fromBase64, hex } from './wallet-client.js';
import type { LiquidityAccountMap } from './liquidity-adapter.js';

const FIXTURE = address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj');
type Source = { value: bigint; confidence: bigint; published: bigint };

/** Local profile only. Decode the authenticated fixture schema from the same RPC
 * snapshot as makers. Clearing independently repeats source authentication and
 * bounds; an off-chain valid result never authorizes risk valuation by itself. */
export async function fundingReference(market: MarketV3, accounts: LiquidityAccountMap, now: bigint): Promise<bigint | null> {
  const discriminator = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('account:Feed'))).slice(0, 8);
  const indexes = market.index === 0 ? [0, 1, 2, 3] : market.index === 1 ? [4, 1, 5, 3] : [];
  const multiplier = market.lotsPerUnit === 1_000_000n ? 1n : market.lotsPerUnit === 100_000n ? 10n : 0n;
  if (indexes.length !== 4 || multiplier === 0n) return null;
  const sources: Source[] = [];
  for (const [position, key] of market.oracle.sources.entries()) {
    const account = accounts.get(key as Address);
    if (!account || account.owner !== FIXTURE || account.executable || account.data[1] !== 'base64') return null;
    const raw = fromBase64(account.data[0]);
    if (raw.length !== 142 || hex(raw.slice(0, 8)) !== hex(discriminator)
      || raw.slice(40, 72).some(byte => byte !== indexes[position] + 1)
      || getAddressDecoder().decode(raw.slice(80, 112)) !== FIXTURE || raw[112] !== 2) return null;
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const sequence = view.getBigUint64(72, true), collateral = position % 2 === 1;
    if (sequence === 0n || sequence < market.oracle.sourceSequences[position] || view.getInt32(129, true) !== -6) return null;
    const value = view.getBigInt64(113, true) * (collateral ? 1n : multiplier);
    const confidence = view.getBigUint64(121, true) * (collateral ? 1n : multiplier);
    const published = view.getBigInt64(133, true);
    if (value < (collateral ? 500_000n : 10_000_000_000n) || value > (collateral ? 1_500_000n : 100_000_000_000n)
      || published <= 0n || published > now + 2n || now - published > 20n
      || confidence * 10_000n > value * (collateral ? 25n : 50n)) return null;
    sources.push({ value, confidence, published });
  }
  const reference = sources[0].value / sources[1].value, guard = sources[2].value / sources[3].value;
  const difference = reference > guard ? reference - guard : guard - reference;
  if (reference < 10_000n || reference > 100_000n || difference * 10_000n > reference * 100n
    || [sources[1], sources[3]].some(source => source.value < 950_000n || source.value > 1_050_000n)) return null;
  return reference;
}
