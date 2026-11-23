/**
 * The unit lane's CI split: how many shard jobs run it, the exact command each one runs, and the one check
 * that stands between those shards' reports and the coverage floor that reads them.
 *
 * ## Why the lane is sharded across JOBS, not tuned inside one
 *
 * MEASURED on the larger runner (16 vCPU, 64 GiB), paired jobs in one lap of the experiment
 * branch, same tree: the whole lane with coverage took 6:54 in its test step; without coverage 2:44,
 * whose own summary read `import 1308s, tests 319s` of about 2,400 worker-seconds. The import time is a long
 * tail — 110,680 module evaluations, the heaviest single hub 2.4s — so no one lazy import moves it. The
 * runner was already saturated, so the cut that scales with the tree is more runners: four shards took
 * 1:24–2:01 each, and the merge of their reports 26s. Re-read those laps with:
 *
 * ```bash
 * slopweaver github ci-runs --branch ci-perf-experiments --event pull_request --workflow perf-experiment.yml --steps
 * ```
 *
 * The lane runs NON-ISOLATED (`config/vitest/unit.ts`), so a worker imports a module once rather than once per
 * file. What a shard still pays is loading the source tree once per worker, which every shard repeats: one
 * unit shard read `transform 192s, setup 28s, import 337s, tests 214s`. A shard therefore costs a fixed share of
 * the tree as well as its own tests, which is the trade against raising the count.
 *
 * ## Why the merge checks the reports it was handed
 *
 * `vitest --merge-reports` merges whatever blob files sit in the directory and checks only that they share
 * a Vitest version. A shard whose artifact never arrived therefore merges into a SMALLER lane that still
 * passes — and the coverage floor, reading that smaller report, judges a number no whole lane produced.
 * {@link blobSetFindings} makes the set exact before anything reads it, so a missing, extra or foreign
 * report fails the merge rather than quietly shrinking what it proves.
 */

import picomatch from "picomatch";

/**
 * How many shard jobs the unit lane runs in CI. Raise it when the slowest shard nears the five-minute bar:
 * every derived name, command and blob below follows this one number, and `ci-offload-contract` refuses a
 * `ci.yml` that disagrees with it.
 */
export const UNIT_SHARD_COUNT = 6;

/** The directory Vitest's blob reporter writes to, and the merge reads from. */
export const UNIT_BLOB_DIRECTORY = ".vitest-reports";

/** The 1-based shard indexes, in order. */
function shardIndexes(): readonly number[] {
  return Array.from({ length: UNIT_SHARD_COUNT }, (_unused, position) => position + 1);
}

/**
 * The CI job that runs one shard.
 *
 * @param index the 1-based shard number
 * @returns the job id, `unit-<index>`
 */
export function unitShardJob({ index }: { index: number }): string {
  return `unit-${String(index)}`;
}

/**
 * Every shard job, in order.
 *
 * @returns `unit-1` through `unit-<count>`
 */
export function unitShardJobs(): readonly string[] {
  return shardIndexes().map((index) => unitShardJob({ index }));
}

/**
 * The exact command one shard job runs — `test:unit` (which always carries `--coverage`) narrowed to one
 * shard, printing the usual summary (so a red shard names its failing test) and writing a blob report the
 * merge rebuilds the whole lane's coverage from.
 *
 * @param index the 1-based shard number
 * @returns the step's whole `run:` line
 */
export function unitShardCommand({ index }: { index: number }): string {
  return `yarn test:unit --shard=${String(index)}/${String(UNIT_SHARD_COUNT)} --reporter=default --reporter=blob`;
}

/**
 * The file Vitest's blob reporter names for one shard — `blob-<index>-<count>.json`, fixed by Vitest itself.
 *
 * @param index the 1-based shard number
 * @returns the bare file name
 */
export function unitShardBlob({ index }: { index: number }): string {
  return `blob-${String(index)}-${String(UNIT_SHARD_COUNT)}.json`;
}

/**
 * Judge the report directory the merge is about to read against the exact set the shards produce. Pure.
 *
 * @param names the file names present in {@link UNIT_BLOB_DIRECTORY}
 * @returns one line per missing or unexpected file; empty means the set is exact
 */
export function blobSetFindings({ names }: { names: readonly string[] }): readonly string[] {
  const expected = shardIndexes().map((index) => unitShardBlob({ index }));
  const missing = expected
    .filter((name) => !names.includes(name))
    .map((name) => `missing ${name} — its shard's report never arrived, so the merge would be a smaller lane`);
  const extra = names
    .filter((name) => !expected.includes(name))
    .map((name) => `unexpected ${name} — not one of the ${String(UNIT_SHARD_COUNT)} shard reports this lap produces`);
  return [...missing, ...extra];
}

