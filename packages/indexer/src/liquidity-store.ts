import {JournalStore,type JournalBinding} from './store.js';
import {projectAccounts,type AccountState} from './account-projection.js';
import {emptyLiquidity} from './liquidity-projection.js';
import type {AccountEvent} from './account-events.js';
export type LiquidityBinding=JournalBinding&{schema:4;venue:string;profile:'liquidity-execution-qualification';artifactSet:string};
export class LiquidityStore extends JournalStore<AccountState,LiquidityBinding,AccountEvent> {
  constructor(url:string,runId:string) {
    super(url,runId,{schema:4,empty:emptyLiquidity,project:(state,event,binding)=>projectAccounts(state,event,binding.venue,binding.domain,4)});
  }
}
