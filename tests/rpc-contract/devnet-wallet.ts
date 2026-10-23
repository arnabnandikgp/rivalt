import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { address, createNoopSigner, getProgramDerivedAddress } from '@solana/kit';
import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import { Rpc } from '../../packages/indexer/src/rpc.js';
import { decode } from '../../packages/indexer/src/events.js';
import { signedWire } from '../../packages/services/src/queue.js';
import { checkedGenesis, configuration } from './devnet-preflight-support.js';
import { persist } from './devnet-rpc.js';

// Read-only verification after a real external wallet signs in the interactive UI.
// No private signer, browser automation, replacement transaction or broadcast.
const owner = address(process.argv[2]), program = sdk.testDeployment('solana:devnet').clearing;
const options = { programAddress: program }, rpc = new Rpc(configuration(process.env).rpc);
const [market] = await sdk.findMarketPda(options), [participant] = await sdk.findParticipantPda({ market, owner }, options);
const [registry] = await sdk.findRegistryPda({ market }, options), [vault] = await sdk.findVaultPda({ market }, options);
const [eventAuthority] = await getProgramDerivedAddress({ programAddress: program, seeds: [Buffer.from('__event_authority')] });
const directory = '.local/devnet/wallet'; mkdirSync(directory, { recursive: true, mode: 0o700 });
const report: Record<string, any> = { startedUtc: new Date().toISOString(), owner, participant, market, program,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
  providerObservation: 'User manually reports Phantom connection/signing; native browser control unavailable', signedByVerifier: false };
try {
  report.genesis = checkedGenesis(await rpc.call('getGenesisHash'));
  const signatures = await rpc.call('getSignaturesForAddress', [participant, { commitment: 'finalized', limit: 20 }]);
  for (const item of signatures) {
    const history = await rpc.call('getTransaction', [item.signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    const events = decode(item.signature, history, eventAuthority, program);
    if (!events.some(e => e.type === 'custody' && e.data.kind === 1 && e.data.actor === owner && e.data.participant === participant)) continue;
    const fetched = await rpc.call('getTransaction', [item.signature, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    assert.equal(fetched.meta.err, null);
    const wire = fetched.transaction[0], signed = signedWire(wire);
    assert.equal(signed.signature, item.signature); assert.equal(signed.keys[0], owner); assert.equal(signed.tx.signatures.length, 1);
    const canonical = new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(owner),
      recentBlockhash: signed.tx.message.recentBlockhash,
      instructions: sdk.walletComputeBudget([await sdk.getRegisterParticipantInstructionAsync({ owner: createNoopSigner(owner), eventAuthority, program }, options)]),
    }).compileToV0Message());
    assert.deepEqual(signed.tx.message.serialize(), canonical.message.serialize(), 'Wallet landing differs from canonical preview');
    const economic = signed.tx.message.compiledInstructions.filter(ix => signed.keys[ix.programIdIndex] === program);
    assert.equal(economic.length, 1);
    assert.deepEqual(Buffer.from(economic[0].data), Buffer.from(sdk.REGISTER_PARTICIPANT_DISCRIMINATOR));
    const status = (await rpc.call('getSignatureStatuses', [[item.signature], { searchTransactionHistory: true }])).value[0];
    assert.equal(status.confirmationStatus, 'finalized'); assert.equal(status.slot, history.slot); assert.equal(status.err, null);
    report.transaction = { signature: item.signature, wire, history, status, events };
    break;
  }
  assert(report.transaction, 'No successful wallet registration found; no replacement signed');
  report.accounts = await rpc.call('getMultipleAccounts', [[market, registry, participant, vault], { encoding: 'base64', commitment: 'finalized', minContextSlot: report.transaction.history.slot }]);
  const raw = report.accounts.value.map((x: any, i: number) => {
    assert.equal(x.owner, i === 3 ? 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' : program);
    return Buffer.from(x.data[0], 'base64');
  });
  const m = sdk.getMarketStateDecoder().decode(raw[0]), reg = sdk.getParticipantRegistryDecoder().decode(raw[1]), p = sdk.getParticipantDecoder().decode(raw[2]);
  assert.equal(p.owner, owner); assert.equal(p.market, market); assert.equal(reg.members[p.id], participant);
  assert.equal(p.cash, 0n); assert.equal(p.lots, 0n); assert.equal(p.virtualScaled, 0n);
  assert.equal(raw[3].readBigUInt64LE(64), m.allocatedVault);
  report.participantState = p;
  const response = await fetch(`http://127.0.0.1:18088/read/v1/balances/${participant}`);
  assert.equal(response.status, 200); report.indexed = await response.json();
  assert.equal(report.indexed.participant, participant);
  const html = readFileSync('apps/trader/dist/index.html', 'utf8');
  const asset = html.match(/src="\/assets\/([^"/]+\.js)"/)?.[1]; assert(asset);
  report.uiAsset = { name: asset, sha256: createHash('sha256').update(readFileSync(`apps/trader/dist/assets/${asset}`)).digest('hex') };
  report.result = 'pass';
} catch (error) {
  report.result = 'fail'; report.failure = String(error).replace(/https?:\/\/\S+/g, '[endpoint]').slice(0, 500); process.exitCode = 1;
} finally {
  report.finishedUtc = new Date().toISOString(); persist(`${directory}/registration.json`, report);
  console.log(JSON.stringify({ result: report.result, signature: report.transaction?.signature, failure: report.failure, report: `${directory}/registration.json` }));
}