/**
 * Judge the test files the merge actually folded in against the whole lane's file list. Pure. The report
 * NAMES can be exact while their CONTENTS are not — MEASURED, a directory holding one shard's
 * report under both shard names merged with exit 0 and listed that shard's files twice — so this is the
 * check that proves every test file ran exactly once, whatever the reports were called.
 *
 * @param expected every test file the lane's config selects, from `vitest list --filesOnly`
 * @param merged every test file in the merged report, once per report that carried it
 * @returns one line per kind of mismatch, naming how many and the first few; empty means exact
 */
export function mergedFileFindings({
  expected,
  merged,
}: {
  expected: readonly string[];
  merged: readonly string[];
}): readonly string[] {
  const counts = new Map<string, number>();
  for (const file of merged) {
    const seen = counts.get(file);
    counts.set(file, seen === undefined ? 1 : seen + 1);
  }
  const wanted = new Set(expected);
  const kinds = [
    {
      files: expected.filter((file) => !counts.has(file)),
      what: "never ran in any shard, so the merged lane is smaller than the lane",
    },
    {
      files: [...counts].filter(([, count]) => count > 1).map(([file]) => file),
      what: "ran in more than one merged report, so one report was duplicated in place of another",
    },
    {
      files: [...counts.keys()].filter((file) => !wanted.has(file)),
      what: "is not in the lane's own file list",
    },
  ];
  // Fail closed: an EMPTY lane list makes every comparison above vacuously exact, so "all 0 test files
  // merged" would pass a lane that selected nothing at all.
  const empty = expected.length === 0 ? [EMPTY_LANE_FINDING] : [];
  return [
    ...empty,
    ...kinds
      .filter((kind) => kind.files.length > 0)
      .map((kind) => `${String(kind.files.length)} test file(s) ${kind.what}: ${kind.files.slice(0, 3).join(", ")}`),
  ];
}

/** What {@link mergedFileFindings} says when the lane's own config selected no test file. */
export const EMPTY_LANE_FINDING = "the unit lane's config selected 0 test files, so a merge proves nothing ran";

/** The directories the unit lane's include walks, each the root of one glob below. */
export const UNIT_LANE_ROOTS: readonly string[] = [
  "src/__tests__/unit",
  "site/__tests__/unit",
  "desktop/__tests__/unit",
];

/** The unit lane's test include, read by `config/vitest/unit.ts` and by {@link unlistedLaneFindings} alike. */
export const UNIT_LANE_INCLUDE: readonly string[] = UNIT_LANE_ROOTS.map((root) => `${root}/**/*.test.ts`);

/**
 * Vitest 4's default `test.exclude`, which the unit lane does not override. Repro:
 * `grep -rn "defaultExclude = " node_modules/vitest/dist/chunks`.
 */
const VITEST_DEFAULT_TEST_EXCLUDE = ["**/node_modules/**", "**/.git/**"];

/**
 * Judge Vitest's own list of the lane against the files git lists. Pure. Vitest walks the lane's include with
 * tinyglobby, which skips a directory it cannot read and says nothing, so `vitest list` and every shard agree
 * on the same SHORT lane and {@link mergedFileFindings} calls it exact (a `chmod 000` directory under a unit
 * root). git's listing refuses that directory instead, so a lane file git lists that Vitest never
 * selected is the walk's gap. Matched the way Vitest's glob matches: `dot: true`, its default exclude.
 *
 * @param expected every test file `vitest list --filesOnly` selected, repo-relative
 * @param listed every file git lists in the working tree and on disk, repo-relative
 * @returns one line naming how many lane files Vitest's walk missed and the first few; empty means none
 */
export function unlistedLaneFindings({
  expected,
  listed,
}: {
  expected: readonly string[];
  listed: readonly string[];
}): readonly string[] {
  const selects = picomatch([...UNIT_LANE_INCLUDE], { dot: true, ignore: VITEST_DEFAULT_TEST_EXCLUDE });
  const wanted = new Set(expected);
  const missing = listed.filter((file) => selects(file) && !wanted.has(file));
  if (missing.length === 0) {
    return [];
  }
  return [
    `${String(missing.length)} test file(s) git lists that the lane's own walk never selected, so it skipped a directory: ${missing.slice(0, 3).join(", ")}`,
  ];
}
