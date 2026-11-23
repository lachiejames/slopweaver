/**
 * The one wait contract: read something on a stepped backoff until it settles or a deadline passes, printing
 * only what CHANGED — copied from the verb that already had it, `github checks --wait`, rather than invented.
 *
 * ## Why this exists
 *
 * MEASURED over one week (read from every Bash call in the
 * week's transcripts, deduplicated by tool-use id): 568 hand-rolled foreground poll loops, 507 of them polling
 * a slopweaver verb, while the poll gate refused 540 re-reads at a median gap of 13 seconds. `github checks`
 * was the only verb offering a wait, so for everything that was not CI a session re-invented the loop the
 * gate had just refused. Every `--wait` on a verb, and `slopweaver wait` itself, goes through this loop so a
 * wait reads the same in every place it appears: one call, a terminal condition, `--timeout-seconds`, and
 * change-only output.
 *
 * ## It worked, and the re-measurement is what says so
 *
 * RE-MEASURED five days after this file landed, over 185,333 Bash calls deduplicated by tool-use
 * id from every transcript on the machine: the hand-rolled loop rate fell from **6.20 per 1,000 Bash calls**
 * before the landing commit to **3.02 after**, and `slopweaver wait` — which did not exist before — was called
 * 885 times in those five days. Repro: extract every Bash `tool_use` from `~/.claude/projects/**` from the week before,
 * dedupe by `.id`, and split `grep -cE '(while|for) .*sleep [0-9]'` at the landing commit's timestamp. What survived
 * is two named classes, each now answered — a merge watch that `github checks --until merge` already served
 * but nothing pointed at (`src/admit/pollReplacement.ts`), and the stack operation lock, which had no flag at
 * all (`src/admit/operationLockWait.ts`).
 *
 * ## What it deliberately does not do
 *
 * It does not print a SETTLED reading. The caller renders the final state with the same code its no-wait
 * path already uses, so `--wait` can never print a different verdict from a single read of the same state.
 */

/**
 * The backoff `github checks --wait` measured for a CI lap (`src/live/github/checks.ts`'s
 * `nextChecksPollDelayMs` carries the measurement): short enough at the start to catch a fast failure, about a
 * dozen reads to outlast a slow run. A verb whose read costs a provider call or a subprocess takes this one.
 */
export const PROVIDER_WAIT_SCHEDULE_MS: readonly number[] = [10_000, 20_000, 30_000, 45_000];

/** The interval every read past {@link PROVIDER_WAIT_SCHEDULE_MS} falls back to. */
export const PROVIDER_WAIT_CEILING_MS = 60_000;

/**
 * The backoff for a read that costs nothing — a `kill -0`, a stat. A background process that exits in three
 * seconds should not be answered ten seconds later just because a provider read would have needed that spacing.
 */
export const LOCAL_WAIT_SCHEDULE_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000];

/** The interval every local read past {@link LOCAL_WAIT_SCHEDULE_MS} falls back to. */
export const LOCAL_WAIT_CEILING_MS = 15_000;

/**
 * How long a `--wait` may run when `--timeout-seconds` is not given: inside the 600-second ceiling Claude Code
 * puts on a FOREGROUND Bash call (its tool contract's `timeout` maximum), so a wait run in the foreground ends
 * on its own verdict rather than being killed mid-read. A longer wait passes `--timeout-seconds` and runs in
 * the background, where its completion resumes the session.
 */
export const DEFAULT_WAIT_TIMEOUT_SECONDS = 540;

/** The injected clock: a test passes plain fakes, never a real sleep. */
export interface WaitClock {
  readonly nowMs: () => number;
  readonly sleep: (args: { ms: number }) => Promise<void>;
}

/** How a wait ended: the reading settled, or the deadline arrived first. */
export type WaitOutcome<T> =
  | { readonly kind: "settled"; readonly reading: T; readonly reads: number }
  | { readonly kind: "timed-out"; readonly reading: T; readonly reads: number };

/**
 * How long to wait before the next read.
 *
 * @param attempt how many reads have already completed, less one (0 before the second read)
 * @param schedule the stepped delays, in milliseconds
 * @param ceilingMs the delay every read past the schedule falls back to
 * @returns the delay in milliseconds
 */
export function nextWaitDelayMs({
  attempt,
  schedule,
  ceilingMs,
}: {
  attempt: number;
  schedule: readonly number[];
  ceilingMs: number;
}): number {
  const stepped = schedule[attempt];
  if (stepped === undefined) {
    return ceilingMs;
  }
  return stepped;
}

/**
 * Read until the reading settles or the deadline would be missed.
 *
 * The first read happens immediately. An UNSETTLED reading is emitted only when its lines differ from the
 * previous unsettled reading's, so a wait that sits on one state for ten minutes prints that state once. The
 * deadline is checked BEFORE sleeping, exactly as `github checks --wait` does: a wait never sleeps past its
 * own timeout only to report that it timed out.
 *
 * @param read performs one read
 * @param settled whether a reading is terminal
 * @param lines what an unsettled reading prints
 * @param emit where a changed unsettled reading's lines go
 * @param clock the injected time source
 * @param timeoutSeconds the wait's deadline, from its first read
 * @param schedule the stepped backoff
 * @param ceilingMs the backoff's ceiling
 * @returns the settled reading, or the last reading when the deadline arrived first
 */
export async function waitUntilSettled<T>({
  read,
  settled,
  lines,
  emit,
  clock,
  timeoutSeconds,
  schedule,
  ceilingMs,
}: {
  read: () => Promise<T>;
  settled: (reading: T) => boolean;
  lines: (reading: T) => readonly string[];
  emit: (line: string) => void;
  clock: WaitClock;
  timeoutSeconds: number;
  schedule: readonly number[];
  ceilingMs: number;
}): Promise<WaitOutcome<T>> {
  const deadlineMs = clock.nowMs() + timeoutSeconds * 1000;
  let previous: string | undefined;
  for (let attempt = 0; ; attempt += 1) {
    const reading = await read();
    const reads = attempt + 1;
    if (settled(reading)) {
      return { kind: "settled", reading, reads };
    }
    const shown = lines(reading);
    const key = shown.join("\n");
    if (key !== previous) {
      shown.forEach((line) => {
        emit(line);
      });
      previous = key;
    }
    const delayMs = nextWaitDelayMs({ attempt, ceilingMs, schedule });
    if (clock.nowMs() + delayMs > deadlineMs) {
      return { kind: "timed-out", reading, reads };
    }
    await clock.sleep({ ms: delayMs });
  }
}

/**
 * The production clock.
 *
 * @returns wall-clock milliseconds and a real timer
 */
export function realWaitClock(): WaitClock {
  return {
    nowMs: () => Date.now(),
    sleep: ({ ms }) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
