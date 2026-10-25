/** Finalized history may advance between scanning signatures and reading accounts.
 * Only a strictly newer authenticated sequence permits bounded tail catch-up. */
export class ReconciliationAhead extends Error {
  constructor(readonly expected:bigint,readonly observed:bigint){
    super(`Finalized sequence advanced from ${expected} to ${observed}; tail catch-up required`);
  }
}
export function compareReconciliationSequence(observed:bigint,expected:bigint){
  if(observed>expected)throw new ReconciliationAhead(expected,observed);
  if(observed<expected)throw new Error(`Finalized sequence ${observed} is behind candidate ${expected}`);
}
