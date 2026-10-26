import { address } from '@solana/kit';
import { fixed, rational, short } from '../amount.js';
import { Field, Metric } from './Primitives.js';
import { GROUP_MARKETS, accountLabel } from './model.js';
import type { GroupController } from './useGroupController.js';
const zero = address('11111111111111111111111111111111');
const orderStates = ['Empty', 'Open', 'Partial', 'Filled', 'Cancelled', 'Expired', 'Invalidated'];

export function GroupSelection({ controller }: { controller: GroupController }) {
  const {
    subaccount,
    setSubaccount,
    marketIndex,
    setMarketIndex,
    snapshot,
    portfolio,
    accounts,
    margin,
    root,
    collateral,
    disabled,
    create,
    offeredChoices,
  } = controller;
  return (
    <section className="panel group-selection">
      <Field label="Margin account">
        <select value={subaccount} onChange={(event) => setSubaccount(Number(event.target.value))}>
          {offeredChoices.map((index) => {
            const account = accounts.find(([, value]) => value.subaccountIndex === index)?.[1];
            return (
              <option key={index} value={index}>
                {account
                  ? accountLabel(account)
                  : index === 0
                    ? 'Cross · not registered'
                    : `Isolated ${index === 1 ? 'BTC' : 'ETH'} · not registered`}
              </option>
            );
          })}
        </select>
      </Field>
      <Field label="Market">
        <select
          value={marketIndex}
          disabled={root?.mode === 1}
          onChange={(event) => setMarketIndex(Number(event.target.value) as 0 | 1)}
        >
          {GROUP_MARKETS.map((market, index) => (
            <option key={market.name} value={index}>
              {market.name}
            </option>
          ))}
        </select>
      </Field>
      {!root && (
        <button
          disabled={disabled || Boolean(snapshot?.state.paused) || snapshot?.state.mode === 3}
          onClick={() => void create()}
        >
          {portfolio ? 'Register account' : 'Create portfolio'}
        </button>
      )}
      <p className="caption">
        {margin ? (
          <>
            <code>{margin}</code>
            <br />
            Mode and market membership are fixed when this account is created.
          </>
        ) : (
          'Connect your test wallet and register an account to deposit collateral.'
        )}
      </p>
    </section>
  );
}

export function GroupBalances({ controller }: { controller: GroupController }) {
  const {
    venue,
    accounts,
    margin,
    root,
    collateral,
    setCollateral,
    amount,
    setAmount,
    recipient,
    setRecipient,
    view,
    disabled,
    financialDisabled,
    cash,
    allocate,
    net,
  } = controller;
  return (
    <section className="panel">
      <h2>Account balances</h2>
      <dl className="account-metrics">
        <Metric label="Funded cash · test USD" value={fixed(root?.cash)} test="group-cash" />
        <Metric
          label="Risk equity · test USD"
          value={fixed(view?.riskEquityScaled, 15)}
          test="group-risk-equity"
          hint="Funded cash plus negative market claims only"
        />
        <Metric
          label="Reserved margin · test USD"
          value={fixed(view?.reserved)}
          test="group-reserved"
        />
        <Metric
          label="Initial / maintenance margin"
          value={`${fixed(view?.initialMargin)} / ${fixed(view?.maintenanceMargin)}`}
        />
        <Metric
          label="Local cash headroom"
          value={fixed(view?.localCashHeadroom)}
          hint="Preview; complete-group proof and simulation still required"
        />
        <Metric
          label="Positive unpaid margin credit"
          value="0"
          hint="No correlation discounts or automatic sibling support"
        />
      </dl>
      <p className="caption">
        {view?.valuationStatus === 'RequiredSourceUnavailable'
          ? 'Required price unavailable: risk equity and cash headroom cannot be calculated.'
          : view?.valuationStatus === 'FrozenResolution'
            ? 'Frozen group: await complete resolution and explicit recovery.'
            : 'Finalized RPC balances; pending funding is calculated from the current on-chain Clock.'}
      </p>
      <div className="form-grid">
        <Field label="Wallet collateral account">
          <select value={collateral} onChange={(event) => setCollateral(event.target.value)}>
            <option value="">Choose token account</option>
            {venue.tokens.map((token) => (
              <option key={token.address} value={token.address}>
                {short(token.address)} · {fixed(token.amount)} test USD
              </option>
            ))}
          </select>
        </Field>
        <Field label="Collateral amount">
          <input
            value={amount}
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
      </div>
      <div className="button-row">
        <button disabled={financialDisabled || !collateral} onClick={() => void cash(false)}>
          Deposit
        </button>
        <button disabled={financialDisabled || !collateral} onClick={() => void cash(true)}>
          Withdraw
        </button>
        <button disabled={financialDisabled || root?.mode !== 0} onClick={() => void net()}>
          Net closed claims
        </button>
      </div>
      <div className="ticket-divider" />
      <Field label="Allocate to account">
        <select value={recipient} onChange={(event) => setRecipient(event.target.value)}>
          <option value="">Choose recipient</option>
          {accounts
            .filter(([key]) => key !== margin)
            .map(([key, account]) => (
              <option key={key} value={key}>
                {accountLabel(account)} · {fixed(account.cash)} funded
              </option>
            ))}
        </select>
      </Field>
      <button disabled={financialDisabled || !recipient} onClick={() => void allocate()}>
        Allocate collateral
      </button>
    </section>
  );
}

export function GroupPositions({ controller }: { controller: GroupController }) {
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
                <td>{GROUP_MARKETS[index].name}</td>
                <td data-testid={`group-position-${index}`}>
                  {fixed(position.lots, GROUP_MARKETS[index].decimals)}
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

export function GroupTicket({ controller }: { controller: GroupController }) {
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

export function GroupOrders({ controller }: { controller: GroupController }) {
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
                      {String(entry.order.id)} · {GROUP_MARKETS[entry.marketIndex].name}
                      {entry.order.groupId !== 0n ? ' · TP/SL' : ''}
                    </td>
                    <td>{orderStates[entry.order.state]}</td>
                    <td>
                      {fixed(
                        view?.orders[index].remaining,
                        GROUP_MARKETS[entry.marketIndex].decimals,
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
                          disabled={disabled || snapshot?.state.mode === 3}
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

export function GroupAuthority({ controller }: { controller: GroupController }) {
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

export function GroupFills({ controller }: { controller: GroupController }) {
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
                    {GROUP_MARKETS[Number(trade.payload.marketState.index)]?.name ??
                      'Unknown market'}
                  </td>
                  <td>
                    {trade.payload.side === 0 ? 'Buy' : 'Sell'}{' '}
                    {fixed(
                      trade.payload.lots,
                      GROUP_MARKETS[Number(trade.payload.marketState.index)].decimals,
                    )}
                  </td>
                  <td>
                    {rational(
                      BigInt(trade.payload.grossQuote) *
                        GROUP_MARKETS[Number(trade.payload.marketState.index)].lotsPerUnit,
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
