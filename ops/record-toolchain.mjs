import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
const run = (command, args = ['--version']) => execFileSync(command, args, { encoding: 'utf8' }).trim();
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const sbf = `${homedir()}/.cache/solana/v1.52/platform-tools`;
console.log(JSON.stringify({
  capturedUtc: new Date().toISOString(),
  host: { architecture: process.arch, os: run('sw_vers', ['-productVersion']), build: run('sw_vers', ['-buildVersion']) },
  versions: Object.fromEntries(['rustc', 'cargo', 'anchor', 'solana', 'cargo-build-sbf', 'surfpool', 'node', 'pnpm'].map(cmd => [cmd, run(cmd)])),
  sbf: { platformTools: 'v1.52', architecture: 'v0', rustc: run(`${sbf}/rust/bin/rustc`), clang: run(`${sbf}/llvm/bin/clang`),
    rustcSha256: hash(`${sbf}/rust/bin/rustc`), clangSha256: hash(`${sbf}/llvm/bin/clang`) },
  binarySha256: Object.fromEntries([
    '.tools/bin/anchor', '.tools/agave/solana-release/bin/solana', '.tools/agave/solana-release/bin/cargo-build-sbf',
    '.tools/surfpool/surfpool', '.tools/node/node-v24.22.0-darwin-arm64/bin/node',
  ].map(path => [path, hash(path)])),
  installedDependencies: JSON.parse(run('node', ['ops/check-dependencies.mjs'])),
}, null, 2));
