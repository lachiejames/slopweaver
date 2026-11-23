/**
 * Where every open pull request has been waiting, and on WHAT — the pure core of `slopweaver github
 * bottleneck`.
 *
 * A large backlog of open pull requests signals bottlenecks in the slopweaver SDLC, and the owner wants them
 * fixed. `./landing.ts` already answers what holds ONE pull request. This module answers the question a
 * backlog asks instead: group the
 * whole fleet by cause, so the biggest bar names the mechanism to fix rather than the pull request to nudge.
 *
 * ## One cause per row, and the ladder's ORDER is the argument
 *
 * A stuck pull request usually fails several tests at once, so a histogram is only as honest as its tie
 * break. {@link CAUSE_LADDER} is that tie break, and two rungs in it are deliberate rather than obvious:
 *
 * **`draft` outranks `ci-red`.** MEASURED on `lachiejames/slopweaver`: 17 of 22 open pull
 * requests were drafts and 10 of those were renovate bumps, every one of which `landing`'s dispatcher calls
 * `outside-the-set` because it is still a draft and none of the six words names it. `renovate.json`
 * sets `draftPR: true`, and `landing` excludes drafts unless asked, so a bump is invisible to the sweep that
 * lands things. Ranking those rows by their CI
 * would report ten CI problems and hide the one mechanism that produced all ten.
 *
 * **`queued` outranks everything.** A row GitHub already holds an entry for is not waiting on this fleet at
 * all, and counting it under any other cause would put a bar against work nobody has to do.
 *
 * ## What is MEASURED, and the one thing that cannot be
 *
 * `openHours` is now minus `createdAt` — how long the pull request has been open, which is the only
 * denominator that does not move under a re-run. `idleHours` is now minus `updatedAt` and is reported BESIDE
 * it, never as the wait: GitHub bumps `updatedAt` on a check re-run, so a pull request trailing by 324 commits
 * behind `main` with eight checks failing read four hours idle.
 *
 * **A seat that ended without landing is only visible for a row a handover doc STATED.** The board join is a
 * declared `branch:` or the branch a run recorded at `handover start`, and nothing else (`./landingBoard.ts`'s
 * `LandingBoardRow`), so a row no doc stated answers
 * `none-declared` rather than "no seat" — all 22 rows of the measurement above did. {@link bottleneckReport}
 * carries that as residue rather than reporting an absence it cannot establish.
 *
 * Pure. No network, no clock beyond the instant a caller passes in, no filesystem.
 */

import type { LandingRow } from "./landing.js";

/**
 * Why one pull request is not moving, as ONE word.
 *
 * `clear` is a real answer and not an absence: a row every test passes is waiting on nothing but a press, and
 * a histogram that omitted it would make the backlog look entirely blocked.
 */
export type BottleneckCause =
  "queued" | "conflicting" | "draft" | "review-owed" | "threads-open" | "ci-red" | "ci-running" | "unread" | "clear";

/**
 * The order causes are tried in, first match winning.
 *
 * A declared registry rather than a chain of `if`s so a guard can assert every {@link BottleneckCause} has a
 * rung — an unranked cause would silently fall through to `clear` and read as a pull request that is fine.
 * Read the module header for why `draft` sits above `ci-red`.
 */
export const CAUSE_LADDER: readonly BottleneckCause[] = [
  "queued",
  "conflicting",
  "draft",
  "review-owed",
  "threads-open",
  "ci-red",
  "ci-running",
  "unread",
  "clear",
] as const;

/** What the board knows about the branch, which is the only thing that can answer "a seat ended". */
type BottleneckSeat =
  { readonly kind: "row"; readonly slug: string; readonly status: string } | { readonly kind: "undeclared" };

