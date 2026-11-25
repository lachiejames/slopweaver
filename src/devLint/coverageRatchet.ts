/**
 * The coverage floor — two independent properties over the same committed file.
 *
 *  1. **Measured coverage** ({@link compareCoverage}) — Vitest's V8 `coverage/coverage-summary.json` against
 *     the four repo-wide minimums and the per-directory statement floors in `coverage-baseline.json` (repo
 *     ROOT, not `coverage/`, which Vitest wipes).
 *     Deliberately left at the root rather than moved alongside the other config/ratchet files (code-quality
 *     round 2 item 13): property 2 below reads this file out of git history at arbitrary past commits, and a
 *     move would make every pre-move commit fail that read, defeating the anti-gaming check it exists for.
 *  2. **Floor integrity** ({@link loweredMetrics}) — that committed file against its own content at a base
 *     commit. Property 1 alone is trivially satisfiable by editing property 1's yardstick.
 *
 * ## Why property 2 exists
 *
 * Measured: setting all four minimums to `1` made the gate print `clean` and exit 0. The floor is the whole
 * bar, and nothing compared it to anything. Worse, `--summary-only` — the form `dev lint` runs, and the only
 * form CI ran — returned 0 BEFORE opening the floor file at all, so on a clean checkout the file could be
 * deleted outright or filled with garbage and CI stayed green. Integrity therefore runs FIRST and
 * unconditionally; only the measured half is skippable, and it says when it skipped.
 *
 * ## What it does not claim
 *
 * Nothing here resists a committer who edits this gate too. The claim is narrower and worth stating exactly:
 * a lowering cannot happen *quietly*. There is deliberately no in-file "authorised lowering" marker — any
 * such counter is one more editable number beside the four, and proves nothing about who wrote it. A
 * justified drop is meant to go red and be merged consciously.
 *
 * The floor RATCHETS: a rebaseline writes measured-minus-one, and the measured half REPORTS a floor that has
 * fallen more than two points behind without failing on it — `coverageFloor.ts` carries both numbers, their
 * measurements, and the per-directory floor.
 *
 * Pure cores (`coverageFloor.ts`: {@link parseCoverageSummary}, {@link parseBaselineJson},
 * {@link compareCoverage}, {@link loweredMetrics}, {@link rebaselinePlan}) carry the logic and are
 * unit-tested; the thin {@link runCoverageRatchet} edge reads files, shells out to git and prints. Resolving
 * the base commit and reading a blob at it moved to `gitAtCommit.ts` when `test-enshittification` became
 * the second gate to compare a branch against its base. It NEVER invokes Vitest — the report is produced by `yarn test:unit` beforehand.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "../lib/result.js";
import { coverageComparisonReport } from "./coverageComparisonReport.js";
import { isNotFound, reportCompleteness } from "./coverageCompleteness.js";
import {
  type CoverageBaseline,
  type CoverageMeasurement,
  loweredMetrics,
  parseBaselineJson,
  parseCoverageSummary,
  rebaselinePlan,
} from "./coverageFloor.js";
import { BASELINE_FILE, type CoverageFloorError, CoverageFloorErrors } from "./coverageFloorErrors.js";
import { gitShow, gitSucceeds, resolveFloorBase } from "./gitAtCommit.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/**
 * Read and parse `coverage-baseline.json` as it exists at a commit.
 *
 * Staged deliberately: `git cat-file -e` exits 128 BOTH for an unreachable commit and for a path missing at
 * a reachable one, so the two are separable only by asking in order. Collapsing them into one "missing"
 * result is the taxonomy defect this gate exists to avoid.
 *
 * @param root the repository root to run git in
 * @param sha the comparison commit
 * @returns the parsed baseline, or a diagnostic naming which stage failed
 */
export function readBaselineAtCommit({
  root,
  sha,
}: {
  root: string;
  sha: string;
}): Result<CoverageBaseline, CoverageFloorError> {
  if (!gitSucceeds({ args: ["cat-file", "-e", `${sha}^{commit}`], root })) {
    return err(CoverageFloorErrors.shaUnreachable({ sha }));
  }
  if (!gitSucceeds({ args: ["cat-file", "-e", `${sha}:${BASELINE_FILE}`], root })) {
    return err(CoverageFloorErrors.shaPathMissing({ sha }));
  }
  const text = gitShow({ root, spec: `${sha}:${BASELINE_FILE}` });
  if (text === undefined) {
    return err(CoverageFloorErrors.shaUnreadable({ sha }));
  }
  const parsed = parseBaselineJson({ text });
  if (parsed.isErr()) {
    return err(CoverageFloorErrors.shaMalformed({ detail: parsed.error.message, sha }));
  }
  return ok(parsed.value);
}

