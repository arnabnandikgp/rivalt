// Public deterministic fixtures for offline local testing only. Never fund on a cluster.
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('.local/keys', { recursive: true, mode: 0o700 });
for (const role of ['clearing', 'payer', 'maker-a', 'maker-b', 'oracle-fixture']) {
  const seed = createHash('sha256').update(`rivalt/p01/local-only/${role}`).digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der', type: 'pkcs8',
  });
  const pubkey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
  writeFileSync(`.local/keys/${role}.json`, JSON.stringify([...seed, ...pubkey]), { mode: 0o600 });
}
