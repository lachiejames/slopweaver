/**
 * What a long browser walk says about itself while it is still running.
 *
 * Separate from `browserWalk.ts` — which grades screenshots and addresses artifacts, and is pure — because
 * this is the one part of a walk that is deliberately NOT: it reads the clock, it reads resident memory, and
 * it reads the relay's own recovery register. Those three reads are the whole point (see
 * {@link walkProgressLine}), and keeping them here is what lets the grading half stay a set of total
 * functions over values.
 */
import { memoryUsage } from "node:process";

import { relayRecoveryCount } from "../../browser/walkStops.js";

/**
 * One walk's progress line, carrying the three numbers that separate the ceiling nobody has separated yet.
 *
 * ## Why a walk prints a cost at all
 *
 * MEASURED on one seat, two independent attempts at the Linear settings walk: one
 * stopped partway under a 900 s cap, the other further on under a 2700 s cap — and both landed at
 * the same elapsed minute. So page count, elapsed time and memory moved together across both runs and the
 * evidence cannot say which of the three is the ceiling. A run that prints only `<page>/<total>` can never say
 * either, however many times it is repeated, which is why the instrument lands beside the fix rather than
 * after it: **cumulative elapsed, resident memory and the page index on one line make the next drop
 * self-diagnosing.** A drop at a constant minute across walks of different page weight is time; at a
 * constant index is count; at a constant RSS is memory.
 *
 * The previous page's own cost is here for the same reason in miniature — it is what tells a reader a walk
 * slowing down page by page before it dies from one that died at full speed.
 *
 * ## The state is the state at the START of this page, deliberately
 *
 * The line is printed BEFORE the page is addressed, because a page that hangs is one of the measured
 * failure classes and a line printed after it would never appear at all — the operator would watch a silent
 * terminal. So every number describes the walk up to this page, and this page's own cost appears on the
 * NEXT line as `prev`.
 *
 * @param label the platform's own progress prefix — never a URL
 * @param position which page this is, counting from one
 * @param total how many pages were DECLARED, which is the denominator a coverage claim is judged against
 * @param page the page's surface name
 * @param previousPageMs what the page before this one cost, or `null` for the first page of a walk
 * @param sinceStartMs how long the walk has been running
 * @param rssBytes resident memory now, read by the caller so this stays pure
 * @param relayRebuilds how many times this run has rebuilt a dropped relay (`browser/relaySession.ts`)
 * @returns the line to print
 */
export function walkProgressLine({
  label,
  position,
  total,
  page,
  previousPageMs,
  sinceStartMs,
  rssBytes,
  relayRebuilds,
}: {
  label: string;
  position: number;
  total: number;
  page: string;
  previousPageMs: number | null;
  sinceStartMs: number;
  rssBytes: number;
  relayRebuilds: number;
}): string {
  const clauses: string[] = [];
  if (previousPageMs !== null) {
    clauses.push(`prev ${duration({ ms: previousPageMs })}`);
  }
  clauses.push(`${duration({ ms: sinceStartMs })} in`);
  clauses.push(`${String(Math.round(rssBytes / 1_048_576))} MiB rss`);
  if (relayRebuilds > 0) {
    clauses.push(`${String(relayRebuilds)} relay rebuild${relayRebuilds === 1 ? "" : "s"}`);
  }
  return `${label}: ${String(position)}/${String(total)} ${page} (${clauses.join(", ")})`;
}

/** A duration a reader can compare across pages: seconds under a minute, minutes and seconds above one. */
function duration({ ms }: { ms: number }): string {
  const totalSeconds = ms / 1_000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds - minutes * 60);
  return `${String(minutes)}m${String(seconds).padStart(2, "0")}s`;
}

/**
 * Where a walk's progress lines go — the one sink a walk owns, which the CLI shell points at stderr.
 *
 * Named because more than the per-page tick writes to it: a platform's root probe that RECOVERED from a
 * failure says so here (`kit/pageWalk.ts`'s `resolveRoot`), so a degraded start is never a silent one. Every
 * line is the caller's to keep identifier-free; this type cannot check that.
 */
export type WalkProgress = (input: { line: string }) => void;

/** One page's tick: called immediately BEFORE the page is addressed, with where it sits in the declared list. */
export type WalkTick = (input: { position: number; page: string }) => void;

/**
 * A walk's progress line as a loop can actually afford to print it: one call, per page.
 *
 * {@link walkProgressLine} is pure, which is what makes it testable and what makes it insufficient on its
 * own — every one of its arguments is bookkeeping (when the walk started, when the previous page started,
 * what resident memory is now, how many relays have been rebuilt), and four walk loops carried that
 * bookkeeping character for character before this existed, three of them growing past `max-function-lines`
 * doing it. So the clock, the memory read and the recovery count live here, behind a closure a loop calls
 * with the only two things it actually knows: which page it is about to address, and where that page sits.
 *
 * `prev` thereby becomes the time since the PREVIOUS TICK rather than a separately measured visit cost.
 * That is a slightly better number than the one it replaces: a tick fires immediately before a page is
 * addressed, so the gap between two of them is the previous page's WHOLE cost — the visit, the screenshot
 * grading, any re-look, and whatever the loop did with the capture — which is what a reader watching a walk
 * slow down before it dies is trying to see.
 *
 * @param label the platform's own progress prefix — never a URL
 * @param total how many pages were DECLARED, the denominator a coverage claim is judged against
 * @param progress where the line goes; `undefined` discards it
 * @returns the per-page tick
 */
export function walkTicker({
  label,
  total,
  progress,
}: {
  label: string;
  total: number;
  progress: WalkProgress | undefined;
}): WalkTick {
  const startedAt = Date.now();
  let lastTickAt: number | null = null;
  return ({ position, page }) => {
    const now = Date.now();
    const previousPageMs = lastTickAt === null ? null : now - lastTickAt;
    lastTickAt = now;
    progress?.({
      line: walkProgressLine({
        label,
        page,
        position,
        previousPageMs,
        relayRebuilds: relayRecoveryCount(),
        rssBytes: memoryUsage.rss(),
        sinceStartMs: now - startedAt,
        total,
      }),
    });
  };
}
