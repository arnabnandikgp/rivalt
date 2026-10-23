import { address } from '@solana/kit';
import { CLEARING_PROGRAM_ADDRESS } from './generated/index.js';
import { MAKER_A_PROGRAM_ADDRESS } from './generatedMakerA/index.js';
import { MAKER_B_PROGRAM_ADDRESS } from './generatedMakerB/index.js';

export type TestChain = 'solana:localnet' | 'solana:devnet';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

/** Explicit test deployments; no arbitrary program or mainnet activation. */
export function testDeployment(chain: string = 'solana:localnet') {
  if (chain !== 'solana:localnet' && chain !== 'solana:devnet') throw new Error('Unsupported test chain');
  return Object.freeze(chain === 'solana:devnet' ? {
    chain, genesis: DEVNET_GENESIS,
    clearing: address('BbLhJdwymg9aGCtdrcxkFsBwP3L8N9NbGJucq37sS2jv'),
    makerA: address('C2dhcKi2FQTsJgHiAYYb8hGeqYWdcUQr9MB4kU6AdLJG'),
    makerB: address('8gBGZLMdws9ci5ax8ASmK46WPigHguFYvm8azK8q6Ckc'),
  } : {
    chain, genesis: null, clearing: CLEARING_PROGRAM_ADDRESS,
    makerA: MAKER_A_PROGRAM_ADDRESS, makerB: MAKER_B_PROGRAM_ADDRESS,
  });
}

export function testRpcUrl(value: string, chain: string, websocket = false) {
  testDeployment(chain);
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const allowed = websocket ? local ? ['ws:', 'wss:'] : ['wss:'] : local ? ['http:', 'https:'] : ['https:'];
  if (!allowed.includes(url.protocol) || url.username || url.password || (chain === 'solana:localnet' && !local))
    throw new Error('Unsupported test RPC configuration');
}
