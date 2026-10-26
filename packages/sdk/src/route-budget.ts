import { address, type Instruction } from '@solana/kit';
import { ComputeBudgetProgram } from '@solana/web3.js';
export const ROUTE_COMPUTE_UNITS = 400_000;
/** P04 measured local envelope; priority fee remains explicitly caller-owned. */
export function routeComputeBudget(): Instruction {
  const ix = ComputeBudgetProgram.setComputeUnitLimit({ units: ROUTE_COMPUTE_UNITS });
  return { programAddress: address(ix.programId.toBase58()), accounts: [], data: ix.data };
}
/** Fully specify wallet fees before preview so providers need not add defaults. */
export function zeroPriorityFee(): Instruction {
  const ix = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0n });
  return { programAddress: address(ix.programId.toBase58()), accounts: [], data: ix.data };
}
export function walletComputeBudget(instructions: Instruction[], units: 400_000 | 600_000 | 700_000 | 1_200_000 = 400_000): Instruction[] {
  const limit = units === 400_000 ? routeComputeBudget() : units === 600_000 ? groupRouteComputeBudget() : units === 700_000 ? groupTransferRouteComputeBudget() : resolutionComputeBudget(), price = zeroPriorityFee(), seen = new Set<string>();
  const equal = (a: Instruction, b: Instruction) => a.data?.length === b.data?.length && a.data?.every((v, i) => v === b.data![i]);
  const economic = instructions.filter(ix => {
    if (ix.programAddress !== limit.programAddress) return true;
    const kind = equal(ix, limit) ? 'limit' : equal(ix, price) ? 'price' : null;
    if (!kind || ix.accounts?.length || seen.has(kind)) throw new Error('Unsupported or duplicate wallet compute budget.');
    seen.add(kind); return false;
  });
  return [limit, price, ...economic];
}
/** G08 bounded full-maker impact search. Measured independently from route CU. */
export function fundingComputeBudget(): Instruction {
  const ix = ComputeBudgetProgram.setComputeUnitLimit({units:1_200_000});
  return {programAddress:address(ix.programId.toBase58()),accounts:[],data:ix.data};
}

/** G10 page ceiling; acceptance requires at least 20% measured headroom. */
export function resolutionComputeBudget(): Instruction {
  const ix=ComputeBudgetProgram.setComputeUnitLimit({units:1_200_000});
  return {programAddress:address(ix.programId.toBase58()),accounts:[],data:ix.data};
}

/** P18C candidate envelope for two authenticated V2 maker hashes and root events.
 * Final measured acceptance, not this declared limit, establishes headroom. */
export const GROUP_ROUTE_COMPUTE_UNITS = 600_000;
export function groupRouteComputeBudget(): Instruction {
  const ix = ComputeBudgetProgram.setComputeUnitLimit({ units: GROUP_ROUTE_COMPUTE_UNITS });
  return { programAddress: address(ix.programId.toBase58()), accounts: [], data: ix.data };
}

/** P20 owner cash transfer + two-maker route, with all four cross order slots
 * occupied. This combined transaction has a separately measured CU envelope. */
export const GROUP_TRANSFER_ROUTE_COMPUTE_UNITS = 700_000;
export function groupTransferRouteComputeBudget(): Instruction {
  const ix = ComputeBudgetProgram.setComputeUnitLimit({ units: GROUP_TRANSFER_ROUTE_COMPUTE_UNITS });
  return { programAddress: address(ix.programId.toBase58()), accounts: [], data: ix.data };
}
