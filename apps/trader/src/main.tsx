import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConnectionProvider, WalletProvider, WalletModalProvider } from '@solana/wallet-adapter';
import { userConfig, groupUserConfig, accountUserConfig, type UserConfig } from '@rivalt/sdk';
import '@solana/wallet-adapter/styles.css';
import './styles.css';
import { App } from './App.js';
import { GroupApp } from './group/GroupApp.js';
import { AccountApp } from './account/AccountApp.js';
import type { AccountTraderConfig } from './account/types.js';
import type { GroupTraderConfig } from './group/types.js';
export type TraderConfig = UserConfig & { apiBase: string; readBase: string };
function Root() {
  const [config, setConfig] = useState<TraderConfig | GroupTraderConfig | AccountTraderConfig>(),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    fetch('/rivalt-config.json', { signal: AbortSignal.timeout(8000) })
      .then(async (r) => {
        if (!r.ok) throw new Error('The local venue configuration is unavailable.');
        const raw = await r.json(),
          validated = raw.version === 3 ? accountUserConfig(raw) : raw.version === 2 ? groupUserConfig(raw) : userConfig(raw);
        if (raw.apiBase !== '/api' || raw.readBase !== '/read')
          throw new Error('Unsupported service configuration.');
        if (raw.demo === true) {
          if (validated.version !== 3) throw new Error('Demo requires the current account profile.');
          const {installDemoWallet} = await import('./account/demo-wallet.js');
          await installDemoWallet(validated);
        }
        if (active)
          setConfig({
            ...validated,
            apiBase: raw.apiBase,
            readBase: raw.readBase,
            ...(raw.demo === true ? {demo: true} : {}),
          });
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  if (!config)
    return (
      <main className="startup">
        <span className="wordmark">
          Rivalt
          <span className="brand-dot" />
        </span>
        <h1>BTC perpetuals</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => setAttempt((x) => x + 1)}>Retry connection</button>
          </>
        ) : (
          <p role="status">Connecting to the test venue…</p>
        )}
      </main>
    );
  return (
    <ConnectionProvider
      endpoint={config.rpcUrl}
      config={{ commitment: 'confirmed', wsEndpoint: config.wsUrl }}
    >
      <WalletProvider chain={config.chain} autoConnect>
        <WalletModalProvider>
          {config.version === 3 ? <AccountApp config={config} /> : config.version === 2 ? <GroupApp config={config} /> : <App config={config} />}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="startup">
        <h1>View unavailable</h1>
        <p>
          Saved transaction signatures remain in this browser. Reload to reconcile them before
          repeating an action.
        </p>
        <button onClick={() => location.reload()}>Reload</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <Boundary>
    <Root />
  </Boundary>,
);
