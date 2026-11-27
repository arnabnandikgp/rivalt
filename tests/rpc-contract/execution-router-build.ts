import assert from 'node:assert/strict';
import {verifyTestBuild} from './backing-artifacts.js';
import {INACTIVE_LISTING_ARTIFACT_SET,INDEXED_WITHDRAWAL_ARTIFACT_SET,GROUPED_CREDIT_ARTIFACT_SET,STREAMED_CREDIT_ARTIFACT_SET,THOUSAND_MEMBER_CREDIT_ARTIFACT_SET,accountDeployment,FUNDED_MULTI_ARTIFACT_SET,PRICE_LIMITED_MULTI_ARTIFACT_SET,MULTI_ROUTING_ARTIFACT_SET,WIDE_DIRECTORY_ARTIFACT_SET,WIDE_ROUTING_ARTIFACT_SET} from '@rivalt/sdk';

export function multiDeploymentFor(artifactSet: string) {
  if (artifactSet === PRICE_LIMITED_MULTI_ARTIFACT_SET) return 'price-limited-multi-maker';
  if (artifactSet === FUNDED_MULTI_ARTIFACT_SET) return 'funded-multi-maker';
  assert.equal(artifactSet, MULTI_ROUTING_ARTIFACT_SET);
  return 'multi-maker';
}

/** Explicit local binary identity shared by the launcher and finalized journal. */
export function routerBuild(selection:'direct-closed-credit'|'verified-coverage'|'maintained-coverage'|'shadow-coverage'|'funded-routing'|'bounded-entry'|'closed-quantity'|'bounded-router-candidate' =
  ['execution-router-direct-credit','execution-router-direct-cashout','execution-router-direct-capacity'].includes(process.env.RIVALT_SETTLEMENT_PROBE ?? '') ? 'direct-closed-credit' :
  process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-verified-coverage' ? 'verified-coverage' :
  process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-maintained-coverage' ? 'maintained-coverage' :
  process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-shadow-coverage' ? 'shadow-coverage' :
  process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-funded-benchmark' ? 'funded-routing' :
  process.env.RIVALT_SETTLEMENT_PROBE?.startsWith('execution-router-bounded-entry')?'bounded-entry':
  ['execution-router-closed-quantity','execution-router-mixed-storage'].includes(process.env.RIVALT_SETTLEMENT_PROBE ?? '') ? 'closed-quantity' : 'bounded-router-candidate',
  directory = process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!) {
  const revision = process.env.RIVALT_ROUTER_REVISION!;
  const probe = process.env.RIVALT_SETTLEMENT_PROBE;
  if (probe === 'execution-router-indexed-withdrawal' || probe === 'execution-router-inactive-listing') {
    const listing = probe === 'execution-router-inactive-listing';
    const profile = listing ? {
      name:'inactive-market-listing',revision:'1adaf018353172e446820a04597b45b97bcbac23',artifactSet:INACTIVE_LISTING_ARTIFACT_SET,
      clearing:{bytes:3922424,sha256:'0d66986f9173d89439d05d899be40870a179b0f9191629259155f4cbbc3e8b81'},
    } : {
      name:'indexed-withdrawal',revision:'4e11ef9488b3c2205a1fa1bad02c0215cae8d976',artifactSet:INDEXED_WITHDRAWAL_ARTIFACT_SET,
      clearing:{bytes:3896184,sha256:'7e1a18ac655c9d9876b2cbdb151c89af70605589732e57e196e5918c2b390b76'},
    };
    assert.equal(revision,profile.revision);
    const artifacts = {
      clearing:profile.clearing,
      'maker-a':{bytes:167520,sha256:'356b53f98b2e6a5ac4aeaf44100617e802ca9435470795ef36edc24ba9a1ff6d'},
      'maker-b':{bytes:167520,sha256:'cb5bf04628f563011e9def55b488336f0271903e15ce7f1da99320f4ef0b67de'},
    };
    verifyTestBuild(directory,revision,artifacts,profile.name);
    return {revision,artifacts,artifactSet:profile.artifactSet};
  }
  const streamed = probe === 'execution-router-streamed-capacity' || probe === 'execution-router-streamed-credit';
  const grouped = probe === 'execution-router-grouped-slots' || probe === 'execution-router-grouped-worker' || probe === 'execution-router-grouped-capacity' || probe === 'execution-router-grouped-credit';
  if (grouped || streamed || probe === 'execution-router-thousand-member-credit') {
    const profile = grouped
      ? {revision:'e4aff314f037b5101f2d036785020e371762c48a',artifactSet:GROUPED_CREDIT_ARTIFACT_SET,
         clearing:{bytes:3890336,sha256:'9879916fe82f2062b000fb2e53c69b038ddac054fd6b1dbf985b6bf541c2c1ad'}}
      : streamed
      ? {revision:'99165b413d6c3b3fe0540ab0756861394324b5d8',artifactSet:STREAMED_CREDIT_ARTIFACT_SET,
         clearing:{bytes:3883768,sha256:'7f9cf8a9a0c1c4197d721ebc856a2fccd4a20b661e0847de91c730ff9ff83c9c'}}
      : {revision:'213d394d748741ca60e1230a9bdbdab6596f86c9',artifactSet:THOUSAND_MEMBER_CREDIT_ARTIFACT_SET,
         clearing:{bytes:3882472,sha256:'bb8780b55c1f5441b93964e7bea2bd36d5e88a27cc9207ebaae9755fccd1a671'}};
    assert.equal(revision,profile.revision);
    const makers = accountDeployment('direct-closed-credit').artifacts.filter(row => row.name.startsWith('maker-'));
    const artifacts = Object.fromEntries(makers.map(({name,bytes,sha256})=>[name,{bytes,sha256}]));
    artifacts.clearing = profile.clearing;
    verifyTestBuild(directory,revision,artifacts,grouped ? 'grouped-credit' : 'thousand-member-credit');
    return {revision, artifacts, artifactSet:profile.artifactSet};
  }
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
