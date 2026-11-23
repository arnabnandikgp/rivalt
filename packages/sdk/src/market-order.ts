import {createNoopSigner, type Address} from '@solana/kit';
import * as clearing from './generated/index.js';
import type {LiquidityRouteInput} from './liquidity-route.js';
import {accountGuard} from './account-snapshot.js';
import {requiredAccountMarkets, requiredAccountLiabilities} from './account-markets.js';
import {marketCheckpointsFor, venueMarketCheckpoints} from './market-checkpoints.js';
import {MAX_ACTION_LOTS} from './quantity-limits.js';
import {requireValue} from './wallet-client.js';

/** Ordinary market order against the complete landed registry. A snapshot
 * supplies identities and structural epochs. The signer does not pick legs. */
export async function buildBestRoute(input: LiquidityRouteInput, actor: Address) {
  const {snapshot, trader, lots, marketIndex, side, maxFee, allInLimit} = input;
  const root = snapshot.roots[trader];
  requireValue(!input.stored && snapshot.commitment === 'confirmed' && snapshot.marginLayout === 'ledger-lanes'
    && snapshot.safetyState.mode === 1 && !snapshot.safetyState.paused && root?.role === 0
    && (actor === root.owner || actor === root.delegate && snapshot.slot < root.delegateExpirySlot),
    'An active ordinary market order requires its live trading authority.');
  requireValue(lots > 0n && lots <= MAX_ACTION_LOTS && (side === 0 || side === 1)
    && maxFee >= 0n && allInLimit >= 0n, 'Invalid order size, side or limits.');
  const liquidity = snapshot.liquidity;
  requireValue(liquidity && liquidity.adapters.length === 3
    && liquidity.adapters.every((entry, index) => entry.registrationState.instance === index),
    'The complete ordered maker registry is required.');
  const [zero, one, two] = liquidity.adapters;
  const roots = [root, ...liquidity.adapters.map(maker => maker.capital)];
  const required = requiredAccountMarkets(roots, 1 << marketIndex);
  const liabilities = requiredAccountLiabilities(roots, 1 << marketIndex);
  const market = snapshot.marketStates[marketIndex];
  const expirySlot = snapshot.slot + 150n < market.validUntil ? snapshot.slot + 150n : market.validUntil;
  requireValue(expirySlot > snapshot.slot, 'Order risk window expired.');
  const position = root.positions[marketIndex];
  const instruction = await clearing.getExecuteBestRouteInstructionAsync({
    actor: createNoopSigner(actor), program: clearing.CLEARING_PROGRAM_ADDRESS, venue: snapshot.venue, safety: snapshot.safety, trader,
    registry: liquidity.registry, market: snapshot.markets[marketIndex], ledger: snapshot.ledgers[marketIndex],
    otherMarket: required & (1 << (1-marketIndex)) ? snapshot.markets[1-marketIndex] : undefined,
    otherLedger: liabilities & (1 << (1-marketIndex)) ? snapshot.ledgers[1-marketIndex] : undefined,
    zeroCapital: zero.registrationState.capital, zeroRegistration: zero.registration, zeroProgram: zero.registrationState.pricingProgram,
    zeroProgramData: zero.registrationState.programData, zeroConfig: zero.registrationState.config, zeroPrice: zero.registrationState.price,
    oneCapital: one.registrationState.capital, oneRegistration: one.registration, oneProgram: one.registrationState.pricingProgram,
    oneProgramData: one.registrationState.programData, oneConfig: one.registrationState.config, onePrice: one.registrationState.price,
    twoCapital: two.registrationState.capital, twoRegistration: two.registration, twoProgram: two.registrationState.pricingProgram,
    twoProgramData: two.registrationState.programData, twoConfig: two.registrationState.config, twoPrice: two.registrationState.price,
    guard: accountGuard(snapshot, trader), domain: snapshot.venueState.domain, configEpoch: market.configEpoch,
    termsEpoch: market.termsEpoch, startSlot: snapshot.slot, expirySlot, side, lots, maxFee, allInLimit,
    reduceOnly: input.reduceOnly ?? (side === 1 ? position.lots >= lots : -position.lots >= lots),
    generation: position.generation, makerEpochs: liquidity.adapters.map(maker => ({
      authority: maker.registrationState.authorityEpoch, control: maker.config.controlEpoch,
      shape: maker.config.shapeEpoch, depth: maker.registrationState.depthEpoch,
    })),
  });
  const checkpoints = marketCheckpointsFor(await venueMarketCheckpoints(snapshot.venue), instruction);
  return {instructions: [...checkpoints, instruction], expirySlot};
}
