/** Recheck retained signed safety receipts against captured raw account bodies.
 * This is a projection regression, not a new RPC/SQL run or complete-block proof;
 * submission ordinals break ties here. The live journal separately authenticates
 * canonical block positions. No successful financial effects are synthesized. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {getProgramDerivedAddress} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {decodeAccountInvocations} from '../../packages/indexer/src/account-events.js';
import {emptyLiquidity} from '../../packages/indexer/src/liquidity-projection.js';
import {projectScopedBatch,projectedEntities} from '../../packages/indexer/src/scoped-projection.js';
import {accountFields} from '../../packages/indexer/src/account-projection.js';
import {json} from '../../packages/indexer/src/events.js';
const directory=process.argv[2];assert(directory);
const load=(name:string)=>JSON.parse(readFileSync(`${directory}/${name}.json`,'utf8'));
const summary=load('summary'),capture=load('financial-capture');
assert.equal(summary.trackedDirty,false);
const venue=sdk.getVenueDecoder().decode(Buffer.from(capture.rawAccounts[capture.venue],'base64'));
const [eventAuthority]=await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds:[Buffer.from('__event_authority')]});
const binding={program:sdk.CLEARING_PROGRAM_ADDRESS,eventAuthority,venue:capture.venue,domain:sdk.hex(venue.domain)};
let state=emptyLiquidity(),invocations=0,failed=0;
const checkpoints:{label:string;entities:number;payloads:string;uncaptured:string[]}[]=[];
const decoders=[sdk.getVenueDecoder(),sdk.getCustodyDecoder(),sdk.getVenueSafetyDecoder(),sdk.getVenueRegistryDecoder(),
  sdk.getPortfolioDecoder(),sdk.getMarginAccountDecoder(),sdk.getMarketDecoder(),sdk.getMarketLedgerDecoder(),sdk.getCapitalBindingDecoder(),
  sdk.getSettlementCertificateDecoder(),sdk.getResolutionDecoder(),sdk.getResolutionPageDecoder(),sdk.getResolutionWorkDecoder(),
  sdk.getRetirementCertificateDecoder(),sdk.getLiquidityRegistryDecoder(),sdk.getMakerRegistrationDecoder(),sdk.getFundingPublisherDecoder()];
function compare(label:string,raw:Record<string,string>) {
  const uncaptured:string[]=[];
  for(const [key,expected] of projectedEntities(state)) {
    if(!raw[key]) {
      assert.equal(state.revisions[key].kind,4,`Missing financial capture ${key}`);
      uncaptured.push(key);continue; // Safety capture omits the trader portfolio.
    }
    const actual=decoders[state.revisions[key].kind].decode(Buffer.from(raw[key],'base64'));
    assert.deepEqual(accountFields(actual),expected,`${label}: projected body ${key}`);
  }
  for(const [key,expected] of Object.entries(state.revisions)) {
    if(uncaptured.includes(key))continue;
    const bytes=Buffer.from(raw[key],'base64');assert.equal(bytes.readBigUInt64LE(10).toString(),expected.revision);
  }
  const registry=sdk.getVenueRegistryDecoder().decode(Buffer.from(raw[capture.registry],'base64'));
  assert.deepEqual(registry.members.slice(0,registry.count),state.members);
  checkpoints.push({label,entities:Object.keys(state.revisions).length-uncaptured.length,payloads:state.sequence,uncaptured});
}
for(const [index,check] of summary.checks.entries()) {
  const receipt=load(`transaction-${index}`);
  assert.equal(receipt.transaction.signatures[0],check.signature);
  const batch=decodeAccountInvocations(check.signature,receipt,index,binding);
  if(receipt.meta.err){failed++;assert.equal(batch.length,0);}
  state=projectScopedBatch(state,batch,binding).state;invocations+=batch.length;
  const next=summary.checks[index+1]?.label;
  if(check.label==='P32 safety whole-account liquidation with live receiver reservations')compare('post-liquidation',capture.liquidationSteps[0].after);
  if(check.label==='P32 safety permissionless bankrupt cross account freezes complete cohort')compare('frozen',capture.frozenAccounts);
  if(check.label==='P32 safety complete applied-account reconciliation'&&next!==check.label)compare('completed',capture.completedAccounts);
  if(check.label==='P32 safety resolved cash exits with stale sources')compare('resolved-exit',capture.resolvedAccounts);
}
compare('reactivated',summary.recoveredAccounts);assert.equal(checkpoints.length,5);
const result={verifier:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),receiptRevision:summary.revision,
  sbfRevision:summary.build.revision,scope:'retained signed receipt projection and raw body comparison; not new RPC/SQL or block-position evidence',
  transactions:summary.checks.length,invocations,failed,checkpoints};
writeFileSync(`${directory}/scoped-projection.json`,json(result));console.log(json(result));
