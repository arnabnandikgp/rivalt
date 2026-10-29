/** Run the same qualified durable worker from a private operator config. */
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {LiquidityUserClient} from '@rivalt/sdk';
import {protectedJson} from './config.js';
import {liquidityOperatorConfig} from './liquidity-config.js';
import {AccountRuntime} from '../../services/src/account-runtime.js';

const path=process.argv[2];assert(path,'Usage: pnpm liquidity:bot <private-operator.json>');
const config=liquidityOperatorConfig(protectedJson(path));
const signer=await Keypair.fromSecretKey(Uint8Array.from(protectedJson(config.signerPath)));
assert.equal(signer.address,config.signer,'Wrong operator signer');
const database=process.env[config.databaseEnv];assert(database,'Missing configured database environment variable');
const client=new LiquidityUserClient(config.deployment);await client.environment();
const runtime=new AccountRuntime(database,config.runId,config.deployment.rpcUrl,4);
try {
  await runtime.open();const {binding}=await runtime.discovery();
  for(const field of ['venue','genesis','anchor','anchorHash','domain'] as const)
    assert.equal(binding[field],config.deployment[field],'Operator database/deployment mismatch');
}finally{await runtime.close();}
Object.assign(process.env,{RIVALT_ACCOUNT_PROFILE:config.deployment.profile,RIVALT_DATABASE_URL:database,RIVALT_RUN_ID:config.runId,
  RIVALT_RPC_URL:config.deployment.rpcUrl,RIVALT_ACCOUNT_ROLE:config.role,RIVALT_MARKET_INDEX:String(config.marketIndex),
  RIVALT_MAKER_ID:config.instance===undefined?'':String(config.instance),RIVALT_SIGNER_PATH:config.signerPath});
await import('../../services/src/account-worker-main.js');
