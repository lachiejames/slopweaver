/**
 * The coverage floor's pure cores — the shape of `coverage-baseline.json`, how a V8 summary becomes a
 * measurement, and the three comparisons the gate in `coverageRatchet.ts` runs over them. Nothing here
 * touches a file, git or `process`; every function is unit-tested under
 * `src/__tests__/unit/devLint/coverageRatchet/`, bar `loweredMetrics`, tested in
 * `src/__tests__/subprocess/devLint/coverageFloorIntegrity.test.ts`.
 *
 * ## The floor ratchets to measured-minus-one
 *
 * MEASURED: statements 74.95% against a floor of 70 whose whole git history was one commit — 4,663
 * statements could stop being covered before CI reddened, and a week later that headroom had grown 25%
 * because the tree grew underneath a number nobody moved. So a rebaseline no longer copies
 * the measurement into the floor: it writes `measured − RATCHET_SLACK_PCT` (never below the floor already
 * committed), and the measured half REPORTS a floor that lags the measurement by more than
 * `STALE_HEADROOM_PCT`, with the rebaseline to run. It does not fail on it: staleness is reported, not red,
 * accepting that up to the gap between floor and measurement can be lost without a red until someone raises
 * the floor. The two numbers differ on purpose: at 1 and 1 the report would fire on every pull request
 * raising coverage by 0.01; at 1 and 2 it fires about once a week at the measured drift (−0.24 points over
 * eight days). Reproduce the report: `yarn test:unit && yarn coverage:ratchet`.
 *
 * ## A per-directory floor (option C — a weak directory cannot hide behind a healthy average)
 *
 * MEASURED: the eight worst directories all sat under the repo floor — `src/browser` 40.21%,
 * `src/devLint` 57.77%, `src/cli` 58.63% — and `src/cli` alone held 52% of every uncovered statement, while
 * the one repo-wide number said 74.95 and the gate said clean. Each top-level directory under `src/` now
 * carries its own STATEMENT floor, ratcheted the same way. Statements only: the audit's own measure, and
 * the stable one — branch and function percentages in a small directory swing tens of points on one file.
 * A directory with fewer than `MIN_DIRECTORY_STATEMENTS` is not floored at all, because at that size one
 * new function moves the percentage further than the slack, and the gate would price adding code rather
 * than adding uncovered code. Reproduce the roster: `yarn test:unit && yarn coverage:rebaseline` and read
 * the `directories` block it writes.
 *
 * ## The blind spot, stated rather than discovered
 *
 * DELETING a directory floor from the committed file is not a lowering {@link loweredMetrics} can catch,
 * because the integrity half runs under `--summary-only` with no measurement in hand and therefore cannot
 * tell a directory that was removed from one that is still there. For a directory at or over
 * {@link MIN_DIRECTORY_STATEMENTS} that costs nothing — the measured half refuses it as `unfloored` on the
 * very next run. The residue is a directory that has SHRUNK under the cut: a rebaseline keeps its floor, and
 * a hand edit removing it passes both halves. Closing it would mean refusing every legitimate deletion of a
 * directory, which is a red CI with no way through, so the hole is smaller than its fix.
 */

import { z } from "zod";
import { parseJson } from "../lib/jsonParse.js";
import { err, ok, type Result } from "../lib/result.js";
import { type CoverageFloorError, CoverageFloorErrors } from "./coverageFloorErrors.js";

/**
 * How far under the measurement a rebaseline places the floor, in percentage points. One point is the
 * owner's "measured-minus-one"; it is the whole bounded loss between two rebaselines that land at the demand.
 */
export const RATCHET_SLACK_PCT = 1;

/**
 * How far the committed floor may lag the measurement before the gate reports it and names the rebaseline.
 * Strictly greater than {@link RATCHET_SLACK_PCT}, so the tree a rebaseline just landed on is never stale
 * the moment one more test lands on top of it — see the module header for the measured churn that rules out 1.
 */
export const STALE_HEADROOM_PCT = 2;

