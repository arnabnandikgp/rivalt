import { CLEARING_PROGRAM_ADDRESS } from './generated/index.js';
import { MAKER_A_PROGRAM_ADDRESS } from './generatedMakerA/index.js';
import { MAKER_B_PROGRAM_ADDRESS } from './generatedMakerB/index.js';

export type TestChain = 'solana:localnet';

/** Current fresh local deployment only. Historical devnet clients live at the
 * pinned pre-consolidation revision; this API never reinterprets their accounts. */
export function testDeployment(chain: string = 'solana:localnet') {
  if (chain !== 'solana:localnet') throw new Error('Unsupported test chain');
  return Object.freeze({chain: 'solana:localnet' as const, genesis: null,
    clearing: CLEARING_PROGRAM_ADDRESS, makerA: MAKER_A_PROGRAM_ADDRESS, makerB: MAKER_B_PROGRAM_ADDRESS});
}

export function testRpcUrl(value: string, chain: string, websocket = false) {
  testDeployment(chain);
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const allowed = websocket ? local ? ['ws:', 'wss:'] : ['wss:'] : local ? ['http:', 'https:'] : ['https:'];
  if (!allowed.includes(url.protocol) || url.username || url.password || (chain === 'solana:localnet' && !local))
    throw new Error('Unsupported test RPC configuration');
}
