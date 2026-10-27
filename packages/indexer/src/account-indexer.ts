import {address} from '@solana/kit';
import {AccountArtifactVerifier,ACCOUNT_ARTIFACT_SET} from '@rivalt/sdk';
import {FinalizedIndexer,type TransportConfig} from './finalized-indexer.js';
import {AccountStore,type AccountBinding} from './account-store.js';
import {decodeAccounts,type AccountEvent} from './account-events.js';
import type {AccountState} from './account-projection.js';
import {hash} from './events.js';
import {reconcileAccountSnapshot} from './account-reconcile.js';

export type AccountConfig=Omit<TransportConfig,'chain'>&{venue:string;profile:'account-safety-qualification'};
export class AccountIndexer extends FinalizedIndexer<AccountState,AccountBinding,AccountEvent> {
  private readonly artifacts=new AccountArtifactVerifier(this.rpc);
  constructor(readonly config:AccountConfig) {
    if(config.profile!=='account-safety-qualification')throw new Error('Explicit qualified local account profile required');
    address(config.venue);
    super({...config,chain:'solana:localnet'},new AccountStore(config.databaseUrl,config.runId));
  }
  protected get historyAddress(){return this.config.venue;}
  protected decodeTransaction(signature:string,transaction:any) {
    return decodeAccounts(signature,transaction,this.eventAuthority,this.config.venue,this.deployment.clearing);
  }
  protected async initializeBinding(anchor:any,genesis:string):Promise<AccountBinding> {
    const init=this.decodeTransaction(this.config.anchor,anchor).find(event=>event.type==='AccountCustodyChangedV3'&&event.data.kind===0&&event.data.sequence==='1');
    if(!init)throw new Error('Invalid account initialization anchor');
    await this.artifacts.verify(address(init.data.authority));
    return {schema:3,venue:this.config.venue,profile:this.config.profile,artifactSet:ACCOUNT_ARTIFACT_SET,genesis,domain:init.data.domain,
      anchor:this.config.anchor,anchorHash:hash(anchor.transaction),program:this.deployment.clearing};
  }
  async reconcile(snapshot?:{state:AccountState;binding:AccountBinding}) {
    const row=snapshot??await this.store.snapshot();
    if(row.binding.artifactSet!==ACCOUNT_ARTIFACT_SET||!row.state.venue)throw new Error('Unqualified account journal deployment');
    await this.artifacts.verify(address(row.state.venue.authority));
    return reconcileAccountSnapshot(row.state,row.binding,keys=>this.rpc.call('getMultipleAccounts',[keys,{encoding:'base64',commitment:'finalized'}]));
  }
}
