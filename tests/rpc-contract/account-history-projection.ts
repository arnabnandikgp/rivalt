// Retained finalized RPC replay only. It never fabricates or runs financial actions.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getProgramDerivedAddress} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {decodeAccounts} from '../../packages/indexer/src/account-events.js';
import {emptyAccounts,projectAccounts} from '../../packages/indexer/src/account-projection.js';
const directory=process.argv[2];
assert(directory,'Explicit retained run directory required');
const summary=JSON.parse(readFileSync(`${directory}/summary.json`,'utf8'));
const [authority]=await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds:[Buffer.from('__event_authority')]});
const state=emptyAccounts();let domain='',events=0;
for(const [index,check] of summary.checks.entries()) {
  const transaction=JSON.parse(readFileSync(`${directory}/finalized-${index}.json`,'utf8'));
  for(const event of decodeAccounts(check.signature,transaction,authority,summary.venue)) {
    domain ||= event.data.domain;
    try {projectAccounts(state,event,summary.venue,domain);events++;}
    catch(error){console.error({index,label:check.label,type:event.type,sequence:event.data.sequence});throw error;}
  }
}
console.log(JSON.stringify({retainedHistory:directory,events,sequence:state.sequence,roots:state.members.length,mode:state.safety?.mode}));
