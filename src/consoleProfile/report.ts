/**
 * The shape of one `slopweaver perf console` run, and the pure folds over it: the per-row median and worst of
 * repeated samples, and the verdict of each row against its named budget.
 *
 * Every number is a measurement the driver took in a launched browser (`./drive.ts`) or a timed child process; a
 * field the walk could not take is `undefined` and is printed as not measured, never as zero.
 */

import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";

/** One `/api/*` read a page or a click started, and how long it took to answer. */
export interface ApiRead {
  /** The route path, e.g. `/api/live/hands`. */
  readonly path: string;
  /**
   * From the request leaving the page to its last byte arriving; `undefined` once the read is known to have failed,
   * so no output — the table or `--json` — ever carries a failed read's time as a duration.
   */
  readonly ms: number | undefined;
  /**
   * Whether a read answered `NOT MEASURED`, a body that is not a reading, or failed outright, rather than a
   * reading — a refusal or a failure is fast and draws almost nothing,
   * so a walk over refusals would time a console that is not there. MEASURED: one tracked `src/` edit
   * left the serving checkout's built CLI stale, every read refused, and `/pull-requests` drew 187 elements instead
   * of about 4,700. Always decided before a read is recorded, never left open.
   */
  readonly notMeasured: boolean;
}

/** One cold load of one page, in a fresh browser context with nothing cached. */
export interface LoadSample {
  readonly path: string;
  /** Navigation start to the first response byte. */
  readonly ttfbMs: number | undefined;
  /** Navigation start to the first contentful paint. */
  readonly fcpMs: number | undefined;
  /** Navigation start to the last largest-contentful-paint candidate before input. */
  readonly lcpMs: number | undefined;
  /** Navigation start to the page's heading drawn with no loading skeleton left. */
  readonly landedMs: number | undefined;
  /** Navigation start to every read the page started having answered, with the network quiet after. */
  readonly settledMs: number | undefined;
  /** Whether something on screen said "loading" before the data arrived — a skeleton, a busy item, a pending tile. */
  readonly loadingIndicator: boolean;
  /** Every `/api/*` read the load started, in the order they answered. */
  readonly reads: readonly ApiRead[];
  /** Reads still unanswered when the walk stopped waiting — each one a tile still saying "loading". */
  readonly unanswered: readonly string[];
  /** Script bytes transferred (compressed) for the load. */
  readonly scriptBytes: number | undefined;
  /** The JS heap after a forced garbage collection once the page settled. */
  readonly heapBytes: number | undefined;
  /** Elements in the document once settled. */
  readonly domNodes: number | undefined;
  /** Main-thread tasks over 50 ms during the load, summed past their first 50 ms each (total blocking time). */
  readonly blockingMs: number | undefined;
}

/** One click — a sidebar item or a thing inside a page — timed from the press. */
export interface ClickSample {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  /** Press to the first frame that showed the press was taken (new address, skeleton, busy item, opened panel). */
  readonly shownMs: number | undefined;
  /** Press to the destination drawn with no skeleton left. */
  readonly landedMs: number | undefined;
  /** Press to every read the click started having answered, with the network quiet after. */
  readonly settledMs: number | undefined;
  /** Whether the click ended in a full document load rather than a client-side navigation. */
  readonly documentLoad: boolean;
  /**
   * Whether the router had already fetched the destination before the press (a Next `<Link>` prefetches what is in
   * view), so a fast click is read as a warm one rather than credited to the page. `undefined` for a panel.
   */
  readonly prefetched: boolean | undefined;
  readonly reads: readonly ApiRead[];
  readonly unanswered: readonly string[];
  readonly blockingMs: number | undefined;
  /** Why the click was not taken — the page drew nothing of the kind to press. Every timing is then `undefined`. */
  readonly skipped: string | undefined;
}

/** The browser's memory across a whole walk: after the first page settled, and after every page has been visited. */
export interface MemorySample {
  readonly startHeapBytes: number | undefined;
  readonly endHeapBytes: number | undefined;
  readonly startDomNodes: number | undefined;
  readonly endDomNodes: number | undefined;
  /** How many sidebar round trips the walk made between the two readings. */
  readonly roundTrips: number;
}