/**
 * The smallest directory that gets its own floor, in statements. At this size the one-point slack is two
 * statements, which is already one short function. MEASURED on this tree: 41 of 57 `src/<dir>`
 * buckets are at or over it; the 16 under it hold 1,586 of 125,631 statements (1.3%), the smallest floored
 * bucket is `src/hygiene` at 204. Reproduce: `yarn test:unit && yarn coverage:rebaseline`, then count the
 * `directories` block against the buckets `directoryStatementsOf` produces from the summary.
 */
export const MIN_DIRECTORY_STATEMENTS = 200;

/** The four coverage metrics the floor tracks, as rounded percentages. */
export interface CoverageMetrics {
  readonly branches: number;
  readonly functions: number;
  readonly lines: number;
  readonly statements: number;
}

/** One directory's statement floor. Statements only — see the module header for why. */
interface DirectoryFloor {
  readonly statements: number;
}

/** The committed floor: a version tag, the four repo-wide minimums, and one statement floor per directory. */
export interface CoverageBaseline {
  readonly version: number;
  readonly summary: CoverageMetrics;
  readonly directories: Readonly<Record<string, DirectoryFloor>>;
}

/** One directory as measured: its statement percentage and how many statements that percentage is over. */
export interface DirectoryMeasurement {
  readonly statements: number;
  readonly statementCount: number;
}

/** What a V8 summary measures, once aggregated: the four totals and every `src/<dir>` bucket. */
export interface CoverageMeasurement {
  readonly summary: CoverageMetrics;
  readonly directories: Readonly<Record<string, DirectoryMeasurement>>;
  /** Every file the report names, root-relative, so a report that left a source file out can be refused. */
  readonly reportedFiles: readonly string[];
}

/** The metric keys, in report order. */
const COVERAGE_METRIC_KEYS = ["branches", "functions", "lines", "statements"] as const;

const pctSchema = z.object({ pct: z.number() });
const totalSchema = z.object({ branches: pctSchema, functions: pctSchema, lines: pctSchema, statements: pctSchema });
// A statement count is a non-negative integer: a negative one measured nothing yet slipped past a zero test.
const countSchema = z.number().int().nonnegative();
const fileSchema = z.object({ statements: z.object({ covered: countSchema, total: countSchema }) });
const summarySchema = z.looseObject({ total: totalSchema });
const metricsSchema = z.object({
  branches: z.number(),
  functions: z.number(),
  lines: z.number(),
  statements: z.number(),
});
const directoryFloorSchema = z.object({ statements: z.number() });
// `directories` defaults to none: the base commit's file predates the per-directory floor, and the measured
// half then refuses every large directory as unfloored, so an absent block is loud rather than a bypass.
const baselineSchema = z.object({
  directories: z.record(z.string(), directoryFloorSchema).default({}),
  summary: metricsSchema,
  version: z.number(),
});

/**
 * Round to two decimals — the baseline's granularity, so float noise can never flake the gate. Pure.
 *
 * @param value the raw percentage
 * @returns the value at the baseline's granularity, so a run that changed nothing cannot drift the gate red
 */
export function round2({ value }: { value: number }): number {
  return Math.round(value * 100) / 100;
}

/**
 * The floor bucket a covered file belongs to: `src/<first>` for a file at least one directory below `src/`,
 * `src` itself for a file sitting directly in it, and `undefined` for anything outside `src/`. Pure.
 *
 * @param relativePath the file's path relative to the repository root, `/`-separated
 * @returns the bucket, or `undefined` when the file is not under `src/`
 */
export function directoryBucketOf({ relativePath }: { relativePath: string }): string | undefined {
  const parts = relativePath.split("/");
  if (parts[0] !== "src" || parts.length < 2) {
    return undefined;
  }
  if (parts.length === 2) {
    return "src";
  }
  return `src/${parts[1]!}`;
}

/**
 * Aggregate a summary's per-file entries into one statement percentage per `src/<dir>` bucket. Pure — a
 * bucket with no statements at all is left out rather than reported as 0% or NaN.
 *
 * @param files each covered file's root-relative path and statement counts
 * @returns every bucket's rounded percentage and statement count, keyed by bucket
 */
