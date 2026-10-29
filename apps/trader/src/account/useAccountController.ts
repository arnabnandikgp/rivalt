import { useEffect, useState } from 'react';
import { address, type Address, type Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { fixed, integer, units } from '../amount.js';
import type { AccountTraderConfig } from './types.js';
import { useAccountVenue } from './useAccountVenue.js';
import { accountLabel } from './model.js';
import {
  GROUP_MARKETS,
  groupOrderPrice,
  groupOrderTerms,
  groupQuantity,
} from '../group/model.js';

const zero = address('11111111111111111111111111111111');
const abs = (value: bigint) => (value < 0n ? -value : value);
export function useAccountController(config: AccountTraderConfig) {
  const selectionKey = `rivalt:selection:v${config.version}:${config.genesis}:${config.anchor}:${config.venue}`;
  const [initial] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(selectionKey) ?? '{}');
      return {
        portfolio: Number.isInteger(value.portfolio) && value.portfolio >= 0 && value.portfolio <= 3 ? value.portfolio : 0,
        subaccount: Number.isInteger(value.subaccount) && value.subaccount >= 0 && value.subaccount <= 8 ? value.subaccount : 0,
        market: value.market === 1 ? 1 as const : 0 as const,
      };
    } catch { return {portfolio: 0, subaccount: 0, market: 0 as const}; }
  });
  const [portfolioIndex, setPortfolioIndex] = useState<number>(initial.portfolio);
  const [subaccount, setSubaccount] = useState<number>(initial.subaccount),
    [marketIndex, setMarketIndex] = useState<0 | 1>(initial.market);
  useEffect(() => {
    // A display preference only; ownership and authority are always read afresh.
    try { localStorage.setItem(selectionKey, JSON.stringify({portfolio: portfolioIndex, subaccount, market: marketIndex})); } catch { /* Signing still requires durable receipt storage. */ }
  }, [selectionKey, portfolioIndex, subaccount, marketIndex]);
  const venue = useAccountVenue(config, `${portfolioIndex}:${subaccount}:${marketIndex}`, portfolioIndex, subaccount),
    snapshot = venue.snapshot;
  const { accounts } = venue;
  const portfolio = venue.ownerPortfolio?.account ? venue.ownerPortfolio.address : undefined;
  const selected = accounts.find(([, root]) => root.subaccountIndex === subaccount),
    margin = selected?.[0] as Address | undefined,
    root = margin ? snapshot?.roots[margin] : undefined;
  const [collateral, setCollateral] = useState(''),
    [amount, setAmount] = useState('1'),
    [recipient, setRecipient] = useState('');
  const [side, setSide] = useState<0 | 1>(0),
    [quantity, setQuantity] = useState('0.000005'),
    [allIn, setAllIn] = useState('1'),
    [fee, setFee] = useState('0.01'),
    [reduceOnly, setReduceOnly] = useState(false);
  const [limit, setLimit] = useState('60000'),
    [expiry, setExpiry] = useState('600'),
    [trigger, setTrigger] = useState(0),
    [threshold, setThreshold] = useState('60000'),
    [replaceId, setReplaceId] = useState('');
  const [takeProfit, setTakeProfit] = useState('61000'),
    [stopLoss, setStopLoss] = useState('59000'),
    [tpLimit, setTpLimit] = useState('60000'),
    [slLimit, setSlLimit] = useState('58000');
  const [delegate, setDelegate] = useState(''),
    [delegateSlots, setDelegateSlots] = useState('1200');
  const selectedMarket = GROUP_MARKETS[marketIndex];
  const view = root && snapshot ? venue.client.balance(snapshot, margin!) : undefined;
  const disabled = Boolean(venue.busy) || !venue.canSign || Boolean(venue.rpcError);
  const financialDisabled =
    disabled || !root || Boolean(snapshot?.safetyState.paused) || snapshot?.safetyState.mode === 2;
  const marketAllowed = Boolean(
    root && root.role === 0 && snapshot?.safetyState.mode === 1 &&
    (root.mode === 0 || root.isolatedMarketIndex === marketIndex),
  );
  const activeOrders =
    root?.book.orders.filter((entry) => [1, 2].includes(entry.order.state)) ?? [];
  useEffect(() => {
    setCollateral((previous) =>
      venue.tokens.some((token) => token.address === previous)
        ? previous
        : (venue.tokens[0]?.address ?? ''),
    );
  }, [venue.tokens]);
  useEffect(() => {
    if (root?.mode === 1) setMarketIndex(root.isolatedMarketIndex as 0 | 1);
    setReplaceId('');
  }, [margin]);
  useEffect(() => {
    setQuantity(marketIndex === 0 ? '0.000005' : '0.00005');
    setLimit(marketIndex === 0 ? '60000' : '3000');
    setThreshold(marketIndex === 0 ? '60000' : '3000');
    setTakeProfit(marketIndex === 0 ? '61000' : '3100');
    setStopLoss(marketIndex === 0 ? '59000' : '2900');
    setTpLimit(marketIndex === 0 ? '60000' : '3000');
    setSlLimit(marketIndex === 0 ? '58000' : '2800');
    setReplaceId('');
  }, [marketIndex]);
  const token = () => {
    if (!venue.tokens.some((entry) => entry.address === collateral))
      throw new Error('Choose an owned test collateral account.');
    return address(collateral);
  };
  const currentRoot = (state: sdk.AccountSnapshot, owner: Address) => {
    if (!margin || !state.roots[margin] || state.roots[margin].owner !== owner)
      throw new Error('Select an owned margin account.');
    return state.roots[margin];
  };
  const prepare = (
    label: string,
    build: (
      state: sdk.AccountSnapshot,
      owner: Address,
    ) => Promise<{
      instructions: Instruction[];
      details: string[];
      via?: 'rpc' | 'api';
    }>,
  ) =>
    venue.preview(async (state, owner) => {
      if (!state) throw new Error('Select a registered margin account.');
      const plan = await build(state, owner);
      return {
        ...(await venue.client.prepare(
          `Portfolio ${portfolioIndex} · ${root ? accountLabel(root) : 'New account'} · ${label}`,
          owner,
          plan.instructions,
          [...(margin ? [`Margin account: ${margin}`] : []), ...plan.details],
        )),
        via: plan.via ?? 'rpc',
      };
    });
  const create = () => venue.preview(async (_state, owner) => ({
    ...await venue.client.prepare(portfolio ? 'Register account' : 'Create portfolio', owner, [
      portfolio ? await venue.client.register(owner, portfolioIndex, subaccount, subaccount === 0 ? undefined : marketIndex)
        : await venue.client.createPortfolio(owner, portfolioIndex),
    ], [portfolio ? `Create immutable ${subaccount === 0 ? 'cross' : `isolated ${selectedMarket.name}`} account ${subaccount} in portfolio ${portfolioIndex}.`
      : `Create portfolio ${portfolioIndex}. No collateral is moved.`]), via: 'rpc',
  }));
  const cash = (withdraw: boolean) =>
    prepare(withdraw ? 'Withdraw' : 'Deposit', async (state, owner) => {
      currentRoot(state, owner);
      const atoms = units(amount, 6, 'Collateral');
      if (!withdraw)
        return {
          instructions: [await venue.client.deposit(state, owner, margin!, token(), atoms)],
          details: [`Deposit ${fixed(atoms)} test USD into this account only.`],
        };
      const plan = await venue.client.exit(state, owner, margin!, token(), atoms);
      return {
        ...plan,
        details: [
          `Withdraw ${fixed(atoms)} funded test USD to the selected wallet token account.`,
        ],
      };
    });
  const allocate = () =>
    prepare('Allocate collateral', async (state, owner) => {
      currentRoot(state, owner);
      const destination = address(recipient),
        atoms = units(amount, 6, 'Allocation');
      const target = accounts.find(([key]) => key === destination);
      if (!target) throw new Error('Select another owned account in this portfolio.');
      const pair = await venue.client.snapshot([margin!, destination], 'confirmed');
      const instruction = await venue.client.transfer(pair, owner, margin!, destination, atoms);
      return {
        instructions: [instruction],
        details: [ `Move ${fixed(atoms)} funded test USD to ${accountLabel(target[1])}.`,
          `Recipient: ${destination}`,
          'Sibling cash is never an automatic guarantee.',
        ],
      };
    });
  const trade = () =>
    prepare(`${side === 0 ? 'Buy' : 'Sell'} ${selectedMarket.name}`, async (state, owner) => {
      currentRoot(state, owner);
      const lots = groupQuantity(quantity, marketIndex);
      const pricing=await venue.client.tradeSnapshot(margin!,marketIndex);
      if(config.version===4) {
        const source=sdk.accountSourceMode(pricing.safetyState,pricing.marketStates[marketIndex],pricing.now,pricing.slot);
        if(!['Normal','Degraded'].includes(source))throw new Error(`Quote unavailable: ${selectedMarket.name} source is ${source}.`);
        if(pricing.liquidity?.adapters.every(maker=>maker.unavailable!==null))
          throw new Error(`Quote unavailable: ${pricing.liquidity.adapters.map(maker=>`maker ${maker.registrationState.instance}: ${maker.unavailable}`).join('; ')}.`);
      }
      const quote = await venue.client.route({snapshot: pricing, trader: margin!, marketIndex, side, lots,
        maxFee: units(fee, 6, 'Maximum venue fee'),
        allInLimit: units(allIn, 6, 'All-in limit'),
        reduceOnly,
      }, owner);
      if (!quote)
        throw new Error(
          'No executable route within your limits and whole-account risk requirements.',
        );
      return {
        instructions: quote.instructions,
        via: 'api',
        details: [
          `${side === 0 ? 'Buy' : 'Sell'} ${fixed(lots, selectedMarket.decimals)} ${selectedMarket.name}${reduceOnly ? ' · reduce only' : ''}.`,
          `Notional ${fixed(quote.allocation.grossQuote)} · venue fee ${fixed(quote.allocation.fee)} test USD (2 bps).`,
          `${side === 0 ? 'Spend' : 'Receive'} ${fixed(quote.allocation.allIn)} test USD including the venue fee.`,
          ...quote.allocation.legs.map(
            (leg) =>
              `${'instance' in leg?`Maker instance ${leg.instance} (${leg.registration.slice(0,8)})`:`Maker ${leg.makerId === 0 ? 'A' : 'B'}`}: ${fixed(leg.lots, selectedMarket.decimals)} ${selectedMarket.name}.`,
          ),
          `Quote expires at slot ${quote.expirySlot}. All submitted legs execute atomically.`,
        ],
      };
    });
  const terms = (
    state: sdk.AccountSnapshot,
    account: sdk.MarginAccountV3,
    previous?: sdk.StoredOrder,
    protection?: { trigger: number; threshold: string; limit: string },
  ) => {
    const position = account.positions[marketIndex];
    const orderTrigger = protection?.trigger ?? trigger;
    return groupOrderTerms(
      {
        side: protection ? (position.lots > 0n ? 1 : 0) : side,
        lots: groupQuantity(quantity, marketIndex),
        limit: groupOrderPrice(protection?.limit ?? limit, marketIndex),
        feeBudget: units(fee, 6, 'Lifetime fee budget'),
        startSlot: state.slot,
        expirySlot: state.slot + integer(expiry, 'Expiry slots', 216_000n),
        trigger: orderTrigger,
        threshold: orderTrigger
          ? groupOrderPrice(protection?.threshold ?? threshold, marketIndex, true)
          : 0n,
        reduceOnly: protection ? true : reduceOnly,
      },
      position,
      previous,
    );
  };
  const order = () =>
    prepare(replaceId ? 'Replace order' : 'Place order', async (state, owner) => {
      const account = currentRoot(state, owner),
        existing = replaceId
          ? account.book.orders.find((entry) => entry.order.id === BigInt(replaceId))
          : undefined;
      if (
        replaceId &&
        (!existing ||
          existing.marketIndex !== marketIndex ||
          ![1, 2].includes(existing.order.state))
      )
        throw new Error('The selected live order changed.');
      const operation = existing
        ? sdk.groupOrderAction('Replace', {
            id: existing.order.id,
            version: existing.order.version,
            terms: terms(state, account, existing.order),
          })
        : sdk.groupOrderAction('Place', {
            expectedId: account.book.lastOrderId + 1n,
            terms: terms(state, account),
          });
      return {
        instructions: [
          await venue.client.manageOrder(state, owner, margin!, marketIndex, operation),
        ],
        details: [
          `${quantity} ${selectedMarket.name} · limit ${limit} test USD per unit.`,
          `Lifetime fee budget ${fee} test USD · exclusive expiry slot ${state.slot + BigInt(expiry)}.`,
          trigger
            ? `Trigger index ${trigger === 1 ? '≥' : '≤'} ${threshold}; an execution attempt is not guaranteed to fill.`
            : 'Persistent limit order against maker liquidity.',
        ],
      };
    });
  const protect = () =>
    prepare(`Protect ${selectedMarket.name}`, async (state, owner) => {
      const account = currentRoot(state, owner),
        position = account.positions[marketIndex],
        lots = groupQuantity(quantity, marketIndex);
      if (position.lots === 0n || lots > abs(position.lots))
        throw new Error('TP/SL must protect at most this existing position.');
      const long = position.lots > 0n;
      const operation = sdk.groupOrderAction('Protect', {
        expectedId: account.book.lastOrderId + 1n,
        takeProfit: terms(state, account, undefined, {
          trigger: long ? 1 : 2,
          threshold: takeProfit,
          limit: tpLimit,
        }),
        stopLoss: terms(state, account, undefined, {
          trigger: long ? 2 : 1,
          threshold: stopLoss,
          limit: slLimit,
        }),
      });
      return {
        instructions: [
          await venue.client.manageOrder(state, owner, margin!, marketIndex, operation),
        ],
        details: [
          `Protect ${quantity} ${selectedMarket.name} of existing generation ${position.generation}.`,
          `Take profit ${takeProfit}, limit ${tpLimit}; stop loss ${stopLoss}, limit ${slLimit} test USD per unit.`,
          'Both reduce-only orders share one remaining position allowance. Triggers authorize attempts; liquidity and safeguards still apply.',
        ],
      };
    });
  const selectReplacement = (id: string) => {
    setReplaceId(id);
    const previous = activeOrders.find(
      (entry) => String(entry.order.id) === id && entry.marketIndex === marketIndex,
    )?.order;
    if (!previous) return;
    const decimal = (value: bigint, decimals: number) => fixed(value, decimals).replaceAll(',', '');
    const price = (value: bigint) => decimal(value * GROUP_MARKETS[marketIndex].lotsPerUnit, 6);
    setSide(previous.side as 0 | 1);
    setReduceOnly(previous.reduceOnly);
    setQuantity(decimal(previous.lots, selectedMarket.decimals));
    setLimit(price(previous.limit));
    setFee(decimal(previous.feeBudget, 6));
    setTrigger(previous.trigger);
    setThreshold(price(previous.threshold));
    setExpiry(
      String(
        previous.expirySlot > (snapshot?.slot ?? 0n)
          ? previous.expirySlot - (snapshot?.slot ?? 0n)
          : 600n,
      ),
    );
  };
  const cancel = (id: bigint, protectionGroup = false) =>
    prepare(protectionGroup ? 'Cancel protection' : 'Cancel order', async (state, owner) => {
      const account = currentRoot(state, owner),
        entry = account.book.orders.find((entry) =>
          protectionGroup ? entry.order.groupId === id : entry.order.id === id,
        );
      if (!entry) throw new Error('Order changed.');
      const version = protectionGroup
        ? account.book.protections.find((entry) => entry.protection.id === id)!.protection.version
        : entry.order.version;
      return {
        instructions: [
          await venue.client.cancel(state, owner, margin!, id, version, protectionGroup),
        ],
        details: ['Direct RPC cancellation; no venue API or fresh execution price required.'],
      };
    });
  const setAuthority = (revoke: boolean) =>
    prepare(revoke ? 'Revoke delegate' : 'Set delegate', async (state, owner) => ({
      instructions: [
        await venue.client.setDelegate(
          state,
          owner,
          margin!,
          revoke ? zero : address(delegate),
          revoke ? 0n : state.slot + integer(delegateSlots, 'Delegate lifetime', 216_000n),
        ),
      ],
      details: [
        revoke
          ? 'Invalidate the account delegate immediately.'
          : `Delegate trading/cancellation to ${delegate} for ${delegateSlots} slots.`,
        'The owner retains transfers, withdrawals and closed-claim netting.',
      ],
    }));
  const net = () =>
    prepare('Net closed claims', async (state, owner) => ({
      instructions: [await venue.client.netClosedClaims(state, owner, margin!, marketIndex, units(amount, 6, 'Claim netting amount'))],
      details: [
        'Explicitly net the selected market’s positive closed claim against the other market’s debt in this flat account. The collateral amount is the requested net amount; a current backing certificate is required. No sibling claims participate.',
      ],
    }));
  const offeredChoices = Array.from({length:9}, (_, index) => index);
  return {
    config,
    portfolioIndex,
    setPortfolioIndex,
    subaccount,
    setSubaccount,
    marketIndex,
    setMarketIndex,
    venue,
    snapshot,
    portfolio,
    accounts,
    margin,
    root,
    collateral,
    setCollateral,
    amount,
    setAmount,
    recipient,
    setRecipient,
    side,
    setSide,
    quantity,
    setQuantity,
    allIn,
    setAllIn,
    fee,
    setFee,
    reduceOnly,
    setReduceOnly,
    limit,
    setLimit,
    expiry,
    setExpiry,
    trigger,
    setTrigger,
    threshold,
    setThreshold,
    replaceId,
    setReplaceId: selectReplacement,
    takeProfit,
    setTakeProfit,
    stopLoss,
    setStopLoss,
    tpLimit,
    setTpLimit,
    slLimit,
    setSlLimit,
    delegate,
    setDelegate,
    delegateSlots,
    setDelegateSlots,
    selectedMarket,
    view,
    disabled,
    financialDisabled,
    marketAllowed,
    activeOrders,
    create,
    cash,
    allocate,
    trade,
    order,
    protect,
    cancel,
    setAuthority,
    net,
    offeredChoices,
  };
}
export type AccountController = ReturnType<typeof useAccountController>;
