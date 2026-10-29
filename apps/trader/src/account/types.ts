import type { AccountUserConfig,LiquidityUserConfig } from '@rivalt/sdk';
export type AccountTraderConfig = (AccountUserConfig|LiquidityUserConfig) & { apiBase: '/api'; readBase: '/read'; demo?: boolean };
