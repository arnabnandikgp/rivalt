/** Signed custody/lifecycle acceptance with the canonical v0/v1 RPC/WS harness. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import * as sdk from '@rivalt/sdk';
import {accountCustodyCases} from './account-custody-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
const directory=process.env.RIVALT_RUN_DIR!;
const source={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  trackedDirty:!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()};
assert.equal(source.trackedDirty,false,'Commit the exact custody verifier before qualification');
const {h,ws,checks,conformance,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,{deferFinality:true});
const json=(value:unknown)=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2)+'\n';
try {
  const result=await accountCustodyCases(h);
  const [members]=await sdk.deriveMemberPage(result.venue,0n);
  const keys=[result.venue,result.registry,result.vault,result.custody,result.safety,members,result.quoteMint,result.userToken,
    ...result.ledgers,...result.markets,...result.roots,...result.portfolios];
  const rawAccounts=Object.fromEntries(await Promise.all(keys.map(async key=>[key,(await h.read(key))!.toString('base64')])));
  await flush();
  const parity=await conformance.finish(directory,[{program:sdk.CLEARING_PROGRAM_ADDRESS,name:'venue',key:result.venue},{program:sdk.CLEARING_PROGRAM_ADDRESS,name:'venueRegistry',key:result.registry},
    {program:sdk.CLEARING_PROGRAM_ADDRESS,name:'marginAccount',key:result.roots[0]},{program:sdk.CLEARING_PROGRAM_ADDRESS,name:'portfolio',key:result.portfolios[0]},{program:sdk.CLEARING_PROGRAM_ADDRESS,name:'memberPage',key:members}],h.read);
  const build=JSON.parse(readFileSync(`${process.env.RIVALT_MEMBERSHIP_ARTIFACT_DIR??process.env.RIVALT_ARTIFACT_DIR!}/build-manifest.json`,'utf8'));
  writeFileSync(`${directory}/summary.json`,json({...source,build,checks,parity,result:{...result,members},rawAccounts,
    wsNotifications:ws.notifications.length,endTrackedDirty:!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()}));
  console.log(`Current custody: ${checks.length} signed outcomes, five Financial roots and exact token exits.`);
}finally {try{await flush();}finally{ws.close();}}