export function directoryStatementsOf({
  files,
}: {
  files: readonly { readonly relativePath: string; readonly covered: number; readonly total: number }[];
}): Readonly<Record<string, DirectoryMeasurement>> {
  const totals = new Map<string, { covered: number; total: number }>();
  for (const file of files) {
    const bucket = directoryBucketOf({ relativePath: file.relativePath });
    if (bucket === undefined) {
      continue;
    }
    const running = totals.get(bucket);
    if (running === undefined) {
      totals.set(bucket, { covered: file.covered, total: file.total });
    } else {
      running.covered += file.covered;
      running.total += file.total;
    }
  }
  const directories: Record<string, DirectoryMeasurement> = {};
  for (const [bucket, { covered, total }] of [...totals.entries()].toSorted(([a], [b]) => a.localeCompare(b))) {
    if (total > 0) {
      directories[bucket] = { statementCount: total, statements: round2({ value: (100 * covered) / total }) };
    }
  }
  return directories;
}

/**
 * Extract the four rounded total percentages and the per-directory statement percentages from a V8
 * `coverage-summary.json`. Pure — a malformed summary is a typed error, never a throw. Every non-`total`
 * key is a file's ABSOLUTE path; a file outside `root` is an error rather than a quiet omission, because a
 * quiet omission is a directory that never gets a floor.
 *
 * @param text the summary file text
 * @param root the repository root the file paths are made relative to
 * @returns the measurement, or an error string
 */
export function parseCoverageSummary({
  text,
  root,
}: {
  text: string;
  root: string;
}): Result<CoverageMeasurement, CoverageFloorError> {
  const parsed = parseJson({ text });
  if (parsed.isErr()) {
    return err(CoverageFloorErrors.summaryMalformed({ detail: parsed.error.message }));
  }
  const decoded = summarySchema.safeParse(parsed.value);
  if (!decoded.success) {
    return err(CoverageFloorErrors.summaryShape());
  }
  const { total, ...rest } = decoded.data;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  const files: { relativePath: string; covered: number; total: number }[] = [];
  for (const [path, entry] of Object.entries(rest)) {
    const file = fileSchema.safeParse(entry);
    if (!file.success) {
      return err(CoverageFloorErrors.summaryFileEntryCounts({ path }));
    }
    if (!path.startsWith(prefix)) {
      return err(CoverageFloorErrors.summaryFileEntryOutsideRoot({ path, root: prefix }));
    }
    files.push({
      covered: file.data.statements.covered,
      relativePath: path.slice(prefix.length),
      total: file.data.statements.total,
    });
  }
  // Fail closed: totals over no measured statement (no file, or only zero-statement files) measured nothing,
  // and high totals would clear every floor. A zero-statement file slipped past a bare length check.
  if (!files.some((file) => file.total > 0)) {
    return err(
      CoverageFloorErrors.summaryMalformed({ detail: "measured no statement in any file, so it measured nothing" }),
    );
  }
  return ok({
    directories: directoryStatementsOf({ files }),
    reportedFiles: files.map((file) => file.relativePath),
    summary: {
      branches: round2({ value: total.branches.pct }),
      functions: round2({ value: total.functions.pct }),
      lines: round2({ value: total.lines.pct }),
      statements: round2({ value: total.statements.pct }),
    },
  });
}

/**
 * Decode a committed baseline file. Pure.
 *
 * @param text the baseline file text
 * @returns the baseline, or an error string
 */
export function parseBaselineJson({ text }: { text: string }): Result<CoverageBaseline, CoverageFloorError> {
  const parsed = parseJson({ text });
  if (parsed.isErr()) {
    return err(CoverageFloorErrors.baselineMalformed({ detail: parsed.error.message }));
  }
  const decoded = baselineSchema.safeParse(parsed.value);
  if (!decoded.success) {
    return err(CoverageFloorErrors.baselineShape());
  }
  return ok({ directories: decoded.data.directories, summary: decoded.data.summary, version: decoded.data.version });
}

/** The directories a measurement is large enough to floor, in key order. */
function floorableDirectories({
  current,
}: {
  current: CoverageMeasurement;
}): readonly (readonly [string, DirectoryMeasurement])[] {
  return Object.entries(current.directories).filter(
    ([, measured]) => measured.statementCount >= MIN_DIRECTORY_STATEMENTS,
  );
}

