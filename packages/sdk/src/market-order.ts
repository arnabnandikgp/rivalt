import {AccountRole, createNoopSigner, type Address, type Instruction} from '@solana/kit';
import * as clearing from './generated/index.js';
import {previewLiquidityRoute, type LiquidityRouteInput} from './liquidity-route.js';
import {quoteCanonical} from './canonical-quote.js';
import {LiquiditySearchLimitError} from './quantity-search.js';
import {accountGuard} from './account-snapshot.js';
import {requiredAccountMarkets, requiredAccountLiabilities} from './account-markets.js';
import {marketCheckpointsFor, venueMarketCheckpoints} from './market-checkpoints.js';
import {MAX_ACTION_LOTS} from './quantity-limits.js';
import {requireValue} from './wallet-client.js';

export const BEST_ROUTE_HEAP_BYTES = 128 * 1024;

/** Include the best financially eligible snapshot legs when the preview finishes.
 * Rank fallback liquidity by the price of the amount it can actually supply.
 * The wallet exposes the selected IDs so omitted quotes are visible. */
function shortlist(input: LiquidityRouteInput, width: number) {
  const makers = input.snapshot.liquidity!.adapters;
  if (makers.length <= width) return [...makers];
  const selected = new Set<number>();
  try {
    const quote = previewLiquidityRoute(input,true).allocation;
    for (const leg of quote?.legs ?? []) selected.add(leg.instance);
  } catch (error) {
    if (!(error instanceof LiquiditySearchLimitError)) throw error;
  }
  const {side,lots,marketIndex} = input;
  const ranked = makers.map(maker => {
    const inventory = maker.capital.positions[marketIndex].lots;
    let quantity = lots;
    const limit = (value:bigint) => { if(value < quantity) quantity=value; };
    limit(maker.depthHints(side).at(-1) ?? 0n);
    limit(side === 0 ? inventory+maker.shape.shortCap : maker.shape.longCap-inventory);
    const reducing = side === 0 ? inventory : -inventory;
    if (maker.shape.mode === 3) limit(reducing);
    const upper = input.snapshot.marketStates[marketIndex].upper;
    if (upper > 0n) limit(maker.capital.cash * 10n / upper + reducing);
    let gross=0n;
    if (quantity > 0n && maker.capital.owner !== input.snapshot.roots[input.trader].owner
        && (maker.unavailable === null || maker.unavailable === 'stale-publication')) {
      try { gross=quoteCanonical(maker.shape,maker.price.anchor,side,quantity,inventory,
        side === 0 ? maker.registrationState.buyConsumed : maker.registrationState.sellConsumed).gross; }
      catch { quantity=0n; }
    } else quantity=0n;
    return {id:maker.config.instance,quantity,gross};
  });
  ranked.sort((left,right) => {
    if ((left.quantity > 0n) !== (right.quantity > 0n)) return left.quantity > 0n ? -1 : 1;
    const difference = left.gross*right.quantity - right.gross*left.quantity;
    if(difference !== 0n) return (difference < 0n) === (side === 0) ? -1 : 1;
    if(left.quantity !== right.quantity) return left.quantity > right.quantity ? -1 : 1;
    return left.id-right.id;
  });
  for(const candidate of ranked) {
    if(selected.size === width) break;
    selected.add(candidate.id);
  }
  return makers.filter(maker=>selected.has(maker.config.instance));
}

/** Ordinary market order against the signed shortlist at execution time. A snapshot
 * supplies identities and structural epochs. The signer does not pick legs. */
export async function buildBestRoute(input: LiquidityRouteInput, actor: Address) {
  return buildMarketOrder(input,actor,false,3);
}

/** Sign the separate local multi-maker instruction and its full candidate set. */
export async function buildMultiMakerRoute(input: LiquidityRouteInput, actor: Address, width = 3) {
  requireValue(Number.isInteger(width) && width>=3 && width<=8,'Multi-maker candidate count must be between three and eight.');
  return buildMarketOrder(input,actor,true,width);
}

