import {readFileSync} from 'node:fs';
import {address,type Instruction} from '@solana/kit';
import {Connection,type Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {LiquidityStore} from '../../indexer/src/liquidity-store.js';
import {Rpc} from '../../indexer/src/rpc.js';
import {hash} from '../../indexer/src/events.js';
import {Queue} from './queue.js';
import {accountUserAuthority} from './account-ingress.js';
import type {AccountAuthority} from './account-authority.js';
import type {LiquidityPriceAuthority} from './liquidity-authority.js';
import {enqueueOperator} from './operator-enqueue.js';
import {publicRequestId} from './quote-window.js';
import type {LiquidityInputs} from './liquidity-inputs.js';
import {boundedDispatch} from './dispatch.js';

type OperatorRole='maker'|'funding'|'orders'|'settlement'|'risk';
/** Local operator lamports only; never collateral, fees or market insurance. */
export function accountBudget(role:OperatorRole,marketIndex?:number,makerId?:number,profile:4=4) {
  if(profile!==4)throw new Error('Unsupported account service profile');
  const prefix='liquidity';
  if(role==='maker'||role==='funding') {
    if(marketIndex!==0&&marketIndex!==1)throw new Error('Market-specific account worker budget required');
    if(role==='maker') {
      if(makerId!==0&&makerId!==1&&makerId!==2)throw new Error('Maker-specific account worker budget required');
      return {name:`${prefix}-maker-${marketIndex}-${makerId}`,cap:1_000_000n};
    }
    if(makerId!==undefined)throw new Error('Account funding budget is market-wide');
    return {name:`${prefix}-funding-${marketIndex}`,cap:5_000_000n};
  }
  if(!['orders','settlement','risk'].includes(role)||marketIndex!==undefined||makerId!==undefined)throw new Error('Invalid account operator budget');
  return {name:`${prefix}-${role}`,cap:5_000_000n};
}

/** Durable transport; all financial decisions belong to workers and ultimately
 * the current on-chain checks. No pending original may be replaced on timeout. */
export class AccountExecution {
  readonly store:LiquidityStore;
  readonly rpc:Rpc;
  readonly connection:Connection;
  readonly queue:Queue;
  private readonly artifacts:sdk.LiquidityArtifactVerifier;
  constructor(database:string,readonly runId:string,url:string,readonly profile:4=4) {
    if(profile!==4)throw new Error('Unsupported account service profile');
    sdk.testRpcUrl(url,'solana:localnet');this.store=new LiquidityStore(database,runId);this.rpc=new Rpc(url);
    this.connection=new Connection(url,'confirmed');this.queue=new Queue(this.store,this.rpc,sdk.CLEARING_PROGRAM_ADDRESS,1);
    this.artifacts=new sdk.LiquidityArtifactVerifier(this.rpc);
  }
  async open() {
    await this.store.migrate();await this.store.pool.query(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
    await this.store.pool.query(readFileSync(new URL('./liquidity-schema.sql',import.meta.url),'utf8'));await this.environment();
    await this.queue.prepare();
  }
  async environment() {
    const {binding,state}=await this.store.snapshot();
    if(binding.program!==sdk.CLEARING_PROGRAM_ADDRESS||binding.profile!=='liquidity-execution-qualification'
      ||binding.artifactSet!==sdk.LIQUIDITY_ARTIFACT_SET||state.venue?.profileVersion!==this.profile)
      throw new Error('Account service deployment mismatch');
    if(await this.rpc.call('getGenesisHash')!==binding.genesis)throw new Error('Account service genesis mismatch');
    const anchor=await this.rpc.call('getTransaction',[binding.anchor,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    if(anchor?.meta?.err!==null||anchor.transaction?.signatures?.[0]!==binding.anchor||hash(anchor.transaction)!==binding.anchorHash)
      throw new Error('Account service initialization mismatch');
    await this.artifacts.verify(address(state.venue.authority));return binding;
  }
  async submit(requestId:string,wire:string) {
    const binding=await this.environment(),id=publicRequestId(requestId);
    return this.queue.put(id,wire,accountUserAuthority(wire,binding.venue,this.profile));
  }
  async budget(role:OperatorRole,payer:Keypair,marketIndex?:number,makerId?:number) {
    const budget=accountBudget(role,marketIndex,makerId,this.profile);await this.queue.budget(budget.name,payer.address,budget.cap);return budget.name;
  }
  async enqueue(id:string,instructions:Instruction[],payer:Keypair,budget:string,authority:AccountAuthority|LiquidityPriceAuthority|null,preflight=false,inputs?:LiquidityInputs) {
    if(!/^(funding|keeper|maker|maker-sync|order|risk):/.test(id))throw new Error('Reserved account operator request namespace required');
    const binding=await this.environment();if(authority&&authority.venue!==binding.venue)throw new Error('Foreign account execution authority');
    const economic=instructions.filter(instruction=>instruction.programAddress!=='ComputeBudget111111111111111111111111111111');
    const route=economic.some(instruction=>[sdk.EXECUTE_LIQUIDITY_ROUTE_DISCRIMINATOR,sdk.EXECUTE_LIQUIDITY_ORDER_DISCRIMINATOR]
      .some(discriminator=>sdk.hex(discriminator)===sdk.hex(instruction.data?.slice(0,8)??[])));
    const explicit=instructions.find(instruction=>instruction.programAddress==='ComputeBudget111111111111111111111111111111'&&instruction.data?.[0]===2);
    const computeUnitLimit=route?800_000:explicit?Buffer.from(explicit.data!).readUInt32LE(1):200_000;
    return enqueueOperator(this,id,economic,payer,budget,authority,preflight,{computeUnitLimit,loadedAccountsDataSizeLimit:8*1024*1024},inputs);
  }
  async execute() {await this.environment();await boundedDispatch(await this.queue.pending(),id=>this.queue.step(id));}
  async close() {await this.store.close();}
}
