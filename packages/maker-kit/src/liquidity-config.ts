import assert from 'node:assert/strict';
import {address} from '@solana/kit';
import {accountUserConfig,type AccountUserConfig} from '@rivalt/sdk';

/** Explicit operator input, never an acceptance dump or inferred deployment. */
export type LiquidityOperatorConfig={schemaVersion:4;operatorClass:'internal-reference';deployment:AccountUserConfig;
  runId:string;databaseEnv:string;signerPath:string;role:'maker'|'funding';marketIndex:0|1;instance?:0|1|2;signer:string};
export function liquidityOperatorConfig(value:LiquidityOperatorConfig):LiquidityOperatorConfig {
  assert.equal(value.schemaVersion,4);assert.equal(value.operatorClass,'internal-reference');
  accountUserConfig(value.deployment);assert(/^[a-zA-Z0-9._-]{1,120}$/.test(value.runId));
  assert(/^RIVALT_[A-Z0-9_]+$/.test(value.databaseEnv));assert(typeof value.signerPath==='string'&&value.signerPath.length>0);
  assert(['maker','funding'].includes(value.role));assert([0,1].includes(value.marketIndex));address(value.signer);
  assert(value.role==='maker'?[0,1,2].includes(value.instance!):value.instance===undefined);
  return value;
}
