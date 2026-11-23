/**
 * The soft deadline a `session-start` run may be given: a wall-clock instant at which its LIVE work stops — a leg
 * still in flight is abandoned, a leg not yet started is skipped, the live re-read stops at the row it is on — so a
 * caller holding a hard budget gets a list cut short, saying what it skipped, rather than none.
 *
 * Why it exists: `supervisor refresh-run` and `supervisor tick close` launch `session-start` under a budget that
 * SIGKILLs it (`cli/commands/supervisor/scratchRefresh.ts`), and a killed child leaves half a JSON document, so
 * under load the seat's list was never refreshed while a bare run of the same verb finished. Only the child can
 * degrade cooperatively; the hard kill stays as the backstop.
 *
 * **A race, not a check between legs**: a check before a leg cannot stop the provider call already
 * running inside it, so every live leg and every verify row races ONE promise that settles at the deadline. An
 * abandoned call is left to finish into nothing; the verb's own `process.exit` (`cli/main.ts`) ends it. The Slack
 * bronze scan is synchronous, so no timer fires inside it: it asks {@link RunDeadline.isReached} between chunks,
 * and that answers from the clock as well as the timer, so a leg is never STARTED after the instant just because a
 * long synchronous stretch kept the timer from running. Only the local work — the board, the ranking
 * and the write — runs past the deadline, and the caller's margin is sized for that. A single read blocked inside
 * the kernel cannot be interrupted by anything in-process; that one residue is the hard kill's.
 *
 * It is distinct from `--now` on purpose: `--now` is the instant the list is JUDGED at and may be a frozen
 * fixture's; this is when the run itself must stop reading, which only the wall clock can answer.
 */

/** An ISO instant in UTC, the only spelling `--deadline` accepts; any number of fractional-second digits. */
const UTC_INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/;

/**
 * Read a `--deadline` value as epoch milliseconds.
 *
 * @param raw the flag's text
 * @returns the instant in epoch milliseconds, or undefined when the text is not a valid UTC instant
 */
export function deadlineMsOf({ raw }: { raw: string }): number | undefined {
  const match = UTC_INSTANT.exec(raw);
  if (match === null) {
    return undefined;
  }
  // Truncate the fraction to milliseconds, the clock's own resolution, so a finer one parses the same everywhere.
  const digits = match[2];
  const fraction = digits === undefined ? "000" : digits.padEnd(3, "0").slice(0, 3);
  const ms = Date.parse(`${match[1]!}.${fraction}Z`);
  // `Date.parse` rolls an impossible day over rather than refusing it, so the round trip is the check.
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 19) !== raw.slice(0, 19)) {
    return undefined;
  }
  return ms;
}

/** One run's deadline: a promise that settles when it is reached, and whether it has been. */
export interface RunDeadline {
  /** Settles once the deadline is reached; never, for a run given none. Never rejects. */
  readonly reached: Promise<void>;
  /** Whether {@link reached} has settled, or the instant has passed while no timer could run. */
  readonly isReached: () => boolean;
  /** Stops the timer once the live work is over, so a run that finished early is not held open to the deadline. */
  readonly release: () => void;
}

/**
 * A deadline over any promise that settles when it is reached — the seam a test drives with no clock at all.
 *
 * @param reached settles at the deadline
 * @param passed whether the instant has passed, asked synchronously; absent, only {@link reached} decides
 * @param release stops whatever settles {@link reached}; absent, there is nothing to stop
 * @returns the deadline
 */
export function runDeadline({
  reached,
  passed,
  release,
}: {
  reached: Promise<void>;
  passed?: () => boolean;
  release?: () => void;
}): RunDeadline {
  let hit = false;
  const settled = reached.then((): undefined => {
    hit = true;
    return undefined;
  });
  return {
    isReached: () => hit || passed?.() === true,
    reached: settled,
    release: () => {
      if (release !== undefined) {
        release();
      }
    },
  };
}

/**
 * The longest delay one Node timer honours; past it Node clamps the delay to 1 ms (`TimeoutOverflowWarning`).
 * Reproduce: `node -e 'console.log(setTimeout(() => {}, 2 ** 31)._idleTimeout)'` prints 1.
 */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * How long one timer should wait toward a deadline: the time left, never negative, never past what a timer honours.
 *
 * @param deadlineMs the deadline in epoch milliseconds
 * @param nowMs the current instant in epoch milliseconds
 * @returns the delay to arm one timer with
 */
export function timerDelayMs({ deadlineMs, nowMs }: { deadlineMs: number; nowMs: number }): number {
  return Math.min(Math.max(0, deadlineMs - nowMs), MAX_TIMER_MS);
}

/**
 * The wall-clock deadline a run was given, or one that is never reached.
 *
 * **The timer is REFERENCED until {@link RunDeadline.release}**: a promise alone does not keep Node
 * alive, so an abandoned read holding no handle of its own, raced against an unref'd timer, would let the process
 * exit 0 before the deadline with nothing printed. Held, the timer guarantees the cut path runs and the list is
 * written; released once the live work is over, it never holds a finished run open.
 *
 * @param deadlineMs the `--deadline` in epoch milliseconds, or undefined when the run was given none
 * @returns the deadline
 */
export function wallClockDeadline({ deadlineMs }: { deadlineMs: number | undefined }): RunDeadline {
  if (deadlineMs === undefined) {
    return runDeadline({ reached: new Promise<void>(() => undefined) });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const passed = (): boolean => Date.now() >= deadlineMs;
  return runDeadline({
    passed,
    reached: new Promise<void>((resolve) => {
      // One timer cannot wait past MAX_TIMER_MS, so a far deadline is re-armed until the instant really arrives.
      const arm = (): void => {
        timer = setTimeout(
          () => {
            if (passed()) {
              resolve();
            } else {
              arm();
            }
          },
          timerDelayMs({ deadlineMs, nowMs: Date.now() }),
        );
      };
      arm();
    }),
    release: () => {
      clearTimeout(timer);
    },
  });
}

/**
 * Run one piece of live work unless the deadline has passed, and abandon it if the deadline arrives first.
 *
 * @param work starts the work; never called once the deadline has passed
 * @param deadline the run's deadline
 * @returns the work's value, or `cut` when the deadline came first
 */
export async function beforeDeadline<T>({
  work,
  deadline,
}: {
  work: () => Promise<T>;
  deadline: RunDeadline;
}): Promise<{ readonly kind: "done"; readonly value: T } | { readonly kind: "cut" }> {
  if (deadline.isReached()) {
    return { kind: "cut" };
  }
  return Promise.race([
    work().then((value) => ({ kind: "done" as const, value })),
    deadline.reached.then(() => ({ kind: "cut" as const })),
  ]);
}

/**
 * The `couldNotSee` line for one part of the run the deadline cut.
 *
 * @param part what was not read, in the words the list prints — a leg's name, or the live re-read
 * @param deadlineMs the deadline that cut it
 * @returns the line
 */
export function cutShortLine({ part, deadlineMs }: { part: string; deadlineMs: number }): string {
  return `not read, ${part}: this run reached its --deadline of ${new Date(deadlineMs).toISOString()} first, so the list is cut short`;
}
