import {backingCheckpoint} from '../../sdk/src/backing-test-fixture.js';
import {expect,it} from 'vitest';
import {directCreditLimit} from './operator-enqueue.js';
import {settlementInstructions} from './settlement-checkpoints.js';
import {createNoopSigner,type Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {accountTradeFixture} from '../../sdk/src/account-test-fixture.js';
import {settleAccounts,orderedPayments,type SettlementSchedule} from './account-settlement-worker.js';
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
    discovery:async()=>({binding:{artifactSet:sdk.BOUNDED_ENTRY_ARTIFACT_SET},state:{members:[margin]}}),
    snapshot:async()=>({...await sdk.readAccountSnapshot(test.rpc,test.config,[margin],'confirmed'),...keys}),
    enqueue:async(_id:string,instructions:Instruction[],_key:Keypair,_budget:string,authority:AccountAuthority|null)=>{submissions.push({instructions,authority});return {request_id:_id};}};
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

async function recurringClaimsFixture(artifactSet: string = sdk.BOUNDED_ENTRY_ARTIFACT_SET) {
  const fixture = await finalPageFixture(0n);
  const { test, certificate, keys } = fixture;
  const proof = sdk.getSettlementCertificateDecoder().decode(Buffer.from(test.accounts.get(certificate).data[0], 'base64'));
  test.put(certificate, sdk.getSettlementCertificateEncoder().encode({ ...proof, complete: true }));
  const ids: string[] = [];
  let pending = false, duplicate: string | undefined, refused: string | undefined;
  const submitted: Instruction[][] = [];
  const runtime = {
    rpc: test.rpc, budget: async () => 'settlement', pendingBudget: async () => pending,
    discovery: async () => ({ binding: {artifactSet}, state: { members: test.margins } }),
    snapshot: async (members: typeof test.margins) => ({ ...await sdk.readAccountSnapshot(test.rpc, test.config, members, 'confirmed'), ...keys }),
    enqueue: async (id: string, instructions: Instruction[]) => {
      if (id === refused) throw new Error('Risk action presently unavailable');
      if (id !== duplicate) { ids.push(id); submitted.push(instructions); return {request_id:id}; }
    },
  } as unknown as AccountRuntime;
  const schedule: SettlementSchedule = { next: 'collection', collectionMarket: 0 };
  const signer = createNoopSigner(test.owner) as Keypair;
  return { ...fixture, ids, submitted, schedule, refuse: (id: string) => { refused=id; }, skipOriginal: (id: string) => { duplicate = id; }, setPending: (value: boolean) => { pending = value; },
    poll: () => settleAccounts(runtime, signer, false, schedule) };
}

it('gives a backed payout a turn between collections and rotates the collecting market', async () => {
  const { test, margin, root, certificate, poll, ids, schedule, setPending } = await recurringClaimsFixture();
  const debtor = test.margins[1];
  const account = sdk.getMarginAccountDecoder().decode(Buffer.from(test.accounts.get(debtor).data[0], 'base64'));
  account.isolatedMarketIndex = 0;
  account.positions[0].virtualScaled = -2_000_000_000n;
  root.positions[1].virtualScaled = -1_000_000_000n;
  test.put(margin, sdk.getMarginAccountEncoder().encode(root));
  test.put(debtor, sdk.getMarginAccountEncoder().encode(account));
  expect((await poll()).reason).toBe('funded-account-loss');
  setPending(true);
  expect((await poll()).reason).toBe('original-settlement-intent-pending');
  expect(schedule).toEqual({ next: 'payment', collectionMarket: 1 });
  setPending(false);
  expect((await poll()).reason).toBe('certified-market-gain');
  expect((await poll()).reason).toBe('funded-account-loss');
  expect(ids).toEqual(['keeper:loss:1:0:9', 'keeper:gain:0:0:9', 'keeper:loss:0:1:9']);

  // With a missing certificate and background work throttled, skip straight to collection.
  test.accounts.delete(certificate);
  expect((await poll()).reason).toBe('funded-account-loss');
  expect(ids.at(-1)).toBe('keeper:loss:1:0:9');
});

