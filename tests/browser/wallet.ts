/** Instrumented Wallet Standard fixture. Only public accounts enter the page. */
export function installWallet(accounts: { address: string; publicKey: number[] }[], versions: (0 | 1)[] = [0]) {
  const w = window as any,
    listeners = new Set<(value: any) => void>();
  let selected = 0,
    connected = false,
    rejectNext = false;
  const account = (i: number, chain = 'solana:localnet') =>
    Object.freeze({
      address: accounts[i].address,
      publicKey: new Uint8Array(accounts[i].publicKey),
      chains: [chain],
      features: ['solana:signTransaction'],
    });
  let current = account(0);
  const emit = () => listeners.forEach((fn) => fn({ accounts: connected ? [current] : [] }));
  const wallet = {
    version: '1.0.0',
    name: 'Rivalt Test Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzM0NWYyNiIvPjx0ZXh0IHg9IjkiIHk9IjI0IiBmaWxsPSJ3aGl0ZSIgZm9udC1zaXplPSIyNCI+UjwvdGV4dD48L3N2Zz4=',
    chains: ['solana:localnet'],
    get accounts() {
      return connected ? [current] : [];
    },
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async () => {
          connected = true;
          emit();
          return { accounts: [current] };
        },
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          connected = false;
          emit();
        },
      },
      'standard:events': {
        version: '1.0.0',
        on: (event: string, fn: (value: any) => void) => {
          if (event === 'change') listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: versions,
        signTransaction: async (...inputs: any[]) => {
          if (rejectNext) {
            rejectNext = false;
            throw new Error('User rejected signature');
          }
          return Promise.all(
            inputs.map(async (input) => {
              if (input.account.address !== current.address || input.chain !== 'solana:localnet')
                throw new Error('Wallet account/chain mismatch');
              const signed = await w.rivaltSign({ index: selected, wire: Array.from(input.transaction) });
              return { signedTransaction: new Uint8Array(signed) };
            }),
          );
        },
      },
    },
  };
  w.rivaltWallet = {
    reject: () => {
      rejectNext = true;
    },
    switch: (index: number, chain = 'solana:localnet') => {
      selected = index;
      current = account(index, chain);
      connected = true;
      emit();
    },
  };
  const register = ({ register }: any) => register(wallet);
  w.addEventListener('wallet-standard:app-ready', (event: any) => register(event.detail));
  w.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
}
