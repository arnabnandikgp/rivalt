import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {liquidityMakerEconomics} from './liquidity-economics.js';
const [input,output]=process.argv.slice(2);assert(input&&output,'Usage: pnpm liquidity:report <captured-input.json> <new-report.json>');
const report=liquidityMakerEconomics(JSON.parse(readFileSync(input,'utf8')));
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({output,reconciliation:report.reconciliation,independentMakerValidation:false}));
