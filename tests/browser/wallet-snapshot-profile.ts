/** Replay public account bytes in Chromium; no validator, wallet extension or network is needed. */
import { resolve } from 'node:path';
import { build, type Plugin } from 'esbuild';
import { chromium } from 'playwright-core';
import { loadSnapshotFixture } from '../performance/wallet-snapshot-fixture.js';
import type * as comparison from './wallet-snapshot-comparison.js';

declare const sdk: typeof comparison, legacy: typeof comparison;
const { bank, identity, wallets, slot, codeAccounts } = loadSnapshotFixture(process.argv.slice(2));

// The control changes only the decoder imported by SDK consumers. The default
// bundle is built directly from the current SDK without any module substitution.
const legacyDecoder: Plugin = {
  name: 'legacy-decoder',
  setup(builder) {
    builder.onResolve({ filter: /\/wallet-client\.js$/ }, () => ({
      path: 'wallet-client', namespace: 'control',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'control' }, () => ({
      resolveDir: process.cwd(),
      contents: `export * from './packages/sdk/src/wallet-client.ts';
        export {decodeWithMapping as fromBase64} from './tests/performance/wallet-snapshot-replay.ts';`,
    }));
  },
};
const browser = await chromium.launch({
  executablePath: process.env.RIVALT_CHROME_PATH ?? chromium.executablePath(),
  args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'],
});
try {
  const page = await browser.newPage();
  // Chromium enables WebCrypto on this localhost origin. Fulfill in memory.
  await page.route('**/*', route => route.request().url() === 'http://localhost/'
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Wallet replay</title>' })
    : route.abort());
  await page.goto('http://localhost/');
  for (const name of ['legacy', 'sdk']) {
    const bundle = await build({
      entryPoints: [resolve('tests/browser/wallet-snapshot-comparison.ts')],
      bundle: true, write: false, format: 'iife', globalName: name, platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: name === 'legacy' ? [legacyDecoder] : [],
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
  }
  const comparisons = await page.evaluate(fixture => sdk.compare(legacy, fixture), {
    accounts: [...bank], identity, slot, wallets, makerProgramData: [...codeAccounts][0],
  });
  console.log(JSON.stringify({ browser: browser.version(), slot, accounts: bank.size, wallets: wallets.length, comparisons }, null, 2));
} finally {
  await browser.close();
}
