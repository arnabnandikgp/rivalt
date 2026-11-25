import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as sdk from '@rivalt/sdk';
import {readCoherentAccounts} from '../../packages/sdk/src/coherent-accounts.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {provisionCanonicalMakers,symmetricPayoutShape} from './canonical-maker-cases.js';
import {routerBuild} from './execution-router-build.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const directory=process.env.RIVALT_RUN_DIR!;
const build=routerBuild();
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,
  directory,{deferFinality:true});
let journal: Awaited<ReturnType<typeof openSettlementJournal>>|undefined;
try {
  const counts=[16,32] as const;
  const fixture=await provisionCanonicalMakers(h,symmetricPayoutShape,[0,1],100_000_000n,64n,counts);
  const markets=[];
  for (const index of [0,1] as const) {
    const market=fixture.markets[index], count=counts[index];
    const last=fixture.instances.filter(maker=>maker.market===market).at(-1)!;
    await last.publish(fixture.updater,30_000n);
    const discovery=await sdk.discoverLiquidityAccounts(rpc,fixture.venue,market,'confirmed','ledger-lanes');
    const keys=[...new Set([sdk.ACCOUNT_CLOCK,...discovery.keys,...discovery.capitals])];
    const batch=await readCoherentAccounts(rpc,keys,'confirmed',discovery.contextSlot);
    const accounts=new Map(keys.map((key,id)=>[key,batch.value[id]]));
    const clock=Buffer.from(accounts.get(sdk.ACCOUNT_CLOCK).data[0],'base64');
    const {adapters}=await sdk.authenticateLiquidityMarket({venue:fixture.venue,market,marketIndex:index,domain:fixture.domain,
      now:clock.readBigInt64LE(32),slot:clock.readBigUInt64LE(0),contextSlot:BigInt(batch.context.slot),marginLayout:'ledger-lanes'},accounts);
    assert.equal(adapters.length,count);
    assert.equal(new Set(adapters.map(maker=>maker.capital.owner)).size,count);
    assert.equal(new Set(adapters.map(maker=>maker.registrationState.capital)).size,count);
    const lastBook=adapters[count-1];
    assert.equal(lastBook.registration,last.registration);
    assert.equal(lastBook.price.anchor,30_000n);
    await h.quote('signed final registered maker quote '+index,await last.request(0,3n),90_006n);
    markets.push({marketIndex:index,registrations:count,distinctOwners:count,dependencies:keys.length,contextSlot:batch.context.slot});
  }
  await flush();
  journal=await openSettlementJournal(rpc,fixture,checks.map(check=>String(check.signature)),build);
  await journal.checkpoint('wide-directory',true);
  const replay=await journal.finish();
  writeFileSync(directory+'/wide-directory.json',JSON.stringify({build,markets,events:replay.events},null,2));
  console.log(markets,replay.events,'replayed events');
} finally {
  await journal?.close();
  try {await flush();} finally {ws.close();}
}
