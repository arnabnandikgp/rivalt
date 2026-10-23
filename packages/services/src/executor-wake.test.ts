import { expect, it, vi } from 'vitest';
import { WakeSignal } from './executor-wake.js';
it('does not lose a notification arriving during a durable queue scan',async()=>{
  vi.useFakeTimers();
  try { const wake=new WakeSignal(),observed=wake.version;wake.notify();let done=false;
    await wake.wait(observed).then(()=>{done=true;});expect(done).toBe(true);expect(vi.getTimerCount()).toBe(0);
  } finally {vi.useRealTimers();}
});
it('wakes a sleeping executor and retains a bounded fallback for lost notifications',async()=>{
  vi.useFakeTimers();
  try {const wake=new WakeSignal();let done=false;const first=wake.wait(wake.version).then(()=>{done=true;});
    await vi.advanceTimersByTimeAsync(100);expect(done).toBe(false);wake.notify();await first;expect(done).toBe(true);expect(vi.getTimerCount()).toBe(0);
    done=false;const second=wake.wait(wake.version).then(()=>{done=true;});await vi.advanceTimersByTimeAsync(249);expect(done).toBe(false);await vi.advanceTimersByTimeAsync(1);await second;expect(done).toBe(true);
  } finally {vi.useRealTimers();}
});
