import {JournalStore, type JournalBinding} from './store.js';
import {emptyGroup, projectGroup, type GroupState} from './group-projection.js';
import type {GroupEvent} from './group-events.js';

export type GroupBinding = JournalBinding & {schema:2; group:string; profile:'cross-safety-qualification'};
export class GroupStore extends JournalStore<GroupState, GroupBinding, GroupEvent> {
  constructor(url: string, runId: string) {
    super(url, runId, {schema:2, empty:emptyGroup,
      project:(state, event, binding) => projectGroup(state, event, binding.group, binding.domain)});
  }
}
