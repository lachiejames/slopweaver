/**
 * `slopweaver github ci-timing` — the pure half: what was typed, which rows a run's jobs become, and how they
 * read.
 *
 * The report has no opinion. It prints each job's wall time and never fails on one: the owner ruled CI job
 * timing reported, not red, and the five-minute bar is decided only
 * after a measured window on the runner the repository settles on — `docs/toolchain/ci-timing.md`. So
 * nothing here may grow a bar, a band, a baseline or a verdict word; a reader who wants one reads the table.
 *
 * Usage problems reuse `./ciRunsErrors.ts`'s union rather than authoring fresh strings into `err()`:
 * `src/cli/commands/github` is a standing directory on the `error-shape-threshold` debt list, and a
 * message built by a factory is not a shape.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { type CiTimingError, CiTimingErrors } from "../../../live/github/ciTimingErrors.js";
import { type JobTiming, parseRunJobsPage } from "../../../live/github/runHistoryParse.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";
import { type CiUsageIssues, ciFlagNames, ciPositiveInteger } from "./ciFlagParsing.js";
import { GithubCiRunsUsageIssues } from "./ciRunsErrors.js";

/** The string-valued flags, named once so the spec and the usage text cannot disagree. */
const TIMING_STRING_FLAGS: readonly string[] = ["repo", "run-id", "home"];

/**
 * The flags this verb accepts.
 *
 * @internal — the parser and {@link GITHUB_CI_TIMING_FLAG_NAMES} are its only readers.
 */
export const GITHUB_CI_TIMING_FLAGS: FlagSpec = { boolean: [], string: TIMING_STRING_FLAGS };

/** Every accepted flag, with the `--` callers type. */
export const GITHUB_CI_TIMING_FLAG_NAMES: readonly string[] = ciFlagNames({
  booleans: [],
  strings: TIMING_STRING_FLAGS,
});

/** A parsed, side-effect-free invocation. */
export interface GithubCiTimingArgs {
  readonly repo: string | undefined;
  readonly runId: number;
  readonly home: string | undefined;
}

/**
 * One job of the run, as the report prints it: timed, or not measured and why.
 *
 * `skipped` is GitHub's own conclusion; `no instants` is a job missing its start or its end, which is a
 * job still running or one GitHub never started. Neither is a fast job, so neither carries a number.
 */
export type CiTimingRow =
  | { readonly kind: "measured"; readonly name: string; readonly wallSeconds: number }
  | { readonly kind: "not-measured"; readonly name: string; readonly reason: "skipped" | "no instants" };

/**
 * Parse one `github ci-timing` invocation before any credential or network is touched.
 *
 * `--run-id` is REQUIRED: the report reads one run, and a default of "the latest" would report whatever
 * landed while this one was queued.
 *
 * @param rest the argv tail after `github ci-timing`
 * @returns the resolved options, or every usage problem found
 */
export function parseGithubCiTimingArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GithubCiTimingArgs, CiUsageIssues> {
  const parsed = parseFlags({ args: rest, spec: GITHUB_CI_TIMING_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error.map((message) => GithubCiRunsUsageIssues.flagParse({ message })));
  }
  const values = parsed.value.values;
  const runId = ciPositiveInteger({ max: undefined, value: values["run-id"] });
  if (runId.kind === "absent") {
    return err([GithubCiRunsUsageIssues.runIdMissing()]);
  }
  if (runId.kind === "invalid") {
    return err([GithubCiRunsUsageIssues.runIdNotNumeric()]);
  }
  const repo = values["repo"];
  const home = values["home"];
  return ok({
    home: typeof home === "string" ? home : undefined,
    repo: typeof repo === "string" ? repo : undefined,
    runId: runId.value,
  });
}