/** One verb the console's live route runs, spawned exactly as the route spawns it, uncontended. */
export interface VerbSample {
  readonly slug: string;
  /** Spawn to exit, through the serving checkout's `bin/slopweaver`. */
  readonly ms: number | undefined;
  /** Why it has no number, when it has none. */
  readonly failed: string | undefined;
}

/** A whole run: when, against what, and every sample taken. */
export interface ConsoleProfileReport {
  readonly measuredAtIso: string;
  readonly base: string;
  readonly runs: number;
  readonly loads: readonly LoadSample[];
  readonly clicks: readonly ClickSample[];
  readonly memory: MemorySample | undefined;
  readonly verbs: readonly VerbSample[];
  /** `slopweaver <verb> --help` through the same launcher: process start-up with no verb module loaded. */
  readonly verbFloorMs: number | undefined;
  /**
   * The machine's one-minute load average when the walk began and ended, against its core count. Every read is a
   * child process competing with the rest of the fleet for those cores, so two walks are comparable only beside
   * this. MEASURED: at a load of 34 on 15 cores, reads that answered in about 3 s at a lighter load ran
   * past 30 s.
   */
  readonly machine: { readonly cores: number; readonly loadAtStart: number; readonly loadAtEnd: number };
}

/** The middle and the worst of a row's repeated samples. */
export interface Spread {
  readonly median: number;
  readonly worst: number;
  readonly n: number;
}

/**
 * The median and worst of the samples that were taken, ignoring the ones that were not.
 *
 * @param values one per run, `undefined` where the run could not take it
 * @returns the spread, or `undefined` when no run took it
 */
export function spreadOf({ values }: { values: readonly (number | undefined)[] }): Spread | undefined {
  const taken = values.filter((value): value is number => value !== undefined).toSorted((a, b) => a - b);
  const n = taken.length;
  if (n === 0) {
    return undefined;
  }
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? taken[mid]! : (taken[mid - 1]! + taken[mid]!) / 2;
  return { median, n, worst: taken[n - 1]! };
}

/**
 * The slowest read of a set of samples, by path — the tile a reader waits on longest, which is where a fix pays.
 *
 * @param samples every sample of one row
 * @returns the path and its worst time, or `undefined` when the row started no read
 */
export function slowestRead({
  samples,
}: {
  samples: readonly { reads: readonly ApiRead[] }[];
}): { path: string; ms: number } | undefined {
  let slowest: { path: string; ms: number } | undefined;
  for (const sample of samples) {
    for (const read of sample.reads) {
      // A read that failed has no duration to rank; the run's NOT A MEASUREMENT line names it instead.
      if (read.notMeasured === true || read.ms === undefined) {
        continue;
      }
      if (slowest === undefined || read.ms > slowest.ms) {
        slowest = { ms: read.ms, path: read.path };
      }
    }
  }
  return slowest;
}

/**
 * The paths of the reads still in flight that one measured window started — those sent at or after `since`.
 *
 * The warm clicks share one page and one ledger, so a read sent before the click is the previous page's: a poll still
 * running, or one a document navigation cancelled without the browser ever reporting it finished or failed. Neither is
 * the click's to wait on or to answer for. MEASURED, the baseline walk of `:3101`: before this, each click
 * after the first document load listed every earlier stranded read again as its own, up to 47 on one click — repro: the walk's `report.json`,
 * the longest `clicks[].unanswered`.
 *
 * @param inflight every read not yet settled, with the instant it was sent
 * @param since the instant the measured action began
 * @returns the paths the window still owes, in send order
 */
export function readsOwedSince({
  inflight,
  since,
}: {
  inflight: Iterable<{ readonly path: string; readonly sentAt: number }>;
  since: number;
}): readonly string[] {
  return [...inflight].filter((read) => read.sentAt >= since).map((read) => read.path);
}

/**
 * The last instant one measured window's own reads moved — one sent, or one settled — which the quiet window counts
 * from. A read from before the window landing during it moves nothing here, for the reason {@link readsOwedSince}
 * gives.
 *
 * @param inflight every read not yet settled, with the instant it was sent
 * @param settled every settled read, with the instant it started and the instant it was classified
 * @param since the instant the measured action began
 * @returns the latest such instant, or `since` when the window's reads have not moved yet
 */
