import {address} from '@solana/kit';
import {GroupArtifactVerifier,GROUP_ARTIFACT_SET} from '@rivalt/sdk';
import {FinalizedIndexer, type TransportConfig} from './finalized-indexer.js';
import {GroupStore, type GroupBinding} from './group-store.js';
import {decodeGroup, type GroupEvent} from './group-events.js';
import type {GroupState} from './group-projection.js';
import {hash} from './events.js';
import {reconcileGroupSnapshot} from './group-reconcile.js';

export type GroupConfig = Omit<TransportConfig, 'chain'> & {group:string; profile:'cross-safety-qualification'};
export class GroupIndexer extends FinalizedIndexer<GroupState, GroupBinding, GroupEvent> {
  private readonly artifacts=new GroupArtifactVerifier(this.rpc);
  constructor(readonly config: GroupConfig) {
    if (config.profile !== 'cross-safety-qualification') throw new Error('Explicit qualified local group profile required');
    address(config.group);
    super({...config, chain:'solana:localnet'}, new GroupStore(config.databaseUrl, config.runId));
  }
  protected get historyAddress() { return this.config.group; }
  protected decodeTransaction(signature: string, transaction: any) {
    return decodeGroup(signature, transaction, this.eventAuthority, this.config.group, this.deployment.clearing);
  }
  protected async initializeBinding(anchor: any, genesis: string): Promise<GroupBinding> {
    const init = this.decodeTransaction(this.config.anchor, anchor).find(event => event.type === 'group-custody' && event.data.kind === 0 && event.data.sequence === '1');
    if (!init) throw new Error('Invalid group initialization anchor');
    await this.artifacts.verify(address(init.data.authority));
    return {schema:2, group:this.config.group, profile:this.config.profile, artifactSet:GROUP_ARTIFACT_SET, genesis, domain:init.data.domain,
      anchor:this.config.anchor, anchorHash:hash(anchor.transaction), program:this.deployment.clearing};
  }
  async reconcile(snapshot?: {state:GroupState; binding:GroupBinding}) {
    const row = snapshot ?? await this.store.snapshot();
    if(row.binding.artifactSet!==GROUP_ARTIFACT_SET||!row.state.group)throw new Error('Unqualified group journal deployment');
    await this.artifacts.verify(address(row.state.group.authority));
    return reconcileGroupSnapshot(row.state, row.binding, keys => this.rpc.call('getMultipleAccounts', [keys,{encoding:'base64',commitment:'finalized'}]));
  }
}