/** One open pull request, measured. */
export interface BottleneckRow {
  readonly repoSlug: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly authorLogin: string;
  readonly cause: BottleneckCause;
  /** Why this cause, in the terms the fix is expressed in. Always populated. */
  readonly detail: string;
  /** How long it has been OPEN, whole hours. */
  readonly openHours: number;
  /** How long since GitHub saw any activity, whole hours. Beside the wait, never as the wait. */
  readonly idleHours: number;
  /** How far the head is behind its base, or `undefined` when this read did not measure it. */
  readonly behindBy: number | undefined;
  /** Every OTHER test this row also fails, so a bar does not hide what else has to happen. */
  readonly alsoFailing: readonly string[];
  readonly seat: BottleneckSeat;
}

/** One bar: a cause, how many rows fell to it, and the oldest wait under it. */
export interface BottleneckBar {
  readonly cause: BottleneckCause;
  readonly count: number;
  /** The `openHours` of the longest-waiting row under this cause. */
  readonly oldestOpenHours: number;
  /** Those rows' numbers, oldest first, so a bar can be acted on rather than only counted. */
  readonly numbers: readonly number[];
}

/** The whole audit: every row measured, grouped, with what it could not establish. */
export interface BottleneckReport {
  readonly rows: readonly BottleneckRow[];
  /** One bar per cause PRESENT, largest first, ties broken by the ladder's own order. */
  readonly bars: readonly BottleneckBar[];
  readonly residue: readonly string[];
}

/** Milliseconds in one hour, so the two age measurements read the same way. */
const MS_PER_HOUR = 3_600_000;

/**
 * Whole hours between two instants, floored, never negative.
 *
 * Floored rather than rounded because every consumer reads it as "at least this long", and clamped at zero
 * because a clock the caller passed in can sit behind a stamp GitHub wrote.
 *
 * @param fromIso the earlier instant, as GitHub wrote it
 * @param nowIso the instant this read was made at
 * @returns whole hours, at least zero
 */
function hoursBetween({ fromIso, nowIso }: { fromIso: string; nowIso: string }): number {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(from) || Number.isNaN(now)) {
    return 0;
  }
  return Math.max(0, Math.floor((now - from) / MS_PER_HOUR));
}

/** One row's verdict for each of the six landing tests, by id, so the ladder reads them by name. */
function verdicts({ row }: { row: LandingRow }): ReadonlyMap<string, string> {
  return new Map(row.tests.map((test) => [test.id, test.verdict]));
}

/**
 * The cause and its sentence, from the six tests plus the queue.
 *
 * Every arm's sentence names what would have to CHANGE, because the report's whole purpose is to be grouped
 * and acted on. `unread` is its own arm rather than folded into a failure: a test nobody could answer must
 * not be counted as a cause somebody can fix.
 *
 * @param row the landing row this read is judging
 * @returns the one cause, and why
 */
function causeOf({ row }: { row: LandingRow }): { readonly cause: BottleneckCause; readonly detail: string } {
  const test = verdicts({ row });
  if (row.queue.kind === "queued") {
    return {
      cause: "queued",
      detail: `GitHub holds entry ${String(row.queue.position)} for it, state ${row.queue.state} — nothing here to do`,
    };
  }
  if (test.get("mergeable") === "fail") {
    return { cause: "conflicting", detail: "it does not merge into its base — rebase it" };
  }
  if (test.get("undrafted") === "fail") {
    return { cause: "draft", detail: "it is still a draft, so no sweep lists it and no dispatch verdict names it" };
  }
  if (test.get("codeowners-satisfied") === "fail") {
    // A BLOCKED merge with no request and no decision fails naming nobody (`./landingTests.ts`), so the
    // test's own sentence is the detail there rather than a request out to an empty list.
    const detail =
      row.blockedOn.length > 0
        ? `GitHub still holds a code-owner request out to ${row.blockedOn.join(", ")}`
        : row.tests.find((one) => one.id === "codeowners-satisfied")!.why;
    return { cause: "review-owed", detail };
  }
  if (test.get("threads-clear") === "fail") {
    return { cause: "threads-open", detail: "a reviewer thread is waiting on us" };
  }
  if (test.get("ci-green") === "fail") {
    return { cause: "ci-red", detail: row.tests.find((one) => one.id === "ci-green")!.why };
  }
  if (row.ci === "running") {
    return { cause: "ci-running", detail: "its checks are still running — it is in motion" };
  }
  const unread = row.tests.filter((one) => one.verdict === "unknown");
  if (unread.length > 0) {
    return { cause: "unread", detail: `this read could not answer ${unread.map((one) => one.id).join(", ")}` };
  }
  return { cause: "clear", detail: row.actionDetail };
}

