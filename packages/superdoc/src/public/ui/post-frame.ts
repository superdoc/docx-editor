export const POST_FRAME_FALLBACK_MS = 100;

export interface PostFrameHandle {
  cancel(): void;
}

export interface PostFrameClock<Timer> {
  readonly requestFrame: ((callback: () => void) => number) | null;
  readonly cancelFrame: ((handle: number) => void) | null;
  readonly setTimer: (callback: () => void, delayMs: number) => Timer;
  readonly clearTimer: (handle: Timer) => void;
}

const browserClock = (): PostFrameClock<ReturnType<typeof setTimeout>> => {
  const requestFrame = globalThis.requestAnimationFrame;
  const cancelFrame = globalThis.cancelAnimationFrame;
  return {
    requestFrame: typeof requestFrame === 'function' ? (callback) => requestFrame(() => callback()) : null,
    cancelFrame: typeof cancelFrame === 'function' ? (handle) => cancelFrame(handle) : null,
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (handle) => clearTimeout(handle),
  };
};

export function schedulePostFrame(run: () => void): PostFrameHandle {
  return schedulePostFrameWith(run, browserClock());
}

export function schedulePostFrameWith<Timer>(run: () => void, clock: PostFrameClock<Timer>): PostFrameHandle {
  let settled = false;
  let frame: number | null = null;
  let afterFrame: Timer | null = null;
  let fallback: Timer | null = null;
  const cancel = (): void => {
    settled = true;
    if (frame !== null) clock.cancelFrame?.(frame);
    if (afterFrame !== null) clock.clearTimer(afterFrame);
    if (fallback !== null) clock.clearTimer(fallback);
    frame = null;
    afterFrame = null;
    fallback = null;
  };
  const fire = (): void => {
    if (settled) return;
    cancel();
    run();
  };
  if (!clock.requestFrame) {
    afterFrame = clock.setTimer(fire, 0);
    return { cancel };
  }
  fallback = clock.setTimer(fire, POST_FRAME_FALLBACK_MS);
  frame = clock.requestFrame(() => {
    frame = null;
    if (!settled) afterFrame = clock.setTimer(fire, 0);
  });
  return { cancel };
}
