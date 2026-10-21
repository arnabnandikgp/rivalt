import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createFromRoot } from 'codama';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';

function snapshot(path: string): Record<string, string> {
  return Object.fromEntries(readdirSync(path, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => {
      const file = `${entry.parentPath}/${entry.name}`;
      return [file, readFileSync(file, 'utf8')];
    }).sort(([a], [b]) => a.localeCompare(b)));
}
for (const [program, folder] of [['clearing', 'generated'], ['maker_a', 'generatedMakerA'], ['maker_b', 'generatedMakerB']]) {
  const path = `packages/sdk/src/${folder}`;
  const before = process.argv.includes('--check') ? snapshot(path) : undefined;
  const idl = JSON.parse(readFileSync(`packages/sdk/idl/${program}.json`, 'utf8'));
  const codama = createFromRoot(rootNodeFromAnchor(idl));
  await codama.accept(renderVisitor('packages/sdk', {
    generatedFolder: `src/${folder}`,
    kitImportStrategy: 'rootOnly',
    importExtension: 'js',
    syncPackageJson: false,
  }));
  if (before) assert.deepEqual(snapshot(path), before, `Generated ${program} SDK differs from the checked-in files`);
}
