/** Profile 4 can choose v0 or v1 according to the complete wire size. */
export function supportsAccountTransactions(profile:3|4,versions?:ReadonlySet<number|'legacy'>|null) {
  return Boolean(versions?.has(0)&&(profile===3||versions.has(1)));
}
