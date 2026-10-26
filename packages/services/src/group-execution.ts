import {readFileSync} from 'node:fs';
import {address,type Instruction} from '@solana/kit';
import {Connection, type Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {GroupStore} from '../../indexer/src/group-store.js';
import {Rpc} from '../../indexer/src/rpc.js';
import {hash} from '../../indexer/src/events.js';
import {Queue} from './queue.js';
import {groupUserAuthority} from './group-ingress.js';
import type {GroupAuthority} from './group-authority.js';
import {enqueueOperator} from './operator-enqueue.js';
import {publicRequestId} from './quote-window.js';

type OperatorRole='maker'|'funding'|'orders'|'settlement'|'risk';
/** Local test lamport budgets; each maker/funding worker is market-specific.
 * They are distinct from test collateral, venue fees and maker equity. */
export function groupBudget(role: OperatorRole, marketIndex?:number, makerId?:number) {
  if (role === 'maker' || role === 'funding') {
    if (marketIndex !== 0 && marketIndex !== 1) throw new Error('Market-specific worker budget required');
    if (role === 'maker') {
      if (makerId !== 0 && makerId !== 1) throw new Error('Maker-specific worker budget required');
      return {name:`group-maker-${marketIndex}-${makerId}`,cap:1_000_000n};
    }
    if (makerId !== undefined) throw new Error('Funding budget is market-wide');
    return {name:`group-funding-${marketIndex}`,cap:5_000_000n};
  }
  if (!['orders','settlement','risk'].includes(role) || marketIndex !== undefined || makerId !== undefined) throw new Error('Invalid group operator budget');
  return {name:`group-${role}`,cap:5_000_000n};
}

/** Durable execution infrastructure only. Market discovery/financial decisions
 * live in the group workers; no worker bypass or successful stub is provided. */
export class GroupExecution {
  readonly store:GroupStore;
  readonly rpc:Rpc;
  readonly connection:Connection;
  readonly queue:Queue;
  private readonly artifacts:sdk.GroupArtifactVerifier;
  constructor(database:string, readonly runId:string, url:string) {
    sdk.testRpcUrl(url,'solana:localnet');
    this.store=new GroupStore(database,runId); this.rpc=new Rpc(url);
    this.connection=new Connection(url,'confirmed');this.queue=new Queue(this.store,this.rpc);this.artifacts=new sdk.GroupArtifactVerifier(this.rpc);
  }
  async open() {
    await this.store.migrate();
    await this.store.pool.query(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
    await this.store.pool.query(readFileSync(new URL('./group-schema.sql',import.meta.url),'utf8'));
    await this.environment();
  }
  async environment() {
    const {binding,state}=await this.store.snapshot();
    if (binding.program !== sdk.CLEARING_PROGRAM_ADDRESS || binding.profile !== 'cross-safety-qualification' || binding.artifactSet !== sdk.GROUP_ARTIFACT_SET || !state.group) throw new Error('Group service deployment mismatch');
    if (await this.rpc.call('getGenesisHash') !== binding.genesis) throw new Error('Group service genesis mismatch');
    const anchor=await this.rpc.call('getTransaction',[binding.anchor,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    if (anchor?.meta?.err !== null || anchor.transaction?.signatures?.[0] !== binding.anchor || hash(anchor.transaction) !== binding.anchorHash) throw new Error('Group service initialization mismatch');
    await this.artifacts.verify(address(state.group.authority));
    return binding;
  }
  async submit(requestId:string,wire:string) {
    const binding=await this.environment(), id=publicRequestId(requestId);
    const authority=groupUserAuthority(wire,binding.group);
    return this.queue.put(id,wire,authority);
  }
  async budget(role:OperatorRole,payer:Keypair,marketIndex?:number,makerId?:number) {
    const budget=groupBudget(role,marketIndex,makerId);
    await this.queue.budget(budget.name,payer.address,budget.cap);
    return budget.name;
  }
  async enqueue(id:string,instructions:Instruction[],payer:Keypair,budget:string,authority:GroupAuthority|null,preflight=false) {
    if (!/^(funding|keeper|maker|maker-sync|order|risk):/.test(id)) throw new Error('Reserved operator request namespace required');
    const binding=await this.environment();
    if (authority && authority.group !== binding.group) throw new Error('Foreign group execution authority');
    return enqueueOperator(this,id,instructions,payer,budget,authority,preflight);
  }
  async execute() {
    await this.environment();
    for (const id of await this.queue.pending()) await this.queue.step(id);
  }
  async close() {await this.store.close();}
}
