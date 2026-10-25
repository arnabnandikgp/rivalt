/** Read-only regression against retained signed RPC history. This does not count
 * as a fresh chain/PG lifecycle and is never a deployment configuration source. */
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {getProgramDerivedAddress} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {decodeGroup} from '../../packages/indexer/src/group-events.js';
import {emptyGroup, projectGroup} from '../../packages/indexer/src/group-projection.js';
import {json} from '../../packages/indexer/src/events.js';

const directory = process.argv[2];
assert(directory, 'provide a retained RPC run directory');
const summary = JSON.parse(readFileSync(`${directory}/summary.json`, 'utf8'));
const [authority] = await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS, seeds:[Buffer.from('__event_authority')]});
const state = emptyGroup();
let events = 0, rejected = 0;
for (const [index, check] of summary.checks.entries()) {
  const transaction = JSON.parse(readFileSync(`${directory}/finalized-${index}.json`, 'utf8'));
  const decoded = decodeGroup(check.signature, transaction, authority, summary.keys.group);
  if (transaction.meta.err !== null) {assert.equal(decoded.length, 0); rejected++;}
  for (const event of decoded) {
    try {projectGroup(state, event, summary.keys.group, state.group?.domain ?? event.data.domain);}
    catch (error) {throw new Error(`${check.label} sequence ${event.data.sequence} (${event.type}): ${error}`, {cause:error});}
    events++;
  }
}
writeFileSync(`${directory}/p21-projection-regression.json`, json({source:summary.revision, events, rejected, state}));
console.log(json({kind:'retained-history-regression-only', events, rejected, sequence:state.sequence, roots:state.members.length}));
