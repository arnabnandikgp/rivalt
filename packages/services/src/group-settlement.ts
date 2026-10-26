import {AccountRole, type Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';

const SCALE=1_000_000_000n;
const MAX_CASH=1_000_000_000_000_000n;
const MAX_SCALED=10n**26n;
const min=(left:bigint,right:bigint)=>left<right?left:right;

/** An unsigned candidate, never settlement authority. Both funding prefixes and
 * live reservations are evaluated; clearing and actual simulation decide whether
 * the sequence-bound transition is admissible. Fractions remain with their root. */
export function groupClaimAmount(snapshot:sdk.GroupSnapshot,margin:Address,marketIndex:0|1,gain:boolean):bigint {
  const root=snapshot.roots[margin];
  if(!root||![1,2].includes(snapshot.state.mode)||snapshot.state.paused||
    (root.mode===1&&root.isolatedMarketIndex!==marketIndex))return 0n;
  const view=sdk.groupBalanceView(root,snapshot.state,snapshot.marketStates,snapshot.now,snapshot.slot);
  const claimText=view.positions[marketIndex].unpaidClaimScaled;
  if(claimText===null)return 0n;
  const claim=BigInt(claimText);
  if(!gain)return claim<=-SCALE?min(-claim/SCALE,root.cash):0n;
  if(claim<SCALE||view.riskEquityScaled===null)return 0n;
  const amount=min(min(claim/SCALE,snapshot.state.settlement),MAX_CASH-root.cash);
  if(amount<=0n)return 0n;
  const candidate=structuredClone(root);candidate.cash+=amount;
  candidate.positions[marketIndex].virtualScaled-=amount*SCALE;
  if(candidate.positions[marketIndex].virtualScaled < -MAX_SCALED)return 0n;
  const after=sdk.groupBalanceView(candidate,snapshot.state,snapshot.marketStates,snapshot.now,snapshot.slot);
  if(after.riskEquityScaled===null||after.initialMargin===null||
    BigInt(after.riskEquityScaled)<(BigInt(after.initialMargin)+BigInt(after.reserved))*SCALE)return 0n;
  return amount;
}

/** Each proof uses exactly the next canonical registry page, with read-only
 * roots. It stays in a separate transaction from any cash/claim mutation. */
export function groupCertificatePage(snapshot:sdk.GroupSnapshot) {
  const proof=sdk.groupExitProof(snapshot);if(proof.complete)return null;
  const members=snapshot.members.slice(proof.start,proof.start+8);
  if(!members.length)throw new Error('Empty group certificate page');
  const instruction=sdk.getCheckGroupExitV2Instruction({...snapshot,sequence:snapshot.state.sequence,
    observations:snapshot.marketStates.map(market=>market.observationSequence),start:proof.start});
  return {start:proof.start,end:proof.start+members.length,instruction:{...instruction,
    accounts:[...instruction.accounts,...members.map(address=>({address,role:AccountRole.READONLY}))]}};
}
