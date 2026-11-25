import {PROFIT_ATTRIBUTION_ARTIFACT_SET,SPONSORED_PROFIT_ARTIFACT_SET} from './profit-attribution.js';
import {LIQUIDITY_ARTIFACTS,LIQUIDITY_ARTIFACT_SET} from './liquidity-artifacts.js';

/** API/budget policy 4 is separate from program profile 6. Both explicit names
 * bind the same qualified bytes; old journals keep their original artifact set. */
export type AccountDeployment='funded-routing'|'bounded-entry'|'closed-quantity'|'bounded-router-candidate'|'execution-router-candidate'|'unified-recovery-candidate'|'local-successor-candidate'|'selected'|'account-scale-candidate'|'profit-attribution-candidate'|'sponsored-profit-candidate'|'verified-pair-candidate'|'btc-residual-candidate'|'btc-allocation-candidate'|'linked-pair-candidate'|'linked-flat-candidate'|'linked-allocation-candidate'|'integrated-recovery-candidate'|'paged-recovery-candidate'|'recovery-search-candidate'|'foreign-creditor-candidate'|'shared-inventory-candidate'|'partial-inventory-candidate'|'book-inventory-candidate'|'book-capacity-candidate'|'multi-lot-book-candidate'|'aggregate-fee-candidate'|'bounded-market-candidate'|'funding-prefix-candidate'|'read-only-market-candidate'|'read-only-ledger-candidate';
export const SETTLEMENT_HELPER_REVISION='ed466030eccd485b8552b378815bf3f4e28fb658';
export const VERIFIED_PAIR_HELPER_REVISION='447efef3d434496c483715c06cbc8e5341da10c1';
export const VERIFIED_PAIR_ARTIFACT_SET='verified-pair-447efef';
export const SHARED_INVENTORY_ARTIFACT_SET='shared-inventory-59184c5';
export const BOOK_INVENTORY_ARTIFACT_SET='inventory-book-d5cc624';
export const BOOK_CAPACITY_ARTIFACT_SET='book-capacity-eb011a5';
export const MULTI_LOT_ARTIFACT_SET='multi-lot-baef259';
export const AGGREGATE_FEE_ARTIFACT_SET='aggregate-fees-5b1e964';
export const BOUNDED_MARKET_ARTIFACT_SET='bounded-market-3ace707';
export const CHECKED_FUNDING_ARTIFACT_SET='funding-prefix-2da3e90';
export const READ_ONLY_MARKET_ARTIFACT_SET='read-only-market-10ab3b5';
export const READ_ONLY_LEDGER_ARTIFACT_SET='read-only-ledger-8bc01bb';
export const INTEGRATED_RECOVERY_ARTIFACT_SET='integrated-recovery-5d7a7c0';
// The comparison identities select a decoder for replay. No runtime signer
// or deployment selection accepts them as authority to operate a venue.
export const DOMAIN_BASELINE_ARTIFACT_SET='financial-domains-before-84ef28f3';
export const DOMAIN_EXTRACTED_ARTIFACT_SET='financial-domains-after-90d71835';
export const LOCAL_SUCCESSOR_ARTIFACT_SET='local-successor-d9a2a55b';
export const PARTITIONED_INPUTS_ARTIFACT_SET='partitioned-inputs-ba2057df';
export const POPULATED_RATES_ARTIFACT_SET='populated-rates-365fa254';
export const ORIGINAL_BUDGETS_ARTIFACT_SET='populated-budgets-16f89bef';
export const FOREIGN_PROTECTION_ARTIFACT_SET='foreign-protection-7df9585e';
export const WINNER_ALLOCATION_ARTIFACT_SET='winner-allocation-486d5818';
export const JOINT_PAYMENT_ARTIFACT_SET='joint-payment-3acd4a4d';
export const PAIR_SCHEDULE_ARTIFACT_SET='pair-schedule-34359552';
export const usesExecutionRouter = (selection?: string): selection is 'funded-routing'|'bounded-entry'|'execution-router-candidate'|'bounded-router-candidate'|'closed-quantity' =>
  usesBoundedEntry(selection) || selection === 'execution-router-candidate' || selection === 'bounded-router-candidate' || selection === 'closed-quantity';
