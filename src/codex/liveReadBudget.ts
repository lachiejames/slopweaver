/**
 * How long one live batch (`./accountLive.ts`) may run, and how long its outer kill waits beyond that.
 *
 * Split from the transport because this is the arithmetic a caller's deadline is judged by, and it is pure: the
 * transport hands it the instant it launches at and gets back a shared deadline or the reason nothing launches.
 */

/**
 * The whole child's ceiling beyond the shared deadline: room to kill and print, plus a margin per store for
 * launching. A backstop that should never fire — if it does, only `tclsh` is killed and the stores it launched are
 * not.
 */
const OUTER_TIMEOUT_MARGIN_MS = 4_000;
/** The launch margin one store adds to the outer timeout — a fork and exec, measured far under this. */
const OUTER_TIMEOUT_PER_STORE_MS = 250;
/** The shortest shared deadline worth launching for — measured answers take up to 2.5s, so under this none would. */
const MIN_LIVE_DEADLINE_MS = 1_000;

/** How long one live batch's shared deadline may be, or why no batch is worth launching. */
export type LiveReadBudget = { readonly deadlineMs: number } | { readonly reason: string };

/** What one live batch is launched with, or why it is not launched. */
export type LiveReadLaunch =
  { readonly deadlineArg: string; readonly outerTimeoutMs: number } | { readonly reason: string };

/** The cleanup margin the outer kill waits beyond a batch's shared deadline: the standing one plus one per store. */
function outerTimeoutMarginMs({ storeCount }: { storeCount: number }): number {
  return OUTER_TIMEOUT_MARGIN_MS + OUTER_TIMEOUT_PER_STORE_MS * storeCount;
}

/**
 * Size one live batch to the time its caller has left.
 *
 * With no caller deadline the batch takes its standing deadline. Under one it takes that or what is left less the
 * batch's own cleanup margin, whichever is shorter. The margin is the STANDING one ({@link outerTimeoutMarginMs}),
 * never a narrower one, because the outer kill it backs reaches only `tclsh` and orphans the app-servers it
 * launched. The exchange judges this at the instant it launches, after every piece of its
 * own pre-launch work, so its outer timeout — the shared deadline plus that margin — cannot outlast the caller. Too little left to launch, and the answer is why rather than a launch that could only be
 * killed.
 *
 * @param deadlineAtMs the epoch-millisecond instant the batch must be over by, or undefined for none
 * @param nowMs the instant the budget is judged at
 * @param standingMs the shared deadline the batch takes when nothing nearer constrains it
 * @param storeCount how many stores the batch launches, each widening the cleanup margin
 * @returns the budget, or why no batch is worth launching
 */
export function liveReadBudget({
  deadlineAtMs,
  nowMs,
  standingMs,
  storeCount,
}: {
  deadlineAtMs: number | undefined;
  nowMs: number;
  standingMs: number;
  storeCount: number;
}): LiveReadBudget {
  if (deadlineAtMs === undefined) {
    return { deadlineMs: standingMs };
  }
  const remainingMs = deadlineAtMs - nowMs;
  const marginMs = outerTimeoutMarginMs({ storeCount });
  const deadlineMs = Math.min(standingMs, remainingMs - marginMs);
  if (deadlineMs < MIN_LIVE_DEADLINE_MS) {
    return {
      reason: `not launched: ${String(remainingMs)}ms were left before the caller's deadline, under the ${String(MIN_LIVE_DEADLINE_MS + marginMs)}ms a live read of ${String(storeCount)} store(s) needs`,
    };
  }
  return { deadlineMs };
}

/**
 * The Tcl program's deadline argument and the outer `spawnSync` timeout for one batch launched at `nowMs`.
 *
 * Under a caller's deadline the argument is an INSTANT (`@<epoch ms>`) rather than a duration, so no delay before
 * the launch or in `tclsh`'s own start can stretch the batch past the caller. With none it
 * stays the duration from Tcl's own start it always was.
 *
 * @param deadlineAtMs the epoch-millisecond instant the batch must be over by, or undefined for none
 * @param nowMs the launch instant, taken after every piece of pre-launch work
 * @param standingMs the shared deadline the batch takes when nothing nearer constrains it
 * @param storeCount how many stores the batch launches
 * @returns the argument and timeout to launch with, or why no batch is worth launching
 */
export function liveReadLaunch({
  deadlineAtMs,
  nowMs,
  standingMs,
  storeCount,
}: {
  deadlineAtMs: number | undefined;
  nowMs: number;
  standingMs: number;
  storeCount: number;
}): LiveReadLaunch {
  const budget = liveReadBudget({ deadlineAtMs, nowMs, standingMs, storeCount });
  if ("reason" in budget) {
    return budget;
  }
  let deadlineArg = String(budget.deadlineMs);
  if (deadlineAtMs !== undefined) {
    deadlineArg = `@${String(nowMs + budget.deadlineMs)}`;
  }
  return { deadlineArg, outerTimeoutMs: budget.deadlineMs + outerTimeoutMarginMs({ storeCount }) };
}
