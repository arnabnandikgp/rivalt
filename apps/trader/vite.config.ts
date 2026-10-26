import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const publicKeys = ['version', 'chain', 'profile', 'rpcUrl', 'wsUrl', 'genesis', 'anchor', 'anchorHash', 'market', 'group', 'mint', 'domain'];
const configure = (server: any) => {
  server.middlewares.use('/rivalt-config.json', (_req: any, res: any) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    try {
      const source = JSON.parse(
        readFileSync(resolve(process.env.RIVALT_TRADER_CONFIG ?? '../../.local/trader-config.json'), 'utf8'),
      );
      res.end(
        JSON.stringify({
          ...Object.fromEntries(publicKeys.map((k) => [k, source[k]])),
          apiBase: '/api',
          readBase: '/read',
        }),
      );
    } catch {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: 'Public test deployment configuration unavailable.' }));
    }
  });
};
const proxy = {
  '/api': {
    target: process.env.RIVALT_SERVICE_ORIGIN ?? 'http://127.0.0.1:18081',
    rewrite: (p: string) => p.replace(/^\/api/, ''),
  },
  '/read': {
    target: process.env.RIVALT_INDEXER_ORIGIN ?? 'http://127.0.0.1:18084',
    rewrite: (p: string) => p.replace(/^\/read/, ''),
  },
};
export default defineConfig({
  plugins: [
    {
      name: 'public-local-deployment',
      configureServer: configure,
      configurePreviewServer: configure,
    } as Plugin,
  ],
  server: { proxy },
  preview: { proxy },
  build: { target: 'es2022', sourcemap: true },
});