/**
 * A file this gate needs, or WHY it is not here.
 *
 * ABSENT and UNREADABLE are different facts and the gate answers the generated summary's two differently:
 * the `--summary-only` stage runs before `yarn test:unit` has produced one, so absence there is expected and
 * skippable, while a summary that exists and cannot be read is a failure at every stage. Collapsing both
 * into `undefined` made an EACCES pass the summary-only gate silently, and made the absent-input marker
 * below false on a branch it covered — found by an adversarial review pass. The committed FLOOR refuses on
 * either, so the distinction only reaches its message; a reader still needs to know which one they have.
 */
type FileRead =
  | { readonly kind: "read"; readonly text: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly reason: string };

/**
 * Read a file, keeping absence and unreadability apart.
 *
 * @param path the file's absolute path
 * @returns the text, or which of the two non-reads happened, with the OS reason when there is one
 */
function readFileOrReason({ path }: { path: string }): FileRead {
  try {
    return { kind: "read", text: readFileSync(path, "utf8") };
  } catch (error) {
    if (isNotFound({ error })) {
      return { kind: "absent" };
    }
    return { kind: "unreadable", reason: error instanceof Error ? error.message : "read failed" };
  }
}

/** The `--rebaseline` branch: write a raised floor, or refuse to lower it. Prints; returns the exit code. */
function applyRebaseline({
  baselinePath,
  current,
  baseline,
  writeOut,
  writeErr,
}: {
  baselinePath: string;
  current: CoverageMeasurement;
  baseline: CoverageBaseline;
  writeOut: ({ text }: { text: string }) => void;
  writeErr: ({ text }: { text: string }) => void;
}): number {
  const plan = rebaselinePlan({ baseline, current });
  if (plan.isErr()) {
    // A POLICY refusal, not a fact: every input was read and parsed, and the gate is declining to record a
    // fall. An earlier pass here carried a `not-a-refusal` marker claiming a read failure, which was simply
    // untrue — the marker is a claim no machine can check, and this is what checking it by hand looks like.
    writeErr({ text: `  ${plan.error.message}\n` });
    writeErr({
      text: `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "coverage-ratchet-rebaseline" }),
        detail: `${String(floorsThatWouldFall({ error: plan.error }))} floor(s) would fall`,
      })}\n`,
    });
    return 1;
  }
  writeFileSync(baselinePath, `${JSON.stringify(plan.value, null, 2)}\n`);
  writeOut({
    text: `coverage-ratchet: baseline rebaselined to ${JSON.stringify(plan.value.summary)} and ${String(
      Object.keys(plan.value.directories).length,
    )} directory floor(s)\n`,
  });
  return 0;
}

/** The compare branch's edge: print {@link coverageComparisonReport}'s text and return its exit code. */
function reportComparison({
  current,
  baseline,
  writeOut,
  writeErr,
}: {
  current: CoverageMeasurement;
  baseline: CoverageBaseline;
  writeOut: ({ text }: { text: string }) => void;
  writeErr: ({ text }: { text: string }) => void;
}): number {
  const report = coverageComparisonReport({ baseline, current });
  if (report.stdout !== "") {
    writeOut({ text: report.stdout });
  }
  if (report.stderr !== "") {
    // devlint: not-a-refusal -- forwards text coverageComparisonReport already rendered through lintGateRefusal
    writeErr({ text: report.stderr });
  }
  return report.exitCode;
}

/**
 * Load the committed floor. Runs BEFORE anything to do with a coverage report, so a deleted or corrupted
 * floor is a failure everywhere — including `yarn lint` on a clean CI checkout, where measured coverage is
 * skipped and the file used to go unread entirely.
 */
function loadCommittedBaseline({
  baselinePath,
}: {
  baselinePath: string;
}): Result<CoverageBaseline, CoverageFloorError> {
  const read = readFileOrReason({ path: baselinePath });
  if (read.kind === "absent") {
    return err(CoverageFloorErrors.fileAbsent({ path: baselinePath }));
  }
  if (read.kind === "unreadable") {
    return err(CoverageFloorErrors.fileUnreadable({ path: baselinePath, reason: read.reason }));
  }
  const text = read.text;
  const parsed = parseBaselineJson({ text });
  if (parsed.isErr()) {
    return err(CoverageFloorErrors.fileMalformed({ detail: parsed.error.message, path: baselinePath }));
  }
  return ok(parsed.value);
}

