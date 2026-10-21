/** Monetary input and labels never pass through a floating-point number. */
export function units(input: string, decimals: number, label = 'Amount'): bigint {
  const value = input.trim();
  if (!new RegExp(`^(0|[1-9][0-9]*)(?:\\.[0-9]{1,${decimals}})?$`).test(value))
    throw new Error(`${label} needs a positive decimal with at most ${decimals} places.`);
  const [whole, fraction = ''] = value.split('.'),
    n = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  if (n <= 0n || n > 1_000_000_000_000_000n)
    throw new Error(`${label} is outside the supported amount range.`);
  return n;
}
export function integer(input: string, label: string, max: bigint): bigint {
  if (!/^[1-9][0-9]*$/.test(input.trim())) throw new Error(`${label} must be a positive whole number.`);
  const n = BigInt(input);
  if (n > max) throw new Error(`${label} exceeds the supported limit.`);
  return n;
}
export function fixed(value: bigint | string | number | null | undefined, decimals = 6, trim = true): string {
  if (value === null || value === undefined) return '—';
  const n = BigInt(value),
    a = n < 0n ? -n : n,
    scale = 10n ** BigInt(decimals);
  const whole = (a / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','),
    fraction = (a % scale).toString().padStart(decimals, '0');
  const tail = trim ? fraction.replace(/0+$/, '') : fraction;
  return `${n < 0n ? '−' : ''}${whole}${decimals && tail ? '.' + tail : ''}`;
}
export function rational(n: bigint | string, d: bigint | string, places = 2): string {
  const numerator = BigInt(n),
    denominator = BigInt(d);
  if (denominator <= 0n) return '—';
  const scale = 10n ** BigInt(places);
  return fixed((numerator * scale + denominator / 2n) / denominator, places, false);
}
export const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
