/**
 * `session watch --follow`'s subscription: one stream's wiring around the batch it is collecting, and nothing
 * else. Split out of `./watch.ts`, which keeps the argument handling, the commit and the report; the fold
 * (`cmux/sessionActivity.ts`) and the rendering (`sessions/watchReport.ts`) are both pure and both elsewhere.
 */

import { type CmuxEventStream, openCmuxEventStream } from "../../../cmux/eventStream.js";
import { type CmuxEvent, SUPERVISION_EVENT_NAMES } from "../../../cmux/events.js";
import { deferred } from "../../../lib/deferred.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

/** How long a drain waits with no new frame before deciding it has caught up with the live edge. */
export const DRAIN_QUIET_MS = 750;

/** One batch handed to the reporter. */
export interface WatchBatch {
  readonly events: readonly CmuxEvent[];
  readonly highestSeq: number;
  readonly gap: boolean;
  readonly answered: boolean;
  readonly truncated: boolean;
}

/**
 * Schedule the quiet-window callback for LATER (never synchronously), and hand back the one way to cancel it.
 *
 * @internal exported so a unit test can fire the quiet window by hand: a test driving real timers is at the
 * mercy of load, where two delivery timers fire in one phase and fold into one batch.
 */
export type WatchQuietScheduler = (options: { readonly delayMs: number; readonly onQuiet: () => void }) => {
  readonly cancel: () => void;
};

/** The real quiet window: `setTimeout`, cancelled by `clearTimeout` on the same handle. */
const timeoutQuietScheduler: WatchQuietScheduler = ({ delayMs, onQuiet }) => {
  const handle = setTimeout(onQuiet, delayMs);
  return {
    cancel: () => {
      clearTimeout(handle);
    },
  };
};

/**
 * Stay subscribed under `--follow`, reporting each batch once the stream goes quiet, until cmux ends it.
 *
 * Reports are chained, so an end arriving while one is still being written waits for it, and a batch still
 * pending when cmux hangs up is reported before the verb exits rather than dropped. A report that FAILS — its
 * commit refused — is logged and ENDS the follow at once, non-zero: a refused commit means this watcher no longer
 * holds the stored revision (another one committed first, or the store is down), so every later batch would fail
 * the same way while consuming events it can never persist. A rejected report still settles the exit code, so it is never left unsettled.
 *
 * @param afterSeq resume strictly after this seq; undefined replays cmux's whole retained buffer
 * @param onBatch commits one batch's fold and cursor, then reports it
 * @param quietMs how long with no frame before a batch is reported
 * @param openStream the subscription opener; a unit test passes a scripted fake
 * @param scheduleQuiet arms the quiet window; a unit test passes one it fires by hand
 * @returns the process exit code
 */
// max-lines-exempt: same shape as `cmux/events.ts`'s `streamEvents` — one subscription's wiring around shared mutable state; the fold (`cmux/sessionActivity.ts`) and the reporting (`sessions/watchReport.ts`) are both pure and both elsewhere.
export async function followEvents({
  afterSeq,
  onBatch,
  quietMs = DRAIN_QUIET_MS,
  openStream = openCmuxEventStream,
  scheduleQuiet = timeoutQuietScheduler,
}: {
  afterSeq: number | undefined;
  onBatch: (options: { batch: WatchBatch }) => Promise<void>;
  quietMs?: number;
  openStream?: typeof openCmuxEventStream;
  scheduleQuiet?: WatchQuietScheduler;
}): Promise<number> {
  const finished = deferred<number>();
  const events: CmuxEvent[] = [];
  // A follow given no starting seq has handled nothing yet, so its cursor starts at zero.
  let highestSeq = 0;
  if (afterSeq !== undefined) {
    highestSeq = afterSeq;
  }
  let gap = false;
  let answered = false;
  let quiet: { readonly cancel: () => void } | undefined;
  let reported: Promise<void> = Promise.resolve();
  let reportFailed = false;
  let stream: CmuxEventStream | undefined;

  // The one place a pending quiet window is dropped, so the arm, the failure stop and the end cannot drift.
  const cancelQuiet = (): void => {
    if (quiet !== undefined) {
      quiet.cancel();
    }
    quiet = undefined;
  };

  // A failed report ends the follow: stop the timer, drop the subscription, and settle non-zero. Called before
  // anything that could itself throw, so the stop never depends on reading the rejection.
  const stopAfterFailure = (): void => {
    reportFailed = true;
    cancelQuiet();
    events.length = 0;
    if (stream !== undefined) {
      stream.close();
    }
    finished.settle({ value: EXIT_ERROR });
  };

  const flush = (): Promise<void> => {
    const batch = [...events];
    events.length = 0;
    const wasGap = gap;
    gap = false;
    // The cursor is cut WITH the batch. Read inside the queued callback instead, it would already count events
    // that arrived while an earlier report was committing — a cursor ahead of the fold it is stored beside.
    const batchHighestSeq = highestSeq;
    const wasAnswered = answered;
    reported = reported
      .then(() => {
        if (reportFailed) {
          return undefined;
        }
        return onBatch({
          batch: { answered: wasAnswered, events: batch, gap: wasGap, highestSeq: batchHighestSeq, truncated: false },
        });
      })
      .catch((cause: unknown) => {
        stopAfterFailure();
        const reason = cause instanceof Error ? cause.message : "it rejected with a value that is not an Error";
        logger.error({ msg: `session watch: a report failed — ${reason}` });
      })
      // The failure is already recorded; a handler that itself throws — reading the rejection, or writing the log —
      // must not leave the chain rejected, where a quiet-timer flush has no one awaiting it.
      .catch(() => {
        stopAfterFailure();
      });
    return reported;
  };

  const arm = (): void => {
    cancelQuiet();
    quiet = scheduleQuiet({
      delayMs: quietMs,
      onQuiet: () => {
        quiet = undefined;
        void flush();
      },
    });
  };

  stream = openStream({
    handlers: {
      onAck: ({ ack }) => {
        // The ack's `latest_seq` is the live EDGE, not what this drain handled — recording it would skip
        // every event between the last one folded and that edge, silently. See `cmux/events.ts`'s own note.
        gap = ack.gap;
        answered = true;
        arm();
      },
      onEnd: ({ error }) => {
        cancelQuiet();
        void (async (): Promise<void> => {
          // `flush` already catches a failed report; this catch is the belt for anything that escaped it — the
          // diagnostic write included — so nothing between here and the settle can leave the verb without an exit code.
          try {
            if (error !== undefined) {
              logger.error({ msg: `session watch: ${error.message}` });
            }
            await (events.length > 0 ? flush() : reported);
          } catch {
            reportFailed = true;
          }
          finished.settle({ value: error === undefined && !reportFailed ? EXIT_OK : EXIT_ERROR });
        })();
      },
      onEvent: ({ event }) => {
        if (finished.settled()) {
          return;
        }
        answered = true;
        events.push(event);
        highestSeq = Math.max(highestSeq, event.seq);
        arm();
      },
    },
    subscription: { ...(afterSeq === undefined ? {} : { afterSeq }), names: [...SUPERVISION_EVENT_NAMES] },
  });

  return finished.promise;
}