/**
 * The floor-integrity half: the COMMITTED floor may not be lower than at the comparison commit. Prints its
 * own verdict under a distinct `coverage-floor:` prefix so it is never mistaken for the measured check.
 *
 * Both sides are read out of git — `HEAD` and the base — never from the working tree. That is not a detail;
 * two separate counterexamples turned on it, and both reproduced against the real gate:
 *
 *  - a commit DELETING the floor, plus an untracked copy left on disk, compared clean;
 *  - a commit LOWERING the floor, plus an uncommitted local edit restoring it, compared clean.
 *
 * Either way the working tree stood in for the commit and the gate reported on a state nobody was pushing.
 * The measured half still reads the working tree, deliberately — there you WANT the floor you are about to
 * commit, so a local raise you cannot yet meet fails immediately.
 *
 * ## Two questions, and only one of them needs a base
 *
 * "Does HEAD have a valid floor at all?" needs no comparison commit, so it is asked FIRST and
 * UNCONDITIONALLY. An earlier revision folded it into the comparison, which meant that with no base supplied
 * a commit deleting the floor plus an untracked copy on disk still passed. Only the "is it lower than at the
 * base?" question needs a base.
 *
 * No base supplied FAILS, printing the command that supplies one: a comparison that never ran is not a clean
 * one, and a by-hand run that printed "skipped" and exited 0 was read as green. CI and `github lap` both
 * export the base. A brand-new ref's all-zeroes base has no previous commit, so that one alone prints what it
 * skipped and passes, under `docs/constraints/hard.md` §2's rule that a skipped stage must say so. It passes
 * only once HEAD confirms the ref is new (`./floorBaseConfirmation.ts`). A base that was supplied and is
 * unavailable is a hard failure too: that is the fail-open case.
 */
function reportFloorIntegrity({
  root,
  env,
  writeOut,
  writeErr,
}: {
  root: string;
  env: NodeJS.ProcessEnv;
  writeOut: ({ text }: { text: string }) => void;
  writeErr: ({ text }: { text: string }) => void;
}): number {
  const head = readBaselineAtCommit({ root, sha: "HEAD" });
  if (head.isErr()) {
    // devlint: not-a-refusal -- an input could not be read or parsed, so the gate reports the failure rather than a verdict
    writeErr({ text: `coverage-floor: ${head.error.message}\n` });
    return 1;
  }
  const base = resolveFloorBase({ env, root });
  if (base.kind === "invalid") {
    // devlint: not-a-refusal -- the base is missing or unusable, so the gate reports the failure rather than a verdict
    writeErr({ text: `coverage-floor: ${base.reason}\n` });
    return 1;
  }
  if (base.kind === "absent") {
    writeOut({ text: `coverage-floor: history comparison skipped — ${base.reason}\n` });
    return 0;
  }
  const read = readBaselineAtCommit({ root, sha: base.sha });
  if (read.isErr()) {
    // devlint: not-a-refusal -- an input could not be read or parsed, so the gate reports the failure rather than a verdict
    writeErr({ text: `coverage-floor: ${read.error.message}\n` });
    return 1;
  }
  const lowered = loweredMetrics({ base: read.value, current: head.value });
  if (lowered.length > 0) {
    for (const line of lowered) {
      writeErr({ text: `  ${line}\n` });
    }
    writeErr({
      text: `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "coverage-ratchet-floor" }),
        detail: `the committed floor was lowered against base ${base.sha}`,
      })}\n`,
    });
    return 1;
  }
  writeOut({ text: `coverage-floor: clean (HEAD not lowered against base ${base.sha})\n` });
  return 0;
}

