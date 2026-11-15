import { describe, expect, it } from 'vitest';
import { POST_FRAME_FALLBACK_MS, schedulePostFrameWith, type PostFrameClock } from './post-frame.js';

function manualClock(withFrames: boolean) {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const frames = new Map<number, () => void>();
  const clock: PostFrameClock<number> = {
    requestFrame: withFrames
      ? (callback) => {
          const handle = nextHandle++;
          frames.set(handle, callback);
          return handle;
        }
      : null,
    cancelFrame: withFrames
      ? (handle) => {
          frames.delete(handle);
        }
      : null,
    setTimer: (run, delayMs) => {
      const handle = nextHandle++;
      timers.set(handle, { at: now + delayMs, run });
      return handle;
    },
    clearTimer: (handle) => {
      timers.delete(handle);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [handle, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > now || !timers.has(handle)) continue;
      timers.delete(handle);
      timer.run();
    }
  };
  const frame = () => {
    const due = [...frames.values()];
    frames.clear();
    for (const callback of due) callback();
  };
  return { clock, advance, frame, pendingTimers: () => timers.size, pendingFrames: () => frames.size };
}

describe('schedulePostFrame', () => {
  it('runs after the next frame, not inside the scheduling task', () => {
    const env = manualClock(true);
    const ran: string[] = [];
    schedulePostFrameWith(() => ran.push('run'), env.clock);
    env.advance(0);
    expect(ran).toEqual([]);
    env.frame();
    expect(ran).toEqual([]);
    env.advance(0);
    expect(ran).toEqual(['run']);
    env.advance(POST_FRAME_FALLBACK_MS);
    expect(ran).toEqual(['run']);
    expect(env.pendingTimers()).toBe(0);
  });

  it('falls back to a timer when no frame arrives', () => {
    const env = manualClock(true);
    const ran: string[] = [];
    schedulePostFrameWith(() => ran.push('run'), env.clock);
    env.advance(POST_FRAME_FALLBACK_MS - 1);
    expect(ran).toEqual([]);
    env.advance(1);
    expect(ran).toEqual(['run']);
    expect(env.pendingFrames()).toBe(0);
    env.frame();
    env.advance(0);
    expect(ran).toEqual(['run']);
  });

  it('uses a zero-delay timer without animation frames', () => {
    const env = manualClock(false);
    const ran: string[] = [];
    schedulePostFrameWith(() => ran.push('run'), env.clock);
    expect(ran).toEqual([]);
    env.advance(0);
    expect(ran).toEqual(['run']);
  });

  it('never runs once cancelled', () => {
    const env = manualClock(true);
    const ran: string[] = [];
    const handle = schedulePostFrameWith(() => ran.push('run'), env.clock);
    env.frame();
    handle.cancel();
    env.advance(POST_FRAME_FALLBACK_MS);
    expect(ran).toEqual([]);
    expect(env.pendingTimers()).toBe(0);
  });
});