it('offers the next ready creditor a payment when the first keeps earning', async () => {
  const { test, margin, root, poll, ids, skipOriginal } = await recurringClaimsFixture();
  const second = test.margins[1];
  const account = sdk.getMarginAccountDecoder().decode(Buffer.from(test.accounts.get(second).data[0], 'base64'));
  account.isolatedMarketIndex = 0;
  account.positions[0].virtualScaled = 1_000_000_000n;
  root.positions[0].virtualScaled = 2_000_000_000n;
  test.put(second, sdk.getMarginAccountEncoder().encode(account));
  test.put(margin, sdk.getMarginAccountEncoder().encode(root));
  // Both balances stay eligible on every poll, as if both had earned again.
  for (let turn = 0; turn < 3; turn++) expect((await poll()).reason).toBe('certified-market-gain');
  expect(ids).toEqual(['keeper:gain:0:0:9', 'keeper:gain:1:0:9', 'keeper:gain:0:0:9']);
  // The next candidate already has an original for that account version.
  skipOriginal('keeper:gain:1:0:9');
  expect((await poll()).reason).toBe('certified-market-gain');
  expect(ids.at(-1)).toBe('keeper:gain:0:0:9');
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

it('dispatches a cold direct claim and considers another claimant if preflight refuses the first',async()=>{
  const {test,margin,root,venue,certificate,submitted,refuse,poll}=await recurringClaimsFixture(sdk.DIRECT_CREDIT_ARTIFACT_SET);
  test.accounts.delete(certificate);
  const other=test.margins[1];
  const account=sdk.getMarginAccountDecoder().decode(Buffer.from(test.accounts.get(other).data[0],'base64'));
  account.isolatedMarketIndex=0;
  account.positions[0].virtualScaled=2_000_000_000n;
  test.put(other,sdk.getMarginAccountEncoder().encode(account));
  root.positions[0].virtualScaled=1_000_000_000n;
  test.put(margin,sdk.getMarginAccountEncoder().encode(root));
  refuse('keeper:gain:0:0:9');
  expect(await poll()).toEqual({status:'queued',reason:'direct-market-gain'});
  expect(submitted).toHaveLength(1);
  const payment=submitted[0].at(-1)!;
  const parsed=sdk.parsePayAccountGainInstruction({...payment,accounts:payment.accounts!,data:payment.data!});
  expect(parsed.accounts.certificate).toBeUndefined();
  expect(parsed.accounts.margin.address).toBe(other);
  expect(parsed.data.amount).toBe(2n);
  expect(payment.accounts!.slice(-8).map(meta=>meta.address)).toEqual(await sdk.deriveCoverageLanes(venue));
  expect(submitted[0].flatMap(ix=>ix.accounts??[]).some(meta=>meta.address===certificate)).toBe(false);
});

it('sizes grouped credit from measured compute while respecting the transaction ceiling',()=>{
  expect(directCreditLimit(158_218)).toBe(400_000);
  expect(directCreditLimit(510_001)).toBe(586_502);
  expect(directCreditLimit(1_399_999)).toBe(1_400_000);
  for(const units of [0,NaN,400_000.5,1_400_001])expect(()=>directCreditLimit(units)).toThrow();
});

it('pays the next ready creditor when the previous flat payee is absent from grouped RPC reads',async()=>{
  const {test}=await finalPageFixture(0n);
  const [early,flat]=test.margins, [next,later]=test.marketPdas.map(([key])=>key);
  const ordered=[early,flat,next,later];
  const ready=[early,next,later].map(margin=>({margin,marketIndex:0 as const}));
  expect(orderedPayments(ordered,ready,{margin:flat,marketIndex:1})).toEqual([ready[1],ready[2],ready[0]]);
  const sibling={margin:flat,marketIndex:1 as const};
  expect(orderedPayments(ordered,[ready[0],sibling,...ready.slice(1)],{margin:flat,marketIndex:0})[0]).toEqual(sibling);
});