/** The measured half: coverage vs the committed floor, or a rebaseline. Needs a generated summary. */
function runMeasuredHalf({
  root,
  summaryPath,
  baselinePath,
  baseline,
  summaryOnly,
  rebaseline,
  writeOut,
  writeErr,
}: {
  root: string;
  summaryPath: string;
  baselinePath: string;
  baseline: CoverageBaseline;
  summaryOnly: boolean;
  rebaseline: boolean;
  writeOut: ({ text }: { text: string }) => void;
  writeErr: ({ text }: { text: string }) => void;
}): number {
  const summary = readFileOrReason({ path: summaryPath });
  if (summary.kind === "unreadable") {
    // devlint: not-a-refusal -- the summary is THERE and could not be read, so the gate has no measurement
    // to compare rather than a verdict to give; skippable absence is the branch below, not this one
    writeErr({ text: `coverage-ratchet: coverage summary at ${summaryPath} is unreadable: ${summary.reason}\n` });
    return 1;
  }
  if (summary.kind === "absent") {
    if (summaryOnly) {
      writeOut({ text: "coverage-ratchet: measured check skipped (no coverage summary at this stage)\n" });
      return 0;
    }
    // devlint: not-a-refusal -- the generated coverage input is absent, so there is nothing to compare against
    writeErr({ text: "coverage-ratchet: coverage summary missing; run `yarn test:unit` first\n" });
    return 1;
  }
  const currentResult = parseCoverageSummary({ root, text: summary.text });
  if (currentResult.isErr()) {
    // devlint: not-a-refusal -- an input could not be read or parsed, so the gate reports the failure rather than a verdict
    writeErr({ text: `coverage-ratchet: ${currentResult.error.message}\n` });
    return 1;
  }
  const current = currentResult.value;
  if (reportCompleteness({ baseline, current, root, writeErr }) !== 0) {
    return 1;
  }
  return rebaseline
    ? applyRebaseline({ baseline, baselinePath, current, writeErr, writeOut })
    : reportComparison({ baseline, current, writeErr, writeOut });
}

/**
 * The effectful edge. Three checks, in this order — and the ORDER is the load-bearing part.
 *
 *  1. **the working-tree floor** parses. Catches a locally deleted or corrupted file, and gives the measured
 *     half something to compare against.
 *  2. **floor integrity** — HEAD has a valid floor, and it is not lower than at the base commit.
 *  3. **measured coverage** — the generated summary against the working-tree floor. `--summary-only` skips
 *     ONLY this, when no summary has been generated yet, and says that it did.
 *
 * Every one of those three was, at some point in this PR's review, in the wrong place. `--summary-only` used
 * to return 0 before the floor file was opened at all, so on a clean CI checkout it could be deleted or
 * filled with garbage and `yarn lint` stayed green. Then the HEAD read sat inside the base comparison, so
 * with no base a commit deleting the floor plus an untracked copy on disk still passed.
 *
 * Which is why `cwd`, `env` and both writers are parameters rather than reads of `process`: three defects in
 * a row lived in this function's ordering and none of them was reachable by a test. Now they are.
 *
 * @param argv the process argv (flags `--rebaseline`, `--summary-only` read from index 2)
 * @param cwd the directory to resolve the floor, the coverage report and git against
 * @param env the environment to read the base SHA from
 * @param writeOut where clean/skipped verdicts go
 * @param writeErr where failures go
 * @returns the exit code (0 clean, 1 a lowered floor / an unreadable base / a drop / a refused rebaseline)
 */
export function runCoverageRatchet({
  argv,
  cwd,
  env,
  writeOut,
  writeErr,
}: {
  argv: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  writeOut: ({ text }: { text: string }) => void;
  writeErr: ({ text }: { text: string }) => void;
}): number {
  const flags = new Set(argv.slice(2));
  const summaryOnly = flags.has("--summary-only");
  const rebaseline = flags.has("--rebaseline");

  // Anchor on cwd, NOT git: yarn scripts + vitest both run from the package root, and vitest writes
  // `coverage/` cwd-relative — so cwd keeps the summary + baseline paths aligned even inside a git hook
  // (where GIT_DIR is set and `git rev-parse --show-toplevel` can resolve a different root).
  const summaryPath = join(cwd, "coverage", "coverage-summary.json");
  // The floor lives OUTSIDE coverage/ — vitest wipes that dir on every run.
  const baselinePath = join(cwd, BASELINE_FILE);

  const loaded = loadCommittedBaseline({ baselinePath });
  if (loaded.isErr()) {
    // devlint: not-a-refusal -- an input could not be read or parsed, so the gate reports the failure rather than a verdict
    writeErr({ text: `coverage-floor: ${loaded.error.message}\n` });
    return 1;
  }
  const integrity = reportFloorIntegrity({ env, root: cwd, writeErr, writeOut });
  if (integrity !== 0) {
    return integrity;
  }
  return runMeasuredHalf({
    baseline: loaded.value,
    baselinePath,
    rebaseline,
    root: cwd,
    summaryOnly,
    summaryPath,
    writeErr,
    writeOut,
  });
}

/**
 * How many floors a refused rebaseline would have dropped — the count the refusal's detail line states.
 *
 * @param error the refusal the plan returned
 * @returns the number of subjects that fell, or 1 for a failure that is not a lowering at all
 */
function floorsThatWouldFall({ error }: { error: CoverageFloorError }): number {
  if (error.code === "REBASELINE_WOULD_LOWER") {
    return error.subjects.length;
  }
  return 1;
}
