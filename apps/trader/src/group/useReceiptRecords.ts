import { useCallback, useRef, useState } from 'react';
import type { SignedIntent } from '@rivalt/sdk';

/** Async signing/polling reads the latest write even before React commits it.
 * A speculative or higher-priority render must never roll this journal back. */
export function useReceiptRecords() {
  const [records, setRecords] = useState<SignedIntent[]>([]);
  const recordsRef = useRef(records);
  const replaceRecords = useCallback((next: SignedIntent[]) => {
    recordsRef.current = next;
    setRecords(next);
  }, []);
  return { records, recordsRef, replaceRecords };
}
