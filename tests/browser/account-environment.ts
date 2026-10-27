import type { ChildProcess } from 'node:child_process';
import type { Address } from '@solana/kit';
import type { AccountUserClient } from '@rivalt/sdk';
import type { AccountIndexer, AccountConfig } from '../../packages/indexer/src/account-indexer.js';
import type { AccountRuntime } from '../../packages/services/src/account-runtime.js';
import type { accountServiceSetup } from '../rpc-contract/account-service-setup.js';
import type { accountRuntimeHarness } from '../rpc-contract/account-runtime-harness.js';

export type AccountQualificationEnvironment = {
  directory: string;
  config: AccountConfig;
  setup: Awaited<ReturnType<typeof accountServiceSetup>>;
  transport: Awaited<ReturnType<typeof accountRuntimeHarness>>;
  client: AccountUserClient;
  runtime: AccountRuntime;
  endpoint: string;
  indexer(): AccountIndexer;
  normal(): Promise<unknown>;
  pauseSources(paused: boolean): void;
  pauseIndexer(paused: boolean): Promise<void>;
  maker: ChildProcess;
  restartMaker(): ChildProcess;
};
export type BrowserAccounts = { cross: Address; isolated: Address };
