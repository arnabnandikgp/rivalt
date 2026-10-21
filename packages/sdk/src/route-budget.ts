import { address, type Instruction } from '@solana/kit';
import { ComputeBudgetProgram } from '@solana/web3.js';
export const ROUTE_COMPUTE_UNITS = 400_000;
/** P04 measured local envelope; priority fee remains explicitly caller-owned. */
export function routeComputeBudget(): Instruction {
  const ix = ComputeBudgetProgram.setComputeUnitLimit({ units: ROUTE_COMPUTE_UNITS });
  return { programAddress: address(ix.programId.toBase58()), accounts: [], data: ix.data };
}
