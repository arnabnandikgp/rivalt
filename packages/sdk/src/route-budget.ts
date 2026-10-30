import { address, type Instruction } from '@solana/kit';
import { ComputeBudgetProgram } from '@solana/web3.js';
export const ROUTE_COMPUTE_UNITS = 400_000;
/** Current cash-action envelope; priority fees are explicit. */
export function routeComputeBudget(): Instruction {
  const ix = ComputeBudgetProgram.setComputeUnitLimit({ units: ROUTE_COMPUTE_UNITS });
  return { programAddress: address(ix.programId.toBase58()), accounts: [], data: ix.data };
}
/** Fully specify wallet fees before preview so providers need not add defaults. */
export function zeroPriorityFee(): Instruction {
  const ix = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0n });
  return { programAddress: address(ix.programId.toBase58()), accounts: [], data: ix.data };
}
export function walletComputeBudget(instructions: Instruction[], units: 400_000 | 600_000 | 800_000 | 1_200_000 = 400_000): Instruction[] {
  const instruction=ComputeBudgetProgram.setComputeUnitLimit({units});
  const limit:Instruction={programAddress:address(instruction.programId.toBase58()),accounts:[],data:instruction.data},price=zeroPriorityFee(),seen=new Set<string>();
  const loadedInstruction=ComputeBudgetProgram.setLoadedAccountsDataSizeLimit({accountDataSizeLimit:8*1024*1024});
  const loaded:Instruction={programAddress:limit.programAddress,accounts:[],data:loadedInstruction.data};
  const equal = (a: Instruction, b: Instruction) => a.data?.length === b.data?.length && a.data?.every((v, i) => v === b.data![i]);
  const economic = instructions.filter(ix => {
    if (ix.programAddress !== limit.programAddress) return true;
    const kind = equal(ix, limit) ? 'limit' : equal(ix, price) ? 'price' : equal(ix, loaded) ? 'loaded' : null;
    if (!kind || ix.accounts?.length || seen.has(kind)) throw new Error('Unsupported or duplicate wallet compute budget.');
    seen.add(kind); return false;
  });
  return [limit, loaded, price, ...economic];
}
/** G10 page ceiling; acceptance requires at least 20% measured headroom. */
export function resolutionComputeBudget(): Instruction {
  const ix=ComputeBudgetProgram.setComputeUnitLimit({units:1_200_000});
  return {programAddress:address(ix.programId.toBase58()),accounts:[],data:ix.data};
}

/** Liquidation candidate envelope; acceptance measures actual headroom. */
export const LIQUIDATION_COMPUTE_UNITS = 600_000;
export function liquidationComputeBudget(): Instruction {
  const ix = ComputeBudgetProgram.setComputeUnitLimit({ units: LIQUIDATION_COMPUTE_UNITS });
  return { programAddress: address(ix.programId.toBase58()), accounts: [], data: ix.data };
}
