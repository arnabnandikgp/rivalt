/** Identify quoted maker positions that cannot fit the pre-funded profit history on a refused fill. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as sdk from '@rivalt/sdk';

const directory = process.argv[2];
assert(directory, 'Pass a completed rotating BTC workload');
const read = (name: string) => JSON.parse(readFileSync(join(directory, name + '.json'), 'utf8'));
const run = read('router-load');
assert(run.rotatingAsks && run.btcPercent === 100, 'This diagnostic expects BTC buys');
type AccountRead = {keys: string[]; response: {value: {data: [string, string]}[]}};
function slotWidths(checkpoint: string) {
  const snapshot = read('sql-' + checkpoint + '-snapshot');
  const widths = new Map<string, number>();
  for (const batch of snapshot.reads as AccountRead[]) {
    for (const [index, address] of batch.keys.entries()) {
      if (!Object.hasOwn(snapshot.state.roots, address)) continue;
      const [wire, encoding] = batch.response.value[index].data;
      assert.equal(encoding, 'base64');
      widths.set(address, sdk.decodeProfitAttribution(Buffer.from(wire, 'base64'), true).width);
    }
  }
  assert.equal(widths.size, Object.keys(snapshot.state.roots).length);
  return widths;
}
const before = slotWidths('ready');
assert.deepEqual(before, slotWidths('drained'), 'Capacity changed during this workload');
const makers = new Set<string>([sdk.makerA.MAKER_A_PROGRAM_ADDRESS, sdk.makerB.MAKER_B_PROGRAM_ADDRESS]);
const quote = sdk.makerA.getMakerQuoteResponseDecoder();
const outcomes: string[] = [];
const examples = new Map<string, number>();
function classify(error: {InstructionError?: [number, {Custom?: number}]} | null, logs: string[]) {
  if (error?.InstructionError?.[1]?.Custom !== sdk.CLEARING_ERROR__CAPACITY) return;
  const tooSmall = new Set<string>();
  for (const line of logs) {
    const match = /^Program return: (\S+) (\S+)$/.exec(line);
    if (!match || !makers.has(match[1])) continue;
    const { request } = quote.decode(Buffer.from(match[2], 'base64'));
    assert.equal(request.side, 0);
    assert(request.lots > 0n);
    const after = request.inventory - request.lots;
    if (after >= 0n) continue;
    // An open position needs three nonzero magnitude bounds and three u16 lengths.
    // Each bound adds 2 * next_power_of_two(abs(lots)) - 2 bits for future recovery.
    let power = 1n;
    while (power < -after) power *= 2n;
    const recoveryBits = 2n * power - 2n;
    const bytesPerMagnitude = (1n + recoveryBits + 7n) / 8n;
    const minimumBytes = 6n + 3n * bytesPerMagnitude;
    const width = before.get(request.capital);
    assert(width !== undefined, 'Quoted capital absent from the reconciled checkpoint');
    if (minimumBytes <= BigInt(width)) continue;
    tooSmall.add(`maker ${request.instance}, ${width} bytes, requires at least ${minimumBytes}`);
    const example = `${request.inventory} to ${after} lots`;
    examples.set(example, (examples.get(example) ?? 0) + 1);
  }
  outcomes.push([...tooSmall].sort().join(' + ') || 'unattributed');
}
for (const filename of readdirSync(directory).filter(name => /^wallet-preview-\d+\.json$/.test(name))) {
  const preview = read(filename.slice(0, -5));
  classify(preview.error, preview.logs);
}
for (const row of run.receipts) {
  if (row.role !== 'trader' || !row.error) continue;
  const receipt = read('landed-' + row.signature);
  assert.equal(receipt.slot, row.slot);
  assert.deepEqual(receipt.meta.err, row.error);
  classify(receipt.meta.err, receipt.meta.logMessages);
}
const reasons: Record<string, number> = {};
for (const outcome of outcomes) reasons[outcome] = (reasons[outcome] ?? 0) + 1;
console.log(JSON.stringify({ capacityRefusals: outcomes.length, reasons, quotedInventory: Object.fromEntries(examples) }));
