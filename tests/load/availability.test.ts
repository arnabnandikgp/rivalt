import { expect, it } from 'vitest';
import { availability } from './availability.js';
import { summarize, type Attempt } from './metrics.js';

const rows: Attempt[] = [
  { id: '1', phase: 'test', actor: 0, offeredAt: 0, fault: false, status: 'finalized', eligible: true, signature: 'a' },
  { id: '2', phase: 'test', actor: 0, offeredAt: 1, fault: false, status: 'quote-unavailable', eligible: true, code: 'client-validation-rejected' },
  { id: '3', phase: 'test', actor: 0, offeredAt: 2, fault: false, status: 'failed', eligible: true, signature: 'b' },
  { id: '4', phase: 'test', actor: 0, offeredAt: 3, fault: false, status: 'unresolved', eligible: true, signature: 'c' },
  { id: '5', phase: 'test', actor: 0, offeredAt: 4, fault: false, status: 'quote-unavailable', code: 'observation-update-due' },
  { id: '6', phase: 'test', actor: 0, offeredAt: 5, fault: true, status: 'finalized', eligible: true, signature: 'd' },
];
it('separates returned quotes, signed attempts, landed fills and declared fault windows', () => {
  const result = availability(rows);
  expect(result.all.offered).toBe(6);
  expect(result.outsideFault).toMatchObject({ offered: 5, quoteEligible: 4, submitted: 3, finalized: 1,
    failed: 1, unresolved: 1, unsigned: 2, unsignedEligibleNotSubmitted: 1,
    quoteAvailability: { numerator: 4, denominator: 5 }, submittedAvailability: { numerator: 3, denominator: 5 },
    finalizedAvailability: { numerator: 1, denominator: 5 }, submittedSuccess: { numerator: 1, denominator: 3 } });
  expect(result.outsideFault.reasons['client-validation-rejected'].classification).toBe('unknown-unavailability');
  expect(result.outsideFault.reasons['observation-update-due'].classification).toBe('scheduled-observation-dispatch-guard');
  expect(result.fault).toMatchObject({ offered: 1, finalized: 1 });
  expect(summarize(rows)).toMatchObject({ normalEligible: 4, normalSubmitted: 3, normalAvailability: 3/5,
    normalQuoteAvailability: 4/5, normalFinalizedAvailability: 1/5, normalSuccess: 1/3 });
});
it('does not manufacture a percentage for an absent population', () => {
  expect(availability([]).all.submittedSuccess.fraction).toBeNull();
});
it('rejects duplicate offers and unsigned records labelled landed', () => {
  expect(() => availability([...rows, rows[0]])).toThrow(/Duplicate/);
  expect(() => availability([{ ...rows[0], signature: undefined }])).toThrow(/signature/);
  expect(() => availability([{ ...rows[0], status: 'quote-unavailable' }])).toThrow(/unsigned/);
});
