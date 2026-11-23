/**
 * The winner state for the deadline-vs-Slack race — and NOTHING else. No clock, no timer, no socket, no
 * logger, no `AbortController`: every one of those has its own real failure mode (a socket that will not
 * close, a timer that overflows), and mixing them into the decision of WHO WON would make that decision
 * untestable without faking one of them. This file exists so `runListenLoop` (`../../cli/commands/listen/
 * run.ts`) can decide the race with a plain, synchronous, in-memory latch, and put every effectful
 * consequence of that decision somewhere else.
 *
 * First-writer-wins, and idempotent for the arm that already won: calling the SAME arm's `try*` again after
 * it won returns `true` again (nothing changed), and the OPPOSING arm always returns `false` once either has
 * won. There is no path back to `"pending"`.
 */

/** Which side of the race won, or neither yet. */
type DeadlineWinner = "pending" | "slack-address" | "clock-wake";

/** The race's decision, and the two ways to try to make it. */
export interface DeadlineArbiter {
  /** The current winner. */
  readonly winner: () => DeadlineWinner;
  /** Claim the win for an admitted Slack address. `true` if this call won it (or already had it). */
  readonly trySlackAddress: () => boolean;
  /** Claim the win for the clock. `true` if this call won it (or already had it). */
  readonly tryClockWake: () => boolean;
}

/**
 * A fresh arbiter, undecided.
 *
 * @returns the arbiter
 */
export function createDeadlineArbiter(): DeadlineArbiter {
  let decided: DeadlineWinner = "pending";
  return {
    tryClockWake: () => {
      decided = decided === "pending" ? "clock-wake" : decided;
      return decided === "clock-wake";
    },
    trySlackAddress: () => {
      decided = decided === "pending" ? "slack-address" : decided;
      return decided === "slack-address";
    },
    winner: () => decided,
  };
}

/**
 * How long to wait before a deadline, floored at zero — a past or current deadline waits no time at all.
 *
 * Deliberately NOT clamped to Node's ~24.85-day timer ceiling here: that is the effectful `wait` seam's job
 * (`../../cli/commands/listen/run.ts`), which owns chunking a long wait into several bounded ones. This
 * function states the true delay; a caller that fed it straight into a single `setTimeout` would be the bug,
 * not this arithmetic.
 *
 * @param deadlineMs the absolute epoch-ms instant to wait until
 * @param nowMs the current instant
 * @returns the delay in milliseconds, never negative
 */
export function deadlineDelayMs({ deadlineMs, nowMs }: { deadlineMs: number; nowMs: number }): number {
  return Math.max(0, deadlineMs - nowMs);
}
