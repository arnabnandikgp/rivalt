import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {accountUserAuthority} from '../../packages/services/src/account-ingress.js';
import type {Keypair} from '@solana/web3.js';
import {multiDeploymentFor,routerBuild} from './execution-router-build.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const directory=process.env.RIVALT_RUN_DIR!,build=routerBuild();
const deployment=multiDeploymentFor(build.artifactSet);
const timed=(label:string)=>label.startsWith('width ');
const feePayers=new Map<string,Keypair>();
let venue='',known:Awaited<ReturnType<typeof sdk.venueMarketCheckpoints>>=[];
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,{
  payerFor:label=>feePayers.get(label),
  beforeBroadcast:async(label,bytes)=>{if(timed(label))assert.equal(accountUserAuthority(bytes,venue,4,known,deployment)?.kind,'accountStateVersion');},
  deferFinality:true,heapSize:label=>timed(label)?128*1024:undefined,computeUnitLimit:label=>timed(label)?800_000:undefined,
  observeOutcomes:timed,measureComputeBoundary:timed,
});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined;
try {
  const setup=await liquidityExecutionSetup(h,rpc,{makerCounts:[8,8],marketCheckpoints:true,marginLayout:'ledger-lanes',
    traderCount:2,independentTraders:true,makerCash:500_000_000_000n,traderCash:500_000_000_000n,verifyRejections:false,
    shape:id=>{
      const regions=[{endLots:65_000n,offset:2n+2n*BigInt(id),slope:0n},...symmetricPayoutShape.asks.slice(1)];
      return {...symmetricPayoutShape,bids:regions,asks:regions,shortCap:8_000_000n,longCap:8_000_000n};
    }});
  venue=setup.venue;known=await sdk.venueMarketCheckpoints(setup.venue,true);
  const results=[];
  for(const index of [0,1] as const){
    const width=index===0?4:8,quantity=BigInt(width-1)*65_000n+33_935n;
    const trader=setup.roots[index],owner=setup.traderOwners[index],ref=index===0?60_000n:30_000n;
    const makers=setup.instances.filter(maker=>maker.market===setup.markets[index]);
    await setup.sample();
    const snap=await setup.snapshot(trader,index);
    const quantities:bigint[]=makers.map((_,id)=>id<width-1?65_000n:id===width-1?33_935n:0n);
    const gross=quantities.reduce((sum,lots,id)=>sum+lots*(ref+2n+BigInt(id)*2n),0n),fee=(gross+4999n)/5000n;
    const order=await sdk.buildMultiMakerRoute({snapshot:snap,trader,marketIndex:index,side:0,lots:quantity,
      maxFee:fee,allInLimit:gross+fee},owner.address,width,deployment);
    assert.deepEqual(order.candidateInstances,Array.from({length:width},(_,id)=>id));
    const label='width '+width+' independent market buy';
    feePayers.set(label,owner);
    await h.send(label,order.instructions,[owner]);
    await flush();
    const tx=checks.find(row=>row.label===label)!;
    assert.equal(tx.signatures,1);
    assert.equal(tx.error,null,label);
    const after=await setup.snapshot(trader,index);
    assert.equal(after.roots[trader].positions[index].lots,quantity);
    assert.equal(after.roots[trader].positions[index].virtualScaled,-gross*1_000_000_000n);
    assert.equal(after.roots[trader].cash,snap.roots[trader].cash-fee);
    assert.deepEqual(await Promise.all(makers.map(async maker=>(await maker.registrationState()).buyConsumed)),quantities);
    results.push({width,quantity,quantities,gross,fee,tx});
  }
  journal=await openSettlementJournal(rpc,setup,checks.map(row=>String(row.signature)),build);
  await journal.checkpoint('measured-fanout',true);
  const replay=await journal.finish();
  writeFileSync(directory+'/multi-width.json',json({build,results,events:replay.events,reconciliation:replay.reconciliation}));
  console.log(results.map(row=>[row.width,row.tx.error,row.tx.computeUnits]),replay.events);
}finally{
  await journal?.close();
  try {await flush();} finally{ws.close();}
}
