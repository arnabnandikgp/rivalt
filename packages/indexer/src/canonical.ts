import type {ReadonlyUint8Array} from '@solana/kit';
export type Canonical<T> = T extends bigint | string ? string : T extends ReadonlyUint8Array ? string :
  T extends readonly (infer Item)[] ? Canonical<Item>[] : T extends object ? { [Key in keyof T]: Canonical<T[Key]> } : T;