/** One shortfall: what fell (a metric key, or `<dir> statements`) and the line a refusal prints for it. */
export interface Shortfall {
  readonly subject: string;
  readonly message: string;
}

/**
 * Compare a measurement against the floor. Pure. Three lists, each empty when the gate is clean:
 *
 *  - `drops` — a repo metric or a floored directory measured BELOW its floor (at two-decimal granularity);
 *  - `stale` — a repo metric whose floor lags the measurement by more than {@link STALE_HEADROOM_PCT};
 *  - `unfloored` — a directory at or over {@link MIN_DIRECTORY_STATEMENTS} with no floor entry.
 *
 * Each entry carries its `subject` beside the message so {@link rebaselinePlan} can name what fell without
 * parsing prose back out of a formatted line — one function decides what a shortfall IS, and two callers
 * read the same answer differently.
 *
 * A directory that has a floor but is now under the size cut still holds it — a floor is only ever dropped
 * by a rebaseline, once the directory is gone.
 *
 * @param current the measurement
 * @param baseline the committed floor
 * @returns the three shortfall lists, and `ok` when all are empty
 */
export function compareCoverage({ current, baseline }: { current: CoverageMeasurement; baseline: CoverageBaseline }): {
  readonly ok: boolean;
  readonly drops: readonly Shortfall[];
  readonly stale: readonly Shortfall[];
  readonly unfloored: readonly Shortfall[];
} {
  const drops: Shortfall[] = [];
  const stale: Shortfall[] = [];
  for (const key of COVERAGE_METRIC_KEYS) {
    const measured = round2({ value: current.summary[key] });
    const floor = round2({ value: baseline.summary[key] });
    if (measured < floor) {
      drops.push({ message: `${key}: ${String(measured)}% < floor ${String(floor)}%`, subject: key });
    } else if (round2({ value: measured - floor }) > STALE_HEADROOM_PCT) {
      stale.push({
        message: `${key}: floor ${String(floor)}% lags measured ${String(measured)}% by more than ${String(STALE_HEADROOM_PCT)} points`,
        subject: key,
      });
    }
  }
  for (const [directory, floor] of Object.entries(baseline.directories)) {
    const measured = current.directories[directory];
    if (measured !== undefined && round2({ value: measured.statements }) < round2({ value: floor.statements })) {
      drops.push({
        message: `${directory} statements: ${String(measured.statements)}% < floor ${String(floor.statements)}%`,
        subject: `${directory} statements`,
      });
    }
  }
  const unfloored = floorableDirectories({ current })
    .filter(([directory]) => baseline.directories[directory] === undefined)
    .map(([directory, measured]) => ({
      message: `${directory}: ${String(measured.statementCount)} statements at ${String(measured.statements)}% and no floor`,
      subject: directory,
    }));
  return { drops, ok: drops.length === 0 && stale.length === 0 && unfloored.length === 0, stale, unfloored };
}

/**
 * The floored directories a report left out while they still exist. {@link compareCoverage} skips a floored
 * directory with no measurement, because a deleted directory takes its floor with it — but a truncated or
 * partial report looks the same, and would pass every floor it omitted. That was measured exactly: one
 * file's report, every other floor skipped, the gate clean. Only the checkout can tell the two apart, so the
 * shell passes `directoriesWithSources` (`coverageCompleteness.ts`) over the listed source tree. Pure.
 *
 * @param current the measurement
 * @param baseline the committed floor
 * @param onDisk the `src/<dir>` buckets that still hold a source file coverage measures
 * @returns one shortfall per floored directory that is on disk and was not measured, in key order
 */
export function unmeasuredFloors({
  current,
  baseline,
  onDisk,
}: {
  current: CoverageMeasurement;
  baseline: CoverageBaseline;
  onDisk: ReadonlySet<string>;
}): readonly Shortfall[] {
  return Object.entries(baseline.directories)
    .filter(([directory]) => onDisk.has(directory) && current.directories[directory] === undefined)
    .map(([directory, floor]) => ({
      message: `${directory} statements: floored at ${String(floor.statements)}% and still on disk, but the report measured nothing under it`,
      subject: `${directory} statements`,
    }));
}

