/**
 * The effectful shell around {@link blobSetFindings} and {@link mergedFileFindings}: refuse an inexact report
 * set, list the lane's own test files, hand the reports to `vitest --merge-reports --coverage` — which writes
 * the one `coverage/` report the floor reads — and then refuse a merge that did not fold in every test file
 * exactly once. Every decision is in `./unitShards.ts`; this file only reads, spawns and prints.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { z } from "zod";
import { workingTreeFilesOf } from "#lib/gitRepo.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { unreadableLaneDirectories } from "./laneWalk.js";
import {
  blobSetFindings,
  mergedFileFindings,
  UNIT_BLOB_DIRECTORY,
  UNIT_LANE_ROOTS,
  unlistedLaneFindings,
} from "./unitShards.js";

/** The unit lane's config, which both the listing and the merge must read. */
const UNIT_CONFIG = "config/vitest/unit.ts";

/** What `vitest list --filesOnly --json` writes: one entry per selected test file. */
const ListedFiles = z.array(z.object({ file: z.string() }));

/** The part of Vitest's JSON reporter this check reads: one entry per merged test file, per report. */
const MergedReport = z.object({ testResults: z.array(z.object({ name: z.string() })) });

/**
 * Print each problem to stderr under the script's name.
 *
 * @param problems the lines to print
 * @returns 1, the exit code a refusal carries
 */
function refuse({ problems }: { problems: readonly string[] }): number {
  for (const problem of problems) {
    process.stderr.write(`test:unit:merge: ${problem}\n`);
  }
  return 1;
}

/**
 * Run the repository's own Vitest with inherited output.
 *
 * @param cwd the repository root
 * @param args the arguments after the binary
 * @returns Vitest's exit status, or 1 when it did not exit normally
 */
function vitest({ cwd, args }: { cwd: string; args: readonly string[] }): number {
  const run = spawnSync(join(cwd, "node_modules", ".bin", "vitest"), args, { cwd, stdio: "inherit" });
  if (run.status === null) {
    return refuse({ problems: [`vitest ${args.join(" ")} did not exit normally (${String(run.signal)})`] });
  }
  return run.status;
}

/**
 * Read one JSON file Vitest wrote and project it through a schema.
 *
 * @param path the file to read
 * @param schema what the file must hold
 * @returns the parsed value, or undefined when the file is missing, not JSON, or the wrong shape
 */
function readJson<T>({ path, schema }: { path: string; schema: z.ZodType<T> }): T | undefined {
  try {
    const parsed = schema.safeParse(safeJsonParse({ label: path, text: readFileSync(path, "utf8") }));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Check Vitest's own walk of the lane against git's listing, which refuses a directory it cannot read where
 * Vitest skips one silently. A tracked file deleted from disk is dropped, since Vitest cannot select it either.
 *
 * @param cwd the repository root
 * @param lane every test file `vitest list` selected, repo-relative
 * @returns the walk's findings, or the listing's own refusal
 */
function walkFindings({ cwd, lane }: { cwd: string; lane: readonly string[] }): readonly string[] {
  const unreadable = unreadableLaneDirectories({ cwd, roots: UNIT_LANE_ROOTS });
  if (unreadable.length > 0) {
    return unreadable.map((line) => `cannot read a lane directory Vitest's walk would skip silently: ${line}`);
  }
  let listed: readonly string[];
  try {
    listed = workingTreeFilesOf({ root: cwd });
  } catch (error: unknown) {
    return [`cannot list the working tree, so nothing proves the lane's walk whole: ${String(error)}`];
  }
  return unlistedLaneFindings({ expected: lane, listed: listed.filter((file) => couldBeLaneFile({ cwd, file })) });
}

/**
 * Whether a path git listed could be a test file Vitest's walk should have selected. A regular file, through
 * any symlink, could; a directory could not, since Vitest selects files only (a tracked directory symlink
 * named `x.test.ts`); nor could a path that does not exist, deleted or a dangling link, nor a link
 * that loops on itself, which Vitest skips too. Any OTHER error keeps it: a tracked file under an IGNORED unreadable directory, which git lists
 * from its index without a warning, answers `EACCES`, and dropping it would drop the one evidence that the
 * walk skipped it.
 *
 * @param cwd the repository root
 * @param file the repo-relative path git listed
 * @returns false only for a directory, a self-looping link, or a path that provably does not exist
 */
export function couldBeLaneFile({ cwd, file }: { cwd: string; file: string }): boolean {
  try {
    return !statSync(join(cwd, file)).isDirectory();
  } catch (error: unknown) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    return code !== "ENOENT" && code !== "ELOOP";
  }
}

/**
 * List, merge and check, in a scratch directory the caller removes.
 *
 * @param cwd the repository root the lane ran in
 * @param scratch where the listing and the merged JSON report are written
 * @returns the process exit code
 */
function mergeIn({ cwd, scratch }: { cwd: string; scratch: string }): number {
  const listPath = join(scratch, "list.json");
  const mergedPath = join(scratch, "merged.json");
  const listed = vitest({ args: ["list", "--config", UNIT_CONFIG, "--filesOnly", `--json=${listPath}`], cwd });
  if (listed !== 0) {
    return listed;
  }
  const merged = vitest({
    args: [
      "run",
      "--config",
      UNIT_CONFIG,
      "--merge-reports",
      "--coverage",
      // The merge folds each shard's CONVERTED coverage map and never reads a raw dump, so the lanes' folding
      // provider (`config/vitest/coverageProvider.ts`) has nothing to do here — and Vitest's merge path loads a
      // custom provider only after replaying the reports, when its module runner answers that module with no
      // default export. Repro: one `--reporter=blob` file, then this merge without the line below.
      "--coverage.provider=v8",
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${mergedPath}`,
    ],
    cwd,
  });
  if (merged !== 0) {
    return merged;
  }
  const expected = readJson({ path: listPath, schema: ListedFiles });
  const report = readJson({ path: mergedPath, schema: MergedReport });
  if (expected === undefined || report === undefined) {
    return refuse({
      problems: ["could not read the lane's file list or the merged report, so nothing proves it whole"],
    });
  }
  const lane = expected.map((entry) => relative(cwd, entry.file));
  const problems = [
    ...mergedFileFindings({ expected: lane, merged: report.testResults.map((entry) => relative(cwd, entry.name)) }),
    ...walkFindings({ cwd, lane }),
  ];
  if (problems.length > 0) {
    return refuse({ problems });
  }
  process.stdout.write(`test:unit:merge: all ${String(expected.length)} test files merged, each exactly once\n`);
  return 0;
}

/**
 * Merge the unit lane's shard reports into its coverage report, or refuse when the reports are not exactly
 * the lane — by name before merging, and by the test files they carried after.
 *
 * @param cwd the repository root the lane ran in
 * @returns the process exit code — Vitest's own, or 1 when the reports were refused
 */
export function runUnitMerge({ cwd }: { cwd: string }): number {
  let names: readonly string[];
  try {
    names = readdirSync(join(cwd, UNIT_BLOB_DIRECTORY));
  } catch (error: unknown) {
    return refuse({ problems: [`cannot list ${UNIT_BLOB_DIRECTORY}: ${String(error)}`] });
  }
  const problems = blobSetFindings({ names });
  if (problems.length > 0) {
    return refuse({ problems });
  }
  const scratch = mkdtempSync(join(tmpdir(), "unit-merge-"));
  try {
    return mergeIn({ cwd, scratch });
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}
