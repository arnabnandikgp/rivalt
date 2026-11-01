import assert from 'node:assert/strict';

/** Protocol custom codes stay exact; RC2 framework errors use RPC's named form. */
export type ExpectedInstructionError = number | 'InvalidInstructionData' | 'InvalidAccountData' | 'MissingRequiredSignature' | 'ReadonlyDataModified' | 'AccountBorrowFailed' | 'InvalidSeeds';
export function assertInstructionError(actual: unknown, expected: ExpectedInstructionError, label: string) {
  assert.deepEqual(actual, typeof expected === 'number' ? {Custom: expected} : expected, label);
}
/** LiteSVM 1.6.1's typed error, never human log parsing or any-error acceptance. */
export function svmInstructionError(outcome: {err(): unknown}): unknown {
  const transactionError = outcome.err() as {err?: () => unknown};
  assert.equal(typeof transactionError.err, 'function', 'Expected instruction failure');
  const error = transactionError.err!() as number | {code?: number};
  if (typeof error !== 'number') {
    assert.equal(typeof error.code, 'number', 'Expected exact custom instruction code');
    return {Custom: error.code};
  }
  const names: Record<number, string> = {2:'InvalidInstructionData',3:'InvalidAccountData',7:'MissingRequiredSignature',15:'ReadonlyDataModified',22:'AccountBorrowFailed',34:'InvalidSeeds'};
  assert(error in names, `Unclassified LiteSVM fieldless instruction error ${error}`);
  return names[error];
}
