/**
 * The voice window's asks for the Queue on screen, one in flight and at most one queued behind it, so a caller arriving
 * mid-ask gets an answer asked after it came (`../components/voice/useQueueScreen.ts`). Pure: the ask and the clock are
 * passed in.
 *
 * Each caller says when its own time is up. The queued ask starts only while some caller waiting on it still has
 * time: a Queue tool's screen ask, queued behind another call's, is abandoned by its 20 s deadline but would
 * otherwise still have been STARTED once the ask ahead of it settled, work for a call already answered. An ask with none in flight checks the clock too, at the moment it would start,
 * so a caller whose time ran out on its way in starts nothing.
 */

/** Whether a caller's ask was made: `false` when every caller waiting on it was past its time when it would start. */
export interface ScreenAsked {
  readonly asked: boolean;
}

/** The chain one window asks through. */
export interface ScreenAskChain {
  /** Ask for the screen now, or join the ask queued behind the one in flight; `startBy` is when this caller's time is up. */
  readonly asked: (input: { readonly startBy: number }) => Promise<ScreenAsked>;
}

/**
 * A chain over one ask.
 *
 * @param start one ask for the screen, settling once its answer, or why there is none, is held
 * @param nowMs the monotonic clock in milliseconds (`performance.now()`), the one every `startBy` is read on
 * @returns the chain
 */
export function screenAskChain({ start, nowMs }: { start: () => Promise<void>; nowMs: () => number }): ScreenAskChain {
  let running: Promise<void> | undefined;
  let next: Promise<ScreenAsked> | undefined;
  let nextBy = Number.NEGATIVE_INFINITY;
  const skipped: ScreenAsked = { asked: false };
  const run = (): Promise<ScreenAsked> => {
    const one = start().finally(() => {
      if (running === one) {
        running = undefined;
      }
    });
    running = one;
    return one.then(() => ({ asked: true }));
  };
  return {
    asked: ({ startBy }) => {
      if (next !== undefined) {
        nextBy = Math.max(nextBy, startBy);
        return next;
      }
      if (running === undefined) {
        if (nowMs() >= startBy) {
          return Promise.resolve(skipped);
        }
        return run();
      }
      nextBy = startBy;
      next = running.then(() => {
        next = undefined;
        // Every caller waiting on it has answered without it, so it is never started.
        if (nowMs() >= nextBy) {
          return skipped;
        }
        return run();
      });
      return next;
    },
  };
}