/**
 * Time the folded job rows of one run, refusing a read that could not name every job.
 *
 * The page parser drops a row with no readable name and only COUNTS it. With no list of expected jobs left
 * to compare against, a dropped row would simply be a job missing from a report that still exits 0, so any
 * drop fails the read: a report that cannot say it is complete is not produced.
 *
 * @param payload the `{ jobs }` document `readAllAttemptJobRows` folded every attempt into
 * @param runId the run read, named in a refusal
 * @returns one timing per job, or why the run cannot be reported whole
 */
export function jobTimingsOfRun({
  payload,
  runId,
}: {
  payload: unknown;
  runId: number;
}): Result<readonly JobTiming[], CiTimingError> {
  const page = parseRunJobsPage({ payload, runId });
  if (page.isErr()) {
    return err(CiTimingErrors.runReadFailed({ message: page.error.message }));
  }
  if (page.value.dropped > 0) {
    return err(
      CiTimingErrors.runReadFailed({
        message: `run ${String(runId)} returned ${String(page.value.dropped)} job row(s) with no readable name — refusing rather than printing a report that silently leaves a job out`,
      }),
    );
  }
  return ok(page.value.timings);
}

/**
 * Turn a run's job timings into the rows the report prints, its own job left out.
 *
 * The report's own job is in the run it reads and is necessarily still running while it reads, so it can
 * never time itself; it is dropped by NAME. Measured rows come first, slowest first and ties by name, so
 * the job worth a look is the top line; the unmeasured follow by name.
 *
 * @param timings every job the run read returned, one per job name after the attempt fold
 * @param ownJobName the workflow job this report runs in
 * @returns the rows, in print order
 */
export function ciTimingRows({
  timings,
  ownJobName,
}: {
  timings: readonly JobTiming[];
  ownJobName: string;
}): readonly CiTimingRow[] {
  const others = timings.filter((timing) => timing.name !== ownJobName);
  const measured = others
    .flatMap((timing): CiTimingRow[] =>
      timing.wallSeconds === undefined
        ? []
        : [{ kind: "measured", name: timing.name, wallSeconds: Math.round(timing.wallSeconds) }],
    )
    .toSorted((left, right) => byWallThenName({ left, right }));
  const unmeasured = others
    .flatMap((timing): CiTimingRow[] =>
      timing.wallSeconds === undefined
        ? [
            {
              kind: "not-measured",
              name: timing.name,
              reason: timing.conclusion === "skipped" ? "skipped" : "no instants",
            },
          ]
        : [],
    )
    .toSorted((left, right) => left.name.localeCompare(right.name));
  return [...measured, ...unmeasured];
}

/** Slowest first, then by name, for two measured rows. */
function byWallThenName({ left, right }: { left: CiTimingRow; right: CiTimingRow }): number {
  const leftSeconds = left.kind === "measured" ? left.wallSeconds : 0;
  const rightSeconds = right.kind === "measured" ? right.wallSeconds : 0;
  return rightSeconds - leftSeconds || left.name.localeCompare(right.name);
}

/** `390` → `6:30`, the shape every duration in this repository's CI reporting is read in. */
function clock({ seconds }: { seconds: number }): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Render the rows as the table the workflow log shows: one line per job, name then wall time.
 *
 * @param runId the run reported, named in the heading
 * @param rows what {@link ciTimingRows} produced
 * @returns the whole report, ready for one write
 */
export function renderCiTimingText({ runId, rows }: { runId: number; rows: readonly CiTimingRow[] }): string {
  const width = Math.max(0, ...rows.map((row) => row.name.length));
  const lines = rows.map((row) =>
    row.kind === "measured"
      ? `${row.name.padEnd(width)}  ${clock({ seconds: row.wallSeconds }).padStart(5)} (${String(row.wallSeconds)}s)`
      : `${row.name.padEnd(width)}  not measured (${row.reason})`,
  );
  const body = lines.length === 0 ? ["no other job in this run"] : lines;
  return [`ci-timing · run ${String(runId)} · wall time per job`, "", ...body].join("\n");
}
