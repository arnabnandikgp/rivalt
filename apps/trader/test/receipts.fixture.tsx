// React scheduler regression only. These are receipt-shaped fixtures, not
// signed transactions or evidence of any blockchain financial operation.
import { Suspense, startTransition, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { SignedIntent } from '@rivalt/sdk';
import { useReceiptRecords } from '../src/shared/useReceiptRecords.js';
import { mergeReconciled } from '../src/receipts.js';

const prior = { id: 'prior', status: 'pending', signature: 'prior', wire: 'prior-bytes' } as SignedIntent;
const original = { id: 'new', status: 'pending', signature: 'new', wire: 'immutable-new-bytes' } as SignedIntent;
const suspended = new Promise(() => {});
const testWindow = window as any;
function Fixture() {
  const { records, recordsRef, replaceRecords } = useReceiptRecords();
  const [pause, setPause] = useState(false), [urgent, setUrgent] = useState(0);
  testWindow.receipts = {
    seed() { flushSync(() => replaceRecords([prior])); },
    begin() { startTransition(() => { replaceRecords([prior, original]); setPause(true); }); },
    preemptAndPoll() {
      flushSync(() => setUrgent(value => value + 1));
      const afterPreempt = recordsRef.current.map(receipt => receipt.id);
      const next = mergeReconciled(recordsRef.current, [prior], [{ ...prior, status: 'finalized' }]);
      localStorage.setItem('receipt-regression', JSON.stringify(next));
      flushSync(() => { replaceRecords(next); setPause(false); });
      return { afterPreempt, saved: next, latest: recordsRef.current };
    },
    reload() {
      flushSync(() => replaceRecords([]));
      const cleared = recordsRef.current.length;
      flushSync(() => replaceRecords(JSON.parse(localStorage.getItem('receipt-regression')!)));
      return { cleared, latest: recordsRef.current };
    },
  };
  if (pause) { testWindow.suspendedReceiptRender = true; throw suspended; }
  return <div data-testid="receipts">{records.map(receipt => receipt.id).join(',')}:{urgent}</div>;
}
createRoot(document.getElementById('root')!).render(<Suspense fallback="pending"><Fixture /></Suspense>);
