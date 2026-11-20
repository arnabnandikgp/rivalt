import { createNoopSigner, getProgramDerivedAddress, type Address } from '@solana/kit';
import type { MarginRouteIntent } from './route-intent.js';
import type { readAccountTradeSnapshot } from './account-snapshot.js';
import { accountSourceMode,effectiveAccountFunding } from './account-balance.js';
import { allocateLiquidityRoute } from './liquidity-allocation.js';
import { requireValue } from './wallet-client.js';
import * as protocol from './generated/index.js';
import { MAX_CASH_ATOMS } from './quantity-limits.js';
import { accountGuard } from './account-snapshot.js';
import {requiredAccountMarkets,requiredAccountLiabilities} from './account-markets.js';

export type LiquidityRouteInput = MarginRouteIntent & {
  snapshot: Awaited<ReturnType<typeof readAccountTradeSnapshot>>; trader: Address;
};

/** Exact preview is available before activation; no transaction authority is implied. */
export function previewLiquidityRoute(input: LiquidityRouteInput) {
  return previewRoute(input, false);
}

function previewRoute(input: LiquidityRouteInput, makerLiquidation: boolean) {
  const { snapshot,trader,marketIndex } = input;
  const root = snapshot.roots[trader];
  requireValue(snapshot.venueState.profileVersion === 6 && snapshot.liquidity && root?.schemaVersion === 10
    && root.venue === snapshot.venue && root.role === 0 && !snapshot.safetyState.paused
    && ![2,3,4].includes(snapshot.safetyState.mode), 'Liquidity preview unavailable.');
  requireValue(root.mode !== 0 || snapshot.marketStates[marketIndex].crossEligible, 'Market is not cross eligible.');
  // Clearing retains the pre-cancellation market accounts and cancels these
  // orders on the candidate copy before evaluating health and source freshness.
  const financialRoot = makerLiquidation ? { ...root, book: { ...root.book,
    orders: root.book.orders.map(entry => [1,2].includes(entry.order.state) && !entry.order.reduceOnly
      ? { ...entry, order: { ...entry.order, state: 6, reserve: 0n } } : entry) } } : root;
  return allocateLiquidityRoute({ ...input, makerLiquidation, root: financialRoot, makers: snapshot.liquidity.adapters,markets: snapshot.marketStates,
    slot: snapshot.slot,now: snapshot.now,
    sources: snapshot.marketStates.map(market => accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot)),
    funding: snapshot.marketStates.map(market => effectiveAccountFunding(snapshot.safetyState,market,snapshot.now,snapshot.slot)),
  });
}

/** Build the selected canonical route with the caller's explicit price/fee limits.
 * Repricing/current consumption may change before landing; structural epochs and
 * exact one/two-leg quantities may not. Signing/transport must use resourceBudget
 * through the v0/v1 compiler rather than attaching v0 budget instructions to v1.
 * This cannot activate a profile: P32 safety qualification is still required. */
export async function buildLiquidityRoute(input: LiquidityRouteInput, actor: Address) {
  return buildRoute(input, actor, false);
}

/** Permissionless reduce-only instruction. The original trader guard and
 * position generation still bind this proposal when clearing executes it. */
export function buildMakerLiquidation(snapshot: LiquidityRouteInput['snapshot'], trader: Address,
  marketIndex: 0|1, lots: bigint, actor: Address) {
  const side = snapshot.roots[trader].positions[marketIndex].lots > 0n ? 1 : 0;
  return buildRoute({snapshot,trader,marketIndex,lots,side,reduceOnly:true,
    allInLimit:side === 0 ? MAX_CASH_ATOMS : 0n,maxFee:MAX_CASH_ATOMS},actor,true);
}

