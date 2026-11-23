/**
 * The gate's SHELL — the ordering of its three checks, against real temporary repositories.
 *
 * This file exists because three separate defects in this gate's review were ordering bugs in
 * {@link runCoverageRatchet}, every one of them "exited 0 while checking nothing", and not one was reachable
 * by a test while the function read `process` directly:
 *
 *  1. `--summary-only` returned 0 before the floor file was opened, so a deleted or corrupted floor passed CI;
 *  2. the comparison read the WORKING TREE, so an uncommitted or untracked copy stood in for the commit;
 *  3. the HEAD read sat inside the base comparison, so with no base — every local run — a commit deleting the
 *     floor plus an untracked copy on disk still passed.
 *
 * So the assertions here are deliberately about EXIT CODES and the text written, not about internals. The
 * writers are plain functions collecting strings — a seam, not a mock (`vi.fn` is banned, and unnecessary).
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCoverageRatchet } from "../../../devLint/coverageRatchet.js";
import { FLOOR_BASE_ENV } from "../../../devLint/gitAtCommit.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const floorJson = ({ b, f, l, s }: { b: number; f: number; l: number; s: number }): string =>
  `${JSON.stringify({ summary: { branches: b, functions: f, lines: l, statements: s }, version: 1 }, null, 2)}\n`;

/**
 * A summary whose four totals sit at the same offsets from the 66/68/70/70 floor — `pct` is the statements
 * value, so 71 is one point over every metric and 10 is under every one. `files` adds per-file entries under
 * `dir`, which the per-directory floor aggregates.
 */
const summaryJson = ({
  dir,
  pct,
  files = {},
}: {
  dir: string;
  pct: number;
  files?: Record<string, { covered: number; total: number }>;
}): string =>
  JSON.stringify({
    total: { branches: { pct: pct - 4 }, functions: { pct: pct - 2 }, lines: { pct }, statements: { pct } },
    ...Object.fromEntries(
      Object.entries(files).map(([path, { covered, total }]) => [
        join(dir, path),
        { statements: { covered, pct: (100 * covered) / total, skipped: 0, total } },
      ]),
    ),
  });

/** A repo whose HEAD commits the given floor. */
function repoAtFloor({ text }: { text: string }): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-shell-"));
  fixtureDirs.push(dir);
  gitInTemp({ args: ["init", "-q"], cwd: dir });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: dir });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: dir });
  writeFileSync(join(dir, "coverage-baseline.json"), text);
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-qm", "floor"], cwd: dir });
  return { dir, sha: gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir }) };
}

/**
 * Write a coverage report into a repo, so the measured half has something to read. The default carries one
 * small file, because a report with totals and no file under them is refused as having measured nothing.
 * Each file the report names is put on disk too when it is not there, as a real run's would be: a source
 * tree with nothing coverage includes is refused before any report is judged.
 */
function withSummary({
  dir,
  pct,
  files = { "src/lib/one.ts": { covered: 1, total: 1 } },
}: {
  dir: string;
  pct: number;
  files?: Record<string, { covered: number; total: number }>;
}): void {
  for (const path of Object.keys(files)) {
    if (!existsSync(join(dir, path))) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), "export const measured = 1;\n");
    }
  }
  mkdirSync(join(dir, "coverage"), { recursive: true });
  writeFileSync(join(dir, "coverage", "coverage-summary.json"), summaryJson({ dir, files, pct }));
}

/** Run the gate, collecting what it wrote. */
function run({ dir, argv, env }: { dir: string; argv: readonly string[]; env: NodeJS.ProcessEnv }): {
  exit: number;
  out: string;
  err: string;
} {
  const out: string[] = [];
  const err: string[] = [];
  const exit = runCoverageRatchet({
    argv: ["node", "entry", ...argv],
    cwd: dir,
    env,
    writeErr: ({ text }) => err.push(text),
    writeOut: ({ text }) => out.push(text),
  });
  return { err: err.join(""), exit, out: out.join("") };
}

const FLOOR = floorJson({ b: 66, f: 68, l: 70, s: 70 });

