import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const versions = new Map();
const visited = new Set();
const runtimeOnly = process.argv.includes('--runtime-only');
assert(process.argv.slice(2).every(arg => arg === '--runtime-only'), 'Unknown dependency check option');
function walk(manifestPath) {
  const path = realpathSync(manifestPath);
  if (visited.has(path)) return;
  visited.add(path);
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  assert(!pkg.name.startsWith('@anchor-lang/'), `Legacy Anchor entered runtime graph: ${pkg.name}`);
  if (pkg.name === '@solana/web3.js') assert.equal(pkg.version, '3.1.1');
  if (pkg.name === '@solana/kit') assert.equal(pkg.version, '8.5.0');
  if (['@solana/web3.js', '@solana/kit', '@solana/wallet-adapter', 'react', 'react-dom'].includes(pkg.name)) {
    versions.set(pkg.name, pkg.version);
  }
  const require = createRequire(path);
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) {
    const dependency = require.resolve.paths(name).map(p => `${p}/${name}/package.json`).find(existsSync);
    if (!dependency) {
      assert(name in (pkg.optionalDependencies ?? {}) || pkg.peerDependenciesMeta?.[name]?.optional,
        `Missing required runtime dependency ${name} of ${pkg.name}`);
      continue;
    }
    walk(dependency);
  }
}
for (const root of ['packages/sdk', 'packages/indexer', 'packages/services', 'apps/trader', 'tests/rpc-contract']) walk(resolve(root, 'package.json'));
if (existsSync('packages/maker-kit/package.json')) walk(resolve('packages/maker-kit/package.json'));
assert.equal(versions.get('@solana/kit'), '8.5.0');
assert.equal(versions.get('@solana/wallet-adapter'), '3.1.1');
if (!runtimeOnly) for (const [name, expected] of [['@anchor-lang/core', '1.2.1'], ['@solana/web3.js', '1.99.0']]) {
  assert.equal(JSON.parse(readFileSync(`tests/anchor-conformance/node_modules/${name}/package.json`)).version, expected);
}
const custodyTestPackages = Object.fromEntries([
  ['litesvm', '1.6.1'], ['@solana-program/token', '0.18.0'], ['@solana-program/system', '0.16.0'],
].map(([name, expected]) => {
  const actual = JSON.parse(readFileSync(`tests/rpc-contract/node_modules/${name}/package.json`)).version;
  assert.equal(actual, expected);
  return [name, actual];
}));
for (const [name, expected] of [['fastify','5.12.7'],['pg','8.23.1']]) {
  assert.equal(JSON.parse(readFileSync(`packages/indexer/node_modules/${name}/package.json`)).version,expected);
}
const browserTooling=Object.fromEntries([
  ['apps/trader','react','19.3.0'],['apps/trader','react-dom','19.3.0'],['apps/trader','vite','7.3.7'],
  ['apps/trader','@types/react','19.3.0'],['apps/trader','@types/react-dom','19.3.0'],['tests/browser','playwright-core','1.64.1'],
].map(([root,name,expected])=>{const actual=JSON.parse(readFileSync(`${root}/node_modules/${name}/package.json`)).version;assert.equal(actual,expected);return[name,actual];}));
console.log(JSON.stringify({ modernRuntime: Object.fromEntries(versions), custodyTestPackages,
  browserTooling,
  serviceRuntime: Object.fromEntries(['fastify','pg'].map(name=>[name,JSON.parse(readFileSync(`packages/indexer/node_modules/${name}/package.json`)).version])),
  packagesInspected: visited.size, legacyIsolation: runtimeOnly ? 'runtime graph excludes legacy; isolated conformance client not checked' : 'pass' }, null, 2));