async function buildRoute(input: LiquidityRouteInput, actor: Address, makerLiquidation: boolean) {
  const { snapshot, trader, marketIndex } = input, root = snapshot.roots[trader];
  requireValue(snapshot.commitment === 'confirmed' && snapshot.safetyState.mode === 1 && !snapshot.safetyState.paused,
    'Canonical execution requires a confirmed, active qualification profile.');
  requireValue(root && (makerLiquidation || input.stored || root.owner === actor || root.delegate === actor && snapshot.slot < root.delegateExpirySlot),
    'Live canonical trade authority required.');
  const preview = previewRoute(input, makerLiquidation), allocation = preview.allocation;
  if (!allocation) return null;
  const selected = allocation.legs.map(leg => snapshot.liquidity!.adapters.find(maker => maker.registration === leg.registration)!);
  const market = snapshot.marketStates[marketIndex];
  const expirySlot = [snapshot.slot + 150n, market.validUntil, ...selected.map(maker => maker.validUntilSlot)]
    .reduce((earlier, value) => value < earlier ? value : earlier);
  requireValue(expirySlot > snapshot.slot, 'Canonical route expired.');
  const [eventAuthority] = await getProgramDerivedAddress({ programAddress: protocol.CLEARING_PROGRAM_ADDRESS,
    seeds: [new TextEncoder().encode('__event_authority')] });
  const [first, second] = selected, firstState = first.registrationState, secondState = second?.registrationState;
  const required = requiredAccountMarkets([root, ...selected.map(maker => snapshot.roots[maker.registrationState.capital])], 1 << marketIndex);
  const liabilityRequired = requiredAccountLiabilities([root, ...selected.map(maker => snapshot.roots[maker.registrationState.capital])], 1 << marketIndex);
  const common = {
    actor: createNoopSigner(actor), venue: snapshot.venue, safety: snapshot.safety,
    market: snapshot.markets[marketIndex], otherMarket: required & (1 << (1 - marketIndex)) ? snapshot.markets[1 - marketIndex] : undefined,
    ledger: snapshot.ledgers[marketIndex], otherLedger: liabilityRequired & (1 << (1 - marketIndex)) ? snapshot.ledgers[1 - marketIndex] : undefined, trader,
    registry: snapshot.liquidity!.registry, eventAuthority, program: protocol.CLEARING_PROGRAM_ADDRESS,
    firstCapital: firstState.capital, firstRegistration: first.registration, firstProgram: firstState.pricingProgram,
    firstProgramData: firstState.programData, firstConfig: firstState.config, firstPrice: firstState.price,
    secondCapital: secondState?.capital, secondRegistration: second?.registration, secondProgram: secondState?.pricingProgram,
    secondProgramData: secondState?.programData, secondConfig: secondState?.config, secondPrice: secondState?.price,
    guard: accountGuard(snapshot, trader), startSlot: snapshot.slot, expirySlot, lots: input.lots,
    legs: allocation.legs.map(leg => ({ lots: leg.lots, authorityEpoch: leg.authorityEpoch,
      controlEpoch: leg.controlEpoch, shapeEpoch: leg.shapeEpoch, depthEpoch: leg.depthEpoch })),
  };
  const position = root.positions[marketIndex];
  const reduceOnly = input.reduceOnly ?? (input.side === 1 ? position.lots >= input.lots : -position.lots >= input.lots);
  const liveInstruction = makerLiquidation ? protocol.getLiquidateLiquidityRouteInstructionAsync : protocol.getExecuteLiquidityRouteInstructionAsync;
  const instruction = input.stored
    ? await protocol.getExecuteLiquidityOrderInstructionAsync({ ...common, ...input.stored })
    : await liveInstruction({ ...common, domain: snapshot.venueState.domain,
      termsEpoch: market.termsEpoch, configEpoch: market.configEpoch, side: input.side,
      allInLimit: input.allInLimit, maxFee: input.maxFee, reduceOnly, generation: position.generation });
  return { snapshotCommitment: snapshot.commitment, snapshotSlot: snapshot.slot, trader, marketIndex,
    guard: common.guard, expirySlot, allocation, metrics: preview.metrics, excluded: preview.excluded,
    instructions: [instruction], resourceBudget: { computeUnitLimit: 800_000, loadedAccountsDataSizeLimit: 8 * 1024 * 1024 } };
}