/** The floor a rebaseline writes for one measurement: measured minus the slack, never below what is committed. */
function ratchetedFloor({ measured, committed }: { measured: number; committed: number }): number {
  return Math.max(round2({ value: committed }), round2({ value: measured - RATCHET_SLACK_PCT }));
}

/**
 * The rebaseline plan: every floor moves to measured-minus-{@link RATCHET_SLACK_PCT}, never downward, and a
 * measurement BELOW a floor refuses the whole rebaseline (there is no `--allow-lower`). Directories: one
 * floor per directory large enough to carry one, an existing floor kept where the directory is now under
 * the size cut, and a floor dropped only when its directory is no longer measured at all. Pure.
 *
 * @param current the measurement
 * @param baseline the committed baseline
 * @returns the new baseline to write, or the metrics and directories that would have lowered the floor
 */
export function rebaselinePlan({
  current,
  baseline,
}: {
  current: CoverageMeasurement;
  baseline: CoverageBaseline;
}): Result<CoverageBaseline, CoverageFloorError> {
  const { drops } = compareCoverage({ baseline, current });
  if (drops.length > 0) {
    return err(CoverageFloorErrors.rebaselineWouldLower({ subjects: drops.map((drop) => drop.subject) }));
  }
  const directories: Record<string, DirectoryFloor> = {};
  for (const [directory, measured] of floorableDirectories({ current })) {
    const committed = baseline.directories[directory];
    directories[directory] = {
      statements: ratchetedFloor({
        committed: committed === undefined ? 0 : committed.statements,
        measured: measured.statements,
      }),
    };
  }
  for (const [directory, floor] of Object.entries(baseline.directories)) {
    if (directories[directory] === undefined && current.directories[directory] !== undefined) {
      directories[directory] = floor;
    }
  }
  return ok({
    directories: Object.fromEntries(Object.entries(directories).toSorted(([a], [b]) => a.localeCompare(b))),
    summary: {
      branches: ratchetedFloor({ committed: baseline.summary.branches, measured: current.summary.branches }),
      functions: ratchetedFloor({ committed: baseline.summary.functions, measured: current.summary.functions }),
      lines: ratchetedFloor({ committed: baseline.summary.lines, measured: current.summary.lines }),
      statements: ratchetedFloor({ committed: baseline.summary.statements, measured: current.summary.statements }),
    },
    version: 2,
  });
}

/**
 * Which floors are LOWER in `current` than in `base`. Pure. EXACT — deliberately not rounded.
 *
 * {@link compareCoverage} rounds to two decimals because it compares a MEASUREMENT against the floor, and
 * measured coverage carries float noise that would otherwise flake the gate. This comparison has no such
 * excuse: both sides are literals someone committed to a JSON file. Rounding here would mean `66 -> 65.999`
 * reports clean, which is a blind spot at exactly the boundary the gate exists to hold — and a rounded
 * comparison is not the property anyone reading "the floor may not be lowered" would expect.
 *
 * Mixed movement counts: raising three metrics while dropping one is still a lowering, and returns just the
 * dropped one. A directory floor present on both sides and lower at `current` is a lowering too. A directory
 * floor ABSENT at `current` is not: a directory that was deleted loses its floor at the next rebaseline, and
 * a directory that still exists with no floor is what the measured half's `unfloored` list refuses.
 *
 * @param current the floor as committed on this branch
 * @param base the floor as committed at the comparison commit
 * @returns the metric and directory names that fell, in report order
 */
export function loweredMetrics({
  current,
  base,
}: {
  current: CoverageBaseline;
  base: CoverageBaseline;
}): readonly string[] {
  const metrics = COVERAGE_METRIC_KEYS.filter((key) => current.summary[key] < base.summary[key]).map(
    (key) => `${key}: ${String(base.summary[key])}% -> ${String(current.summary[key])}%`,
  );
  const directories = Object.entries(base.directories)
    .filter(([directory, floor]) => {
      const now = current.directories[directory];
      return now !== undefined && now.statements < floor.statements;
    })
    .map(
      ([directory, floor]) =>
        `${directory} statements: ${String(floor.statements)}% -> ${String(current.directories[directory]!.statements)}%`,
    );
  return [...metrics, ...directories];
}
