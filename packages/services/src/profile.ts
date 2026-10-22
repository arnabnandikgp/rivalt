/** Explicit synthetic fee budgets; no top-ups or user collateral deductions. */
export function localBudgets(name = 'smoke', rpcUrl = 'http://127.0.0.1') {
  if (name !== 'smoke' && name !== 'soak24') throw new Error('Unknown local budget profile');
  if (name === 'soak24' && new URL(rpcUrl).hostname !== '127.0.0.1')
    throw new Error('Soak budgets require a loopback test deployment');
  return Object.freeze({ name, operator: name === 'soak24' ? 500_000_000n : 5_000_000n,
    maker: name === 'soak24' ? 5_000_000n : 1_000_000n });
}
