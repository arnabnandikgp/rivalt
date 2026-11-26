import assert from 'node:assert/strict';
import {verifyTestBuild} from './backing-artifacts.js';
import {accountDeployment,FUNDED_MULTI_ARTIFACT_SET,PRICE_LIMITED_MULTI_ARTIFACT_SET,MULTI_ROUTING_ARTIFACT_SET,WIDE_DIRECTORY_ARTIFACT_SET,WIDE_ROUTING_ARTIFACT_SET} from '@rivalt/sdk';

export function multiDeploymentFor(artifactSet: string) {
  if (artifactSet === PRICE_LIMITED_MULTI_ARTIFACT_SET) return 'price-limited-multi-maker';
  if (artifactSet === FUNDED_MULTI_ARTIFACT_SET) return 'funded-multi-maker';
  assert.equal(artifactSet, MULTI_ROUTING_ARTIFACT_SET);
  return 'multi-maker';
}

/** Explicit local binary identity shared by the launcher and finalized journal. */
export function routerBuild(selection:'direct-closed-credit'|'verified-coverage'|'maintained-coverage'|'shadow-coverage'|'funded-routing'|'bounded-entry'|'closed-quantity'|'bounded-router-candidate' =
  process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-direct-credit' ? 'direct-closed-credit' :
  process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-verified-coverage' ? 'verified-coverage' :
  process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-maintained-coverage' ? 'maintained-coverage' :
  process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-shadow-coverage' ? 'shadow-coverage' :
  process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-funded-benchmark' ? 'funded-routing' :
  process.env.RIVALT_SETTLEMENT_PROBE?.startsWith('execution-router-bounded-entry')?'bounded-entry':
  ['execution-router-closed-quantity','execution-router-mixed-storage'].includes(process.env.RIVALT_SETTLEMENT_PROBE ?? '') ? 'closed-quantity' : 'bounded-router-candidate',
  directory = process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!) {
  const revision = process.env.RIVALT_ROUTER_REVISION!;
  const extended=['execution-router-multi-fills','execution-router-multi-width','execution-router-multi-price-limits','execution-router-wallet-contention','execution-router-matched-makers','execution-router-feasible-books'].includes(process.env.RIVALT_SETTLEMENT_PROBE??'');
  if (extended) {
    const verified = (['price-limited-multi-maker','funded-multi-maker','multi-maker'] as const)
      .map(accountDeployment).find(deployment => deployment.programRevision === revision);
    assert(verified && revision, 'Unknown wider routing revision');
    const artifacts=Object.fromEntries(verified.artifacts.filter(artifact=>artifact.name!=='oracle-fixture')
      .map(({name,bytes,sha256})=>[name,{bytes,sha256}]));
    verifyTestBuild(directory,revision,artifacts,'wide-atomic-routes');
    return {revision,artifacts,artifactSet:verified.artifactSet};
  }
  const wideFills=process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-wide-fills';
  if (wideFills || process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-wide-directory') {
    assert.equal(revision,wideFills?'5e32c124f078902535c6e40a02419f797550e89a':'9a537a70a86e8ef8ebbfc4ec37bf84e7d5f37084');
    const artifacts = {
      clearing:wideFills?{bytes:3639640,sha256:'f386eddff755a76efc93d97b75c29de756b555a2eb78762649f03b91e223cb12'}:{bytes:3631168,sha256:'e370a3b1cb18896d05737777ec19deabab3c11532d69d11b3d5f23bd3b4ec283'},
      'maker-a':{bytes:167520,sha256:'2140ec94a8994a62d0c54044b10d14f48eae19dca0c9a8299b78f7b82b1ca97f'},
      'maker-b':{bytes:167520,sha256:'372794d71127c68e548d5df4edf0af70c11d15a3ed10dcf2bc993339e67752fe'},
    };
    verifyTestBuild(directory,revision,artifacts,'wide-maker-discovery');
    return {revision,artifacts,artifactSet:wideFills?WIDE_ROUTING_ARTIFACT_SET:WIDE_DIRECTORY_ARTIFACT_SET};
  }
  const deployment = accountDeployment(selection);
  assert.equal(revision, deployment.programRevision);
  const artifacts = Object.fromEntries(deployment.artifacts
    .filter(artifact => artifact.name !== 'oracle-fixture')
    .map(({name, bytes, sha256}) => [name, {bytes, sha256}]));
  verifyTestBuild(directory, revision, artifacts, selection==='direct-closed-credit'||selection==='verified-coverage'||selection==='maintained-coverage'||selection==='shadow-coverage'?selection:selection==='bounded-entry'||selection==='funded-routing'?'bounded-entry-settlement':selection==='closed-quantity'?'closed-quantity-settlement':'execution-router-qualification');
  return {artifactSet: deployment.artifactSet, artifacts, revision};
}
