import {expect,it} from 'vitest';
import {createNoopSigner,type Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {accountFixture} from '../../sdk/src/account-test-fixture.js';
import {settleAccounts} from './account-settlement-worker.js';
import {accountWorkerKeys} from './account-worker-state.js';
import type {AccountRuntime} from './account-runtime.js';
import type {AccountAuthority} from './account-authority.js';

// Encoded consumer input only; actual atomic completion/rollback is an RPC gate.
it('persists final backing page and payment as one original with receiver-version expiry proof',async()=>{
  const test=await accountFixture(),margin=test.margins[0],venue=test.config.venue;
  const root=sdk.getMarginAccountDecoder().decode(Buffer.from(test.accounts.get(margin).data[0],'base64'));
  root.positions[0].virtualScaled=3_000_000_001n;
  test.put(margin,sdk.getMarginAccountEncoder().encode(root));
  const [ledger]=await sdk.deriveMarketLedger(test.marketPdas[0][0]);
  const ledgerState=sdk.getMarketLedgerDecoder().decode(Buffer.from(test.accounts.get(ledger).data[0],'base64'));
  // The consumer fixture must still have allocated backing for the funded pool.
  ledgerState.insurance-=3n;ledgerState.settlement=3n;
  test.put(ledger,sdk.getMarketLedgerEncoder().encode(ledgerState));
  const keys=await accountWorkerKeys(venue),[,registryBump]=await sdk.deriveVenueComponent(venue,'registry');
  test.put(keys.registry,sdk.getVenueRegistryEncoder().encode({schemaVersion:7,revision:1n,venue,
    membershipVersion:4n,count:2,members:test.margins,bump:registryBump}));
  const [certificate,bump]=await sdk.deriveSettlementCertificate(venue,0);
  test.put(certificate,sdk.getSettlementCertificateEncoder().encode({...test.empty(sdk.getSettlementCertificateDecoder()),
    schemaVersion:7,revision:1n,venue,marketIndex:0,safetyEpoch:2n,membershipVersion:4n,count:2,liabilityVersion:1n,bump}));
  const submissions:{instructions:Instruction[];authority:AccountAuthority|null}[]=[];
  const runtime={rpc:test.rpc,budget:async()=> 'settlement-budget',pendingBudget:async()=>false,
    discovery:async()=>({state:{members:[margin]}}),
    snapshot:async()=>({...await sdk.readAccountSnapshot(test.rpc,test.config,[margin],'confirmed'),...keys}),
    enqueue:async(_id:string,instructions:Instruction[],_key:Keypair,_budget:string,authority:AccountAuthority|null)=>{submissions.push({instructions,authority});}};
  expect(await settleAccounts(runtime as unknown as AccountRuntime,createNoopSigner(test.owner) as Keypair))
    .toEqual({status:'queued',reason:'atomic-backing-page-and-gain'});
  expect(submissions).toHaveLength(1);
  const {instructions,authority}=submissions[0];expect(instructions).toHaveLength(3);
  expect(sdk.hex(instructions[1].data!.slice(0,8))).toBe(sdk.hex(sdk.CHECK_MARKET_BACKING_DISCRIMINATOR));
  expect(sdk.hex(instructions[2].data!.slice(0,8))).toBe(sdk.hex(sdk.PAY_ACCOUNT_GAIN_DISCRIMINATOR));
  expect(sdk.parsePayAccountGainInstruction(instructions[2]).data.amount).toBe(3n);
  expect(authority).toEqual({kind:'accountStateVersion',venue,account:margin,value:root.stateVersion.toString()});
  for(const key of [test.custody,(await sdk.deriveVenueComponent(venue,'vault'))[0]])
    expect(instructions.slice(1).some(instruction=>instruction.accounts!.some(meta=>meta.address===key))).toBe(false);
});
