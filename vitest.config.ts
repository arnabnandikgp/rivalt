import { configDefaults, defineConfig } from 'vitest/config';

// Fresh operator checkouts and retained local evidence are not workspace tests.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, '.local/**', '.tools/**'] } });