export function lastWindowChange({
  inflight,
  settled,
  since,
}: {
  inflight: Iterable<{ readonly sentAt: number }>;
  settled: readonly { readonly start: number; readonly classified: number }[];
  since: number;
}): number {
  let last = since;
  for (const read of inflight) {
    if (read.sentAt >= since) {
      last = Math.max(last, read.sentAt);
    }
  }
  for (const read of settled) {
    if (read.start >= since) {
      last = Math.max(last, read.classified);
    }
  }
  return last;
}

/**
 * Why a live read is not a reading, or `undefined` when it is one. Only a 200 carrying `ok: true` is a reading; a
 * refusal, any other status, or a body that is not a `LiveResult` is a failure with no number, because a fast error
 * timed as a duration would print as the quickest read in the table. The one judge of a live read, for the reads a
 * page makes and the verbs timed alone alike, so a body drifting from `LiveResult` is refused by name on both. A non-200 is judged by its status alone: the route's 404 carries `{ error }`.
 *
 * @param status the route's HTTP status
 * @param text the response body as sent
 * @returns why it is not a reading, or `undefined`
 */
export function liveReadFailure({ status, text }: { status: number; text: string }): string | undefined {
  if (status !== 200) {
    return `the route answered HTTP ${String(status)}`;
  }
  const read = LIVE_RESULT.parseJson({ text });
  if (read.isErr()) {
    return read.error.message;
  }
  // A reading lacking `payload` is refused above by name: the boundary holds a declared-unread key to be present.
  return read.value.ok ? undefined : read.value.notMeasured;
}

/**
 * What the live route answers on a 200 (`LiveResult`, `site/app/api/live/[verb]/route.ts`), restated strictly: `site`
 * is a separate project. `payload` is the verb's own output and is declared unread — what is judged here is whether
 * the route answered a reading, never what the reading said.
 */
const LIVE_RESULT = defineBoundary({
  endpoint: "GET /api/live/[verb]",
  schema: z.discriminatedUnion("ok", [
    z.strictObject({
      fixture: z.string().optional(),
      observedAtIso: z.string(),
      ok: z.literal(true),
      payload: z.unknown(),
      stampedByRoute: z.boolean(),
    }),
    z.strictObject({ notMeasured: z.string(), observedAtIso: z.string(), ok: z.literal(false) }),
  ]),
});

/**
 * One verb timing from what the live route answered: its duration only when {@link liveReadFailure} finds none.
 *
 * @param slug the live read's slug
 * @param status the route's HTTP status
 * @param text the response body as sent
 * @param ms request to last byte
 * @returns the sample, carrying either a duration or why there is none
 */
export function verbSampleOf({
  slug,
  status,
  text,
  ms,
}: {
  slug: string;
  status: number;
  text: string;
  ms: number;
}): VerbSample {
  const failed = liveReadFailure({ status, text });
  if (failed !== undefined) {
    return { failed, ms: undefined, slug };
  }
  return { failed: undefined, ms, slug };
}

/**
 * Every live read in a run that failed, never answered before the settle cap, or answered `NOT MEASURED`, by path —
 * a page's or a click's read, or a verb timed alone. One still unanswered is closed with the page that started it, so
 * it never reaches the reads at all; it is counted from the sample's `unanswered` instead. A walk with any is not a measurement of the console: the verb printing it judges a run with one as
 * failed, whatever the budgets say.
 *
 * @param report the run
 * @returns each refused path once, in walk order
 */
export function refusedReads({ report }: { report: ConsoleProfileReport }): readonly string[] {
  const paths = [...report.loads, ...report.clicks].flatMap((sample) => [
    ...sample.reads.filter((read) => read.notMeasured === true).map((read) => read.path),
    ...sample.unanswered,
  ]);
  const verbs = report.verbs.filter((verb) => verb.failed !== undefined).map((verb) => `/api/live/${verb.slug}`);
  return [...new Set([...paths, ...verbs])];
}

/**
 * Group samples by a key, keeping first-seen order so a table reads in walk order.
 *
 * @param keyOf the grouping key of one sample
 * @returns one group per key
 */
export function groupInOrder<T>({
  samples,
  keyOf,
}: {
  samples: readonly T[];
  keyOf: (sample: T) => string;
}): readonly { key: string; samples: readonly T[] }[] {
  const groups = new Map<string, T[]>();
  for (const sample of samples) {
    const key = keyOf(sample);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [sample]);
    } else {
      group.push(sample);
    }
  }
  return [...groups].map(([key, members]) => ({ key, samples: members }));
}
