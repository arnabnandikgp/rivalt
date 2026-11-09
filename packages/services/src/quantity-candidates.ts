import {MAX_ACTION_LOTS} from '@rivalt/sdk';

/** Operational subfill probes, not a proof that every feasible size was tried.
 * Begin with the remaining exposure and halve on rejection. The existing numeric
 * domain bounds this to 27 attempts; admission and durable send budgets still apply.
 */
export function* quantityCandidates(remaining:bigint):Generator<bigint> {
  for(let lots=remaining<MAX_ACTION_LOTS?remaining:MAX_ACTION_LOTS;lots>0n;lots/=2n)yield lots;
}
