import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter';
import * as sdk from '@rivalt/sdk';
import type { TraderConfig } from './main.js';
import { useVenue, http } from './useVenue.js';
import { fixed, integer, rational, short, units } from './amount.js';

const abs = (n: bigint) => (n < 0n ? -n : n);
const orderStates = ['Empty', 'Open', 'Partial', 'Filled', 'Cancelled', 'Expired', 'Invalidated'];
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Metric({
  label,
  value,
  hint,
  test,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  test?: string;
}) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd data-testid={test}>{value}</dd>
      {hint && <small>{hint}</small>}
    </div>
  );
}

/** Only pixel coordinates use Number; prices and candle comparisons remain rational bigint. */
function Candles({ items, ready }: { items: any[]; ready: boolean }) {
  const prices = items
    .flatMap((c) => [c.low, c.high])
    .map((p) => (BigInt(p.numerator) * 1_000_000n) / BigInt(p.denominator));
  const low = prices.length ? prices.reduce((a, b) => (a < b ? a : b)) : 0n,
    high = prices.length ? prices.reduce((a, b) => (a > b ? a : b)) : 0n,
    span = high - low || 1n;
  const y = (p: any) =>
    200 - Number((((BigInt(p.numerator) * 1_000_000n) / BigInt(p.denominator) - low) * 160n) / span);
  const first = BigInt(items[0]?.start ?? 0),
    last = BigInt(items.at(-1)?.start ?? 0),
    timeSpan = last - first || 60n;
  return (
    <section className="panel chart" aria-labelledby="chart-heading">
      <div className="panel-title">
        <h2 id="chart-heading">Executed price</h2>
        <span>1 min · actual fills</span>
      </div>
      {!ready ? (
        <div className="empty">Fill history unavailable. Chain balances remain separate.</div>
      ) : !items.length ? (
        <div className="empty">
          No finalized fills in the last hour.<small>Candles appear when trades execute.</small>
        </div>
      ) : (
        <>
          <svg
            viewBox="0 0 700 230"
            role="img"
            aria-label="One-minute candles from actual finalized fills. Empty intervals are not filled."
          >
            {[40, 120, 200].map((v) => (
              <line key={v} x1="20" x2="680" y1={v} y2={v} className="gridline" />
            ))}
            {items.map((c) => {
              const x = 35 + Number(((BigInt(c.start) - first) * 630n) / timeSpan),
                up =
                  BigInt(c.close.numerator) * BigInt(c.open.denominator) >=
                  BigInt(c.open.numerator) * BigInt(c.close.denominator);
              return (
                <g key={c.start} className={up ? 'candle-up' : 'candle-down'}>
                  <title>
                    {new Date(Number(c.start) * 1000).toISOString()} · O{' '}
                    {rational(c.open.numerator, c.open.denominator)} H{' '}
                    {rational(c.high.numerator, c.high.denominator)} L{' '}
                    {rational(c.low.numerator, c.low.denominator)} C{' '}
                    {rational(c.close.numerator, c.close.denominator)} · {fixed(c.volumeLots)} BTC
                  </title>
                  <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} />
                  <rect
                    x={x - 4}
                    y={Math.min(y(c.open), y(c.close))}
                    width="8"
                    height={Math.max(2, Math.abs(y(c.close) - y(c.open)))}
                  />
                </g>
              );
            })}
          </svg>
          <div className="chart-labels">
            <span>
              {fixed(low, 6)}–{fixed(high, 6)} test USD / BTC
            </span>
            <span>No-trade intervals stay empty</span>
          </div>
          <details>
            <summary>Accessible candle data</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>UTC minute</th>
                    <th>Open</th>
                    <th>High</th>
                    <th>Low</th>
                    <th>Close</th>
                    <th>BTC</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.start}>
                      <td>{new Date(Number(c.start) * 1000).toISOString().slice(11, 16)}</td>
                      {['open', 'high', 'low', 'close'].map((k) => (
                        <td key={k}>{rational(c[k].numerator, c[k].denominator)}</td>
                      ))}
                      <td>{fixed(c.volumeLots)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

export function App({ config }: { config: TraderConfig }) {
  const v = useVenue(config),
    s = v.snapshot;
  const [theme, setTheme] = useState(() =>
    localStorage.getItem('rivalt:theme') === 'light' ? 'light' : 'dark',
  );
  const [side, setSide] = useState(0),
    [size, setSize] = useState('0.0001'),
    [cash, setCash] = useState('10'),
    [token, setToken] = useState('');
  const [orderSide, setOrderSide] = useState(0),
    [orderSize, setOrderSize] = useState('0.00001'),
    [limit, setLimit] = useState('60000'),
    [fee, setFee] = useState('0.001');
  const [expiry, setExpiry] = useState('3600'),
    [trigger, setTrigger] = useState(0),
    [threshold, setThreshold] = useState('61000'),
    [reduce, setReduce] = useState(false),
    [editing, setEditing] = useState<bigint>();
  const [tp, setTp] = useState('61000'),
    [sl, setSl] = useState('59000'),
    [protectionSize, setProtectionSize] = useState('0.00001');
  const reviewDialog = useRef<HTMLDialogElement>(null),
    returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('rivalt:theme', theme);
  }, [theme]);
  useEffect(() => {
    setEditing(undefined);
    setToken('');
  }, [v.owner]);
  useEffect(() => {
    if (v.review) {
      returnFocus.current = document.activeElement as HTMLElement;
      reviewDialog.current?.showModal();
    } else if (reviewDialog.current?.open) {
      reviewDialog.current.close();
      returnFocus.current?.focus();
    }
  }, [v.review]);
  const p = s && v.owner ? Object.values(s.participants).find((p) => p.owner === v.owner) : undefined;
  const balance =
    s && p
      ? sdk.balanceView(p, { market: s.m, risk: s.risk, resolution: s.resolutionState }, s.slot, s.now)
      : undefined;
  const capacity = s && p ? sdk.userCapacity(s, p) : undefined;
  const selectedToken = v.tokens.find((t) => t.address === (token || v.tokens[0]?.address));
  const disabled = !v.canSign || Boolean(v.busy) || Boolean(v.rpcError) || !s;
  const tradeDisabled =
    disabled ||
    !p ||
    !v.feed.ready ||
    s?.m.mode !== 2 ||
    Boolean(s?.m.paused) ||
    s?.sourceMode === 'NoCredibleBounds';
  const source = s?.m.mode === 3 ? 'Frozen' : (s?.sourceMode ?? 'Connecting');
  const submit = (fn: () => void) => (e: FormEvent) => {
    e.preventDefault();
    fn();
  };
  const prepare = (
    label: string,
    build: (
      snap: sdk.UserSnapshot,
      owner: sdk.Participant['owner'],
    ) => Promise<{ instructions: any[]; details: string[]; label?: string }>,
    via: 'rpc' | 'api' = 'api',
  ) =>
    void v.preview(async (snap, owner) => {
      const result = await build(snap, owner);
      return {
        ...(await v.client.prepare(result.label ?? label, owner, result.instructions, result.details)),
        via,
      };
    });
  const collateral = (action: 'Deposit' | 'Withdraw' | 'Settle profit') =>
    prepare(
      action,
      async (snap, owner) => {
        const amount = units(cash, 6),
          u = await v.client.user(snap, owner);
        if (!u.p || !selectedToken)
          throw new Error('A registered account and an existing test collateral token account are required.');
        if (action === 'Deposit') {
          const available =
            (await v.client.walletTokens(owner)).find((t) => t.address === selectedToken.address)?.amount ??
            0n;
          if (amount > available)
            throw new Error(`Insufficient wallet collateral. Available: ${fixed(available)} test USD.`);
        }
        if (action === 'Deposit')
          return {
            instructions: [
              await sdk.getDepositInstructionAsync({
                ...snap,
                owner: u.signer,
                participant: u.participant,
                quoteMint: config.mint,
                userToken: selectedToken.address,
                amount,
              }),
            ],
            details: [
              `Deposit ${fixed(amount)} test USD from ${short(selectedToken.address)}.`,
              `Funded cash increases only after the SPL transfer finalizes.`,
            ],
          };
        const exit = await v.client.exitInstructions(
          snap,
          owner,
          selectedToken.address,
          amount,
          action === 'Settle profit',
        );
        return {
          ...exit,
          label: exit.verificationOnly ? 'Verify exit cohort' : action,
          details: exit.verificationOnly
            ? [
                'Verify the next cohort page. This transaction moves no collateral.',
                'Prepare the exit again after finalization.',
              ]
            : [
                `${action}: ${fixed(amount)} test USD.`,
                action === 'Withdraw'
                  ? `Destination ${selectedToken.address}`
                  : 'Convert eligible unpaid profit into funded cash from the settlement pool.',
                'A complete cohort check and post-action margin are enforced on chain.',
              ],
        };
      },
      action === 'Deposit' ? 'api' : 'rpc',
    );
  const trade = () =>
    prepare(side === 0 ? 'Buy BTC' : 'Sell BTC', async (snap, owner) => {
      const lots = units(size, 6, 'BTC size');
      if (lots > 1000n) throw new Error('This local profile supports at most 0.001 BTC per route.');
      const quote = await http(config.apiBase, '/v1/quote', { owner, side, lots: String(lots) }),
        fresh = await v.client.snapshot('confirmed'),
        q = await v.client.validateQuote(fresh, owner, side, lots, quote);
      return {
        instructions: q.instructions,
        details: [
          `${side === 0 ? 'Buy' : 'Sell'} ${fixed(lots)} BTC`,
          ...q.legs.map(
            (l) =>
              `Maker ${l.makerId === 0 ? 'A' : 'B'}: ${fixed(l.lots)} BTC · gross ${fixed(l.gross)} test USD`,
          ),
          `Gross ${fixed(q.gross)} · venue fee ${fixed(q.fee)} test USD (2 bps)`,
          `All-in ${side === 0 ? 'debit' : 'credit'} ${fixed(q.allIn)} test USD`,
          'Preview uses confirmed state. The fill remains pending until independently finalized.',
          `Quote expires at slot ${q.expirySlot}. A stale quote rejects atomically.`,
        ],
      };
    });
  const terms = async (snap: sdk.UserSnapshot, owner: sdk.Participant['owner']) => {
    const u = await v.client.user(snap, owner);
    if (!u.p) throw new Error('Register an account first.');
    const previous = editing === undefined ? undefined : u.p.book.orders.find((o) => o.id === editing);
    if (editing !== undefined && !previous)
      throw new Error('The selected order changed. Refresh its details.');
    const lots = units(orderSize, 6, 'Order BTC size');
    if (lots > 1000n) throw new Error('Order size exceeds 0.001 BTC.');
    const price = integer(limit, 'Limit price', 110000n);
    if (price < 9000n) throw new Error('Limit must be at least 9,000 test USD / BTC.');
    const feeBudget = units(fee, 6, 'Lifetime fee budget');
    if (feeBudget > 1_000_000n) throw new Error('Lifetime fee budget exceeds 1 test USD.');
    const triggerPrice = trigger ? integer(threshold, 'Trigger index', 100000n) : 0n;
    if (trigger && triggerPrice < 10000n) throw new Error('Trigger must be at least 10,000.');
    const t = {
      side: previous?.side ?? orderSide,
      lots,
      limit: price,
      feeBudget,
      startSlot: snap.slot,
      expirySlot: snap.slot + integer(expiry, 'Expiry slots', 216000n),
      trigger,
      threshold: triggerPrice,
      reduceOnly: previous?.reduceOnly ?? reduce,
      generation: previous?.generation ?? (reduce ? u.p.generation : 0n),
    };
    return { u, t, previous };
  };
  const place = () =>
    prepare(editing === undefined ? 'Place order' : `Replace order ${editing}`, async (snap, owner) => {
      const { u, t, previous } = await terms(snap, owner),
        ix = previous
          ? await sdk.getReplaceOrderInstructionAsync({
              ...snap,
              owner: u.signer,
              participant: u.participant,
              id: previous.id,
              version: previous.version,
              terms: t,
            })
          : await sdk.getPlaceOrderInstructionAsync({
              ...snap,
              owner: u.signer,
              participant: u.participant,
              expectedId: u.p.book.lastOrderId + 1n,
              terms: t,
            });
      return {
        instructions: [ix],
        details: [
          `${t.side === 0 ? 'Buy' : 'Sell'} total ${fixed(t.lots)} BTC at limit ${fixed(t.limit, 0)} test USD / BTC`,
          `Lifetime fee budget ${fixed(t.feeBudget)} test USD; charged fee prefix is retained on replacement.`,
          t.reduceOnly
            ? `Reduce only · position generation ${t.generation}`
            : 'Adds position risk and reserves funded cash.',
          `Trigger ${t.trigger === 0 ? 'none' : `${t.trigger === 1 ? 'index ≥' : 'index ≤'} ${fixed(t.threshold, 0)}`}; exclusive expiry slot ${t.expirySlot}.`,
        ],
      };
    });
  const edit = (o: sdk.StoredOrder) => {
    setEditing(o.id);
    setOrderSide(o.side);
    setOrderSize(fixed(o.lots, 6).replaceAll(',', ''));
    setLimit(String(o.limit));
    setFee(fixed(o.feeBudget, 6).replaceAll(',', ''));
    setTrigger(o.trigger);
    setThreshold(String(o.threshold || 61000n));
    setReduce(o.reduceOnly);
    v.invalidate();
    document.getElementById('order-size')?.focus();
  };
  const cancel = (o: sdk.StoredOrder) =>
    prepare(
      `Cancel order ${o.id}`,
      async (snap, owner) => {
        const u = await v.client.user(snap, owner),
          current = u.p?.book.orders.find((x) => x.id === o.id);
        if (!current) throw new Error('Order no longer exists.');
        return {
          instructions: [
            await sdk.getCancelOrderInstructionAsync({
              ...snap,
              owner: u.signer,
              participant: u.participant,
              id: current.id,
              version: current.version,
            }),
          ],
          details: [
            `Cancel order ${o.id}, version ${current.version}, directly over RPC.`,
            `Any fill that finalizes first remains executed. Only the remaining authority is cancelled.`,
          ],
        };
      },
      'rpc',
    );
  const protection = () =>
    prepare('Place TP/SL', async (snap, owner) => {
      const u = await v.client.user(snap, owner);
      if (!u.p?.lots) throw new Error('TP/SL requires an existing position.');
      const lots = units(protectionSize, 6, 'Protected BTC');
      if (lots > abs(u.p.lots)) throw new Error('Protected size exceeds this position.');
      const long = u.p.lots > 0n,
        tpPrice = integer(tp, 'Take profit index', 100000n),
        slPrice = integer(sl, 'Stop loss index', 100000n),
        limitPrice = integer(limit, 'Execution limit', 110000n),
        feeBudget = units(fee, 6, 'Lifetime fee budget');
      const common = {
        side: long ? 1 : 0,
        lots,
        limit: limitPrice,
        feeBudget,
        startSlot: snap.slot,
        expirySlot: snap.slot + integer(expiry, 'Expiry slots', 216000n),
        reduceOnly: true,
        generation: u.p.generation,
      };
      return {
        instructions: [
          await sdk.getPlaceProtectionInstructionAsync({
            ...snap,
            owner: u.signer,
            participant: u.participant,
            expectedId: u.p.book.lastOrderId + 1n,
            tp: { ...common, trigger: long ? 1 : 2, threshold: tpPrice },
            sl: { ...common, trigger: long ? 2 : 1, threshold: slPrice },
          }),
        ],
        details: [
          `Protect ${fixed(lots)} BTC of existing generation ${u.p.generation}.`,
          `TP index ${tpPrice} · SL index ${slPrice} test USD / BTC`,
          `Execution limit ${limitPrice} · fee budget ${fixed(feeBudget)} per order.`,
          `Both orders share one remaining size allowance. Fills are not guaranteed after a trigger.`,
        ],
      };
    });
  return (
    <>
      <a className="skip" href="#account">
        Skip to account
      </a>
      <header className="topbar">
        <a href="#" className="wordmark">
          Rivalt
          <span className="brand-dot" />
        </a>
        <div className="network">
          Local test venue <span aria-hidden="true">·</span> BTC / test USD
        </div>
        <div className="header-actions">
          <button
            className="quiet"
            aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☀' : '◐'}
          </button>
          <WalletMultiButton />
        </div>
      </header>
      <main>
        <section className="market-header">
          <div>
            <div className="eyebrow">COMMON CLEARING · COMPETING MAKERS</div>
            <h1>BTC perpetual</h1>
            <p>Isolated collateral. One position across both makers.</p>
          </div>
          <span className={`status ${source === 'Normal' ? 'good' : 'warning'}`} data-testid="source-mode">
            {source}
          </span>
        </section>
        <div className="announcements" aria-live="polite">
          {v.notice && (
            <p className="notice" role="status">
              {v.notice}
            </p>
          )}
          {v.error && (
            <p className="error" role="alert">
              {v.error}
            </p>
          )}
          {v.rpcError && (
            <p className="error" role="alert">
              {v.rpcError} <button onClick={() => void v.refresh()}>Retry RPC</button>
            </p>
          )}
          {v.apiError && (
            <p className="warning notice" role="status">
              {v.apiError}
            </p>
          )}
          {v.owner && !v.canSign && (
            <p className="warning notice">
              This wallet account cannot sign v0 transactions on the configured local test network.
            </p>
          )}
          {s?.m.mode === 3 && (
            <p className="warning notice">
              Market frozen. Complete-cohort recovery is in progress. Trading, deposits and ordinary exits are
              disabled.
            </p>
          )}
        </div>
        <dl className="market-metrics">
          <Metric
            label="Index reference"
            value={s?.risk ? fixed(s.risk.referencePrice, 0) : '—'}
            hint="test USD / BTC · controlled local feeds"
          />
          <Metric
            label="Risk interval"
            value={s?.risk ? `${fixed(s.risk.lower, 0)} – ${fixed(s.risk.upper, 0)}` : '—'}
            hint="Independent source bounds"
          />
          <Metric
            label="Last actual fill"
            value={
              v.feed.ready && v.feed.trades.length
                ? rational(v.feed.trades.at(-1).payload.grossQuote, v.feed.trades.at(-1).payload.lots)
                : '—'
            }
            hint="Execution price, not risk valuation"
          />
          <Metric
            label="Funding index"
            value={s ? fixed(s.funding, 9) : '—'}
            hint="test USD / BTC · cumulative"
          />
        </dl>
        <div className="trading-grid">
          <div className="market-column">
            <Candles items={v.feed.candles} ready={v.feed.ready} />
            <section className="panel" id="account" aria-labelledby="account-heading">
              <div className="panel-title">
                <h2 id="account-heading">Your isolated account</h2>
                <span>{v.owner ? short(v.owner) : 'Wallet disconnected'}</span>
              </div>
              {!v.owner ? (
                <div className="empty">Connect a wallet to view your account and sign transactions.</div>
              ) : !s ? (
                <div className="empty" role="status">
                  Reading the finalized cohort…
                </div>
              ) : !p ? (
                <div className="empty">
                  <p>No clearing account for this wallet.</p>
                  <button
                    disabled={disabled}
                    onClick={() =>
                      prepare(
                        'Register account',
                        async (snap, owner) => {
                          const u = await v.client.user(snap, owner);
                          return {
                            instructions: [
                              await sdk.getRegisterParticipantInstructionAsync({
                                ...snap,
                                owner: u.signer,
                                participant: u.participant,
                              }),
                            ],
                            details: [
                              'Create your isolated participant account. Network rent is paid by your wallet.',
                            ],
                          };
                        },
                        'rpc',
                      )
                    }
                  >
                    Register account
                  </button>
                </div>
              ) : (
                <>
                  <dl className="account-metrics">
                    <Metric
                      label="Funded cash"
                      value={fixed(p.cash)}
                      test="funded-cash"
                      hint="test USD · actual collateral"
                    />
                    <Metric
                      label="Unpaid profit / loss"
                      value={fixed(balance?.unpaidPnlScaled, 15)}
                      test="unpaid-pnl"
                      hint="test USD · positive profit gives zero margin credit"
                    />
                    <Metric
                      label="Position"
                      value={`${fixed(p.lots)} BTC`}
                      test="position"
                      hint={`Generation ${p.generation}`}
                    />
                    <Metric
                      label="Risk equity"
                      value={fixed(balance?.riskEquity)}
                      hint="Cash minus adverse unpaid liability"
                    />
                    <Metric
                      label="Order reserve"
                      value={fixed(balance?.currentRequiredReserve)}
                      hint="test USD · currently required"
                    />
                    <Metric
                      label="Withdrawable preview"
                      value={fixed(capacity?.withdrawable)}
                      test="withdrawable"
                      hint="Subject to fresh cohort and margin checks"
                    />
                  </dl>
                  <p className="caption">
                    Funded settlement available to you:{' '}
                    <strong data-testid="settleable">{fixed(capacity?.settleable)} test USD</strong>. Positive
                    unpaid profit becomes cash only when settlement is funded.
                    {capacity?.reason && ` ${capacity.reason}`}
                  </p>
                  {balance?.resolution && (
                    <dl className="account-metrics">
                      <Metric label="Resolution stage" value={balance.resolution.stage} />
                      <Metric
                        label="Planned payment"
                        value={fixed(balance.resolution.plannedPayment)}
                        hint="A plan is not yet cash"
                      />
                      <Metric
                        label="Payment applied"
                        value={balance.resolution.paymentApplied ? 'Yes' : 'No'}
                      />
                    </dl>
                  )}
                  <form onSubmit={submit(() => collateral('Deposit'))} className="cash-form">
                    <Field label="Collateral account">
                      <select
                        aria-label="Collateral account"
                        value={selectedToken?.address ?? ''}
                        onChange={(e) => {
                          setToken(e.target.value);
                          v.invalidate();
                        }}
                      >
                        {v.tokens.length ? (
                          v.tokens.map((t) => (
                            <option key={t.address} value={t.address}>
                              {short(t.address)} · {fixed(t.amount)} test USD
                            </option>
                          ))
                        ) : (
                          <option value="">No test collateral account</option>
                        )}
                      </select>
                    </Field>
                    <Field label="Collateral amount" hint="Test USD, up to 6 decimals">
                      <input
                        aria-label="Collateral amount"
                        inputMode="decimal"
                        value={cash}
                        onChange={(e) => {
                          setCash(e.target.value);
                          v.invalidate();
                        }}
                      />
                    </Field>
                    <div className="button-row">
                      <button
                        type="submit"
                        disabled={disabled || !selectedToken || s.m.paused || s.m.mode === 3 || !v.feed.ready}
                      >
                        Deposit
                      </button>
                      <button
                        type="button"
                        disabled={disabled || !selectedToken || !capacity?.withdrawable}
                        onClick={() => collateral('Withdraw')}
                      >
                        Withdraw via RPC
                      </button>
                      <button
                        type="button"
                        disabled={disabled || !selectedToken || !capacity?.settleable}
                        onClick={() => collateral('Settle profit')}
                      >
                        Settle profit via RPC
                      </button>
                    </div>
                  </form>
                </>
              )}
            </section>
          </div>
          <aside className="panel trade-ticket" aria-labelledby="trade-heading">
            <div className="panel-title">
              <h2 id="trade-heading">Trade</h2>
              <span>2 bps taker fee</span>
            </div>
            <form onSubmit={submit(trade)}>
              <div className="segmented" aria-label="Trade direction">
                <button
                  type="button"
                  aria-pressed={side === 0}
                  onClick={() => {
                    setSide(0);
                    v.invalidate();
                  }}
                >
                  Buy / long
                </button>
                <button
                  type="button"
                  aria-pressed={side === 1}
                  onClick={() => {
                    setSide(1);
                    v.invalidate();
                  }}
                >
                  Sell / short
                </button>
              </div>
              <Field label="BTC size" hint="0.000001–0.001 BTC in this test profile">
                <input
                  aria-label="BTC size"
                  inputMode="decimal"
                  value={size}
                  onChange={(e) => {
                    setSize(e.target.value);
                    v.invalidate();
                  }}
                />
              </Field>
              <button className="primary full" disabled={tradeDisabled} type="submit">
                Get quote
              </button>
              <p className="caption">
                Review up to two maker legs before signing. The submitted route fills atomically.
                Provider-side maker fee: 0 bps.
              </p>
            </form>
            <div className="ticket-divider" />
            <h3>Direct recovery</h3>
            <p className="caption">
              Cancel orders and withdraw eligible cash over RPC even if venue APIs are unavailable. Frozen
              markets and on-chain margin checks still apply.
            </p>
            <a href="#orders">Manage orders ↓</a>
            <dl className="deployment">
              <dt>Network</dt>
              <dd>Local test only</dd>
              <dt>Market</dt>
              <dd>
                <code title={config.market}>{short(config.market)}</code>
              </dd>
              <dt>Finalized slot</dt>
              <dd>{s?.slot.toString() ?? '—'}</dd>
            </dl>
          </aside>
        </div>
        <section className="panel" id="orders" aria-labelledby="orders-heading">
          <div className="panel-title">
            <h2 id="orders-heading">Orders & position protection</h2>
            <span>Durable on-chain authority</span>
          </div>
          <div className="order-layout">
            <form onSubmit={submit(place)}>
              <h3>{editing === undefined ? 'New limit / stop order' : `Replace order ${editing}`}</h3>
              <div className="form-grid">
                <Field label="Order side">
                  <select
                    aria-label="Order side"
                    value={orderSide}
                    disabled={editing !== undefined}
                    onChange={(e) => setOrderSide(Number(e.target.value))}
                  >
                    <option value={0}>Buy</option>
                    <option value={1}>Sell</option>
                  </select>
                </Field>
                <Field label="Total BTC size" hint="Includes fills already executed when replacing">
                  <input
                    id="order-size"
                    aria-label="Order BTC size"
                    inputMode="decimal"
                    value={orderSize}
                    onChange={(e) => setOrderSize(e.target.value)}
                  />
                </Field>
                <Field
                  label="Execution limit"
                  hint="All-in price including venue fees · whole test USD / BTC"
                >
                  <input
                    aria-label="Execution limit"
                    inputMode="numeric"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                  />
                </Field>
                <Field label="Lifetime fee budget" hint="Test USD, shared across partial fills">
                  <input
                    aria-label="Lifetime fee budget"
                    inputMode="decimal"
                    value={fee}
                    onChange={(e) => setFee(e.target.value)}
                  />
                </Field>
                <Field label="Trigger">
                  <select
                    aria-label="Trigger"
                    value={trigger}
                    onChange={(e) => setTrigger(Number(e.target.value))}
                  >
                    <option value={0}>None · limit order</option>
                    <option value={1}>Index at or above</option>
                    <option value={2}>Index at or below</option>
                  </select>
                </Field>
                {trigger > 0 && (
                  <Field label="Trigger index">
                    <input
                      aria-label="Trigger index"
                      inputMode="numeric"
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                    />
                  </Field>
                )}
                <Field label="Expiry in slots" hint="Exclusive; maximum 216,000 slots">
                  <input
                    aria-label="Expiry in slots"
                    inputMode="numeric"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                  />
                </Field>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={reduce}
                  disabled={editing !== undefined}
                  onChange={(e) => setReduce(e.target.checked)}
                />
                Reduce existing position only
              </label>
              <div className="button-row">
                <button disabled={tradeDisabled} type="submit">
                  {editing === undefined ? 'Review order' : 'Review replacement'}
                </button>
                {editing !== undefined && (
                  <button type="button" onClick={() => setEditing(undefined)}>
                    New order
                  </button>
                )}
              </div>
            </form>
            <form onSubmit={submit(protection)}>
              <h3>Existing-position TP / SL</h3>
              <p className="caption">
                Uses the execution limit, fee budget and expiry shown in the order form. Both legs reduce the
                current generation and share one size allowance.
              </p>
              <Field label="Protected BTC">
                <input
                  aria-label="Protected BTC"
                  inputMode="decimal"
                  value={protectionSize}
                  onChange={(e) => setProtectionSize(e.target.value)}
                />
              </Field>
              <div className="form-grid">
                <Field label="Take profit index">
                  <input
                    aria-label="Take profit index"
                    inputMode="numeric"
                    value={tp}
                    onChange={(e) => setTp(e.target.value)}
                  />
                </Field>
                <Field label="Stop loss index">
                  <input
                    aria-label="Stop loss index"
                    inputMode="numeric"
                    value={sl}
                    onChange={(e) => setSl(e.target.value)}
                  />
                </Field>
              </div>
              <button disabled={tradeDisabled || !p?.lots} type="submit">
                Review TP/SL
              </button>
              <p className="caption">
                A trigger authorizes execution at your limit; it does not guarantee a fill.
              </p>
            </form>
          </div>
          {!p?.book.orders.some((o) => o.id > 0n) ? (
            <p className="empty compact">No on-chain orders for this account.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Side / type</th>
                    <th>Filled / total BTC</th>
                    <th>Limit</th>
                    <th>Status / allowance</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {p.book.orders
                    .filter((o) => o.id > 0n)
                    .map((o) => {
                      const remaining = sdk.orderRemaining(p, o, s!.m.termsEpoch, s!.slot),
                        active = o.state === 1 || o.state === 2;
                      return (
                        <tr key={o.id.toString()} data-testid={`order-${o.id}`}>
                          <td>
                            #{o.id.toString()}{' '}
                            <small>
                              v{o.version.toString()} · gen {o.generation.toString()}
                            </small>
                          </td>
                          <td>
                            {o.side === 0 ? 'Buy' : 'Sell'}{' '}
                            {o.groupId > 0n ? `· TP/SL ${o.groupId}` : o.trigger ? '· stop' : '· limit'}
                            <small>
                              {o.reduceOnly ? 'Reduce only' : 'Opening authority'}
                              {o.trigger ? ` · index ${o.trigger === 1 ? '≥' : '≤'} ${o.threshold}` : ''}
                            </small>
                          </td>
                          <td>
                            {fixed(o.filled)} / {fixed(o.lots)}
                          </td>
                          <td>{fixed(o.limit, 0)}</td>
                          <td>
                            {active && remaining === 0n
                              ? 'Inactive (expiry / generation / allowance)'
                              : (orderStates[o.state] ?? 'Unknown')}
                            <small>
                              Remaining {fixed(remaining)} BTC · fee {fixed(o.feeCharged)}
                            </small>
                          </td>
                          <td>
                            <div className="button-row">
                              <button
                                disabled={tradeDisabled || !active || remaining === 0n}
                                onClick={() => edit(o)}
                                aria-label={`Edit order ${o.id}`}
                              >
                                Edit
                              </button>
                              <button
                                disabled={disabled || !active}
                                onClick={() => cancel(o)}
                                aria-label={`Cancel order ${o.id} via RPC`}
                              >
                                Cancel via RPC
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
          {p?.book.groups
            .filter((g) => g.id > 0n && g.remaining > 0n && g.generation === p.generation)
            .map((g) => (
              <div className="group-row" key={String(g.id)}>
                <span>
                  TP/SL group {String(g.id)} · shared remaining {fixed(g.remaining)} BTC
                </span>
                <button
                  disabled={disabled}
                  onClick={() =>
                    prepare(
                      `Cancel TP/SL ${g.id}`,
                      async (snap, owner) => {
                        const u = await v.client.user(snap, owner),
                          current = u.p.book.groups.find((x) => x.id === g.id);
                        if (!current) throw new Error('Protection changed.');
                        return {
                          instructions: [
                            await sdk.getCancelProtectionInstructionAsync({
                              ...snap,
                              owner: u.signer,
                              participant: u.participant,
                              groupId: current.id,
                              version: current.version,
                            }),
                          ],
                          details: ['Cancel both remaining protective authorities directly over RPC.'],
                        };
                      },
                      'rpc',
                    )
                  }
                >
                  Cancel TP/SL group {String(g.id)}
                </button>
              </div>
            ))}
        </section>
        <div className="history-grid">
          <section className="panel">
            <div className="panel-title">
              <h2>Wallet activity</h2>
              <button onClick={() => void v.refresh()}>Refresh</button>
            </div>
            <p className="caption">
              Saved signatures are reconciled independently over RPC. An unresolved outcome must be checked
              before repeating the action.
            </p>
            {!v.records.length ? (
              <p className="empty compact">No signed transactions saved for this wallet and deployment.</p>
            ) : (
              <ul className="activity">
                {[...v.records]
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((r) => (
                    <li key={r.id} data-testid={`receipt-${r.id}`}>
                      <div>
                        <strong>{r.label}</strong>
                        <span
                          className={`status ${r.status === 'finalized' ? 'good' : ''}`}
                          data-testid="receipt-status"
                        >
                          {r.status === 'finalized'
                            ? 'Finalized'
                            : r.status === 'confirmed'
                              ? 'Confirmed · awaiting finality'
                              : r.status}
                        </span>
                      </div>
                      <code title={r.signature}>{r.signature}</code>
                      {r.error && <p>{r.error}</p>}
                      {r.fee && <small>Actual network fee {fixed(r.fee, 9)} SOL</small>}
                      {!['finalized', 'failed'].includes(r.status) && (
                        <button disabled={disabled} onClick={() => void v.resend(r)}>
                          Resend identical bytes via RPC
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </section>
          <section className="panel">
            <div className="panel-title">
              <h2>Venue health</h2>
              <span>{v.feed.ready ? 'Live read API' : 'API unavailable'}</span>
            </div>
            <dl className="health">
              <Metric label="Source state" value={source} />
              <Metric
                label="Recovery"
                value={
                  s?.resolutionState
                    ? `${sdk.RESOLUTION_STAGES[s.resolutionState.header.stage]} · ${s.resolutionState.header.cursor}/${s.resolutionState.header.count}`
                    : 'No resolution'
                }
              />
              {s?.makers.map((m) => (
                <Metric
                  key={m.r.makerId}
                  label={`Maker ${m.r.makerId === 0 ? 'A' : 'B'}`}
                  value={
                    m.r.quarantined
                      ? 'Quarantined'
                      : !m.approved
                        ? 'Program changed'
                        : v.feed.operators?.makers.find((x: any) => x.makerId === m.r.makerId)?.online &&
                            v.feed.ready
                          ? 'Online'
                          : 'Heartbeat unavailable'
                  }
                  hint={`Quote epoch ${m.r.quoteEpoch} · expiry slot ${m.state.expirySlot}`}
                />
              ))}
            </dl>
            <p className="caption">
              Test collateral only. This local engineering deployment is not a funded venue.
            </p>
            <details>
              <summary>Finalized fills & maker legs</summary>
              {v.feed.ready ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Sequence / side</th>
                        <th>Executed BTC</th>
                        <th>Gross / venue fee</th>
                        <th>Maker results</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...v.feed.trades]
                        .reverse()
                        .slice(0, 10)
                        .map((fill: any) => (
                          <tr key={fill.sequence}>
                            <td>
                              {fill.sequence} · {fill.payload.side === 0 ? 'Buy' : 'Sell'}
                              <small>{short(fill.signature)}</small>
                            </td>
                            <td>{fixed(fill.payload.lots)}</td>
                            <td>
                              {fixed(fill.payload.grossQuote)} / {fixed(fill.payload.fee)}
                              <small>test USD · one aggregate fee</small>
                            </td>
                            <td>
                              {fill.payload.legs.map((leg: any) => (
                                <small key={leg.makerId}>
                                  Maker {leg.makerId === 0 ? 'A' : 'B'} · {fixed(leg.lots)} BTC ·{' '}
                                  {fixed(leg.grossQuote)} test USD
                                </small>
                              ))}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>Finalized fill details unavailable.</p>
              )}
            </details>
            <details>
              <summary>Recent finalized order & trade events</summary>
              {v.feed.ready ? (
                <ul className="events">
                  {v.feed.events
                    .filter((x: any) => 'book' in x.payload || 'grossQuote' in x.payload)
                    .slice(-12)
                    .reverse()
                    .map((x: any) => (
                      <li key={x.sequence}>
                        Sequence {x.sequence} ·{' '}
                        {'grossQuote' in x.payload
                          ? `fill ${fixed(x.payload.lots)} BTC, gross ${fixed(x.payload.grossQuote)} test USD`
                          : `order change ${x.payload.kind}`}
                        <code>{short(x.signature)}</code>
                      </li>
                    ))}
                </ul>
              ) : (
                <p>Indexed events unavailable.</p>
              )}
            </details>
          </section>
        </div>
        <footer>
          Rivalt · Local engineering profile <span>All displayed amounts use integer settlement units.</span>
        </footer>
      </main>
      <dialog
        ref={reviewDialog}
        aria-labelledby="review-heading"
        onCancel={(e) => {
          e.preventDefault();
          if (!v.busy) v.invalidate();
        }}
      >
        <div className="panel-title">
          <h2 id="review-heading">{v.review?.label}</h2>
          <button aria-label="Close transaction review" disabled={Boolean(v.busy)} onClick={v.invalidate}>
            ×
          </button>
        </div>
        <p className="caption">Review this exact transaction before opening your wallet.</p>
        <ul className="review-details">
          {v.review?.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
        <dl>
          <Metric
            label="Network fee"
            value={`${fixed(v.review?.fee, 9)} SOL`}
            hint="Separate from collateral and venue fees; account creation may also require rent."
          />
          <Metric label="Submission" value={v.review?.via === 'rpc' ? 'Direct RPC' : 'Venue relay'} />
          <Metric label="Wallet" value={v.review?.owner ? short(v.review.owner) : '—'} />
        </dl>
        {v.error && (
          <p className="error" role="alert">
            {v.error}
          </p>
        )}
        <button
          className="primary full"
          disabled={!v.canSign || Boolean(v.busy)}
          onClick={() => void v.sign()}
        >
          {v.busy || 'Sign transaction'}
        </button>
      </dialog>
    </>
  );
}
