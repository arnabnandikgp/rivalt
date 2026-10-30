import type {OrderRecord} from './generated/index.js';
export const activeOrder=(order:Pick<OrderRecord,'state'>)=>order.state===1||order.state===2;
export function orderTriggered(o:any,reference:bigint,slot:bigint){
  return activeOrder(o)&&slot>=BigInt(o.startSlot)&&slot<BigInt(o.expirySlot)&&(o.trigger===0||(o.trigger===1&&reference>=BigInt(o.threshold))||(o.trigger===2&&reference<=BigInt(o.threshold)));
}
