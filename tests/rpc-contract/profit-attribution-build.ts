import {accountDeployment,type AccountDeployment} from '@rivalt/sdk';
import {BACKING_ARTIFACTS,verifyTestBuild} from './backing-artifacts.js';

type Linked = boolean|'flat'|'allocation'|'foreign'|'shared'|'partial'|'book'|'capacity'|'multi'|'fees'|'market'|'funding';
const linkedBuilds = {
  pair:['linked-pair-candidate','linked-pair-qualification'],
  flat:['linked-flat-candidate','linked-pair-qualification'],
  allocation:['linked-allocation-candidate','linked-allocation-qualification'],
  foreign:['foreign-creditor-candidate','foreign-creditor-qualification'],
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