/**
 * Measure ONE open pull request.
 *
 * @param row the landing row, which already carries every fact GitHub published about it
 * @param nowIso the instant this read was made at, so a replay judges by its own clock
 * @returns the row's cause, its two ages and what else it fails
 */
export function bottleneckRow({ row, nowIso }: { row: LandingRow; nowIso: string }): BottleneckRow {
  const { cause, detail } = causeOf({ row });
  const seat: BottleneckSeat =
    row.boardRow.kind === "row"
      ? { kind: "row", slug: row.boardRow.slug, status: row.boardRow.status }
      : { kind: "undeclared" };
  let behindBy: number | undefined;
  if (row.baseDistance.kind === "read") {
    behindBy = row.baseDistance.value.behindBy;
  }
  return {
    alsoFailing: row.tests.filter((one) => one.verdict === "fail").map((one) => one.id),
    authorLogin: row.authorLogin,
    behindBy,
    cause,
    detail,
    idleHours: hoursBetween({ fromIso: row.updatedAtIso, nowIso }),
    number: row.number,
    openHours: hoursBetween({ fromIso: row.createdAtIso, nowIso }),
    repoSlug: row.repoSlug,
    seat,
    title: row.title,
    url: row.url,
  };
}

/**
 * Group the measured rows into bars, largest first.
 *
 * A tie is broken by {@link CAUSE_LADDER}'s own order rather than by cause name, so two equal bars print in
 * the order the ladder already argues for and a reader never has to wonder whether the sort meant something.
 *
 * @param rows every measured row
 * @returns one bar per cause PRESENT, largest first
 */
export function bottleneckBars({ rows }: { rows: readonly BottleneckRow[] }): readonly BottleneckBar[] {
  const bars = CAUSE_LADDER.map((cause) => {
    const under = rows.filter((one) => one.cause === cause).toSorted((a, b) => b.openHours - a.openHours);
    return {
      cause,
      count: under.length,
      numbers: under.map((one) => one.number),
      oldestOpenHours: under.length === 0 ? 0 : under[0]!.openHours,
    };
  }).filter((bar) => bar.count > 0);
  return bars.toSorted((a, b) => {
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    return CAUSE_LADDER.indexOf(a.cause) - CAUSE_LADDER.indexOf(b.cause);
  });
}

/**
 * The whole audit over one fleet read.
 *
 * @param rows every open pull request the landing read returned
 * @param nowIso the instant the read was made at
 * @returns every row measured, the bars, and what the read could not establish
 */
export function bottleneckReport({ rows, nowIso }: { rows: readonly LandingRow[]; nowIso: string }): BottleneckReport {
  const measured = rows.map((row) => bottleneckRow({ nowIso, row }));
  const undeclared = measured.filter((row) => row.seat.kind === "undeclared").length;
  const residue: string[] = [];
  if (undeclared > 0) {
    residue.push(
      `${String(undeclared)} of ${String(measured.length)} row(s) are stated by no handover row, so whether a seat ` +
        `ended without landing is UNKNOWN for them — the board join is a declared \`branch:\` or a run's ` +
        `recorded one and nothing else`,
    );
  }
  const unread = measured.filter((row) => row.cause === "unread").length;
  if (unread > 0) {
    residue.push(
      `${String(unread)} row(s) fell to \`unread\`: a test this read could not answer is not a cause anybody can fix, ` +
        `and is counted apart from one that is`,
    );
  }
  return { bars: bottleneckBars({ rows: measured }), residue, rows: measured };
}
