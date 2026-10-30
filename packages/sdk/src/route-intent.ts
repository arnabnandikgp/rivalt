/** User limits shared by routing, wallet signing and stored-order execution. */
export type MarginStoredFill={id:bigint;version:bigint;filled:bigint};
export type MarginRouteIntent={marketIndex:0|1;side:0|1;lots:bigint;maxFee:bigint;allInLimit:bigint;reduceOnly?:boolean;stored?:MarginStoredFill};
