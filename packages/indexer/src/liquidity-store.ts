import {JournalStore,type JournalBinding} from './store.js';
import {type AccountState} from './account-projection.js';
import {projectScopedBatch} from './scoped-projection.js';
import {emptyLiquidity} from './liquidity-projection.js';
import type {AccountEvent} from './account-events.js';
export type LiquidityBinding=JournalBinding&{schema:7;venue:string;profile:'liquidity-execution-qualification';artifactSet:string};
export class LiquidityStore extends JournalStore<AccountState,LiquidityBinding,AccountEvent> {
  constructor(url:string,runId:string) {
    super(url,runId,{schema:7,empty:emptyLiquidity,apply:projectScopedBatch});
  }
}
