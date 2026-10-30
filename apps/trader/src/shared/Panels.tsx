import { address } from '@solana/kit';
import { fixed, rational, short } from '../amount.js';
import { Field, Metric } from './Primitives.js';
import { MARKETS, accountLabel } from './model.js';
import type { AccountController } from '../account/useAccountController.js';
const zero = address('11111111111111111111111111111111');
const orderStates = ['Empty', 'Open', 'Partial', 'Filled', 'Cancelled', 'Expired', 'Invalidated'];

export function Positions({ controller }: { controller: AccountController }) {
  const { portfolio, margin, view, cash } = controller;
  return (
    <section className="panel">
      <h2>Positions and unpaid claims</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Market</th>
              <th>Position</th>
              <th>Unpaid P&amp;L · test USD</th>
              <th>Pending funding debit</th>
              <th>Price status</th>
            </tr>
          </thead>
          <tbody>
            {view?.positions.map((position, index) => (
              <tr key={index}>
                <td>{MARKETS[index].name}</td>
                <td data-testid={`group-position-${index}`}>
                  {fixed(position.lots, MARKETS[index].decimals)}
                </td>
                <td>{fixed(position.unpaidClaimScaled, 15)}</td>
                <td>{fixed(position.pendingFundingDebitScaled, 15)}</td>
                <td>{position.sourceMode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="caption">
        Unpaid profit is a claim, not withdrawable cash. Funding belongs to this account’s
        positions; portfolio totals do not grant margin credit.
      </p>
    </section>
  );
}

export function Ticket({ controller }: { controller: AccountController }) {
  const {
    marketIndex,
    root,
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
    setReplaceId,
    takeProfit,
    setTakeProfit,
    stopLoss,
    setStopLoss,
    tpLimit,
    setTpLimit,
    slLimit,
    setSlLimit,
    selectedMarket,
    disabled,
    financialDisabled,
    marketAllowed,
    activeOrders,
    trade,
    order,
    protect,
  } = controller;
  return (
    <section className="panel trade-ticket">
      <h2>{selectedMarket.name} order ticket</h2>
      <div className="ticket-divider" />
      <Field label="Side">
        <select value={side} onChange={(event) => setSide(Number(event.target.value) as 0 | 1)}>
          <option value={0}>Buy / long</option>
          <option value={1}>Sell / short</option>
        </select>
      </Field>
      <Field label={`Quantity (${selectedMarket.name})`}>
        <input
          value={quantity}
          inputMode="decimal"
          onChange={(event) => setQuantity(event.target.value)}
        />
      </Field>
      <Field
        label={
          side === 0 ? 'Maximum all-in spend (test USD)' : 'Minimum all-in proceeds (test USD)'
        }
      >
        <input
          value={allIn}
          inputMode="decimal"
          onChange={(event) => setAllIn(event.target.value)}
        />
      </Field>
      <Field label="Venue fee budget (test USD)">
        <input value={fee} inputMode="decimal" onChange={(event) => setFee(event.target.value)} />
      </Field>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={reduceOnly}
          onChange={(event) => setReduceOnly(event.target.checked)}
        />
        Reduce only
      </label>
      <button
        className="primary full"
        disabled={financialDisabled || !marketAllowed}
        onClick={() => void trade()}
      >
        Review atomic trade
      </button>
      <p className="caption">
        2 bps taker fee · zero provider fee. At most two makers; all submitted legs must succeed.
      </p>
      <details>
        <summary>Persistent limit / stop-limit</summary>
        <Field label="Order to replace">
          <select value={replaceId} onChange={(event) => setReplaceId(event.target.value)}>
            <option value="">New order</option>
            {activeOrders
              .filter((entry) => entry.marketIndex === marketIndex && entry.order.groupId === 0n)
              .map((entry) => (
                <option key={String(entry.order.id)} value={String(entry.order.id)}>
                  Order {String(entry.order.id)}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Limit price (test USD per unit)">
          <input value={limit} onChange={(event) => setLimit(event.target.value)} />
        </Field>
        <Field label="Expiry (slots)">
          <input value={expiry} onChange={(event) => setExpiry(event.target.value)} />
        </Field>
        <Field label="Trigger">
          <select value={trigger} onChange={(event) => setTrigger(Number(event.target.value))}>
            <option value={0}>No trigger</option>
            <option value={1}>Index at or above</option>
            <option value={2}>Index at or below</option>
          </select>
        </Field>
        {trigger !== 0 && (
          <Field label="Trigger price">
            <input value={threshold} onChange={(event) => setThreshold(event.target.value)} />
          </Field>
        )}
        <button disabled={financialDisabled || !marketAllowed} onClick={() => void order()}>
          {replaceId ? 'Review replacement' : 'Review persistent order'}
        </button>
      </details>
      <details>
        <summary>Protect existing position</summary>
        <p className="caption">Uses the quantity, expiry and per-order fee budget above.</p>
        <Field label="Take-profit trigger">
          <input value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} />
        </Field>
        <Field label="Take-profit execution limit">
          <input value={tpLimit} onChange={(event) => setTpLimit(event.target.value)} />
        </Field>
        <Field label="Stop-loss trigger">
          <input value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} />
        </Field>
        <Field label="Stop-loss execution limit">
          <input value={slLimit} onChange={(event) => setSlLimit(event.target.value)} />
        </Field>
        <button
          disabled={financialDisabled || !marketAllowed || root?.positions[marketIndex].lots === 0n}
          onClick={() => void protect()}
        >
          Review TP/SL
        </button>
      </details>
    </section>
  );
}

export function Orders({ controller }: { controller: AccountController }) {
  const { marketIndex, snapshot, root, view, disabled, activeOrders, order, cancel } = controller;
  return (
    <section className="panel">
      <h2>Orders in this account</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Order / market</th>
              <th>State</th>
              <th>Remaining</th>
              <th>Reserved · test USD</th>
              <th>Authority</th>
              <th>Cancel</th>
            </tr>
          </thead>
          <tbody>
            {root?.book.orders.map(
              (entry, index) =>
                entry.order.id !== 0n && (
                  <tr key={String(entry.order.id)}>
                    <td>
                      {String(entry.order.id)} · {MARKETS[entry.marketIndex].name}
                      {entry.order.groupId !== 0n ? ' · TP/SL' : ''}
                    </td>
                    <td>{orderStates[entry.order.state]}</td>
                    <td>
                      {fixed(
                        view?.orders[index].remaining,
                        MARKETS[entry.marketIndex].decimals,
                      )}
                    </td>
                    <td>{fixed(view?.orders[index].reserve)}</td>
                    <td>
                      {entry.delegateEpoch === 0n
                        ? 'Owner'
                        : `Delegate epoch ${entry.delegateEpoch}`}
                    </td>
                    <td>
                      {[1, 2].includes(entry.order.state) && (
                        <button
                          disabled={disabled || (snapshot && snapshot.safetyState.mode === 2)}
                          onClick={() =>
                            void cancel(
                              entry.order.groupId || entry.order.id,
                              entry.order.groupId !== 0n,
                            )
                          }
                        >
                          Cancel {entry.order.groupId ? 'pair' : 'order'}
                        </button>
                      )}
                    </td>
                  </tr>
                ),
            )}
          </tbody>
        </table>
      </div>
      {!activeOrders.length && (
        <p className="caption">
          No live orders. Expired or generation-invalidated orders have no executable allowance.
        </p>
      )}
    </section>
  );
}

export function Authority({ controller }: { controller: AccountController }) {
  const {
    root,
    expiry,
    delegate,
    setDelegate,
    delegateSlots,
    setDelegateSlots,
    disabled,
    financialDisabled,
    setAuthority,
  } = controller;
  return (
    <section className="panel">
      <details>
        <summary>Account authority</summary>
        <p className="caption">
          Owner: {root?.owner ?? '—'}
          <br />
          Delegate: {root?.delegate === zero ? 'None' : (root?.delegate ?? '—')} · expiry slot{' '}
          {String(root?.delegateExpirySlot ?? 0n)}
        </p>
        <div className="form-grid">
          <Field label="Delegate public address">
            <input value={delegate} onChange={(event) => setDelegate(event.target.value)} />
          </Field>
          <Field label="Delegate lifetime (slots)">
            <input
              value={delegateSlots}
              onChange={(event) => setDelegateSlots(event.target.value)}
            />
          </Field>
        </div>
        <div className="button-row">
          <button
            disabled={financialDisabled || !delegate}
            onClick={() => void setAuthority(false)}
          >
            Review delegate
          </button>
          <button
            disabled={financialDisabled || root?.delegate === zero}
            onClick={() => void setAuthority(true)}
          >
            Revoke delegate
          </button>
        </div>
      </details>
    </section>
  );
}

export function Fills({ controller }: { controller: AccountController }) {
  const { venue, side, quantity, fee, trade } = controller;
  return (
    <section className="panel">
      <h2>Recent finalized fills</h2>
      {!venue.feed.ready ? (
        <p className="caption">Indexed fill history unavailable.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sequence</th>
                <th>Market</th>
                <th>Side / quantity</th>
                <th>Execution VWAP</th>
                <th>Venue fee</th>
                <th>Signature</th>
              </tr>
            </thead>
            <tbody>
              {[...venue.feed.trades].reverse().map((trade: any) => (
                <tr key={trade.sequence}>
                  <td>{trade.sequence}</td>
                  <td>
                    {MARKETS[Number(trade.payload.marketState.index)]?.name ??
                      'Unknown market'}
                  </td>
                  <td>
                    {trade.payload.side === 0 ? 'Buy' : 'Sell'}{' '}
                    {fixed(
                      trade.payload.lots,
                      MARKETS[Number(trade.payload.marketState.index)].decimals,
                    )}
                  </td>
                  <td>
                    {rational(
                      BigInt(trade.payload.grossQuote) *
                        MARKETS[Number(trade.payload.marketState.index)].lotsPerUnit,
                      BigInt(trade.payload.lots) * 1_000_000n,
                    )}
                  </td>
                  <td>{fixed(trade.payload.fee)}</td>
                  <td>
                    <code title={trade.signature}>{short(trade.signature)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
