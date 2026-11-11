/** Candidate-only transport binding for actual worker acceptance. The selected
 * runtime allowlist stays unchanged until P56B; no financial method is replaced. */
import assert from 'node:assert/strict';
import {address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {hash} from '../../packages/indexer/src/events.js';
import {BACKING_ARTIFACT_SET,BACKING_ARTIFACTS} from './backing-artifacts.js';

export class BackingWorkerRuntime extends AccountRuntime {
  private readonly candidate=new sdk.ArtifactVerifier(this.rpc,sdk.LIQUIDITY_ARTIFACTS.map(artifact=>
    ({...artifact,...BACKING_ARTIFACTS[artifact.name]})));
  override async environment() {
    const {binding,state}=await this.store.snapshot();
    assert.equal(binding.program,sdk.CLEARING_PROGRAM_ADDRESS);
    assert.equal(binding.schema,10);assert.equal(binding.profile,'liquidity-execution-qualification');
    assert.equal(binding.artifactSet,BACKING_ARTIFACT_SET);assert.equal(state.venue?.profileVersion,6);
    assert.equal(await this.rpc.call('getGenesisHash'),binding.genesis);
    const anchor=await this.rpc.call('getTransaction',[binding.anchor,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(anchor?.meta?.err,null);assert.equal(anchor.transaction.signatures[0],binding.anchor);
    assert.equal(hash(anchor.transaction),binding.anchorHash);
    await this.candidate.verify(address(state.venue!.authority));return binding;
  }
}
