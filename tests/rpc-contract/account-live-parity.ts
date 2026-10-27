import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import * as sdk from '@rivalt/sdk';
const names=['AccountCustodyChangedV3','AccountMakerChangedV3','AccountOracleChangedV3','AccountQualificationV3',
  'AccountOrderChangedV3','AccountAuthorityChangedV3','AccountRouteExecutedV3','AccountFinancialChangedV3','AccountBackingChangedV3',
  'AccountLiquidatedV3','AccountResolutionAppliedV3','AccountResolutionCompletedV3','AccountResolutionFrozenV3',
  'AccountResolutionOrderV3','AccountResolutionPlannedV3','AccountResolutionProgressV3','AccountResolutionProposalV3',
  'AccountResolutionRatesV3','AccountResolutionRoundedV3','AccountResolutionValuedV3','AccountRetirementProgressV3',
  'AccountSafetyRecoveryV3','AccountsRetiredV3','RetiredReserveWithdrawnV3'];
export function decodeAccountEvent(bytes:Uint8Array) {
  for(const name of names) {
    const discriminator=name.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toUpperCase()+'_EVENT_DISCRIMINATOR';
    if(Buffer.from(bytes).subarray(0,8).equals(Buffer.from((sdk as any)[discriminator]))) {
      return {name,data:(sdk as any)[`parse${name}Event`](bytes)};
    }
  }
  return null;
}
export function canonical(value:unknown):unknown {
  if(typeof value==='bigint')return value.toString();
  if(value instanceof Uint8Array)return [...value];
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object' && '__option' in value) {
    if(value.__option==='None')return null;
    assert(value.__option==='Some' && 'value' in value);return canonical(value.value);
  }
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='discriminator')
    .map(([key,item])=>[key,canonical(item)]));
  return value;
}
export function accountLiveParity(directory:string,accounts:{program:string;name:string;bytes:string}[],eventBytes:string[]) {
  const file=`${directory}/legacy-input.json`;
  writeFileSync(file,JSON.stringify({accounts,events:eventBytes.map(bytes=>({program:'clearing',bytes}))}));
  const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/group-trading.cjs',file],{encoding:'utf8'}));
  for(const [index,account] of accounts.entries()) {
    const api=account.program==='clearing'?sdk:account.program==='maker_a'?sdk.makerA:sdk.makerB;
    const name=account.name[0].toUpperCase()+account.name.slice(1);
    assert.deepEqual(legacy.accounts[index],canonical((api as any)[`get${name}Decoder`]().decode(Buffer.from(account.bytes,'base64'))),account.name);
  }
  for(const [index,bytes] of eventBytes.entries())assert.deepEqual(legacy.events[index].data,
    canonical(decodeAccountEvent(Buffer.from(bytes,'base64'))!.data),`committed event ${index}`);
  return {accounts:accounts.length,events:eventBytes.length,accountTypes:[...new Set(accounts.map(account=>`${account.program}:${account.name}`))]};
}
