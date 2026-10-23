import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { checkedGenesis, configuration, DEPENDENCIES, observeSlot, programDataAddress, programDataIdentity, unsigned } from './devnet-preflight-support.js';

// Read-only inventory. No signing, deployment, faucet, wallet or fixture imports.
const directory = `.local/devnet/preflight/${new Date().toISOString().replaceAll(':', '-')}`;
mkdirSync(directory, { recursive: true });
let stage = 'configuration', id = 0;
const report: Record<string, unknown> = {
  kind: 'read-only-devnet-dependency-inventory', startedUtc: new Date().toISOString(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
  a18Complete: false, signedUpdateVerified: false, rivaltDeployed: false,
};
try {
  const config = configuration(process.env);
  report.endpoint = config.endpointLabel;
  async function rpc(method: string, params: unknown[] = []) {
    const requestId = ++id;
    const response = await fetch(config.rpc, {
      method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('RPC HTTP failure');
    const body = await response.json();
    if (body.id !== requestId || body.error || !('result' in body)) throw new Error('RPC response rejected');
    return body.result;
  }
  stage = 'genesis'; report.genesis = checkedGenesis(await rpc('getGenesisHash'));
  stage = 'version'; const version = await rpc('getVersion');
  if (typeof version['solana-core'] !== 'string' || !/^[a-zA-Z0-9.+-]{1,64}$/.test(version['solana-core'])) throw new Error('Version invalid');
  report.version = { solanaCore: version['solana-core'], featureSet: unsigned(version['feature-set']) };
  stage = 'dependency-programs';
  const entries = Object.entries(DEPENDENCIES);
  const programs = await rpc('getMultipleAccounts', [entries.map(([, address]) => address), { encoding: 'base64', commitment: 'finalized' }]);
  if (!Array.isArray(programs.value) || programs.value.length !== entries.length) throw new Error('Program response invalid');
  const addresses = programs.value.map(programDataAddress);
  stage = 'dependency-program-data';
  const accounts = await rpc('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'finalized', minContextSlot: Number(unsigned(programs.context.slot)) }]);
  if (!Array.isArray(accounts.value) || accounts.value.length !== entries.length) throw new Error('ProgramData response invalid');
  report.dependencies = entries.map(([role, program], i) => ({ role, program, programData: addresses[i], ...programDataIdentity(accounts.value[i]) }));
  report.contexts = { programSlot: unsigned(programs.context.slot), programDataSlot: unsigned(accounts.context.slot), commitment: 'finalized' };
  stage = 'websocket'; report.websocket = await observeSlot(config.ws);
  report.result = 'pass';
} catch {
  // Provider errors may contain credential-bearing URLs, headers or response text.
  report.result = 'fail'; report.failedStage = stage; process.exitCode = 1;
} finally {
  report.finishedUtc = new Date().toISOString();
  writeFileSync(`${directory}/inventory.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ result: report.result, failedStage: report.failedStage, report: `${directory}/inventory.json`, a18Complete: false }));
}
