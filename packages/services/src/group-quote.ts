import * as sdk from '@rivalt/sdk';
import {json} from '../../indexer/src/events.js';

export class GroupQuoteUnavailable extends Error {
  constructor(readonly code:string,readonly diagnostic:Record<string,string|number>){super(code);}
}
/** A confirmed original sample can be present before queue finality. It must
 * match the exact group/market observation; missing history is never inferred. */
export function groupSampleMatches(event:any,snapshot:sdk.GroupSnapshot){
  if(event?.group!==snapshot.group||typeof event.market!=='string')return false;
  const index=snapshot.markets.indexOf(event.market),market=snapshot.marketStates[index];if(!market||!event.state)return false;
  const {discriminator,...fields}=market;
  return BigInt(event.sequence)<=snapshot.state.sequence&&json(fields)===json(event.state);
}
