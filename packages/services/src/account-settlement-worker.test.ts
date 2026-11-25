import {backingCheckpoint} from '../../sdk/src/backing-test-fixture.js';
import {expect,it} from 'vitest';
import {settlementInstructions} from './settlement-checkpoints.js';
import {createNoopSigner,type Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {accountTradeFixture} from '../../sdk/src/account-test-fixture.js';
import {settleAccounts,type SettlementSchedule} from './account-settlement-worker.js';
import {accountWorkerKeys} from './account-worker-state.js';
import type {AccountRuntime} from './account-runtime.js';
import type {AccountAuthority} from './account-authority.js';

async function finalPageFixture(bad: bigint) {
  const test=await accountTradeFixture(),margin=test.margins[0],venue=test.config.venue;
  const root=sdk.getMarginAccountDecoder().decode(Buffer.from(test.accounts.get(margin).data[0],'base64'));
  root.positions[0].virtualScaled=3_000_000_001n;
  test.put(margin,sdk.getMarginAccountEncoder().encode(root));
  const [ledger]=await sdk.deriveMarketLedger(test.marketPdas[0][0]);
  const ledgerState=sdk.getMarketLedgerDecoder().decode(Buffer.from(test.accounts.get(ledger).data[0],'base64'));
  // The consumer fixture must still have allocated backing for the funded pool.
  ledgerState.insurance-=3n;ledgerState.settlement=3n;
  ledgerState.backing={epoch:7n,safetyEpoch:2n,membershipEpoch:4n,termsEpoch:1n,configEpochs:[1n,1n],
    region:{prices:[[1n,1_000_000n],[1n,1_000_000n]],funding:[[0n,0n],[0n,0n]]},summary:backingCheckpoint(2n,3n,0,bad)};
  test.put(ledger,sdk.getMarketLedgerEncoder().encode(ledgerState));
  const keys=await accountWorkerKeys(venue),[,registryBump]=await sdk.deriveVenueComponent(venue,'registry');
  test.put(keys.registry,sdk.getVenueRegistryEncoder().encode({schemaVersion:10,revision:1n,venue,
    membershipEpoch:4n,nextId:2n,registeredCount:2n,financialCount:2n,liveIndex:(await sdk.deriveMemberIndex(venue,14,0n))[0],bump:registryBump}));
  const [certificate,bump]=await sdk.deriveSettlementCertificate(venue,0);
  // Literal serialized final root-frame visit after two Financial roots. This
  // continuation closes traversal; member ordinal 2 is not an account ID.
  const checkpoint=Buffer.alloc(544);checkpoint[0]=1;
  checkpoint.writeBigUInt64LE(2n,8);checkpoint.writeBigUInt64LE(2n,16);
  checkpoint.writeBigUInt64LE(2n,72);checkpoint.writeBigUInt64LE(2n,80);checkpoint[88]=1;

  test.put(certificate,sdk.getSettlementCertificateEncoder().encode({...test.empty(sdk.getSettlementCertificateDecoder()),
    schemaVersion:10,revision:1n,venue,marketIndex:0,backingEpoch:7n,count:2n,next:2n,membership:{checkpoint},bump}));
  return {test,margin,venue,root,keys,certificate};
}

// Encoded consumer input only; actual atomic completion/rollback is an RPC gate.
it.each([0n,1n])('persists final coverage with payment only for a payable cohort (bad=%s)',async(bad)=>{
  const {test,margin,venue,root,keys,certificate}=await finalPageFixture(bad);
  const submissions:{instructions:Instruction[];authority:AccountAuthority|null}[]=[];
  const runtime={rpc:test.rpc,budget:async()=> 'settlement-budget',pendingBudget:async()=>false,
    discovery:async()=>({state:{members:[margin]}}),
    snapshot:async()=>({...await sdk.readAccountSnapshot(test.rpc,test.config,[margin],'confirmed'),...keys}),
    enqueue:async(_id:string,instructions:Instruction[],_key:Keypair,_budget:string,authority:AccountAuthority|null)=>{submissions.push({instructions,authority});}};
  // Spacing pure background scans must still admit the payable final page.
  const worker=runtime as unknown as AccountRuntime,signer=createNoopSigner(test.owner) as Keypair;
  if(bad){
    expect(await settleAccounts(worker,signer,false)).toEqual({status:'idle',reason:'background-page-interval'});
    expect(submissions).toHaveLength(0);
  }
  expect(await settleAccounts(worker,signer,Boolean(bad)))
    .toEqual({status:'queued',reason:bad?'complete-market-backing-page':'atomic-backing-page-and-gain'});
  expect(submissions).toHaveLength(1);
  const {instructions,authority}=submissions[0];expect(instructions).toHaveLength(bad?2:3);
  expect(sdk.hex(instructions[1].data!.slice(0,8))).toBe(sdk.hex(sdk.CHECK_MARKET_BACKING_DISCRIMINATOR));
  if(bad) {expect(authority).toEqual({kind:'backingRevision',venue,account:certificate,value:'1'});return;}
  expect(sdk.hex(instructions[2].data!.slice(0,8))).toBe(sdk.hex(sdk.PAY_ACCOUNT_GAIN_DISCRIMINATOR));
  expect(sdk.getPayAccountGainInstructionDataDecoder().decode(instructions[2].data!).amount).toBe(3n);
  expect(authority).toEqual({kind:'accountStateVersion',venue,account:margin,value:root.stateVersion.toString()});
  for(const key of [test.custody,(await sdk.deriveVenueComponent(venue,'vault'))[0]])
    expect(instructions.slice(1).some(instruction=>instruction.accounts!.some(meta=>meta.address===key))).toBe(false);
});

it('gives a backed payout a turn between collections and rotates the collecting market', async () => {
  const { test, margin, root, keys, certificate } = await finalPageFixture(0n);
  const debtor = test.margins[1];
  const account = sdk.getMarginAccountDecoder().decode(Buffer.from(test.accounts.get(debtor).data[0], 'base64'));
  account.isolatedMarketIndex = 0;
  account.positions[0].virtualScaled = -2_000_000_000n;
  root.positions[1].virtualScaled = -1_000_000_000n;
  test.put(margin, sdk.getMarginAccountEncoder().encode(root));
  test.put(debtor, sdk.getMarginAccountEncoder().encode(account));
  const proof = sdk.getSettlementCertificateDecoder().decode(Buffer.from(test.accounts.get(certificate).data[0], 'base64'));
  test.put(certificate, sdk.getSettlementCertificateEncoder().encode({ ...proof, complete: true }));
  const ids: string[] = [];
  let pending = false;
  const runtime = {
    rpc: test.rpc, budget: async () => 'settlement', pendingBudget: async () => pending,
    discovery: async () => ({ state: { members: [debtor, margin] } }),
    snapshot: async (members: typeof test.margins) => ({ ...await sdk.readAccountSnapshot(test.rpc, test.config, members, 'confirmed'), ...keys }),
    enqueue: async (id: string) => { ids.push(id); },
  } as unknown as AccountRuntime;
  const signer = createNoopSigner(test.owner) as Keypair;
  const schedule: SettlementSchedule = { next: 'collection', collectionMarket: 0 };
  const poll = () => settleAccounts(runtime, signer, false, schedule);
  expect((await poll()).reason).toBe('funded-account-loss');
  pending = true;
  expect((await poll()).reason).toBe('original-settlement-intent-pending');
  expect(schedule).toEqual({ next: 'payment', collectionMarket: 1 });
  pending = false;
  expect((await poll()).reason).toBe('certified-market-gain');
  expect((await poll()).reason).toBe('funded-account-loss');
  expect(ids).toEqual(['keeper:loss:1:0:9', 'keeper:gain:0:0:9', 'keeper:loss:0:1:9']);

  // With a missing certificate and background work throttled, skip straight to collection.
  test.accounts.delete(certificate);
  expect((await poll()).reason).toBe('funded-account-loss');
  expect(ids.at(-1)).toBe('keeper:loss:1:0:9');
});

// The on-chain guard consumes contiguous sibling instructions for each serial operation.
it('refreshes every supplied market and ledger again for the payment after a backing scan',async()=>{
  const fixture=await accountTradeFixture();
  const venue=fixture.config.venue,markets=fixture.marketPdas.map(([key])=>key);
  const ledgers=await Promise.all(markets.map(async market=>(await sdk.deriveMarketLedger(market))[0]));
  const [safety]=await sdk.deriveVenueComponent(venue,'safety');
  const {eventAuthority,registry}=await accountWorkerKeys(venue);
  const snapshot={venue,safety,eventAuthority,markets,ledgers,marginLayout:'ledger-lanes' as const};
  const [certificate]=await sdk.deriveSettlementCertificate(venue,0);
  const common={...snapshot,registry,program:sdk.CLEARING_PROGRAM_ADDRESS,btc:markets[0],eth:markets[1],btcLedger:ledgers[0],ethLedger:ledgers[1]};
  const scan=sdk.getCheckMarketBackingInstruction({...common,ledger:ledgers[0],certificate,restart:false,revision:1n});
  const payment=sdk.getPayAccountGainInstruction({...common,actor:createNoopSigner(fixture.owner),margin:fixture.margins[0],certificate,marketIndex:0,amount:3n});
  const limit=sdk.resolutionComputeBudget();
  const prior=await settlementInstructions({...snapshot,marginLayout:undefined},limit,scan,payment);
  expect(prior).toEqual([limit,scan,payment]);
  const result=await settlementInstructions(snapshot,limit,scan,payment);
  const fundingTag=sdk.hex(sdk.CHECKPOINT_MARKET_DISCRIMINATOR),feeTag=sdk.hex(sdk.CLASSIFY_MARKET_FEES_DISCRIMINATOR);
  for(const instruction of result.slice(1).filter(instruction=>instruction!==scan&&instruction!==payment)) {
    expect(instruction.accounts!.filter(meta=>meta.role!==0).map(meta=>meta.address)).toEqual([instruction.accounts![2].address]);
  }
  const observed=result.slice(1).map(ix=>ix===scan?'scan':ix===payment?'pay':[sdk.hex(ix.data!),ix.accounts![2].address]);
  expect(observed).toEqual([[fundingTag,markets[0]],[feeTag,ledgers[0]],[fundingTag,markets[1]],'scan',
    [fundingTag,markets[0]],[feeTag,ledgers[0]],[fundingTag,markets[1]],[feeTag,ledgers[1]],'pay']);
});
