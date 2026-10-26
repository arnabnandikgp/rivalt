import assert from 'node:assert/strict';
import type {Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {GroupTradingHarness} from './group-trading-cases.js';
import type {groupSafetyCases} from './group-safety-cases.js';

/** Activated-path checks include registration/curve bytes, not only root cash. */
export async function groupRouteNegatives(h:GroupTradingHarness,lifecycle:Awaited<ReturnType<typeof groupSafetyCases>>) {
  const {fixture,route,protectedKeys}=lifecycle;
  const keys=[...protectedKeys(),...fixture.makers.flat().flatMap(maker=>[maker.registration,maker.config,maker.groupBinding])];
  const snapshot=()=>Promise.all(keys.map(h.read));
  async function reject(label:string,instruction:Instruction,error:number,signer=fixture.owner) {
    const before=await snapshot();await h.send(label,[instruction],[signer],error);
    assert.deepEqual(await snapshot(),before,`${label}: balances, nonces, orders, registrations and curve state rollback`);
  }
  const quoted=await route(0,0,[2n,3n]);
  const {intent}=sdk.getExecuteGroupRouteV2InstructionDataDecoder().decode(quoted.instruction.data!);
  const changed=(next:sdk.RouteIntentArgs)=>({...quoted.instruction,data:sdk.getExecuteGroupRouteV2InstructionDataEncoder().encode({intent:next})});
  await reject('reject live route fee below aggregate charge',changed({...intent,maxFee:0n}),sdk.CLEARING_ERROR__ROUTE_LIMIT);
  await reject('reject stale second maker quote epoch',changed({...intent,legs:[intent.legs[0],{...intent.legs[1],quoteEpoch:intent.legs[1].quoteEpoch+1n}]}),sdk.CLEARING_ERROR__ROUTE_LIMIT);
  const [first,second]=fixture.makers[0];
  const wrongConfig={...quoted.instruction,accounts:quoted.instruction.accounts!.map(account=>account.address===second.config
    ?{...account,address:fixture.makers[1][1].config}:account)};
  await reject('reject foreign-market second config after first CPI',wrongConfig,sdk.CLEARING_ERROR__MAKER_BINDING);
  const aliases=new Map([[second.capital,first.capital],[second.registration,first.registration],[second.pricingProgram,first.pricingProgram],
    [second.programData,first.programData],[second.config,first.config]]);
  await reject('reject duplicate maker legs',{...quoted.instruction,accounts:quoted.instruction.accounts!.map(account=>({...account,address:aliases.get(account.address)??account.address}))},2040);
  const foreign={...quoted.instruction,accounts:quoted.instruction.accounts!.map(account=>account.address===fixture.owner.address
    ?{...account,address:fixture.payer.address}:account)};
  await reject('reject foreign immediate route actor',foreign,sdk.CLEARING_ERROR__AUTHORITY,fixture.payer);
  const self=await route(0,0,[2n,3n],false,first.capital,first.owner);
  await reject('reject maker self trade through route',self.instruction,2040,first.owner);
}
