import {JournalStore,type JournalBinding} from './store.js';
import {emptyAccounts,projectAccounts,type AccountState} from './account-projection.js';
import type {AccountEvent} from './account-events.js';
export type AccountBinding=JournalBinding&{schema:3;venue:string;profile:'account-safety-qualification';artifactSet:string};
export class AccountStore extends JournalStore<AccountState,AccountBinding,AccountEvent> {
  constructor(url:string,runId:string) {
    super(url,runId,{schema:3,empty:emptyAccounts,project:(state,event,binding)=>projectAccounts(state,event,binding.venue,binding.domain)});
  }
}