describe(
  "runCoverageRatchet — floor integrity runs before anything to do with a report",
  {
    timeout: REAL_GIT_TIMEOUT_MS,
  },
  () => {
    it("fails on a DELETED floor even with no report and --summary-only", () => {
      // The CI shape. This exited 0 before the fix: the summary-only branch returned first.
      const { dir } = repoAtFloor({ text: FLOOR });
      gitInTemp({ args: ["rm", "-q", "coverage-baseline.json"], cwd: dir });
      gitInTemp({ args: ["commit", "-qm", "delete"], cwd: dir });

      const result = run({ argv: ["--summary-only"], dir, env: {} });

      expect(result.exit).toBe(1);
      expect(result.err).toContain("floor file missing at");
    });

    it("says UNREADABLE rather than missing when the floor is there and cannot be read", () => {
      // The witness for the other arm: both used to print one collapsed "missing or unreadable", so a
      // reader could not tell a deleted floor from one a permission bit was hiding.
      const { dir } = repoAtFloor({ text: FLOOR });
      chmodSync(join(dir, "coverage-baseline.json"), 0o000);

      const result = run({ argv: ["--summary-only"], dir, env: {} });

      chmodSync(join(dir, "coverage-baseline.json"), 0o644);
      expect(result.exit).toBe(1);
      expect(result.err).toContain("is unreadable:");
    });

    it("fails on a CORRUPT floor even with no report and --summary-only", () => {
      const { dir } = repoAtFloor({ text: FLOOR });
      writeFileSync(join(dir, "coverage-baseline.json"), "THIS IS NOT JSON AT ALL\n");

      const result = run({ argv: ["--summary-only"], dir, env: {} });

      expect(result.exit).toBe(1);
      expect(result.err).toContain("invalid JSON");
    });

    it("fails when HEAD has no floor but an untracked copy sits on disk — WITH NO BASE SUPPLIED", () => {
      // The local shape, and the subtlest of the three: asking "does HEAD have a floor?" needs no base, so
      // scoping that question to CI left every local run trusting a file git had never seen.
      const { dir } = repoAtFloor({ text: FLOOR });
      gitInTemp({ args: ["rm", "-q", "coverage-baseline.json"], cwd: dir });
      gitInTemp({ args: ["commit", "-qm", "delete"], cwd: dir });
      writeFileSync(join(dir, "coverage-baseline.json"), FLOOR);

      const result = run({ argv: ["--summary-only"], dir, env: {} });

      expect(result.exit).toBe(1);
      expect(result.err).toContain("coverage-baseline.json does not exist at commit HEAD");
    });
  },
);