async function buildMarketOrder(input: LiquidityRouteInput, actor: Address, multi: boolean, width: number) {
  const {snapshot, trader, lots, marketIndex, side, maxFee, allInLimit} = input;
  const root = snapshot.roots[trader];
  requireValue(!input.stored && snapshot.commitment === 'confirmed' && snapshot.marginLayout === 'ledger-lanes'
    && snapshot.safetyState.mode === 1 && !snapshot.safetyState.paused && root?.role === 0
    && (actor === root.owner || actor === root.delegate && snapshot.slot < root.delegateExpirySlot),
    'An active ordinary market order requires its live trading authority.');
  requireValue(lots > 0n && lots <= MAX_ACTION_LOTS && (side === 0 || side === 1)
    && maxFee >= 0n && allInLimit >= 0n, 'Invalid order size, side or limits.');
  const liquidity = snapshot.liquidity;
  requireValue(liquidity && liquidity.adapters.length === liquidity.registryState.count && liquidity.adapters.length >= 3
    && liquidity.adapters.every((entry, index) => entry.registrationState.instance === index),
    'The complete ordered maker registry is required.');
  const candidates = shortlist(input,width);
  const [zero, one, two] = candidates;
  const roots = [root, ...candidates.map(maker => maker.capital)];
  const required = requiredAccountMarkets(roots, 1 << marketIndex);
  const liabilities = requiredAccountLiabilities(roots, 1 << marketIndex);
  const market = snapshot.marketStates[marketIndex];
  const expirySlot = snapshot.slot + 150n < market.validUntil ? snapshot.slot + 150n : market.validUntil;
  requireValue(expirySlot > snapshot.slot, 'Order risk window expired.');
  const position = root.positions[marketIndex];
  const accounts = {
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
  };
  const epochs = candidates.map(maker => ({
    authority: maker.registrationState.authorityEpoch, control: maker.config.controlEpoch,
    shape: maker.config.shapeEpoch, depth: maker.registrationState.depthEpoch,
  }));
  const order = {
    guard: accountGuard(snapshot, trader), domain: snapshot.venueState.domain, configEpoch: market.configEpoch,
    termsEpoch: market.termsEpoch, startSlot: snapshot.slot, expirySlot, side, lots, maxFee, allInLimit,
    reduceOnly: input.reduceOnly ?? (side === 1 ? position.lots >= lots : -position.lots >= lots),
    generation: position.generation, makerEpochs:epochs.slice(0,3),
  };
  let instruction: Instruction = multi
    ? await clearing.getExecuteMultiRouteInstructionAsync({...accounts,order,extraEpochs:epochs.slice(3)})
    : await clearing.getExecuteBestRouteInstructionAsync({...accounts,...order});
  const ids = candidates.map(maker=>maker.config.instance);
  const missingLanes = liquidity.registryState.registrations.flatMap((address,id) =>
    !ids.includes(id) && ids.some(instance=>instance%3===id) ? [{address,role:AccountRole.WRITABLE}] : []);
  const bundles=candidates.slice(3).flatMap(maker=>[
    {address:maker.registrationState.capital,role:AccountRole.WRITABLE},
    {address:maker.registration,role:AccountRole.WRITABLE},
    ...[maker.registrationState.pricingProgram,maker.registrationState.programData,maker.registrationState.config,
      maker.registrationState.price].map(address=>({address,role:AccountRole.READONLY})),
  ]);
  if(bundles.length||missingLanes.length) instruction={...instruction,accounts:[...instruction.accounts!,...bundles,...missingLanes]};
  const checkpoints = marketCheckpointsFor(await venueMarketCheckpoints(snapshot.venue), instruction);
  return {instructions: [...checkpoints, instruction], expirySlot,candidateInstances:ids};
}
