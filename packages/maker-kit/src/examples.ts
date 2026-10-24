import { createNoopSigner, type Address } from '@solana/kit';
import * as sdk from '@rivalt/sdk';

/** Reviewable instructions only. The caller owns signing, durable persistence,
 * RPC simulation/submission and reconciliation of the original signed bytes.
 */
export async function makerInstructions(snapshot: sdk.UserSnapshot, makerId: 0 | 1, owner: Address) {
  const maker = snapshot.makers.find(candidate => candidate.r.makerId === makerId);
  if (!maker || maker.r.owner !== owner) throw new Error('Maker owner/config binding mismatch');
  const signer = createNoopSigner(owner), options = { programAddress: snapshot.program };
  const api = makerId === 0 ? sdk.makerA : sdk.makerB;
  return {
    // The program requires actual expiry; calling this early cannot reset depth.
    publishAndSync: [api.getPublishEpochInstruction({ owner: signer, config: maker.r.config, duration: 3600n }, { programAddress: maker.r.pricingProgram }),
      await sdk.getSyncMakerEpochInstructionAsync({ ...snapshot, ...maker.r, registration: maker.registration }, options)],
    deposit: async (tokenAccount: Address, amount: bigint) => sdk.getDepositInstructionAsync({ ...snapshot,
      owner: signer, participant: maker.r.capital, quoteMint: snapshot.m.quoteMint, userToken: tokenAccount, amount }, options),
    // Stopping the daemon leaves standing on-chain authority until expiry.
    // Immediate quarantine is an explicit venue-authority operation, not an
    // instruction that this owner-only bot can sign on the venue's behalf.
    owner: signer.address, capital: maker.r.capital, approved: maker.approved,
  };
}