export const usesUnifiedRecovery = (selection?: AccountDeployment) => selection === 'unified-recovery-candidate' || usesExecutionRouter(selection);
export const UNIFIED_RECOVERY_ARTIFACT_SET='unified-recovery-79724a5a';
// The local runner binds this layout to its program hashes before indexing.
// The new instruction uses unified recovery account and event layouts.
export const EXECUTION_ROUTER_ARTIFACT_SET='standing-maker-routing';
export const BOUNDED_ENTRY_ARTIFACT_SET='bounded-entry-settlement';
export const WIDE_DIRECTORY_ARTIFACT_SET='wide-maker-directory';
export const WIDE_ROUTING_ARTIFACT_SET='wide-maker-routing';
export const MULTI_ROUTING_ARTIFACT_SET='multi-maker-routing';
export const hasWideDirectory=(set?:string)=>set===WIDE_DIRECTORY_ARTIFACT_SET||set===WIDE_ROUTING_ARTIFACT_SET||set===MULTI_ROUTING_ARTIFACT_SET;
export const FUNDED_ROUTING_ARTIFACT_SET='funded-maker-routing';
export const usesBoundedEntry=(selection?:string)=>selection==='bounded-entry'||selection==='funded-routing';
export const hasBoundedEntry=(set?:string)=>set===BOUNDED_ENTRY_ARTIFACT_SET||set===FUNDED_ROUTING_ARTIFACT_SET||hasWideDirectory(set);
export const usesClosedQuantity=(selection?:string)=>usesBoundedEntry(selection)||selection==='closed-quantity';
export const hasClosedQuantity=(set?:string)=>hasBoundedEntry(set)||set===CLOSED_QUANTITY_ARTIFACT_SET;
export const CLOSED_QUANTITY_ARTIFACT_SET='closed-quantity-settlement';
export const BOUNDED_ROUTER_ARTIFACT_SET='bounded-maker-routing';
export const hasJointPayment=(set?:string)=>set===JOINT_PAYMENT_ARTIFACT_SET||set===UNIFIED_RECOVERY_ARTIFACT_SET||set===EXECUTION_ROUTER_ARTIFACT_SET||set===BOUNDED_ROUTER_ARTIFACT_SET||hasClosedQuantity(set);
export const hasPartitionedInputs=(set?:string)=>set===PARTITIONED_INPUTS_ARTIFACT_SET||set===POPULATED_RATES_ARTIFACT_SET||set===ORIGINAL_BUDGETS_ARTIFACT_SET||set===FOREIGN_PROTECTION_ARTIFACT_SET||set===WINNER_ALLOCATION_ARTIFACT_SET||set===PAIR_SCHEDULE_ARTIFACT_SET||hasJointPayment(set);
const integratedLayout=(set?:string)=>set===INTEGRATED_RECOVERY_ARTIFACT_SET||set===LOCAL_SUCCESSOR_ARTIFACT_SET||hasPartitionedInputs(set)
  ||set===DOMAIN_BASELINE_ARTIFACT_SET||set===DOMAIN_EXTRACTED_ARTIFACT_SET;
