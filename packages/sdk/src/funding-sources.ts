import * as policy from './price-policy.js';
import { address, getAddressDecoder, type Address } from '@solana/kit';
import type { Market } from './generated/index.js';
import { fromBase64, hex } from './wallet-client.js';
import type { LiquidityAccountMap } from './liquidity-adapter.js';

const FIXTURE = address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj');
type Source = { value: bigint; confidence: bigint; published: bigint };

/** Local profile only. Decode the authenticated fixture schema from the same RPC
 * snapshot as makers. Clearing independently repeats source authentication and
 * bounds; an off-chain valid result never authorizes risk valuation by itself. */
export async function fundingReference(market: Market, accounts: LiquidityAccountMap, now: bigint): Promise<bigint | null> {
  const discriminator = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('account:Feed'))).slice(0, 8);
  const indexes = market.index === 0 ? [0, 1, 2, 3] : market.index === 1 ? [4, 1, 5, 3] : [];
  const multiplier = policy.priceSourceMultiplier(market.lotsPerUnit);
  if (indexes.length !== 4 || multiplier === null) return null;
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
    if (sequence === 0n || sequence < market.oracle.sourceSequences[position] || view.getInt32(129, true) !== policy.SOURCE_EXPONENT) return null;
    const value = view.getBigInt64(113, true) * (collateral ? 1n : multiplier);
    const confidence = view.getBigUint64(121, true) * (collateral ? 1n : multiplier);
    const published = view.getBigInt64(133, true);
    if (value < (collateral ? policy.MIN_COLLATERAL_USD : policy.MIN_NORMALIZED_ASSET_USD) || value > (collateral ? policy.MAX_COLLATERAL_USD : policy.MAX_NORMALIZED_ASSET_USD)
      || confidence > 18_446_744_073_709_551_615n
      || published <= 0n || published > 9_223_372_036_854_775_807n - policy.SOURCE_AGE
      || published > now + policy.FUTURE_SKEW || now - published > policy.SOURCE_AGE
      || confidence * policy.BASIS_POINTS > value * (collateral ? policy.COLLATERAL_CONFIDENCE_BPS : policy.ASSET_CONFIDENCE_BPS)) return null;
    sources.push({ value, confidence, published });
  }
  const reference = sources[0].value / sources[1].value, guard = sources[2].value / sources[3].value;
  const difference = reference > guard ? reference - guard : guard - reference;
  if (reference < policy.MIN_REFERENCE_PRICE || reference > policy.MAX_REFERENCE_PRICE || difference * policy.BASIS_POINTS > reference * policy.SOURCE_DIVERGENCE_BPS
    || [sources[1], sources[3]].some(source => source.value < policy.MIN_NORMAL_COLLATERAL_USD || source.value > policy.MAX_NORMAL_COLLATERAL_USD)) return null;
  for (const index of [0, 2]) {
    const asset = sources[index], collateral = sources[index + 1];
    const lower = (asset.value - asset.confidence) * policy.RISK_LOWER_PERCENT
      / ((collateral.value + collateral.confidence) * policy.PERCENT_DENOMINATOR);
    const denominator = (collateral.value - collateral.confidence) * policy.PERCENT_DENOMINATOR;
    const upper = ((asset.value + asset.confidence) * policy.RISK_UPPER_PERCENT + denominator - 1n) / denominator;
    if (lower < 1n || upper > policy.MAX_PRICE) return null;
  }
  return reference;
}
