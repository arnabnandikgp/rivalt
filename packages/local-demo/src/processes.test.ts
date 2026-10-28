import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {expect,it} from 'vitest';
import {watchSupervisor} from './processes.js';

it.each([0,1])('detects a real early supervisor exit (%s) without a status server',async code=>{
  const child=spawn(process.execPath,['-e',`process.exit(${code})`],{stdio:'ignore',detached:true});
  const check=watchSupervisor(child,'supervisor.log');
  expect(check).not.toThrow();
  await once(child,'exit');
  expect(check).toThrow(`Demo supervisor exited before startup (${code}); inspect supervisor.log`);
});

it('handles a spawn error without an unhandled error event or startup polling',async()=>{
  const child=spawn('/missing-rivalt-demo-supervisor',[],{stdio:'ignore',detached:true});
  const check=watchSupervisor(child,'supervisor.log');
  await once(child,'error');
  expect(check).toThrow('Demo supervisor could not start; inspect supervisor.log');
});
