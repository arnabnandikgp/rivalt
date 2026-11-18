import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {AccountSnapshot, accountBalanceView} from '@rivalt/sdk';
import {Positions} from '../src/shared/Panels.js';

export function renderPayoutPositions(snapshot:AccountSnapshot, view:ReturnType<typeof accountBalanceView>) {
  return renderToStaticMarkup(createElement(Positions,{controller:{snapshot,view}}));
}
