import { createHash } from 'node:crypto';
import { getAddressDecoder } from '@solana/kit';

export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
// Current official Pyth Core addresses; inventory is not signed-update acceptance.
export const DEPENDENCIES = {
  receiver: 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ',
  wormholeReceiver: 'HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ',
  push: 'pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT',
  compatibleReceiver: 'rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp',
  compatibleWormholeReceiver: 'HDw2E7P8X1SkCyjvoGsfBGAVUutKcj874bXjHrpVYrVL',
  compatiblePush: 'pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou',
} as const;

export function configuration(env: Record<string, string | undefined>) {
  const rpc = env.RIVALT_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com';
  const ws = env.RIVALT_DEVNET_WS_URL ?? (env.RIVALT_DEVNET_RPC_URL ? undefined : 'wss://api.devnet.solana.com');
  const valid = (value: string | undefined, protocol: string) => {
    try { const u = new URL(value ?? ''); return u.protocol === protocol && !u.hash && !u.username && !u.password; }
    catch { return false; }
  };
  if (!valid(rpc, 'https:') || !valid(ws, 'wss:')) throw new Error('Configure HTTPS devnet RPC and explicit WSS URLs; URL credentials/fragments are rejected');
  return { rpc, ws: ws!, endpointLabel: env.RIVALT_DEVNET_RPC_URL ? 'configured-private-url-redacted' : 'official-public-devnet' };
}

export function checkedGenesis(value: unknown) {
  if (value !== DEVNET_GENESIS) throw new Error('RPC is not the pinned Solana devnet genesis');
  return DEVNET_GENESIS;
}

export function unsigned(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Unsafe RPC integer');
  return value.toString();
}

type Account = { owner: string; executable: boolean; data: [string, string] } | null;
function bytes(account: Account, executable: boolean) {
  if (!account || account.owner !== UPGRADEABLE_LOADER || account.executable !== executable || account.data[1] !== 'base64') {
    throw new Error('Dependency owner, executable flag or encoding mismatch');
  }
  return Buffer.from(account.data[0], 'base64');
}
export function programDataAddress(account: Account) {
  const data = bytes(account, true);
  if (data.length !== 36 || data.readUInt32LE(0) !== 2) throw new Error('Invalid upgradeable program layout');
  return getAddressDecoder().decode(data.subarray(4));
}
export function programDataIdentity(account: Account) {
  const data = bytes(account, false);
  if (data.length <= 45 || data.readUInt32LE(0) !== 3 || data[12] > 1) throw new Error('Invalid ProgramData layout');
  return {
    deploymentSlot: data.readBigUInt64LE(4).toString(),
    upgradeAuthority: data[12] === 1 ? getAddressDecoder().decode(data.subarray(13, 45)) : null,
    allocatedBytes: data.length.toString(),
    accountSha256: createHash('sha256').update(data).digest('hex'),
    // Includes loader allocation padding. Do not equate this with a local ELF hash.
    payloadWithPaddingSha256: createHash('sha256').update(data.subarray(45)).digest('hex'),
  };
}

export async function observeSlot(url: string): Promise<{ subscription: string; slot: string }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let subscription: number | undefined, done = false;
    const finish = (result?: { subscription: string; slot: string }) => {
      if (done) return;
      done = true; clearTimeout(timer); socket.close();
      result ? resolve(result) : reject(new Error('Devnet WS slot subscription failed or timed out'));
    };
    const timer = setTimeout(() => finish(), 12_000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'slotSubscribe' })));
    socket.addEventListener('error', () => finish());
    socket.addEventListener('close', () => { if (!done) finish(); });
    socket.addEventListener('message', ({ data }) => {
      try {
        const message = JSON.parse(String(data));
        if (message.id === 1) {
          unsigned(message.result); subscription = message.result;
        } else if (subscription !== undefined && message.method === 'slotNotification' && message.params.subscription === subscription) {
          const slot = unsigned(message.params.result.slot);
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'slotUnsubscribe', params: [subscription] }));
          finish({ subscription: subscription.toString(), slot });
        }
      } catch { finish(); }
    });
  });
}
