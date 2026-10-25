import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter';
import { address } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type { GroupTraderConfig } from './types.js';
import { terminal, retain, mergeReconciled } from '../receipts.js';

export type Review = sdk.PreparedTransaction & {
  scope: string;
  via: 'api' | 'rpc';
};
export async function http(base: string, path: string, body?: unknown) {
  const r = await fetch(base + path, {
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok)
    throw new Error(
      path === '/v2/quote'
        ? 'Quote unavailable at the current chain state. Request a new quote.'
        : 'Venue API unavailable or request rejected. Direct cancel and withdrawal use RPC.',
    );
  return r.json();
}
function readReceipts(key: string): sdk.SignedIntent[] {
  const value = JSON.parse(localStorage.getItem(key) ?? '[]');
  if (!Array.isArray(value)) throw new Error('Saved transaction history is invalid.');
  return value.filter(
    (x) =>
      x &&
      typeof x.signature === 'string' &&
      typeof x.wire === 'string' &&
      typeof x.owner === 'string',
  );
}
export function useGroupVenue(config: GroupTraderConfig, scope: string) {
  const wallet = useWallet(),
    owner = wallet.publicKey ? address(wallet.publicKey.toBase58()) : null;
  const client = useMemo(() => new sdk.GroupUserClient(config), [config]);
  const key = `rivalt:receipts:v2:${config.genesis}:${config.anchor}:${config.group}:${owner ?? 'disconnected'}`;
  const current = useRef({ owner, key, epoch: 0, wallet, scope });
  current.current.owner = owner;
  current.current.key = key;
  current.current.wallet = wallet;
  current.current.scope = scope;
  const [snapshot, setSnapshot] = useState<sdk.GroupSnapshot>(),
    [tokens, setTokens] = useState<{ address: sdk.Participant['owner']; amount: bigint }[]>([]);
  const [ownerPortfolio, setOwnerPortfolio] =
    useState<Awaited<ReturnType<sdk.GroupUserClient['ownerPortfolio']>>>();
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
    setOwnerPortfolio(undefined);
    setNotice('');
    setError('');
    try {
      setRecords(readReceipts(key));
    } catch (e) {
      setError((e as Error).message);
      setRecords([]);
    }
  }, [key, scope, wallet.account?.chains.join(',')]);
  const refresh = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    const epoch = current.current.epoch;
    try {
      const s = await client.snapshot();
      const [owned, portfolio] = owner
        ? await Promise.all([client.walletTokens(owner), client.ownerPortfolio(owner)])
        : [[], undefined];
      if (epoch !== current.current.epoch) return;
      setSnapshot(s);
      setTokens(owned);
      setOwnerPortfolio(portfolio);
      setRpcError('');
      const results = await Promise.allSettled([
        http(config.readBase, '/v2/trades?latest=true&limit=30'),
        http(config.readBase, '/v2/events?latest=true&limit=50'),
        http(config.readBase, '/v2/group'),
      ]);
      if (epoch !== current.current.epoch) return;
      if (results.every((result) => result.status === 'fulfilled')) {
        const [trades, events, group] = results.map(
          (result) => (result as PromiseFulfilledResult<any>).value,
        );
        if (
          [trades, events, group].some(
            (value) =>
              value.group !== config.group ||
              value.deployment?.anchor !== config.anchor ||
              value.deployment?.genesis !== config.genesis ||
              value.deployment?.domain !== config.domain ||
              value.deployment?.profile !== config.profile,
          )
        ) {
          setApiError(
            'Indexed deployment differs from the configured group. Direct RPC balances and exits remain available.',
          );
          setFeed((previous: any) => ({ ...previous, ready: false }));
          return;
        }
        setFeed({
          trades: trades.items,
          events: events.items,
          group,
          asOf: trades.asOf,
          ready: true,
        });
        setApiError('');
      } else {
        setApiError(
          'Venue history is unavailable. Direct RPC balances and exits remain available.',
        );
        setFeed((previous: any) => ({ ...previous, ready: false }));
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
              setNotice(
                `${latest.label} failed. Check its saved result before preparing a new transaction.`,
              );
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
    build: (
      s: sdk.GroupSnapshot,
      owner: sdk.Participant['owner'],
    ) => Promise<Omit<Review, 'scope'>>,
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
      // Unsigned preparation uses the current provisional stamp; displayed balances
      // remain finalized and execution still rechecks the signed dependencies.
      const s = await client.snapshot('confirmed');
      const prepared = await build(s, owner);
      if (epoch !== current.current.epoch || current.current.scope !== scope) return;
      if (recordsRef.current.some((x) => !terminal(x) && x.label === prepared.label))
        throw new Error(
          'This action has an unresolved saved transaction. Reconcile its signature before repeating it.',
        );
      setReview({ ...prepared, scope });
    } catch (e) {
      if (epoch === current.current.epoch) setError((e as Error).message);
    } finally {
      if (operation.current === id) setBusy('');
    }
  };
  const sign = async () => {
    if (!review || review.scope !== scope || !canSign || !current.current.wallet.signTransaction)
      return;
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
      if (
        epoch !== current.current.epoch ||
        current.current.owner !== prepared.owner ||
        current.current.scope !== prepared.scope
      )
        throw new Error('Wallet account, market or margin account changed. Nothing was sent.');
      const intent = await client.signed(prepared, signed);
      if (
        epoch !== current.current.epoch ||
        current.current.owner !== prepared.owner ||
        current.current.scope !== prepared.scope
      )
        throw new Error('Wallet account, market or margin account changed. Nothing was sent.');
      save([...recordsRef.current, intent], target);
      setReview(undefined);
      setBusy('Submitting saved transaction');
      try {
        if (prepared.via === 'api') {
          const result = await http(config.apiBase, '/v2/submit', {
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
    ownerPortfolio,
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
