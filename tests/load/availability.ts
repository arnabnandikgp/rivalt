import assert from 'node:assert/strict';
import type { Attempt } from './metrics.js';

const classification: Record<string, string> = {
  'observation-update-due': 'scheduled-observation-dispatch-guard',
  'observation-update-pending': 'awaiting-confirmed-observation-proof',
  'observation-not-confirmed': 'preview-context-behind-observation',
  'risk-increase-restricted': 'oracle-mode-risk-restriction',
  'source-unavailable': 'no-credible-price-bounds',
  'observation-expired': 'expired-observation', 'quote-expiring': 'insufficient-dispatch-slots',
  'market-paused': 'venue-paused', 'account-unavailable': 'account-unavailable',
  'unfilled-no-liquidity': 'no-admissible-allocation', 'unfilled-account-busy': 'account-admission-busy',
};
const ratio = (numerator: number, denominator: number) => ({ numerator, denominator, fraction: denominator ? numerator / denominator : null });

/** An offered attempt is one unique driver record, never an RPC retry or a fee.
 * Fault labels mean declared driver windows, not proof that outside them the
 * oracle or venue was Normal. Unknown causes stay unknown.
 */
export function availability(rows: Attempt[]) {
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'Duplicate offered attempt');
  for (const row of rows) {
    assert(typeof row.id === 'string' && row.id && typeof row.fault === 'boolean');
    assert(!['finalized', 'failed', 'unresolved'].includes(row.status) || row.signature, 'Signed outcome lacks signature');
    assert(!row.signature || row.status !== 'quote-unavailable', 'Signed attempt cannot be an unsigned refusal');
  }
  function population(selected: Attempt[]) {
    const offered = selected.length, quoteEligible = selected.filter(row => row.eligible).length;
    const submitted = selected.filter(row => row.signature).length;
    const finalized = selected.filter(row => row.status === 'finalized').length;
    const failed = selected.filter(row => row.status === 'failed').length;
    const unresolved = selected.filter(row => row.signature && !['finalized', 'failed'].includes(row.status)).length;
    const reasons: Record<string, { count: number; classification: string; withDiagnostic: number }> = {};
    for (const row of selected.filter(row => !row.signature && row.status !== 'quote-eligible')) {
      const reason = row.code ?? row.status;
      const group = reasons[reason] ??= { count: 0, classification: classification[reason] ?? 'unknown-unavailability', withDiagnostic: 0 };
      group.count++; if (row.diagnostic) group.withDiagnostic++;
    }
    return { offered, quoteEligible, submitted, finalized, failed, unresolved, unsigned: offered - submitted,
      unsignedEligibleNotSubmitted: selected.filter(row => row.eligible && !row.signature).length,
      quoteAvailability: ratio(quoteEligible, offered), submittedAvailability: ratio(submitted, offered),
      finalizedAvailability: ratio(finalized, offered), submittedSuccess: ratio(finalized, submitted), reasons };
  }
  return { schemaVersion: 1, denominator: 'Unique actual offered records; excludes unrecorded schedules and retry polls',
    windowDefinition: 'Outside/inside declared driver fault windows; outside does not assert oracle Normal mode',
    all: population(rows), outsideFault: population(rows.filter(row => !row.fault)), fault: population(rows.filter(row => row.fault)) };
}
