import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createFromRoot, bottomUpTransformerVisitor, flattenInstructionDataArgumentsVisitor, isNode, camelCase } from 'codama';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';
// Seed labels below are nonempty ASCII strings. Keep this build-only identity
// conversion local rather than importing a transport from another workspace.
function seedIdentity(label: string): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt(`0x${Buffer.from(label, 'ascii').toString('hex')}`), encoded = '';
  while (value > 0n) { encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n; }
  return encoded;
}

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
  // Public PDA helper names bind seed schemas, never the alphabetically first
  // instruction that happens to use them. Preserve the already published names
  // when new group instructions precede V1 instructions in Anchor's sorted IDL.
  if (program === 'clearing') {
    const preferred = new Map(Object.entries({
      registry: 'registry', 'registry-v2': 'initializeGroupV2Registry',
      vault: 'vault', 'vault-v2': 'classifyGroupSurplusV2Vault',
      resolution: 'resolution', 'resolution-v2': 'groupResolution',
      'exit-guard': 'guard', 'exit-v2': 'groupExitGuard',
    }).map(([label, name]) => [seedIdentity(label), name]));
    const aliases = new Map();
    for (const pda of codama.getRoot().program.pdas ?? []) {
      const seed = pda.seeds?.[0];
      if (!isNode(seed, 'constantPdaSeedNode') || !isNode(seed.value, 'bytesValueNode') || seed.value.encoding !== 'base58') continue;
      const name = preferred.get(seed.value.data);
      if (name) aliases.set(pda.name, camelCase(name));
    }
    codama.update(bottomUpTransformerVisitor([{
      select: path => isNode(path.at(-1), 'pdaNode') || isNode(path.at(-1), 'pdaLinkNode'),
      transform(node) {
        if (!(isNode(node, 'pdaNode') || isNode(node, 'pdaLinkNode'))) return node;
        return {...node, name: aliases.get(node.name) ?? node.name};
      },
    }]));
  }
  // Codama normally flattens structs used by only one instruction. Reusing V1
  // request types in V2 must not silently nest the existing public SDK inputs.
  const legacyRequests = program === 'clearing'
    ? new Set(['executeRoute', 'executeOrder', 'previewMaker']) : new Set(['quote']);
  const definitions = new Map(codama.getRoot().program.definedTypes?.map(type => [type.name, type.type]));
  codama.update(bottomUpTransformerVisitor([{
    select: '[instructionNode]',
    transform(node) {
      if (!isNode(node, 'instructionNode') || !legacyRequests.has(node.name)) return node;
      return { ...node, arguments: node.arguments?.map(argument => {
        if (!isNode(argument.type, 'definedTypeLinkNode')) return argument;
        const type = definitions.get(argument.type.name);
        assert(type && isNode(type, 'structTypeNode'), `Missing legacy request ${argument.type.name}`);
        return { ...argument, type };
      }) };
    },
  }]));
  codama.update(flattenInstructionDataArgumentsVisitor());
  await codama.accept(renderVisitor('packages/sdk', {
    generatedFolder: `src/${folder}`,
    kitImportStrategy: 'rootOnly',
    importExtension: 'js',
    syncPackageJson: false,
  }));
  if (before) assert.deepEqual(snapshot(path), before, `Generated ${program} SDK differs from the checked-in files`);
}
