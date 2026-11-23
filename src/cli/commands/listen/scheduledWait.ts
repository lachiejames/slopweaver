/**
 * The one wait `listen recover --scheduled` (`./scheduledRecover.ts`) makes before it sweeps: until the next due
 * sweep or a recipe's own deadline, whichever comes first. Split out of the sweep shell because it is the one
 * piece of that file that touches a real timer and nothing else.
 */
import { waitChunked } from "../../../live/listen/chunkedWait.js";

/**
 * Wait until the earlier of the next due sweep or a recipe deadline — real timers, chunked so a wait
 * longer than `setTimeout`'s ceiling is honoured (see `chunkedWait.ts`). The clock used to compute REMAINING
 * time is injected; the timer itself is always real, since a wait already skipped (due now, or overdue)
 * never reaches this function at all — see its caller.
 *
 * @param dueAtMs the next sweep's due instant, epoch milliseconds
 * @param deadlineMs the recipe deadline, epoch milliseconds, or `undefined` when none is armed
 * @param nowMs the clock to compute remaining time against
 * @returns which one actually elapsed first
 */
export async function waitUntilDueOrDeadline({
  dueAtMs,
  deadlineMs,
  nowMs,
}: {
  dueAtMs: number;
  deadlineMs: number | undefined;
  nowMs: () => number;
}): Promise<"due" | "clock-wake"> {
  const now = nowMs();
  const dueInMs = Math.max(0, dueAtMs - now);
  const deadlineInMs = deadlineMs === undefined ? undefined : Math.max(0, deadlineMs - now);
  const waitMs = deadlineInMs === undefined ? dueInMs : Math.min(dueInMs, deadlineInMs);
  await waitChunked({
    ms: waitMs,
    seams: {
      clearTimer: ({ handle }) => {
        // `as`: this seam pair is defined together right here — `setTimer` below always returns exactly
        // what `setTimeout` did, so `handle` is sound even though the shared interface types it `unknown`
        // to let a test's fake timer return anything.
        // oxlint-disable-next-line no-unsafe-type-assertion
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
      nowMs: () => performance.now(),
      setTimer: ({ ms, onElapsed }) => setTimeout(onElapsed, ms),
    },
    signal: new AbortController().signal,
  });
  return deadlineInMs !== undefined && deadlineInMs <= dueInMs ? "clock-wake" : "due";
}
