import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createFromRoot } from 'codama';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';

const idl = JSON.parse(readFileSync('packages/sdk/idl/clearing.json', 'utf8'));
function snapshot(path: string): Record<string, string> {
  return Object.fromEntries(readdirSync(path, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => {
      const file = `${entry.parentPath}/${entry.name}`;
      return [file, readFileSync(file, 'utf8')];
    }).sort(([a], [b]) => a.localeCompare(b)));
}
const before = process.argv.includes('--check') ? snapshot('packages/sdk/src/generated') : undefined;
const codama = createFromRoot(rootNodeFromAnchor(idl));
await codama.accept(renderVisitor('packages/sdk', {
  kitImportStrategy: 'rootOnly',
  importExtension: 'js',
  syncPackageJson: false,
}));
if (before) assert.deepEqual(snapshot('packages/sdk/src/generated'), before, 'Generated SDK differs from the checked-in files');
