/** Contract identities are separate from the receipts they decode. In particular,
 * a fresh ABI must never reinterpret the frozen predecessor with current IDLs. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {LIQUIDITY_ARTIFACTS} from '@rivalt/sdk';
import type {ProgramContract} from './receipt-metrics.js';

export const FROZEN_B_SOURCE = 'fb5d0c546a417796ce615e0d3d3575545c96c178';
export const C0_SOURCE = '366c7ab4f12c058fbff6538ededca26674ccf5bf';
export const artifactNames = ['clearing', 'maker_a', 'maker_b', 'oracle_fixture'] as const;
export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

export function profileContracts(revision?: string) {
  const encoded = ['clearing', 'maker_a', 'maker_b'].map(name => {
    const path = `packages/sdk/idl/${name}.json`;
    const bytes = revision ? execFileSync('git', ['show', `${revision}:${path}`]) : readFileSync(path);
    return {name, bytes};
  });
  return {
    contracts: encoded.map(({name, bytes}) => ({...JSON.parse(bytes.toString()), name})) as ProgramContract[],
    idls: Object.fromEntries(encoded.map(({name, bytes}) => [name, sha256(bytes)])),
  };
}

export function candidateArtifacts(directory: string) {
  const build = JSON.parse(readFileSync(`${directory}/build-manifest.json`, 'utf8'));
  assert.equal(build.revision, C0_SOURCE, 'Selected C0 source is immutable; a changed candidate needs an explicit new checkpoint');
  assert.equal(build.trackedDirty, false);
  assert.equal(build.instrumented, undefined);
  assert.equal(build.profile, 'liquidity-execution-qualification');
  assert.equal(build.framework, 'anchor-2.0.0-rc.2');
  assert.equal(build.accountSchema, 8);
  assert.equal(build.makerAccountSchema, 5);
  const artifacts = Object.fromEntries(artifactNames.map(name => {
    const bytes = readFileSync(`${directory}/${name}.so`);
    assert.equal(sha256(bytes), build.binaries[`${name}.so`]);
    const approved = LIQUIDITY_ARTIFACTS.find(value => value.name === name.replaceAll('_', '-'));
    assert(approved);
    assert.equal(sha256(bytes), approved.sha256, 'Candidate must match the client admission allowlist');
    assert.equal(bytes.length, approved.bytes);
    return [name, {sha256: sha256(bytes), bytes: bytes.length}];
  }));
  return {build, artifacts};
}

/** A signed original may be replayed on two independently reset local chains.
 * Preserve both executions (their starting states/CU can differ), but never call
 * them distinct signed originals or accept duplicate receipts within one run. */
export class OriginalPopulation {
  private readonly originals = new Map<string, {wireSha256: string; run: number; receipt: string; runs: Set<number>}>();
  get uniqueOriginals() { return this.originals.size; }
  observe(value: {signature: string; wireSha256: string; run: number; receipt: string}) {
    const previous = this.originals.get(value.signature);
    if (!previous) {
      this.originals.set(value.signature, {...value, runs: new Set([value.run])});
      return null;
    }
    assert.equal(value.wireSha256, previous.wireSha256, 'Same signature must identify identical signed bytes');
    assert(!previous.runs.has(value.run), 'Duplicate original receipt within one run');
    previous.runs.add(value.run);
    return {run: previous.run, receipt: previous.receipt};
  }
}
