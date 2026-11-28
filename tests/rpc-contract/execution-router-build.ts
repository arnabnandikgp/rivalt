import assert from 'node:assert/strict';
import {verifyTestBuild} from './backing-artifacts.js';
import {LISTED_DEFAULT_ARTIFACT_SET,LISTED_CASH_ARTIFACT_SET,LISTED_EXECUTION_ARTIFACT_SET,LISTED_MARGIN_ARTIFACT_SET,LISTED_FUNDING_ARTIFACT_SET,LISTED_DIRECTORY_ARTIFACT_SET,INDEXED_DEFAULT_ARTIFACT_SET,LISTED_MAKER_ARTIFACT_SET,LISTING_INDEX_ARTIFACT_SET,INACTIVE_LISTING_ARTIFACT_SET,INDEXED_WITHDRAWAL_ARTIFACT_SET,GROUPED_CREDIT_ARTIFACT_SET,STREAMED_CREDIT_ARTIFACT_SET,THOUSAND_MEMBER_CREDIT_ARTIFACT_SET,accountDeployment,FUNDED_MULTI_ARTIFACT_SET,PRICE_LIMITED_MULTI_ARTIFACT_SET,MULTI_ROUTING_ARTIFACT_SET,WIDE_DIRECTORY_ARTIFACT_SET,WIDE_ROUTING_ARTIFACT_SET} from '@rivalt/sdk';

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
  const listedBuilds = {
    'execution-router-listed-directory': {
      artifactSet: LISTED_DIRECTORY_ARTIFACT_SET, revision: 'a3a2c3cb6864a21a3225c82a788b0a00db3e467d',
      clearing: {bytes:4275120,sha256:'d144f260856f843b8c7a6a6f660701cbaf733c38789fbd2e3919ee8c338745b7'},
    },
    'execution-router-listed-funding': {
      artifactSet: LISTED_FUNDING_ARTIFACT_SET, revision: 'b609e3e860ed80f733ce862b33059bba9156102e',
      clearing: {bytes:4344424,sha256:'df0290217b04dc5b944f5bacdbf2d82188a085eabf3e2af561ddde709f904809'},
    },
    'execution-router-funded-listed-default': {
      artifactSet: LISTED_DEFAULT_ARTIFACT_SET, revision: '8b5a08080663ef19610b9276bd3d599aa5cc37cf',
      clearing: {bytes:4666760,sha256:'14f99317762e477122a873d7ee6bcd0e6e54c041d4b34675c369ff2554b85928'},
    },
    'execution-router-listed-cash': {
      artifactSet: LISTED_CASH_ARTIFACT_SET, revision: 'b79ea8db6a53b7e404308148ef3f6e397b5941b7',
      clearing: {bytes:4576816,sha256:'40b6b165f7ec1cf27983c02a64235300fd1cb83f5c99ea0027480c993e5c000e'},
    },
    'execution-router-listed-execution': {
      artifactSet: LISTED_EXECUTION_ARTIFACT_SET, revision: '48f78deccb83995950a83c640b8206fd21758477',
      clearing: {bytes:4505216,sha256:'24ebbe95af57ee1fe908c4ddf7b62346ef654ffc392c2094cc51756c0c7b12a1'},
    },
    'execution-router-listed-margin': {
      artifactSet: LISTED_MARGIN_ARTIFACT_SET, revision: '0d8b70e0e45acf00f88509c08c74ff7c0252b4bd',
      clearing: {bytes:4348408,sha256:'368d940e74ff4cc9936e5f1d3cc495e03df17651acbe0daccdf2c5462f4fb323'},
    },
  };
  if(probe && Object.hasOwn(listedBuilds,probe)) {
    const build=listedBuilds[probe as keyof typeof listedBuilds];
    assert.equal(revision,build.revision);
    const artifacts={
      clearing:build.clearing,
      'maker-a':{bytes:187208,sha256:'1c8d021a8dc0947606f96ac18d1a2a61b0c2185ec9f862c097d52a3bce302e62'},
      'maker-b':{bytes:187208,sha256:'65412a25adb9e98bd793878ba016648026529169c36c028a51bab592c1e824e8'}
    };
    verifyTestBuild(directory,revision,artifacts,build.artifactSet);
    return {revision,artifacts,artifactSet:build.artifactSet};
  }
  if(probe==='execution-router-venue-application') {
    const deployment=accountDeployment('venue-default-application');
    assert.equal(revision,deployment.programRevision);
    const artifacts=Object.fromEntries(deployment.artifacts.filter(artifact=>['clearing','maker-a','maker-b'].includes(artifact.name))
      .map(({name,bytes,sha256})=>[name,{bytes,sha256}])) as Record<'clearing'|'maker-a'|'maker-b',{bytes:number;sha256:string}>;
    verifyTestBuild(directory,revision,artifacts,deployment.artifactSet);
    return {revision,artifacts,artifactSet:deployment.artifactSet};
  }
  if (probe === 'execution-router-listed-maker' || probe === 'execution-router-venue-book' || probe === 'execution-router-venue-default') {
    const verifier=probe==='execution-router-venue-default';
    assert.equal(revision,verifier?'a094f62cd4192b2b00f845660b281c613698986d':'5929eb48f2963499bc0a5316a9a22c2b99dcdd3d');
    const artifacts={
      'clearing':verifier?{bytes:4186984,sha256:'0e0cfd094ebd757cffaa3e4e75c461c5c28bf9c34390c4b3308640d8f750ebd9'}:{bytes:3988696,sha256:'6093180c296f800f4b1f88d75db79c73bc85dbd27ff0fd4996789dc983db0a85'},
      'maker-a':{bytes:187208,sha256:'1c8d021a8dc0947606f96ac18d1a2a61b0c2185ec9f862c097d52a3bce302e62'},
      'maker-b':{bytes:187208,sha256:'65412a25adb9e98bd793878ba016648026529169c36c028a51bab592c1e824e8'}
    };
    const artifactSet=verifier?INDEXED_DEFAULT_ARTIFACT_SET:LISTED_MAKER_ARTIFACT_SET;
    verifyTestBuild(directory,revision,artifacts,artifactSet);
    return {revision,artifacts,artifactSet};
  }
  if (probe === 'execution-router-indexed-withdrawal' || probe === 'execution-router-inactive-listing' || probe === 'execution-router-listing-index') {
    const listing = probe === 'execution-router-inactive-listing';
    const profile = probe === 'execution-router-listing-index' ? {
      name:'inactive-market-listing',revision:'aa205484afa247360a60d6a01767be23d9ce6a98',artifactSet:LISTING_INDEX_ARTIFACT_SET,
      clearing:{bytes:3965952,sha256:'85ba9d753966c338a241379245c255c07ee2c6fdbeeef3d3620ab6285643e36d'},
    } : listing ? {
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
