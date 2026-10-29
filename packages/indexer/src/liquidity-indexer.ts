import {address} from '@solana/kit';
import {LiquidityArtifactVerifier,LIQUIDITY_ARTIFACT_SET} from '@rivalt/sdk';
import {FinalizedIndexer,type TransportConfig} from './finalized-indexer.js';
import {LiquidityStore,type LiquidityBinding} from './liquidity-store.js';
import {decodeAccounts,type AccountEvent} from './account-events.js';
import type {AccountState} from './account-projection.js';
import {hash} from './events.js';
import {reconcileAccountSnapshot} from './account-reconcile.js';

export type LiquidityConfig=Omit<TransportConfig,'chain'|'maxTransactionVersion'>&{venue:string;profile:'liquidity-execution-qualification'};
export class LiquidityIndexer extends FinalizedIndexer<AccountState,LiquidityBinding,AccountEvent> {
  private readonly artifacts=new LiquidityArtifactVerifier(this.rpc);
  declare readonly config:LiquidityConfig;
  constructor(config:LiquidityConfig) {
    if(config.profile!=='liquidity-execution-qualification')throw new Error('Explicit qualified local liquidity profile required');
    address(config.venue);
    super({...config,chain:'solana:localnet',maxTransactionVersion:1},new LiquidityStore(config.databaseUrl,config.runId));
  }
  protected get historyAddress(){return this.config.venue;}
  protected decodeTransaction(signature:string,transaction:any) {
    return decodeAccounts(signature,transaction,this.eventAuthority,this.config.venue,this.deployment.clearing,4);
  }
  protected async initializeBinding(anchor:any,genesis:string):Promise<LiquidityBinding> {
    const init=this.decodeTransaction(this.config.anchor,anchor).find(event=>event.type==='AccountCustodyChangedV3'&&event.data.kind===0&&event.data.sequence==='1');
    if(!init)throw new Error('Invalid liquidity initialization anchor');
    await this.artifacts.verify(address(init.data.authority));
    return {schema:4,venue:this.config.venue,profile:this.config.profile,artifactSet:LIQUIDITY_ARTIFACT_SET,genesis,domain:init.data.domain,
      anchor:this.config.anchor,anchorHash:hash(anchor.transaction),program:this.deployment.clearing};
  }
  async reconcile(snapshot?:{state:AccountState;binding:LiquidityBinding}) {
    const row=snapshot??await this.store.snapshot();
    if(row.binding.artifactSet!==LIQUIDITY_ARTIFACT_SET||row.state.venue?.profileVersion!==4||!row.state.liquidity)
      throw new Error('Unqualified liquidity journal deployment');
    await this.artifacts.verify(address(row.state.venue.authority));
    return reconcileAccountSnapshot(row.state,row.binding,keys=>this.rpc.call('getMultipleAccounts',[keys,{encoding:'base64',commitment:'finalized'}]));
  }
}
