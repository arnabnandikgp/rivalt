import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { getBase58Encoder } from '@solana/kit';
import { Rpc } from '../../packages/indexer/src/rpc.js';
import { checkedGenesis, configuration } from './devnet-preflight-support.js';
import { sponsoredFeeds } from './pyth-core.js';
import { DevnetTransport } from './devnet-transport.js';
import { persist } from './devnet-rpc.js';

// Read-only retrieval of the exact messages actually consumed by Rivalt. The
// independent Python auditor checks their instruction/account bytes afterward.
const root = process.argv[2] ?? '.local/devnet/acceptance';
const report = JSON.parse(readFileSync(`${root}/report.json`, 'utf8'));
assert(report.usedSource, 'A recorded actual source observation is required');
const profile = JSON.parse(readFileSync('ops/devnet-profile.json', 'utf8'));
const rpc = new DevnetTransport(new Rpc(configuration(process.env).rpc));
checkedGenesis(await rpc.call('getGenesisHash'));
const directory = `${root}/provenance`; mkdirSync(directory, { recursive: true });
const feeds = (await sponsoredFeeds()).filter(f => f.name === 'compatible');
const bytes = (data: string) => Buffer.from(getBase58Encoder().encode(data));
const disc = (s: string) => createHash('sha256').update(`global:${s}`).digest().subarray(0, 8);
const keys = (tx: any): string[] => [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
const fetchTx = (signature: string) => rpc.call('getTransaction', [signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 1 }]);
const updates = [];
for (const [index, feed] of feeds.entries()) {
  const postedSlot = BigInt(report.usedSource.prices[index].postedSlot);
  const discovered: any[] = []; let before: string | undefined;
  for (let page = 0; page < 4; page++) {
    const rows = await rpc.call('getSignaturesForAddress', [feed.account, { limit: 500, commitment: 'finalized', ...(before ? { before } : {}) }]);
    discovered.push(...rows);
    if (!rows.length || BigInt(rows.at(-1).slot) <= postedSlot) break;
    before = rows.at(-1).signature;
  }
  const matching = discovered.filter(row => BigInt(row.slot) === postedSlot && row.err === null);
  persist(`${directory}/${feed.feed}-discovery.json`, { address: feed.account, postedSlot, matching,
    fetchedCount: discovered.length, fetchedSha256: createHash('sha256').update(JSON.stringify(discovered)).digest('hex') });
  let update: any, vaa: string | undefined;
  for (const candidate of matching) {
    const tx = await fetchTx(candidate.signature); if (!tx || tx.meta.err !== null) continue;
    const all = keys(tx);
    const ix = tx.transaction.message.instructions.find((i: any) => all[i.programIdIndex] === feed.push &&
      all[i.accounts[5]] === feed.account && bytes(i.data).subarray(0, 8).equals(disc('update_price_feed')));
    if (ix) { assert(!update, 'Ambiguous source update at posted slot'); update = tx; vaa = all[ix.accounts[2]]; }
  }
  assert(update && vaa, 'Actual source update not found in bounded finalized history');
  persist(`${directory}/${feed.feed}-update.json`, update);
  const vaaHistory = await rpc.call('getSignaturesForAddress', [vaa, { limit: 100, commitment: 'finalized' }]);
  let verification: any;
  for (const candidate of vaaHistory.filter((x: any) => x.err === null && BigInt(x.slot) <= postedSlot)) {
    const tx = await fetchTx(candidate.signature); if (!tx || tx.meta.err !== null) continue;
    const all = keys(tx);
    if (tx.transaction.message.instructions.some((ix: any) => all[ix.programIdIndex] === profile.wormholeReceiver &&
      ix.accounts.some((i: number) => all[i] === vaa) && bytes(ix.data).subarray(0, 8).equals(disc('verify_encoded_vaa_v1')))) {
      verification = tx; break;
    }
  }
  assert(verification, 'Actual VAA verification not found in bounded finalized history');
  persist(`${directory}/${feed.feed}-vaa-verification.json`, verification);
  updates.push({ feed, account: report.usedSource.raw.value[index], postedSlot,
    updateSignature: update.transaction.signatures[0], vaa, verificationSignature: verification.transaction.signatures[0] });
}
persist(`${directory}/manifest.json`, { result: 'retrieved', a18Complete: false, retrievedUtc: new Date().toISOString(),
  reportRevision: report.revision, usedSource: report.usedSource, updates, interruptions: rpc.interruptions });
console.log(JSON.stringify({ result: 'retrieved', directory, updates: updates.map(x => ({ feed: x.feed.feed, signature: x.updateSignature })) }));
