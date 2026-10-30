import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { fixed, short } from '../amount.js';
import type { useAccountVenue } from '../account/useAccountVenue.js';
export function Field({ label, children }: { label: string; children: ReactElement<{'aria-label'?:string}> }) {
  return (
    <label className="field">
      <span>{label}</span>
      {cloneElement(children,{'aria-label':label})}
    </label>
  );
}
export function Metric({
  label,
  value,
  test,
  hint,
}: {
  label: string;
  value: ReactNode;
  test?: string;
  hint?: string;
}) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd data-testid={test}>{value}</dd>
      {hint && <small>{hint}</small>}
    </div>
  );
}
export function Receipts({ venue }: { venue: Pick<ReturnType<typeof useAccountVenue>, 'records' | 'busy' | 'resend'> }) {
  return (
    <section className="panel">
      <h2>Saved transactions</h2>
      <p className="caption">
        Original signed bytes stay in this browser. Confirmation is independently checked over RPC.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Signature</th>
              <th>Outcome</th>
              <th>Network fee (SOL)</th>
              <th>Recovery</th>
            </tr>
          </thead>
          <tbody>
            {[...venue.records].reverse().map((record) => (
              <tr key={record.id}>
                <td>{record.label}</td>
                <td>
                  <code title={record.signature}>{short(record.signature)}</code>
                </td>
                <td>
                  {record.status}
                  {record.error && <small> · {record.error}</small>}
                </td>
                <td>{fixed(record.fee, 9)}</td>
                <td>
                  {!['finalized', 'failed'].includes(record.status) && (
                    <button
                      disabled={Boolean(venue.busy)}
                      onClick={() => void venue.resend(record)}
                    >
                      Resend identical bytes
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!venue.records.length && (
        <p className="caption">No transactions saved for this wallet and deployment.</p>
      )}
    </section>
  );
}
export function Review({ venue }: { venue: Pick<ReturnType<typeof useAccountVenue>, 'review' | 'busy' | 'canSign' | 'sign' | 'invalidate'> }) {
  const review = venue.review;
  if (!review) return null;
  return (
    <section className="panel group-review" role="region" aria-label="Review transaction">
      <h2>{review.label}</h2>
      <ul className="review-details">
        {review.details.map((detail, index) => (
          <li key={index}>{detail}</li>
        ))}
      </ul>
      <p className="caption">
        Estimated network fee: {fixed(review.fee, 9)} test SOL. Simulation passed; chain state may
        change before execution.
      </p>
      <div className="button-row">
        <button
          className="primary"
          disabled={Boolean(venue.busy) || !venue.canSign}
          onClick={() => void venue.sign()}
        >
          Sign transaction
        </button>
        <button disabled={Boolean(venue.busy)} onClick={venue.invalidate}>
          Dismiss review
        </button>
      </div>
    </section>
  );
}
