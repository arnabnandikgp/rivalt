// Decode finalized originals at their actual slots. The independent Rust fold
// gets the original observation and touch times. Its expected indices come
// directly from the two route effects and the post-gap market account.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {getProgramDerivedAddress} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {decodeAccountInvocations} from '../../packages/indexer/src/account-events.js';

const directory=process.argv[2];
assert(directory,'Supply a completed cross-market funding run directory.');
const {binding,state}=JSON.parse(readFileSync(join(directory,'sql-cross-market-funding-snapshot.json'),'utf8'));
assert.equal(binding.artifactSet,sdk.BOUNDED_MARKET_ARTIFACT_SET);
const [eventAuthority]=await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds:[Buffer.from('__event_authority')]});
const fills=[];
for(const name of readdirSync(directory).filter(value=>/^transaction-\d+\.json$/.test(value))){
  const tx=JSON.parse(readFileSync(join(directory,name),'utf8'));
  for(const invocation of decodeAccountInvocations(tx.transaction.signatures[0],tx,0,{...binding,eventAuthority})){
    for(const event of invocation.events.filter(value=>value.type==='LiquidityRouteFeeRecorded'))fills.push({slot:tx.slot,data:event.data});
  }
}
fills.sort((left,right)=>left.slot-right.slot);
assert.equal(fills.length,2);
const [first,second]=fills;
const eth=state.venue.markets[1];
assert.equal(first.data.market,eth);
assert.equal(second.data.market,state.venue.markets[0]);
assert.equal(second.data.otherMarketState.__option,'Some');
const source=first.data.marketState, sibling=second.data.otherMarketState.value;
assert.equal(sibling.index,1);
assert.equal(source.observationSequence,sibling.observationSequence);
assert.deepEqual(source.oracle,sibling.oracle);
const recovered=state.markets[eth], window=source.oracle;
assert.equal(recovered.oracle.outcome,3);
const input=[1,source.configEpoch,source.observationSequence,source.validFrom,window.sampledAt,window.heldUntil,
  window.heldSlot,window.fundingBase,window.premiumScaled,first.slot,source.fundingTime,source.fundingIndexScaled,
  second.slot,sibling.fundingTime,sibling.fundingIndexScaled,recovered.validFrom,recovered.oracle.fundingBase];
process.stdout.write(execFileSync('target/debug/examples/funding_prefix_replay',[],{input:input.join(' '),encoding:'utf8'}));
