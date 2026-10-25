import {getAddressEncoder, getProgramDerivedAddress, type Address} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';

/** Canonical schema-2 identities for the fixed two-market profile. */
export function findGroupMarketPda(group: Address, index: number, programAddress: Address = CLEARING_PROGRAM_ADDRESS) {
  if (!Number.isInteger(index) || index < 0 || index > 1) throw new Error('Unsupported group market index');
  return getProgramDerivedAddress({programAddress,
    seeds:[new TextEncoder().encode('market-v2'), getAddressEncoder().encode(group), new Uint8Array([index])]});
}
export function findGroupMakerPda(market: Address, makerId: number, programAddress: Address = CLEARING_PROGRAM_ADDRESS) {
  if (!Number.isInteger(makerId) || makerId < 0 || makerId > 1) throw new Error('Unsupported group maker ID');
  return getProgramDerivedAddress({programAddress,
    seeds:[new TextEncoder().encode('registration-v2'), getAddressEncoder().encode(market), new Uint8Array([makerId])]});
}
