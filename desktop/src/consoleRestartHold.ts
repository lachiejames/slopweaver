/**
 * How long a console that stopped answering is waited out as an update's restart before the shell calls it a failure.
 * Pure: `main.ts` owns the clock and the reads.
 *
 * The "could not start its console … localhost:3000 did not answer" note and the blank "The console is not serving"
 * page must not come up while the console is still within the normal desktop-update time range. A pull swaps the console onto its new build (`scripts/docs-site.sh` `refresh_round`): the old server is
 * frozen and ended, and the record moves only once the new one answers a page, so for the swap's gap every read
 * fails. That gap is a normal update, not the owner's to act on; past this window it is.
 */
import { type CheckoutError, type ConsoleError, isCheckoutProblem } from "./errors";
import type { ConsoleOutageEntry } from "./overlayRecovery";

/**
 * The window, from the first failed read: `scripts/docs-site.sh`'s own `wait_for_production` budget, 120s of wall
 * clock for a new build to answer a page. A restart that has not answered by then is one the script itself gave up
 * on, so it is no longer a normal update and the note is the owner's. Measured on the owner's Mac: a whole
 * refresh round on :3000 ran 94s from build start to the new server ready, and while a build ran the old server
 * missed a 5s `/queue` probe for 5–30s at a time. One round on a spare port, read by a candidate app: the build
 * starved the old server 25s and the shell held it, back after 27.0s from its first failed read; the swap itself was
 * 7.1s down, back after 12.1s; no note either time. Re-measure with a production console on a spare port (`DOCS_SITE_PORT=3100 bash scripts/docs-site.sh
 * --serve`, an empty commit, then `DOCS_SITE_PORT=3100 bash scripts/docs-site.sh --refresh`) while probing
 * `http://127.0.0.1:3100/queue` with a 5s timeout every 250ms, and read the longest DOWN-to-UP span; the installed
 * app logs each real one as a `console-outage` `back` line in `desktop-events.jsonl`.
 */
export const RESTART_HOLD_MS = 120_000;

/** How often a held console is read again, so the page comes back within moments of the new build answering. */
export const RESTART_POLL_MS = 2_000;

/**
 * When an outage began: the first sign of trouble already recorded, else now. The window runs from that first sign,
 * never from the end of an attempt it then spends. Every instant here is on a MONOTONIC clock (`performance.now()`):
 * a wall clock steps on a correction and jumps by the whole sleep on wake, either of which would raise the note early.
 *
 * @param outageSinceMs the first failed read since the console last served, `undefined` while it serves
 * @param nowMs the instant now
 * @returns the outage's start
 */
export function outageStart({ outageSinceMs, nowMs }: { outageSinceMs: number | undefined; nowMs: number }): number {
  if (outageSinceMs === undefined) {
    return nowMs;
  }
  return outageSinceMs;
}

/**
 * Whether a console down since `outageSinceMs` is still inside a normal update's restart. A missing or invalid
 * checkout is never a restart — no update brings one back — so it is raised at once.
 *
 * @param failure why the last read or recovery failed
 * @param outageSinceMs when the first failed read since the console last served began
 * @param nowMs the instant now
 * @returns `"hold"` while inside the window, `"raise"` once past it or for a checkout problem
 */
export function restartHoldVerdict({
  failure,
  outageSinceMs,
  nowMs,
}: {
  failure: ConsoleError | CheckoutError;
  outageSinceMs: number;
  nowMs: number;
}): "hold" | "raise" {
  if (isCheckoutProblem({ failure })) {
    return "raise";
  }
  return nowMs - outageSinceMs < RESTART_HOLD_MS ? "hold" : "raise";
}

/**
 * The event-log line for one turn of an outage.
 *
 * @param outcome held as a restart, back and answering, or raised as the note
 * @param outageSinceMs when the first failed read began, on the monotonic outage clock
 * @param nowMs the instant now, on that same monotonic clock
 * @param atMs the wall-clock instant the line is stamped with
 * @param problem why the last read failed; omitted once it is back
 * @returns the entry
 */
export function consoleOutageEntry({
  outcome,
  outageSinceMs,
  nowMs,
  atMs,
  problem,
}: {
  outcome: ConsoleOutageEntry["outcome"];
  outageSinceMs: number;
  nowMs: number;
  atMs: number;
  problem?: string;
}): ConsoleOutageEntry {
  let reported: string | null = null;
  if (problem !== undefined) {
    reported = problem;
  }
  return {
    atIso: new Date(atMs).toISOString(),
    downMs: Math.max(0, nowMs - outageSinceMs),
    kind: "console-outage",
    outcome,
    problem: reported,
  };
}
