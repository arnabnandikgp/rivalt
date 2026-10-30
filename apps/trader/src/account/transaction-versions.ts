/** Profile 4 can choose v0 or v1 according to the complete wire size. */
export function supportsAccountTransactions(profile:4,versions?:ReadonlySet<number|'legacy'>|null) {
  return Boolean(profile===4&&versions?.has(0)&&versions.has(1));
}
