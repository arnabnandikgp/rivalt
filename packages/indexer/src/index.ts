import assert from 'node:assert/strict';
import { address } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { Rpc, integer } from './rpc.js';
import { decode, hash, json, type Event } from './events.js';
import { Store, type Binding } from './store.js';
import { type State } from './projection.js';
import { FinalizedIndexer, type TransportConfig } from './finalized-indexer.js';

export { Store, Rpc };
export { GroupIndexer, type GroupConfig } from './group-indexer.js';
export type Config = TransportConfig & {market:string};
export class Indexer extends FinalizedIndexer<State, Binding, Event> {
  constructor(readonly config: Config) { super(config, new Store(config.databaseUrl, config.runId)); }
  protected decodeTransaction(signature: string, transaction: any) {
    return decode(signature, transaction, this.eventAuthority, this.deployment.clearing);
  }
  protected async initializeBinding(anchor: any, genesis: string): Promise<Binding> {
    const init = this.decodeTransaction(this.config.anchor, anchor).find(event => event.type === 'custody' && event.data.kind === 0 && event.data.sequence === '1');
    if (!init || init.data.market !== this.config.market) throw new Error('Invalid initialization anchor');
    return {genesis, market:this.config.market, domain:init.data.domain, anchor:this.config.anchor,
      anchorHash:hash(anchor.transaction), program:this.deployment.clearing, schema:1};
  }
  async reconcile(snapshot?: {state:State;binding:Binding}) {
    const {state,binding} = snapshot ?? await this.store.snapshot();
    const market = address(binding.market);
    const [registry] = await sdk.findRegistryPda({market}, this.options);
    const [route] = await sdk.findRouteStatePda({market}, this.options);
    const [vault] = await sdk.findVaultPda({market}, this.options);
    const [resolution] = await sdk.findResolutionPda({market}, this.options);
    const participants = Object.keys(state.participants), makers = Object.keys(state.makers);
    const keys = [market,registry,vault,...participants,...makers,...(state.risk ? [route] : []),...(state.resolution ? [resolution] : [])];
    const response = await this.rpc.call('getMultipleAccounts',[keys,{encoding:'base64',commitment:'finalized'}]);
    integer(response.context.slot);
    const data = (i:number, owner:string = this.deployment.clearing) => {
      const a = response.value[i]; if (!a || a.owner !== owner) throw new Error('Reconciliation account missing/wrong owner');
      return Buffer.from(a.data[0],'base64');
    };
    const chain = sdk.getMarketStateDecoder().decode(data(0));
    if (chain.sequence !== BigInt(state.sequence)) throw new Error('Reconciliation sequence differs; backfill required');
    const m = state.market;
    assert.equal(Buffer.from(chain.domain).toString('hex'),binding.domain);
    for (const key of ['termsEpoch','configEpoch','totalCash','settlement','insurance','fees','allocatedVault','paused','mode','fundingIndexScaled','fundingTime'] as const)
      assert.equal(String(chain[key]),String(m[key]),`Market ${key}`);
    const reg = sdk.getParticipantRegistryDecoder().decode(data(1));
    assert.equal(reg.count,participants.length);
    assert.deepEqual(reg.members,[...participants].sort((a,b)=>state.participants[a].id-state.participants[b].id));
    participants.forEach((key,i) => {
      const p = sdk.getParticipantDecoder().decode(data(3+i));
      assert.equal(p.market,market); assert.equal(p.schemaVersion,1);
      for (const [field,value] of Object.entries(state.participants[key])) assert.deepEqual(JSON.parse(json((p as any)[field])),JSON.parse(json(value)),`Participant ${field}`);
    });
    const token = data(2,'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    assert.equal(token.length,165); const actualVault=token.readBigUInt64LE(64);
    assert(actualVault >= chain.allocatedVault,'Vault deficit');
    makers.forEach((key,i) => {
      const maker = sdk.getMakerRegistrationDecoder().decode(data(3+participants.length+i));
      for (const [field,value] of Object.entries(state.makers[key])) assert.equal(json((maker as any)[field]),json(value),`Maker ${field}`);
    });
    if (state.risk) {
      const risk = sdk.getTestRouteStateDecoder().decode(data(keys.indexOf(route)));
      for (const key of ['observationSequence','referencePrice','lower','upper','validFrom','validUntil'] as const) assert.equal(String(risk[key]),state.risk[key],`Risk ${key}`);
      assert.equal(String(risk.grossLots),m.grossLots);
      if(m.mode>=2) assert.deepEqual(JSON.parse(json(risk.oracle)),state.risk.oracle,'Oracle/funding state');
    }
    if(state.resolution){
      const value=sdk.getResolutionStateDecoder().decode(data(keys.indexOf(resolution)));
      assert.equal(value.version,1);assert.equal(value.market,market);
      assert.deepEqual(JSON.parse(json({header:value.header,rows:value.rows})),state.resolution,'Resolution ledger');
    }
    return {slot:response.context.slot.toString(),sequence:state.sequence,actualVault:actualVault.toString(),allocatedVault:chain.allocatedVault.toString(),unallocatedSurplus:(actualVault-chain.allocatedVault).toString(),participants:participants.length};
  }
}