export const hasLedgerLanes=(set?:string)=>set===READ_ONLY_LEDGER_ARTIFACT_SET||integratedLayout(set);
export const hasMarketLanes=(set?:string)=>set===READ_ONLY_MARKET_ARTIFACT_SET||hasLedgerLanes(set);
export const hasFundingCheckpoints=(set?:string)=>set===CHECKED_FUNDING_ARTIFACT_SET||hasMarketLanes(set);
export const hasMarketCapacity=(set?:string)=>set===BOUNDED_MARKET_ARTIFACT_SET||hasFundingCheckpoints(set);
export const hasAggregateFees=(set?:string)=>set===AGGREGATE_FEE_ARTIFACT_SET||hasMarketCapacity(set);
export const isMultiLotArtifact=(set?:string)=>set===MULTI_LOT_ARTIFACT_SET||hasAggregateFees(set);
export const isBookInventoryArtifact=(set?:string)=>set===BOOK_INVENTORY_ARTIFACT_SET||set===BOOK_CAPACITY_ARTIFACT_SET||isMultiLotArtifact(set);
export const isMultiLotDeployment=(selection?:AccountDeployment)=>usesUnifiedRecovery(selection)||selection==='local-successor-candidate'||selection==='integrated-recovery-candidate'||selection==='multi-lot-book-candidate'||selection==='aggregate-fee-candidate'||selection==='bounded-market-candidate';
export const isBookInventoryDeployment=(selection:AccountDeployment)=>selection==='book-inventory-candidate'||selection==='book-capacity-candidate'||isMultiLotDeployment(selection);
export const PARTIAL_INVENTORY_ARTIFACT_SET='partial-inventory-2256c51';
export const isSharedInventoryArtifact=(value?:string)=>value===SHARED_INVENTORY_ARTIFACT_SET || value===PARTIAL_INVENTORY_ARTIFACT_SET;
export const PAGED_RECOVERY_ARTIFACT_SET='paged-recovery-37672622';
export const RECOVERY_SEARCH_ARTIFACT_SET='recovery-search-efbaa02';
export const hasPagedRecovery=(set?:string)=>set===PAGED_RECOVERY_ARTIFACT_SET||set===LOCAL_SUCCESSOR_ARTIFACT_SET||hasPartitionedInputs(set);
export type RecoveryDeployment='funded-routing'|'bounded-entry'|'closed-quantity'|'bounded-router-candidate'|'execution-router-candidate'|'unified-recovery-candidate'|'local-successor-candidate'|'paged-recovery-candidate'|'integrated-recovery-candidate'|'recovery-search-candidate';
export const usesRecoverySearch=(selection?:AccountDeployment):selection is RecoveryDeployment=>
  usesUnifiedRecovery(selection)||selection==='local-successor-candidate'||selection==='paged-recovery-candidate'||selection==='integrated-recovery-candidate'||selection==='recovery-search-candidate';
