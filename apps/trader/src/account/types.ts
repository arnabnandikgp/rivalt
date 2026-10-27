import type { AccountUserConfig } from '@rivalt/sdk';
export type AccountTraderConfig = AccountUserConfig & { apiBase: '/api'; readBase: '/read' };
