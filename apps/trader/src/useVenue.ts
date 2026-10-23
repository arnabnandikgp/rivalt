import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter';
import { address } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type { TraderConfig } from './main.js';
import { terminal, retain, mergeReconciled } from './receipts.js';

export type Review = sdk.PreparedTransaction & { via: 'api' | 'rpc' };
export async function http(base: string, path: string, body?: unknown) {
  const r = await fetch(base + path, {
    ...(body === undefined
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok)
    throw new Error(
      path === '/v1/quote'
        ? 'Quote unavailable at the current chain state. Request a new quote.'
        : 'Venue API unavailable or request rejected. Direct cancel and withdrawal use RPC.',
    );
  return r.json();
}
function readReceipts(key: string): sdk.SignedIntent[] {
  const value = JSON.parse(localStorage.getItem(key) ?? '[]');
  if (!Array.isArray(value)) throw new Error('Saved transaction history is invalid.');
  return value.filter(
    (x) => x && typeof x.signature === 'string' && typeof x.wire === 'string' && typeof x.owner === 'string',
  );
}
export function useVenue(config: TraderConfig) {
  const wallet = useWallet(),
    owner = wallet.publicKey ? address(wallet.publicKey.toBase58()) : null;
  const client = useMemo(() => new sdk.UserClient(config), [config]);
  const key = `rivalt:receipts:v1:${config.genesis}:${config.anchor}:${owner ?? 'disconnected'}`;
  const current = useRef({ owner, key, epoch: 0, wallet });
  current.current.owner = owner;
  current.current.key = key;
  current.current.wallet = wallet;
  const [snapshot, setSnapshot] = useState<sdk.UserSnapshot>(),
    [tokens, setTokens] = useState<{ address: sdk.Participant['owner']; amount: bigint }[]>([]);
  const [rpcError, setRpcError] = useState(''),
    [apiError, setApiError] = useState(''),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const [records, setRecords] = useState<sdk.SignedIntent[]>([]),
    recordsRef = useRef(records);
  recordsRef.current = records;
  const [review, setReview] = useState<Review>(),
    [busy, setBusy] = useState(''),
    operation = useRef(0),
    reading = useRef(false),
    polling = useRef(false);
  const [feed, setFeed] = useState<any>({
    trades: [],
    events: [],
    candles: [],
    operators: null,
    ready: false,
  });
  const save = useCallback(
    (items: sdk.SignedIntent[], target = key) => {
      // Failure to save must stop broadcast. No private key is ever stored here.
      const retained = retain(items);
      localStorage.setItem(target, JSON.stringify(retained));
      if (current.current.key === target) {
        recordsRef.current = retained;
        setRecords(retained);
      }
    },
    [key],
  );
  useEffect(() => {
    current.current.epoch++;
    operation.current++;
    setReview(undefined);
    setBusy('');
    setTokens([]);
    setNotice('');
    setError('');
    try {
      setRecords(readReceipts(key));
    } catch (e) {
      setError((e as Error).message);
      setRecords([]);
    }
  }, [key, wallet.account?.chains.join(',')]);
  const refresh = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    const epoch = current.current.epoch;
    try {
      const s = await client.snapshot(),
        owned = owner ? await client.walletTokens(owner) : [];
      if (epoch !== current.current.epoch) return;
      setSnapshot(s);
      setTokens(owned);
      setRpcError('');
      const end = Number(s.now) + 1;
      const results = await Promise.allSettled([
        http(config.readBase, '/v1/trades?latest=true&limit=30'),
        http(config.readBase, '/v1/events?latest=true&limit=50'),
        http(config.readBase, `/v1/candles?from=${end - 3600}&to=${end}`),
        http(config.apiBase, '/v1/operators'),
      ]);
      if (epoch !== current.current.epoch) return;
      if (results.every((r) => r.status === 'fulfilled')) {
        const [trades, events, candles, operators] = results.map(
          (r) => (r as PromiseFulfilledResult<any>).value,
        );
        if (
          [trades, events, candles].some(
            (x) =>
              x.market !== config.market ||
              x.deployment?.anchor !== config.anchor ||
              x.deployment?.genesis !== config.genesis ||
              x.deployment?.domain !== config.domain,
          )
        ) {
          setApiError('Indexed deployment differs from this test deployment. Direct RPC balances and exits remain available.');
          setFeed((x: any) => ({ ...x, ready: false }));
          return;
        }
        setFeed({
          trades: trades.items,
          events: events.items,
          candles: candles.items,
          unplacedTrades: candles.unplacedTrades,
          operators,
          asOf: trades.asOf,
          ready: true,
        });
        setApiError('');
      } else {
        setApiError('Venue data is unavailable. Direct RPC balances and exits remain available.');
        setFeed((x: any) => ({ ...x, ready: false }));
      }
    } catch (e) {
      if (epoch === current.current.epoch) setRpcError((e as Error).message);
    } finally {
      reading.current = false;
    }
  }, [client, owner, config]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const tick = async () => {
      if (polling.current || !owner) return;
      polling.current = true;
      const epoch = current.current.epoch,
        target = key;
      try {
        const previous = recordsRef.current;
        if (!previous.some((x) => !terminal(x))) return;
        const next = await Promise.all(
          previous.map(async (x) => (terminal(x) ? x : client.reconcile(x).catch(() => x))),
        );
        if (epoch === current.current.epoch && JSON.stringify(next) !== JSON.stringify(previous)) {
          const merged = mergeReconciled(recordsRef.current, previous, next);
          save(merged, target);
          const latest = [...merged].sort((a, b) => b.createdAt - a.createdAt)[0],
            before = previous.find((x) => x.id === latest?.id);
          if (latest && before && latest.status !== before.status) {
            if (latest.status === 'finalized')
              setNotice(
                `${latest.label} finalized. The saved transaction was independently fetched over RPC.`,
              );
            else if (latest.status === 'failed')
              setNotice(`${latest.label} failed. Check its saved result before preparing a new transaction.`);
            else if (latest.status === 'unresolved')
              setNotice(
                `${latest.label} remains unresolved. Check the saved signature before repeating this action.`,
              );
          }
          void refresh();
        }
      } finally {
        polling.current = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => clearInterval(timer);
  }, [client, owner, key, save, refresh]);
  const canSign = Boolean(
    owner &&
    wallet.signTransaction &&
    wallet.supportedTransactionVersions?.has(0) &&
    wallet.account?.chains.includes(config.chain),
  );
  const invalidate = () => {
    setReview(undefined);
    setError('');
  };
  const preview = async (
    build: (s: sdk.UserSnapshot, owner: sdk.Participant['owner']) => Promise<Review>,
  ) => {
    const epoch = current.current.epoch,
      id = ++operation.current;
    setError('');
    setNotice('');
    setReview(undefined);
    if (!owner || !canSign) {
      setError('Connect a wallet account that supports this test network and v0 signing.');
      return;
    }
    setBusy('Preparing transaction');
    try {
      const s = await client.snapshot();
      const prepared = await build(s, owner);
      if (epoch !== current.current.epoch) return;
      if (recordsRef.current.some((x) => !terminal(x) && x.label === prepared.label))
        throw new Error(
          'This action has an unresolved saved transaction. Reconcile its signature before repeating it.',
        );
      setSnapshot(s);
      setReview(prepared);
    } catch (e) {
      if (epoch === current.current.epoch) setError((e as Error).message);
    } finally {
      if (operation.current === id) setBusy('');
    }
  };
  const sign = async () => {
    if (!review || !canSign || !current.current.wallet.signTransaction) return;
    const prepared = review,
      target = key,
      epoch = current.current.epoch,
      id = ++operation.current;
    setBusy('Waiting for wallet');
    setError('');
    setNotice('');
    try {
      let signed;
      try {
        signed = await current.current.wallet.signTransaction(prepared.transaction);
      } catch {
        if (epoch === current.current.epoch) {
          setNotice('Signature declined or wallet unavailable. Nothing was sent.');
          setReview(undefined);
        }
        return;
      }
      if (epoch !== current.current.epoch || current.current.owner !== prepared.owner)
        throw new Error('Wallet account or network changed. Nothing was sent.');
      const intent = await client.signed(prepared, signed);
      if (epoch !== current.current.epoch || current.current.owner !== prepared.owner)
        throw new Error('Wallet account or network changed. Nothing was sent.');
      save([...recordsRef.current, intent], target);
      setReview(undefined);
      setBusy('Submitting saved transaction');
      try {
        if (prepared.via === 'api') {
          const result = await http(config.apiBase, '/v1/submit', {
            requestId: intent.id,
            wire: intent.wire,
          });
          if (result.signature !== intent.signature)
            throw new Error('Submission acknowledgement differs; checking the saved signature.');
        } else await client.broadcast(intent);
        if (epoch === current.current.epoch)
          setNotice('Submitted. Waiting for independent RPC confirmation.');
      } catch {
        if (epoch === current.current.epoch)
          setNotice(
            'Submission was not acknowledged. The signed transaction is saved; checking its signature before any retry.',
          );
      }
    } catch (e) {
      if (epoch === current.current.epoch) setError((e as Error).message);
    } finally {
      if (operation.current === id) setBusy('');
    }
  };
  const resend = async (intent: sdk.SignedIntent) => {
    if (!owner || intent.owner !== owner) return;
    const epoch = current.current.epoch,
      id = ++operation.current;
    setBusy('Resending saved bytes');
    setError('');
    try {
      const checked = await client.reconcile(intent);
      if (epoch !== current.current.epoch) return;
      save(recordsRef.current.map((x) => (x.id === intent.id ? checked : x)));
      if (terminal(checked)) return;
      const valid = await client.rpc.call('isBlockhashValid', [
        intent.blockhash,
        { commitment: 'finalized' },
      ]);
      if (!valid.value)
        throw new Error(
          'Saved transaction has expired. Its outcome remains unresolved; no replacement was signed.',
        );
      if (epoch !== current.current.epoch) return;
      await client.broadcast(intent);
      if (epoch === current.current.epoch)
        setNotice('Resent the identical signed bytes over RPC. Checking the original signature.');
    } catch (e) {
      if (epoch === current.current.epoch) setError((e as Error).message);
    } finally {
      if (operation.current === id) setBusy('');
    }
  };
  return {
    wallet,
    owner,
    client,
    snapshot,
    tokens,
    rpcError,
    apiError,
    notice,
    error,
    records,
    review,
    busy,
    feed,
    canSign,
    refresh,
    preview,
    sign,
    resend,
    invalidate,
    setNotice,
    setError,
  };
}
