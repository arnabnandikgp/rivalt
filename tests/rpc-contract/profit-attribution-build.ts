import {POPULATED_RATES_ARTIFACT_SET,PARTITIONED_INPUTS_ARTIFACT_SET,accountDeployment,DOMAIN_BASELINE_ARTIFACT_SET,DOMAIN_EXTRACTED_ARTIFACT_SET,type AccountDeployment} from '@rivalt/sdk';
import {BACKING_ARTIFACTS,verifyTestBuild} from './backing-artifacts.js';

type Linked = boolean|'successor'|'paged'|'integrated'|'owned'|'flat'|'allocation'|'foreign'|'shared'|'partial'|'book'|'capacity'|'multi'|'fees'|'market'|'funding'|'lane'|'ledger';
const linkedBuilds = {
  successor:['local-successor-candidate','local-successor-qualification'],
  paged:['paged-recovery-candidate','paged-recovery-qualification'],
  integrated:['integrated-recovery-candidate','integrated-recovery-qualification'],
  owned:['recovery-search-candidate','recovery-search-qualification'],
  pair:['linked-pair-candidate','linked-pair-qualification'],
  flat:['linked-flat-candidate','linked-pair-qualification'],
  allocation:['linked-allocation-candidate','linked-allocation-qualification'],
  foreign:['foreign-creditor-candidate','foreign-creditor-qualification'],
  ledger:['read-only-ledger-candidate','read-only-route-ledger'],
  lane:['read-only-market-candidate','read-only-route-market'],
  funding:['funding-prefix-candidate','checked-funding-prefix'],
  market:['bounded-market-candidate','bounded-market-read'],
  fees:['aggregate-fee-candidate','aggregate-fee-qualification'],
  multi:['multi-lot-book-candidate','multi-lot-book-qualification'],
  capacity:['book-capacity-candidate','book-inventory-qualification'],
  book:['book-inventory-candidate','book-inventory-qualification'],
  partial:['partial-inventory-candidate','partial-inventory-qualification'],
  shared:['shared-inventory-candidate','shared-inventory-qualification'],
} as const;

export function verifyProfitBuild(directory:string,sponsored=false,paired=false,residual=false,allocation=false,linked:Linked=false) {
  const comparison=process.env.RIVALT_DOMAIN_COMPARISON;
  if(comparison){
    if(linked!=='integrated'||!['baseline','extracted'].includes(comparison)
      ||!['profit-attribution-integrated-payout','profit-attribution-integrated-receiver'].includes(process.env.RIVALT_SETTLEMENT_PROBE??''))
      throw new Error('Financial domain comparison requires an explicit payout or liquidation probe');
    const baseline=comparison==='baseline';
    const revision=baseline?'84ef28f37c1f2cc8a26d68640c883b15bb40e35c':'90d71835a2c1ec749d372873a7f9c0bdcbe894dd';
    const clearing=baseline?{bytes:3193416,sha256:'ff161557a6a94ca582d10ca1b13e820c207f0aaeafa695f5d04c178dc578fb80'}
      :{bytes:3193704,sha256:'df5fc5d4944c09129512c99fab55fe38b3f5c28f585aa8dded4cee1762f4088d'};
    const artifacts={...BACKING_ARTIFACTS,clearing};
    verifyTestBuild(directory,revision,artifacts,'integrated-recovery-qualification');
    return {artifactSet:baseline?DOMAIN_BASELINE_ARTIFACT_SET:DOMAIN_EXTRACTED_ARTIFACT_SET,artifacts,revision};
  }
  let selection:AccountDeployment,feature:string;
  if(linked) [selection,feature]=linkedBuilds[linked===true?'pair':linked];
  else if(allocation) [selection,feature]=['btc-allocation-candidate','btc-allocation-qualification'];
  else if(residual) [selection,feature]=['btc-residual-candidate','btc-residual-qualification'];
  else if(paired) [selection,feature]=['verified-pair-candidate','single-pair-default-qualification'];
  else [selection,feature]=[sponsored?'sponsored-profit-candidate':'profit-attribution-candidate','profit-attribution-qualification'];
  const deployment=accountDeployment(selection);
  // The first two attribution builds use the pre-existing arithmetic helper.
  const revision=selection==='profit-attribution-candidate'?'33361d969978543716697373826a3f3675e1edc4':
    selection==='sponsored-profit-candidate'?'1763dc750dbb27c852fafd5fbda4fad486fd69cb':deployment.helperRevision;
  const pinned=deployment.artifacts.find(artifact=>artifact.name==='clearing')!;
  const artifacts={...BACKING_ARTIFACTS,clearing:{bytes:pinned.bytes,sha256:pinned.sha256}};
  verifyTestBuild(directory,revision,artifacts,feature);
  return {artifactSet:deployment.artifactSet,artifacts,revision};
}

/** Read-only qualification identity. No application deployment selector accepts this build. */
export function verifyPartitionedBuild(directory:string,originalRates=false) {
  if(originalRates) {
    const revision='365fa2540914573ca06c4ff2268ca746fc9e78c4';
    const artifacts={...BACKING_ARTIFACTS,clearing:{bytes:3206096,sha256:'37bdb5a56697b0d81f116ad8b75c6bfa501009c0e661fdc3c10c1d01ae88589f'}};
    verifyTestBuild(directory,revision,artifacts,'populated-recovery-qualification');
    return {artifactSet:POPULATED_RATES_ARTIFACT_SET,revision,artifacts};
  }
  const revision='ba2057df85ce6d014673db5353ee351a310239d9';
  const artifacts={...BACKING_ARTIFACTS,clearing:{bytes:3205568,sha256:'925ece7c206a743a5fea2887598317a7484877ac649b7ba4650be34da07cbfdd'}};
  verifyTestBuild(directory,revision,artifacts,'partitioned-recovery-inputs');
  return {artifactSet:PARTITIONED_INPUTS_ARTIFACT_SET,revision,artifacts};
}
