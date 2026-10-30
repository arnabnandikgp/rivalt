/** Finalized history may advance between scanning signatures and reading accounts.
 * Only a strictly newer authenticated revision permits bounded tail catch-up. */
export class ReconciliationAhead extends Error {
  constructor(readonly expected:bigint,readonly observed:bigint){
    super(`Finalized revision advanced from ${expected} to ${observed}; tail catch-up required`);
  }
}
export function compareReconciliationRevision(observed:bigint,expected:bigint){
  if(observed>expected)throw new ReconciliationAhead(expected,observed);
  if(observed<expected)throw new Error(`Finalized revision ${observed} is behind candidate ${expected}`);
}
