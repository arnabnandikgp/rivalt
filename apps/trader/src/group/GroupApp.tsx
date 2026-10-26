import { WalletMultiButton } from '@solana/wallet-adapter';
import { short } from '../amount.js';
import { terminal } from '../receipts.js';
import type { GroupTraderConfig } from './types.js';
import { GroupReceipts, GroupReview } from './Primitives.js';
import { useGroupController } from './useGroupController.js';
import {
  GroupSelection,
  GroupBalances,
  GroupPositions,
  GroupTicket,
  GroupOrders,
  GroupAuthority,
  GroupFills,
} from './GroupPanels.js';
export function GroupApp({ config }: { config: GroupTraderConfig }) {
  const controller = useGroupController(config),
    { venue, snapshot } = controller;
  return (
    <>
      <header className="topbar">
        <a className="wordmark" href="#">
          Rivalt
          <span className="brand-dot" />
        </a>
        <span className="network">Local test venue · BTC + ETH · internal makers</span>
        <div className="header-actions">
          <button onClick={() => void venue.refresh()} disabled={Boolean(venue.busy)}>
            Refresh
          </button>
          <WalletMultiButton />
        </div>
      </header>
      <main onChange={venue.invalidate}>
        <div className="market-header">
          <div>
            <span className="eyebrow">PORTFOLIO ZERO</span>
            <h1>Manage your margin</h1>
            <p>One collateral mint. Separate account balances. Explicit allocation.</p>
          </div>
          <span className="status">
            {snapshot?.state.mode === 3
              ? 'Group frozen'
              : snapshot?.state.paused
                ? 'Group paused'
                : snapshot?.state.mode === 2
                  ? 'Isolated + cross test profile'
                  : 'Isolated trading'}
          </span>
        </div>
        {venue.rpcError && (
          <p className="banner error" role="alert">
            {venue.rpcError}
          </p>
        )}
        {venue.apiError && (
          <p className="banner warning" role="status">
            {venue.apiError}
          </p>
        )}
        {venue.error && (
          <p className="banner error" role="alert">
            {venue.error}
          </p>
        )}
        {venue.notice && (
          <p className="banner" role="status">
            {venue.notice}
          </p>
        )}
        {venue.busy && <p role="status">{venue.busy}</p>}
        <GroupSelection controller={controller} />
        <GroupReview venue={venue} />
        <div className="trading-grid">
          <div className="market-column">
            <GroupBalances controller={controller} />
            <GroupPositions controller={controller} />
          </div>
          <GroupTicket controller={controller} />
        </div>
        <GroupOrders controller={controller} />
        <GroupAuthority controller={controller} />
        <GroupFills controller={controller} />
        <GroupReceipts venue={venue} />
        <p className="caption">
          {venue.records.filter((record) => !terminal(record)).length} unresolved saved
          transaction(s). Group {short(config.group)} · one test collateral mint · no funded
          deployment.
        </p>
      </main>
    </>
  );
}
