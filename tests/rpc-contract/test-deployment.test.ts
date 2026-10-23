import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { address, blockhash, createNoopSigner, getProgramDerivedAddress } from '@solana/kit';
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import { userAuthority } from '../../packages/services/src/queue.js';
import { fixtureKey } from './custody-cases.js';

const manifest = JSON.parse(readFileSync('ops/devnet-profile.json', 'utf8'));
const deployment = sdk.testDeployment('solana:devnet');
const market = address('212Kzyyi9E12FfjqsTcqvZjHg1zSnp6TyaHqEZkChzih');
const config: sdk.UserConfig = { version: 1, chain: 'solana:devnet', genesis: sdk.DEVNET_GENESIS,
  rpcUrl: 'http://127.0.0.1:18086', wsUrl: 'ws://127.0.0.1:18086', anchor: '1'.repeat(88),
  market, mint: address('9q2xbNpTVF2CrS43sHETAgDZsotUtxq4EcnQ67jrGc4Z'), domain: '00'.repeat(32) };

test('explicit devnet IDs match the deployed manifest and retained chain PDAs', async () => {
  expect(deployment.clearing).toBe(manifest.programs.clearing);
  expect(deployment.makerA).toBe(manifest.programs.maker_a);
  expect(deployment.makerB).toBe(manifest.programs.maker_b);
  const client = new sdk.UserClient(config);
  expect((await sdk.findMarketPda(client.options))[0]).toBe(market);
  expect((await sdk.findParticipantPda({ market, owner: address('Chuxukhu1DSUVHRZFPAGxTPjNK5Kz5jTkbJCesLyFjMh') }, client.options))[0])
    .toBe('9EyFUQ1jcHMDnk1kGGs6yeamtdhzn4Us2mFwyZxCsCCU');
  expect(sdk.testDeployment().clearing).toBe(sdk.CLEARING_PROGRAM_ADDRESS);
  expect((await sdk.findMarketPda())[0]).not.toBe(market);
});

test('wrong cluster, arbitrary chain and browser credentials remain rejected', () => {
  expect(() => sdk.userConfig({ ...config, genesis: '11111111111111111111111111111111' })).toThrow('genesis');
  expect(() => sdk.testDeployment('solana:mainnet')).toThrow();
  expect(() => sdk.userConfig({ ...config, rpcUrl: 'https://rpc.example/?api-key=secret' })).toThrow('credentials');
  expect(() => sdk.testRpcUrl('https://rpc.example', 'solana:localnet')).toThrow();
  expect(() => sdk.testRpcUrl('http://rpc.example', 'solana:devnet')).toThrow();
  expect(() => sdk.testRpcUrl('https://rpc.example/?api-key=server-only', 'solana:devnet')).not.toThrow();
});

test('signed devnet wallet ingress must explicitly match its deployment', async () => {
  const key = await fixtureKey('p14-deployment-wire');
  const [eventAuthority] = await getProgramDerivedAddress({ programAddress: deployment.clearing, seeds: [Buffer.from('__event_authority')] });
  const ix = await sdk.getCancelOrderInstructionAsync({ owner: createNoopSigner(key.address), market, eventAuthority, program: deployment.clearing, id: 1n, version: 1n }, { programAddress: deployment.clearing });
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: key.publicKey,
    recentBlockhash: blockhash('11111111111111111111111111111111'), instructions: [ix] }).compileToV0Message());
  await tx.sign([key]);
  const wire = Buffer.from(tx.serialize()).toString('base64');
  expect(userAuthority(wire, market, deployment.clearing)).toBeNull();
  expect(() => userAuthority(wire, market)).toThrow('Unsupported transaction');
});