describe("runCoverageRatchet — the base comparison", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("passes an unchanged floor and says which base it used", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    withSummary({ dir, pct: 71 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(0);
    expect(result.out).toBe(
      `coverage-floor: clean (HEAD not lowered against base ${sha})\n` +
        `coverage-ratchet: clean (floor {"branches":66,"functions":68,"lines":70,"statements":70}, 0 directory floor(s))\n`,
    );
  });

  it("fails a lowering committed at HEAD that an uncommitted edit tries to hide", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    writeFileSync(join(dir, "coverage-baseline.json"), floorJson({ b: 1, f: 1, l: 1, s: 1 }));
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "flatten the floor"], cwd: dir });
    writeFileSync(join(dir, "coverage-baseline.json"), FLOOR); // "put it back", uncommitted
    withSummary({ dir, pct: 71 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(1);
    expect(result.err).toContain("a committed coverage floor is LOWER than the one at the base commit");
    expect(result.err).toContain("branches: 66% -> 1%");
    expect(result.err).toContain("There is no override for this lint gate at run time");
  });

  it("fails closed on a base that was supplied but is unreachable", () => {
    const { dir } = repoAtFloor({ text: FLOOR });
    withSummary({ dir, pct: 71 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: "0".repeat(39) + "1" } });

    expect(result.exit).toBe(1);
    expect(result.err).toContain("is unreachable in this checkout");
  });

  it("fails closed on a base that was supplied but is not a commit SHA", () => {
    const { dir } = repoAtFloor({ text: FLOOR });
    withSummary({ dir, pct: 71 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: "origin/main" } });

    expect(result.exit).toBe(1);
    expect(result.err).toContain("is not a full 40-character commit SHA");
  });

  it("FAILS when no base is supplied, naming the command that supplies one, rather than passing unread", () => {
    // The by-hand run that printed "skipped" and exited 0 was read as green, and a branch lapped red that way.
    const { dir } = repoAtFloor({ text: FLOOR });
    withSummary({ dir, pct: 71 });

    const result = run({ argv: [], dir, env: {} });

    expect(result.exit).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toBe(
      `coverage-floor: no ${FLOOR_BASE_ENV} in the environment, so nothing was compared — run ` +
        `\`git fetch origin main\`, then re-run with \`${FLOOR_BASE_ENV}=$(git merge-base origin/main HEAD)\` ` +
        "in front of the command\n",
    );
  });

  it("says it skipped the comparison for a brand-new ref's all-zeroes base, and passes", () => {
    const { dir } = repoAtFloor({ text: FLOOR });
    withSummary({ dir, pct: 71 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: "0".repeat(40) } });

    expect(result.exit).toBe(0);
    expect(result.out).toBe(
      `coverage-floor: history comparison skipped — ${FLOOR_BASE_ENV} is all zeroes — this ref has no previous commit\n` +
        `coverage-ratchet: clean (floor {"branches":66,"functions":68,"lines":70,"statements":70}, 0 directory floor(s))\n`,
    );
  });
});

describe("runCoverageRatchet — the measured half", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("fails when measured coverage is below the floor", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    withSummary({ dir, pct: 10 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(1);
    expect(result.err).toContain("coverage dropped below the committed floor");
  });

  it("skips only the measured half under --summary-only, and names what it skipped", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR });

    const result = run({ argv: ["--summary-only"], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(0);
    expect(result.out).toBe(
      `coverage-floor: clean (HEAD not lowered against base ${sha})\n` +
        "coverage-ratchet: measured check skipped (no coverage summary at this stage)\n",
    );
  });

  it("fails on a missing report WITHOUT --summary-only", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(1);
    expect(result.err).toContain("coverage summary missing");
  });

  it("refuses a --rebaseline that would lower the floor", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    withSummary({ dir, pct: 10 });

    const result = run({ argv: ["--rebaseline"], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(1);
    expect(result.err).toContain("rebaseline refused — would lower");
  });

  it("writes a raised floor on --rebaseline", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    withSummary({ dir, pct: 88 });

    const result = run({ argv: ["--rebaseline"], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(0);
    expect(result.out).toBe(
      `coverage-floor: clean (HEAD not lowered against base ${sha})\n` +
        'coverage-ratchet: baseline rebaselined to {"branches":83,"functions":85,"lines":87,"statements":87} and 0 directory floor(s)\n',
    );
  });
});

