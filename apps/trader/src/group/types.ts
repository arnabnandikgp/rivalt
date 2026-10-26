import type { GroupUserConfig } from '@rivalt/sdk';
export type GroupTraderConfig = GroupUserConfig & {
  apiBase: '/api';
  readBase: '/read';
};