export const hasJointRecovery=(set?:string)=>set===PAGED_RECOVERY_ARTIFACT_SET||set===RECOVERY_SEARCH_ARTIFACT_SET||integratedLayout(set);
export const FOREIGN_CREDITOR_ARTIFACT_SET='foreign-creditor-d177cc5';
export const LINKED_ALLOCATION_ARTIFACT_SET='linked-allocation-d0ae474';
export const LINKED_FLAT_ARTIFACT_SET='linked-flat-30434d5';
export const LINKED_PAIR_ARTIFACT_SET='linked-pair-0e027fc';
export const BTC_ALLOCATION_ARTIFACT_SET='btc-allocation-9e2cc00';
export const BTC_RESIDUAL_ARTIFACT_SET='btc-residual-8024a37';
export const ACCOUNT_SCALE_ARTIFACT_SET=LIQUIDITY_ARTIFACT_SET;
type DeploymentBinding = {
  artifactSet:string; schema:number; programProfile:number; programRevision?:string;
  helperRevision:string; artifacts:typeof LIQUIDITY_ARTIFACTS;
};
export function accountDeployment(selection:AccountDeployment):DeploymentBinding {
  if (selection === 'funded-routing') {
    const previous = accountDeployment('bounded-entry');
    return {...previous, artifactSet: FUNDED_ROUTING_ARTIFACT_SET,
      programRevision: 'e02e72a06a16c36cd2b843ca373895e3fbd23927',
      artifacts: previous.artifacts.map(artifact => artifact.name === 'clearing' ? {...artifact,
        bytes: 3631312, sha256: '83106bb34172c854e849327a05c9a56459fc283d70c6fe9b0fd6a86febb6e25d'} : artifact)};
  }
  if (selection === 'bounded-entry') {
    const previous = accountDeployment('closed-quantity');
    return {...previous, artifactSet: BOUNDED_ENTRY_ARTIFACT_SET,
      programRevision: 'b7e4458b57a3a9bbb0906929a936094c78393b47',
      artifacts: previous.artifacts.map(artifact => artifact.name === 'clearing' ? {...artifact,
        bytes: 3630808, sha256: 'b013759bd9378771713d10ea95afec3e56785aa6b3c9b3f5f341be716665239e'} : artifact)};
  }
  if (selection === 'closed-quantity') {
    const router = accountDeployment('bounded-router-candidate');
    return {...router, artifactSet: CLOSED_QUANTITY_ARTIFACT_SET,
      programRevision: 'ec6f1ffa4b6a3a37b322a3411e934f474b88f997',
      artifacts: router.artifacts.map(artifact => artifact.name === 'clearing' ? {...artifact,
        bytes: 3634128, sha256: '0895875314c723fde1ba8cef1c623d5df9700de4655c7fefef154b90d0f86c83'} : artifact)};
  }
  if (usesExecutionRouter(selection)) {
    const programs: Record<string, {bytes: number; sha256: string}> = {
      clearing: selection === 'bounded-router-candidate' ?
        {bytes: 3639616, sha256: '94acdff582390aa1805c1e0d82879073227ce31af8ede48715f73a90e0cea726'} : {bytes: 3637536, sha256: 'fa85567e41cde0b9ecb0eb02ae78c4213f1898cd46dbeccc3ab6e4a6c7c35bc4'},
      'maker-a': selection === 'bounded-router-candidate' ?
        {bytes: 167520, sha256: '49e64c2bef25be6aa35b991205e40d0d15df326fe9fd5c37ec9c14d832f424a8'} : {bytes: 167520, sha256: '38a45a632db54c64a39c2793043ec14bb0b172721761a2950c61d59328ec6ccb'},
      'maker-b': selection === 'bounded-router-candidate' ?
        {bytes: 167520, sha256: '93541f00d200cfb18c5f7770fbce11ee2225c9e03fc528cea30157fe486987f3'} : {bytes: 167520, sha256: '924c94a5a7e1eff35ad0dc28a4ebc3b01b7b5b17d18d8fda531e91daeaf37139'},
    };
    return {artifactSet: selection === 'bounded-router-candidate' ? BOUNDED_ROUTER_ARTIFACT_SET : EXECUTION_ROUTER_ARTIFACT_SET, schema: 10, programProfile: 6,
      programRevision: selection === 'bounded-router-candidate' ? '986b3cd3287ff0e99ae777a98c192792f8a91883' : '35fef03e3f58e9cba69b4c38408e39194bddc051',
      helperRevision: '79724a5a0182eb8f22f916c6a9f23fd5f1dfcc91',
      artifacts: LIQUIDITY_ARTIFACTS.map(artifact => ({...artifact, ...programs[artifact.name]}))};
  }
  if(selection==='unified-recovery-candidate')return {
    artifactSet:UNIFIED_RECOVERY_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'79724a5a0182eb8f22f916c6a9f23fd5f1dfcc91',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:3555384,sha256:'c8c98fb4906426c3582f9d478da983c0ea43b3ba518a5c145b7e45923bc05828'}:artifact)
  };
  if(selection==='local-successor-candidate')return {
    artifactSet:LOCAL_SUCCESSOR_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'d9a2a55b8c43f490b83c70b1151ebf306543f74c',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:3199280,sha256:'5be8497c6ae059d1864fb17e92be268cb3cd7a11adfb3542556d659fbb8806e6'}:artifact)
  };
  if(selection==='read-only-ledger-candidate')return {
    artifactSet:READ_ONLY_LEDGER_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'8bc01bb942126022e783ff62392ecccedf969edc',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:3023024,sha256:'6e0b3aa9e33eb79db214bb0cfb478d01a9e27bf27473624b34fece70e49d178e'}:artifact)
  };
  if(selection==='read-only-market-candidate')return {
    artifactSet:READ_ONLY_MARKET_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'10ab3b5437243c8a988862e6bcbc32551116d3ba',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2961736,sha256:'2e2aa670fc7e2aa318a4fb9bb7ee9db02f8f0f0ef517e0bab14f99fe8b21acac'}:artifact)
  };
  if(selection==='funding-prefix-candidate')return {
    artifactSet:CHECKED_FUNDING_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'2da3e904060aa2d1d1b174a88bf5740f99b71002',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2920496,sha256:'ef02d96b5d689c04e3b68854560073248507c956229bc0892d5423fa3170bec8'}:artifact)
  };
  if(selection==='bounded-market-candidate')return {
    artifactSet:BOUNDED_MARKET_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'3ace707834ffb80a5e3df5a3fe0fa8285ef89a39',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2900728,sha256:'62c35c3bd7c5decac5d9f6cc6feaa7aad94b554e8aba535c3afbec0225832b8d'}:artifact)
  };
  if(selection==='aggregate-fee-candidate')return {
    artifactSet:AGGREGATE_FEE_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'5b1e964c309612908329aa39ace0042714622a0e',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2880864,sha256:'1c8aa1d744a1a88281691ed67e87152b4c266f40401813a962a9855c6c88681c'}:artifact)
  };
  if(selection==='multi-lot-book-candidate')return {
    artifactSet:MULTI_LOT_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'baef259fbf6c0a385890c9ca614b8f8994c958fc',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2855600,sha256:'0e5c4e520dd966abf5979c65f96644b5f7bc57e3a822efbf207dbea7b72a0cb4'}:artifact)
  };
  if(selection==='book-capacity-candidate')return {
    artifactSet:BOOK_CAPACITY_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'eb011a5b3846cc002217cefbf1be59d22c934228',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2778000,sha256:'a07c006ab60c2d7e187f2712ff6565d41122f9bf4825654c511b6ea2dd0c8618'}:artifact)
  };
  if(selection==='book-inventory-candidate')return {
    artifactSet:BOOK_INVENTORY_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'d5cc6243b191cecedc1ed4845fafa8dc92e1691a',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2731776,sha256:'fa5e8877510f28c202c7d4db799a81a91ce7eeb031ffea59b543d41a04bbfac2'}:artifact)
  };
  if(selection==='partial-inventory-candidate')return {
    artifactSet:PARTIAL_INVENTORY_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'2256c519e09c3f3c35816e3a0f578614de7f0654',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2638216,sha256:'da2796230e4591aa53855b4fc0c6543ad424c017bd09cd2ec8c8f96535627e8e'}:artifact)
  };
  if(selection==='shared-inventory-candidate')return {
    artifactSet:SHARED_INVENTORY_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'59184c58e1cfa0a3aabafaf11274a10a0c58154e',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2683376,sha256:'caf78f79e2e0bf1b6fc30f3ce5aef2cc0f453af2ef13e422a774055a4a833eef'}:artifact)
  };
  if(selection==='integrated-recovery-candidate')return {
    artifactSet:INTEGRATED_RECOVERY_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'5d7a7c0faef79ec0e97bf9e95278c4f4e8f25639',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:3187040,sha256:'94a82ceab69599b2abb952b0ea2f2867b27a27f5d54eb3ef59e88ee19f7ace9f'}:artifact)
  };
  if(selection==='paged-recovery-candidate')return {
    artifactSet:PAGED_RECOVERY_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'376726225002b0112d34a6d699664ff5471a8f21',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:3074232,sha256:'c2609d642a9dacc43ceb4727155babdadc375978884c7cd09cdcb02048e0fb18'}:artifact)
  };
  if(selection==='recovery-search-candidate')return {
    artifactSet:RECOVERY_SEARCH_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'efbaa024ad8dc00dde1e91326ee3eba6d4d700e9',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:3055624,sha256:'902291ec1c562037e18bb04f7311276bd8d9c3b82ff8857dffd86484c2e43fdd'}:artifact)
  };
  if(selection==='foreign-creditor-candidate')return {
    artifactSet:FOREIGN_CREDITOR_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'d177cc5ed68bb527470486165d2702d03e03959e',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2603744,sha256:'3d7b0b64d71aad7943b265ac66011fd8231f8d195846a2c49d0fcbe0825ee76b'}:artifact)
  };
  if(selection==='linked-allocation-candidate')return {
    artifactSet:LINKED_ALLOCATION_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'d0ae474df3ba758466b5ca9b9e9e1f2cd6840935',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2609136,sha256:'4e41342a10405a75e1539a8a249c97cbf6c955f4434f484996f9c2f0bf06bcd4'}:artifact)
  };
  if(selection==='linked-flat-candidate')return {
    artifactSet:LINKED_FLAT_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'30434d5e0cc77c296912ecd82d1036b8c674d9a9',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2586864,sha256:'e55f48477a39977d10e33a85e87bab5d5ee00161307469ae1c88dae500d2cac9'}:artifact)
  };
  if(selection==='linked-pair-candidate')return {
    artifactSet:LINKED_PAIR_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'0e027fcd5d5a658292218d40106c65b22c81da5c',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2585320,sha256:'7f627bc93748c7b4e6c36aa65a461900690387c77ab0e6169e4745dd0bad9086'}:artifact)
  };
  if(selection==='btc-allocation-candidate')return {
    artifactSet:BTC_ALLOCATION_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'9e2cc0071b8b3aaf84e21e26727f2f8ff7f01ed4',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2581008,sha256:'cfca283a6c024d0839c4f9167bcef78ab15ca2d7346b814db4bda496503f02b9'}:artifact)
  };
  if(selection==='btc-residual-candidate')return {
    artifactSet:BTC_RESIDUAL_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:'8024a3776e8d57807ace6f782fef972f89c5f196',
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2550560,sha256:'cd2e95d27c5e6ec9b1a55138220ec29f2475c9a7c9b3d14373c35a5361e1982e'}:artifact)
  };
  if(selection==='verified-pair-candidate')return {
    artifactSet:VERIFIED_PAIR_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:VERIFIED_PAIR_HELPER_REVISION,
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2549160,sha256:'ad877806d413e8708d8c33189dc4d2084392fb41995763f016506c7ae04b8f6a'}:artifact)
  };
  if(selection==='sponsored-profit-candidate')return {
    artifactSet:SPONSORED_PROFIT_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:SETTLEMENT_HELPER_REVISION,
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2516448,sha256:'e1fa7b655b3e619aac575f1a8e559791cfc09e5c28492a5e334678b105b7f547'}:artifact)
  };
  if(selection==='profit-attribution-candidate')return {
    artifactSet:PROFIT_ATTRIBUTION_ARTIFACT_SET,schema:10,programProfile:6,helperRevision:SETTLEMENT_HELPER_REVISION,
    artifacts:LIQUIDITY_ARTIFACTS.map(artifact=>artifact.name==='clearing'?{...artifact,
      bytes:2497736,sha256:'f4b313c3899e1aab074baf92a015c2e37f3c7a450e6610105e0669d539a98ca3'}:artifact)
  };
  if(selection!=='selected'&&selection!=='account-scale-candidate')throw new Error('Unsupported account deployment');
  return {artifactSet:LIQUIDITY_ARTIFACT_SET,schema:10,programProfile:6,artifacts:LIQUIDITY_ARTIFACTS,helperRevision:SETTLEMENT_HELPER_REVISION};
}