describe("runCoverageRatchet — the ratchet and the per-directory floor", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /** A version-2 floor with one directory floor. */
  const FLOOR_V2 = `${JSON.stringify(
    {
      directories: { "src/cli": { statements: 50 } },
      summary: { branches: 66, functions: 68, lines: 70, statements: 70 },
      version: 2,
    },
    null,
    2,
  )}\n`;
  /** `src/cli` at 300 statements (over the size cut) and the given percentage. */
  const cliFiles = ({ pct }: { pct: number }): Record<string, { covered: number; total: number }> => ({
    "src/cli/a.ts": { covered: 3 * pct, total: 300 },
  });

  it("reports a floor that lags the measurement by more than the headroom, names the rebaseline, and exits 0", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    withSummary({ dir, pct: 72.01 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(0);
    expect(result.out).toContain(
      "coverage-ratchet: 4 floor(s) lag the measurement by more than the ratchet's headroom — reported, not red\n",
    );
    expect(result.out).toContain("  lines: floor 70% lags measured 72.01% by more than 2 points\n");
    expect(result.out).toContain("yarn coverage:rebaseline");
    expect(result.out).not.toContain("coverage-ratchet: clean");
    expect(result.err).not.toContain("lags measured");
  });

  it("passes a floor exactly at the headroom", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    withSummary({ dir, pct: 72 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(0);
  });

  it("refuses a directory over the size cut that has no floor", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    withSummary({ dir, files: cliFiles({ pct: 60 }), pct: 71 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(1);
    expect(result.err).toContain("  src/cli: 300 statements at 60% and no floor\n");
    expect(result.err).toContain("1 unfloored directory(ies)");
    expect(result.err).toContain("There is no override for this lint gate at run time");
  });

  it("refuses a directory under its floor while the repo totals hold, under the drop row", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR_V2 });
    withSummary({ dir, files: cliFiles({ pct: 49 }), pct: 71 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(1);
    expect(result.err).toContain("  src/cli statements: 49% < floor 50%\n");
    expect(result.err).toContain("coverage dropped below the committed floor");
  });

  it("fails a partial report that left out a floored directory still on disk, compare and rebaseline alike", () => {
    // Counterexample: a one-file report skipped every floor it omitted and printed `clean`.
    const { dir, sha } = repoAtFloor({ text: FLOOR_V2 });
    mkdirSync(join(dir, "src", "cli"), { recursive: true });
    writeFileSync(join(dir, "src", "cli", "a.ts"), "export const a = 1;\n");
    withSummary({ dir, pct: 71 });

    const results = [[], ["--rebaseline"]].map((argv) => run({ argv, dir, env: { [FLOOR_BASE_ENV]: sha } }));

    expect(results.map((result) => result.exit)).toEqual([1, 1]);
    expect(results.map((result) => result.err)).toEqual(
      Array.from(
        { length: 2 },
        () =>
          "  src/cli statements: floored at 50% and still on disk, but the report measured nothing under it\n" +
          "coverage-ratchet: the coverage summary measured nothing under 1 floored directory(ies) still on disk, so it is partial; regenerate it with `yarn test:unit`\n",
      ),
    );
  });

  it("fails a report that measured a directory through one file and left its other file out", () => {
    // Second counterexample: `src/a` measured, so its floor was judged, over half its files.
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    mkdirSync(join(dir, "src", "a"), { recursive: true });
    writeFileSync(join(dir, "src", "a", "covered.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "src", "a", "omitted.ts"), "export const b = 2;\n");
    withSummary({ dir, files: { "src/a/covered.ts": { covered: 1, total: 1 } }, pct: 71 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(1);
    expect(result.err).toBe(
      "  src/a/omitted.ts\n" +
        "coverage-ratchet: the coverage summary does not name 1 source file(s) coverage includes, so it is partial; regenerate it with `yarn test:unit`\n",
    );
  });

  it("fails when a source directory cannot be read, rather than reading its floor as deleted", () => {
    // Third counterexample: an unreadable directory listed as empty, so every floor under it went.
    const { dir, sha } = repoAtFloor({ text: FLOOR_V2 });
    mkdirSync(join(dir, "src", "cli"), { recursive: true });
    writeFileSync(join(dir, "src", "cli", "a.ts"), "export const a = 1;\n");
    withSummary({ dir, pct: 71 });
    chmodSync(join(dir, "src", "cli"), 0o000);

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    chmodSync(join(dir, "src", "cli"), 0o755);
    expect(result.exit).toBe(1);
    expect(result.err).toContain("coverage-ratchet: could not list the source tree coverage includes: EACCES");
  });

  it("follows a symlinked directory as Vitest does: a report naming its file passes, one omitting it fails", () => {
    // Both ways: a skipped link hid a subtree from the gate, and a refused one reddened a whole report.
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    mkdirSync(join(dir, "linked"), { recursive: true });
    writeFileSync(join(dir, "linked", "a.ts"), "export const a = 1;\n");
    mkdirSync(join(dir, "src", "lib"), { recursive: true });
    writeFileSync(join(dir, "src", "lib", "one.ts"), "export const one = 1;\n");
    symlinkSync(join(dir, "linked"), join(dir, "src", "more"));

    withSummary({
      dir,
      files: { "src/lib/one.ts": { covered: 1, total: 1 }, "src/more/a.ts": { covered: 1, total: 1 } },
      pct: 71,
    });
    const whole = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });
    withSummary({ dir, pct: 71 });
    const partial = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(whole.exit).toBe(0);
    expect(partial.exit).toBe(1);
    expect(partial.err).toContain("  src/more/a.ts\n");
  });

  it("asks once for a file two sibling links reach, as a full run names it once", () => {
    // `src/a` and `src/b` both link to one directory; Vitest named `src/a/one.ts` alone.
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    mkdirSync(join(dir, "real"), { recursive: true });
    writeFileSync(join(dir, "real", "one.ts"), "export const one = 1;\n");
    mkdirSync(join(dir, "src"), { recursive: true });
    symlinkSync(join(dir, "real"), join(dir, "src", "a"));
    symlinkSync(join(dir, "real"), join(dir, "src", "b"));

    withSummary({ dir, files: { "src/a/one.ts": { covered: 1, total: 1 } }, pct: 71 });
    const whole = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });
    withSummary({ dir, pct: 71 });
    const partial = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(whole.exit).toBe(0);
    expect(partial.exit).toBe(1);
    expect(partial.err).toContain("  src/a/one.ts\n");
  });

  it("walks a symlink cycle finitely, as Vitest does, asking the report for each real file once", () => {
    // Refusing a cycle reddened a complete report that named the file through the loop as well.
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    mkdirSync(join(dir, "src", "lib"), { recursive: true });
    writeFileSync(join(dir, "src", "lib", "one.ts"), "export const one = 1;\n");
    writeFileSync(join(dir, "src", "lib", "two.ts"), "export const two = 2;\n");
    symlinkSync(join(dir, "src"), join(dir, "src", "lib", "loop"));

    withSummary({
      dir,
      files: {
        "src/lib/loop/lib/one.ts": { covered: 1, total: 1 },
        "src/lib/one.ts": { covered: 1, total: 1 },
        "src/lib/two.ts": { covered: 1, total: 1 },
      },
      pct: 71,
    });
    const whole = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });
    withSummary({ dir, pct: 71 });
    const partial = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(whole.exit).toBe(0);
    expect(partial.exit).toBe(1);
    expect(partial.err).toContain("  src/lib/two.ts\n");
  });

  it("passes a link coverage would never read: excluded tree or name, a non-source file, or a dangling one", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    writeFileSync(join(dir, "data.txt"), "fixture\n");
    mkdirSync(join(dir, "src", "__tests__"), { recursive: true });
    symlinkSync(join(dir, "data.txt"), join(dir, "src", "__tests__", "data.txt"));
    symlinkSync(join(dir, "data.txt"), join(dir, "src", "notes.txt"));
    symlinkSync(join(dir, "gone.ts"), join(dir, "src", "dangling.ts"));
    mkdirSync(join(dir, "src", "pkg"), { recursive: true });
    symlinkSync(join(dir, "data.txt"), join(dir, "src", "pkg", "index.ts"));
    withSummary({ dir, pct: 71 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(0);
  });

  it("never asks for a file under a DIRECTORY named like an excluded file, which Vitest's `contains` match drops", () => {
    // Measured on Vitest 4.1.12's own matcher: `src/**/index.ts` excludes `src/pkg/index.ts/hidden.ts`.
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    mkdirSync(join(dir, "src", "pkg", "index.ts"), { recursive: true });
    writeFileSync(join(dir, "src", "pkg", "index.ts", "hidden.ts"), "export const h = 1;\n");
    withSummary({ dir, pct: 71 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(existsSync(join(dir, "src", "pkg", "index.ts", "hidden.ts"))).toBe(true);
    expect(result.exit).toBe(0);
  });

  it("never asks for a file under a directory Vitest's forced exclusions drop", () => {
    // `**/__x00__*` matches `src/__x00__dir` as a prefix of every path beneath it.
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    mkdirSync(join(dir, "src", "__x00__dir"), { recursive: true });
    writeFileSync(join(dir, "src", "__x00__dir", "inside.ts"), "export const i = 1;\n");
    withSummary({ dir, pct: 71 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(existsSync(join(dir, "src", "__x00__dir", "inside.ts"))).toBe(true);
    expect(result.exit).toBe(0);
  });

  it("asks the report for a dot-prefixed source, which Vitest's coverage include measures", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", ".hidden.ts"), "export const h = 1;\n");
    withSummary({ dir, pct: 71 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(1);
    expect(result.err).toContain("  src/.hidden.ts\n");
  });

  it("never asks the report for a file Vitest's forced exclusions drop", () => {
    // Vitest always excludes `**/__x00__*`, so a complete report never names this file.
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "__x00__generated.ts"), "export const g = 1;\n");
    withSummary({ dir, pct: 71 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(existsSync(join(dir, "src", "__x00__generated.ts"))).toBe(true);
    expect(result.exit).toBe(0);
  });

  it("fails a report over a tree where coverage includes no source file", () => {
    // Every `src/` file excluded, the report naming one loaded from outside the include, the gate clean.
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    withSummary({ dir, files: { "desktop/src/one.ts": { covered: 1, total: 1 } }, pct: 71 });
    mkdirSync(join(dir, "src", "__tests__"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), "export {};\n");
    writeFileSync(join(dir, "src", "__tests__", "a.test.ts"), "export {};\n");

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(1);
    expect(result.err).toBe(
      "coverage-ratchet: no source file coverage includes is on disk under src/, so there is nothing for the floor to judge\n",
    );
  });

  it("passes a floored directory that is gone from disk and from the report", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR_V2 });
    withSummary({ dir, pct: 71 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(0);
  });

  it("passes a directory at its floor and counts it", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR_V2 });
    withSummary({ dir, files: cliFiles({ pct: 50 }), pct: 71 });

    const result = run({ argv: [], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(0);
    expect(result.out).toContain(
      `coverage-ratchet: clean (floor {"branches":66,"functions":68,"lines":70,"statements":70}, 1 directory floor(s))\n`,
    );
  });

  it("writes measured-minus-one for every metric and every large directory on --rebaseline, as version 2", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    withSummary({ dir, files: cliFiles({ pct: 60 }), pct: 88 });

    const result = run({ argv: ["--rebaseline"], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(0);
    expect(readFileSync(join(dir, "coverage-baseline.json"), "utf8")).toBe(
      `${JSON.stringify(
        {
          directories: { "src/cli": { statements: 59 } },
          summary: { branches: 83, functions: 85, lines: 87, statements: 87 },
          version: 2,
        },
        null,
        2,
      )}\n`,
    );
  });

  it("refuses a --rebaseline over a directory under its floor", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR_V2 });
    withSummary({ dir, files: cliFiles({ pct: 40 }), pct: 88 });

    const result = run({ argv: ["--rebaseline"], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(1);
    expect(result.err).toContain("rebaseline refused — would lower: src/cli statements");
  });

  it("compares a version-2 HEAD against a version-1 base as not lowered — the base has no directory floors", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR });
    writeFileSync(join(dir, "coverage-baseline.json"), FLOOR_V2);
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "add directory floors"], cwd: dir });

    const result = run({ argv: ["--summary-only"], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(0);
    expect(result.out).toContain(`coverage-floor: clean (HEAD not lowered against base ${sha})\n`);
  });

  it("fails a directory floor lowered at HEAD against the base", () => {
    const { dir, sha } = repoAtFloor({ text: FLOOR_V2 });
    writeFileSync(join(dir, "coverage-baseline.json"), FLOOR_V2.replace('"statements": 50', '"statements": 49.99'));
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "lower one directory"], cwd: dir });

    const result = run({ argv: ["--summary-only"], dir, env: { [FLOOR_BASE_ENV]: sha } });

    expect(result.exit).toBe(1);
    expect(result.err).toContain("  src/cli statements: 50% -> 49.99%\n");
    expect(result.err).toContain("a committed coverage floor is LOWER than the one at the base commit");
  });
});
