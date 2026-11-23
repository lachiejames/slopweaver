/**
 * The floor-integrity half of the coverage gate: the committed floor against its own content at a base
 * commit.
 *
 * The pure decisions ({@link loweredMetrics}, {@link resolveFloorBase}) are tested as plain functions. The
 * git read is tested against REAL temporary repositories, which `testing.md` sanctions for a genuine
 * round-trip — and this is one. The property under test is "does git, as actually invoked, distinguish an
 * unreachable commit from a path missing at a reachable one?", and both cases exit 128, so a fake git would
 * only prove the fake agrees with itself. Every git call goes through `gitInTemp`, which strips the
 * environment and refuses to run outside the OS temp directory.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CoverageBaseline, type CoverageMetrics, loweredMetrics } from "../../../devLint/coverageFloor.js";
import { CoverageFloorErrors } from "../../../devLint/coverageFloorErrors.js";
import { readBaselineAtCommit } from "../../../devLint/coverageRatchet.js";
import { FLOOR_BASE_ENV, resolveFloorBase } from "../../../devLint/gitAtCommit.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/** Put an env var back exactly as it was — `delete` when it was unset, since assigning `undefined` is not. */
function restoreEnvVar({ name, saved }: { name: string; saved: string | undefined }): void {
  if (saved === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = saved;
}

const metrics = ({ b, f, l, s }: { b: number; f: number; l: number; s: number }): CoverageMetrics => ({
  branches: b,
  functions: f,
  lines: l,
  statements: s,
});

/** A whole baseline over the four metrics, with the directory floors given (none by default). */
const floor = ({
  b,
  f,
  l,
  s,
  directories = {},
}: {
  b: number;
  f: number;
  l: number;
  s: number;
  directories?: Readonly<Record<string, { readonly statements: number }>>;
}): CoverageBaseline => ({ directories, summary: metrics({ b, f, l, s }), version: 2 });

const FLOOR = floor({ b: 66, f: 68, l: 70, s: 70 });

/** A fresh temp repository with git identity configured, ready to commit into. */
function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-floor-"));
  gitInTemp({ args: ["init", "-q"], cwd: dir });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: dir });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: dir });
  return dir;
}

/** A repo whose HEAD commit contains `coverage-baseline.json` with the given text. Returns dir + sha. */
function repoWithBaseline({ text }: { text: string }): { dir: string; sha: string } {
  const dir = initRepo();
  writeFileSync(join(dir, "coverage-baseline.json"), text);
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-qm", "floor"], cwd: dir });
  return { dir, sha: gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir }) };
}

const floorJson = ({ b, f, l, s }: { b: number; f: number; l: number; s: number }): string =>
  `${JSON.stringify({ summary: metrics({ b, f, l, s }), version: 1 }, null, 2)}\n`;

describe("loweredMetrics", () => {
  it("reports nothing when the floor is unchanged", () => {
    expect(loweredMetrics({ base: FLOOR, current: FLOOR })).toEqual([]);
  });

  it("reports nothing when every metric is raised", () => {
    expect(loweredMetrics({ base: FLOOR, current: floor({ b: 67, f: 69, l: 71, s: 71 }) })).toEqual([]);
  });

  it("names the single metric that fell, with both values", () => {
    expect(loweredMetrics({ base: FLOOR, current: floor({ b: 60, f: 68, l: 70, s: 70 }) })).toEqual([
      "branches: 66% -> 60%",
    ]);
  });

  it("catches a lowering hidden behind three raises", () => {
    expect(loweredMetrics({ base: FLOOR, current: floor({ b: 99, f: 99, l: 69.99, s: 99 }) })).toEqual([
      "lines: 70% -> 69.99%",
    ]);
  });

  it("names every metric when the whole floor is flattened", () => {
    expect(loweredMetrics({ base: FLOOR, current: floor({ b: 1, f: 1, l: 1, s: 1 }) })).toEqual([
      "branches: 66% -> 1%",
      "functions: 68% -> 1%",
      "lines: 70% -> 1%",
      "statements: 70% -> 1%",
    ]);
  });

  it("catches a directory floor lowered while every repo metric holds", () => {
    const base = floor({ b: 66, f: 68, l: 70, s: 70, directories: { "src/cli": { statements: 56.81 } } });
    const current = floor({ b: 66, f: 68, l: 70, s: 70, directories: { "src/cli": { statements: 56.8 } } });
    expect(loweredMetrics({ base, current })).toEqual(["src/cli statements: 56.81% -> 56.8%"]);
  });

  it("does not treat a directory floor ABSENT at HEAD as a lowering — the measured half refuses a live one", () => {
    // A deleted directory loses its floor at the next rebaseline; a directory that still exists with no
    // floor is what `compareCoverage`'s `unfloored` list catches, with a summary in hand to prove it exists.
    const base = floor({ b: 66, f: 68, l: 70, s: 70, directories: { "src/gone": { statements: 90 } } });
    expect(loweredMetrics({ base, current: FLOOR })).toEqual([]);
  });

  it("lists repo metrics before directories when both fell", () => {
    const base = floor({ b: 66, f: 68, l: 70, s: 70, directories: { "src/store": { statements: 46.06 } } });
    const current = floor({ b: 66, f: 68, l: 69, s: 70, directories: { "src/store": { statements: 40 } } });
    expect(loweredMetrics({ base, current })).toEqual(["lines: 70% -> 69%", "src/store statements: 46.06% -> 40%"]);
  });

  it("catches a drop smaller than two decimals — these are committed literals, not measurements", () => {
    // The measured check rounds, because measured coverage has float noise. Two committed numbers do not,
    // so rounding here would leave a blind spot at exactly the boundary the gate exists to hold.
    expect(loweredMetrics({ base: FLOOR, current: floor({ b: 65.999, f: 68, l: 70, s: 70 }) })).toEqual([
      "branches: 66% -> 65.999%",
    ]);
  });

  it("catches the smallest drop a double can represent — one unit in the last place", () => {
    // 66 - 1ulp. This is the tightest lowering that can exist once the JSON is parsed, and it is caught.
    const oneUlpBelow66 = 65.99999999999999;
    expect(oneUlpBelow66 < 66).toBe(true);
    expect(loweredMetrics({ base: FLOOR, current: floor({ b: oneUlpBelow66, f: 68, l: 70, s: 70 }) })).toEqual([
      "branches: 66% -> 65.99999999999999%",
    ]);
  });

  it("does not treat a literal that parses to the SAME double as a lowering", () => {
    // Deliberate, and reviewed: a pass flagged `66 -> 65.999999999999999` as an escape. It is not one.
    // JSON.parse maps that literal to exactly 66, so the committed floor VALUE is unchanged — there is
    // nothing to catch, and the effective bar has not moved. Comparing raw text instead would make
    // reformatting the file register as a lowering. The property is about the number, not the spelling.
    // Built by parsing, not written as a literal — that is the real path, and a source literal this precise
    // is itself a lint error (`no-loss-of-precision`), which rather makes the point.
    const collapsesToSixtySix = Number("65.999999999999999");
    expect(collapsesToSixtySix).toBe(66);
    expect(loweredMetrics({ base: FLOOR, current: floor({ b: collapsesToSixtySix, f: 68, l: 70, s: 70 }) })).toEqual(
      [],
    );
  });
});

describe("resolveFloorBase", () => {
  const sha = "a".repeat(40);

  it("takes a full SHA from the environment", () => {
    expect(resolveFloorBase({ env: { [FLOOR_BASE_ENV]: sha } })).toEqual({ kind: "sha", sha });
  });

  it("trims surrounding whitespace", () => {
    expect(resolveFloorBase({ env: { [FLOOR_BASE_ENV]: `  ${sha}\n` } })).toEqual({ kind: "sha", sha });
  });

  it("is invalid, a failing kind, when the variable is unset", () => {
    expect(resolveFloorBase({ env: {} }).kind).toBe("invalid");
  });

  it("accepts an uppercase SHA, which git also accepts, and normalises it", () => {
    // Rejecting case would manufacture a failure out of nothing — and under the earlier design a rejected
    // value fell through to a skip, i.e. skipped-but-green.
    expect(resolveFloorBase({ env: { [FLOOR_BASE_ENV]: "A".repeat(40) } })).toEqual({
      kind: "sha",
      sha: "a".repeat(40),
    });
  });

  it("treats the all-zero SHA as absent, not as a comparison and not as a missing base", () => {
    // A new-ref push supplies all zeroes. That means "no previous commit", which is a scope boundary —
    // distinct from a base nobody supplied or one that cannot be used, which are faults.
    const resolved = resolveFloorBase({ env: { [FLOOR_BASE_ENV]: "0".repeat(40) } });
    expect(resolved).toEqual({
      kind: "absent",
      reason: `${FLOOR_BASE_ENV} is all zeroes — this ref has no previous commit`,
    });
  });

  // A SET-but-unusable value must be a FAULT, never a skip. The whole defect class this gate exists for is
  // "reported green while checking nothing", and a mistyped CI variable that silently disables the history
  // half — while printing a reassuring "skipped" line — is exactly that, permanently and invisibly.
  it("rejects an empty value rather than treating it as no-base", () => {
    expect(resolveFloorBase({ env: { [FLOOR_BASE_ENV]: "   " } }).kind).toBe("invalid");
  });

  it("rejects an abbreviated SHA rather than skipping the check", () => {
    expect(resolveFloorBase({ env: { [FLOOR_BASE_ENV]: "a1b2c3d" } }).kind).toBe("invalid");
  });

  it("rejects a branch name rather than skipping the check", () => {
    expect(resolveFloorBase({ env: { [FLOOR_BASE_ENV]: "origin/main" } }).kind).toBe("invalid");
  });

  it("rejects a 40-character non-hex string", () => {
    expect(resolveFloorBase({ env: { [FLOOR_BASE_ENV]: "z".repeat(40) } }).kind).toBe("invalid");
  });
});

describe("readBaselineAtCommit", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reads and parses the floor as committed", () => {
    const { dir, sha } = repoWithBaseline({ text: floorJson({ b: 66, f: 68, l: 70, s: 70 }) });

    const read = readBaselineAtCommit({ root: dir, sha });

    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toEqual({ directories: {}, summary: FLOOR.summary, version: 1 });
  });

  it("reads the COMMITTED content, not the working tree — an uncommitted lowering cannot hide the base", () => {
    const { dir, sha } = repoWithBaseline({ text: floorJson({ b: 66, f: 68, l: 70, s: 70 }) });
    writeFileSync(join(dir, "coverage-baseline.json"), floorJson({ b: 1, f: 1, l: 1, s: 1 }));

    const read = readBaselineAtCommit({ root: dir, sha });

    expect(read.isOk()).toBe(true);
    expect(unwrap(read).summary).toEqual(FLOOR.summary);
  });

  it("names an unreachable commit and tells you how to fetch it", () => {
    const { dir } = repoWithBaseline({ text: floorJson({ b: 66, f: 68, l: 70, s: 70 }) });
    const missing = "0123456789012345678901234567890123456789";

    const read = readBaselineAtCommit({ root: dir, sha: missing });

    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read)).toEqual(CoverageFloorErrors.shaUnreachable({ sha: missing }));
  });

  it("distinguishes a reachable commit that simply has no floor file", () => {
    // Both this and an unreachable commit exit 128 from git. Separated only by asking in the right order.
    const dir = initRepo();
    writeFileSync(join(dir, "unrelated.txt"), "x\n");
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "no floor here"], cwd: dir });
    const sha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });

    const read = readBaselineAtCommit({ root: dir, sha });

    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read)).toEqual(CoverageFloorErrors.shaPathMissing({ sha }));
  });

  it("refuses a malformed floor at the base rather than treating it as absent", () => {
    const { dir, sha } = repoWithBaseline({ text: "THIS IS NOT JSON AT ALL\n" });

    const read = readBaselineAtCommit({ root: dir, sha });

    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).message).toContain(`coverage-baseline.json at commit ${sha} is malformed`);
  });

  it("refuses a floor whose shape is wrong even though the JSON parses", () => {
    const { dir, sha } = repoWithBaseline({ text: `${JSON.stringify({ summary: { branches: 1 }, version: 1 })}\n` });

    const read = readBaselineAtCommit({ root: dir, sha });

    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).message).toContain("malformed");
  });

  // The integrity half resolves BOTH sides through git, `HEAD` included. These two cover the counterexamples
  // that broke the earlier working-tree read, and both were reproduced against the real gate first.
  it("HEAD reports the committed floor even when an uncommitted edit raises it back", () => {
    // Commit a lowering, then 'fix' it only on disk. Reading the working tree here reported clean.
    const { dir } = repoWithBaseline({ text: floorJson({ b: 66, f: 68, l: 70, s: 70 }) });
    writeFileSync(join(dir, "coverage-baseline.json"), floorJson({ b: 65.999, f: 99, l: 99, s: 99 }));
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "lower branches by 0.001 behind three raises"], cwd: dir });
    writeFileSync(join(dir, "coverage-baseline.json"), floorJson({ b: 66, f: 99, l: 99, s: 99 }));

    const head = readBaselineAtCommit({ root: dir, sha: "HEAD" });

    expect(head.isOk()).toBe(true);
    expect(unwrap(head).summary.branches).toBe(65.999);
  });

  it("HEAD refuses when the floor was deleted in a commit but restored on disk", () => {
    const { dir } = repoWithBaseline({ text: floorJson({ b: 66, f: 68, l: 70, s: 70 }) });
    gitInTemp({ args: ["rm", "-q", "coverage-baseline.json"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "delete the floor"], cwd: dir });
    writeFileSync(join(dir, "coverage-baseline.json"), floorJson({ b: 66, f: 68, l: 70, s: 70 }));

    const head = readBaselineAtCommit({ root: dir, sha: "HEAD" });

    expect(head.isErr()).toBe(true);
    expect(unwrapErr(head)).toEqual(CoverageFloorErrors.shaPathMissing({ sha: "HEAD" }));
  });

  it("an untracked floor on disk is not the same object as the one committed at that commit", () => {
    // The masking case: a commit that DELETES the floor, plus a stray untracked copy on disk. `git show`
    // must keep reporting on the COMMIT, so the working tree can never stand in for it.
    const dir = initRepo();
    writeFileSync(join(dir, "coverage-baseline.json"), floorJson({ b: 66, f: 68, l: 70, s: 70 }));
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "floor"], cwd: dir });
    gitInTemp({ args: ["rm", "-q", "coverage-baseline.json"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "delete the floor"], cwd: dir });
    const headWithoutFloor = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
    writeFileSync(join(dir, "coverage-baseline.json"), floorJson({ b: 66, f: 68, l: 70, s: 70 }));

    const read = readBaselineAtCommit({ root: dir, sha: headWithoutFloor });

    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read)).toEqual(CoverageFloorErrors.shaPathMissing({ sha: headWithoutFloor }));
  });

  it("reads a floor larger than execFileSync's default 1 MiB buffer instead of calling it unreadable", () => {
    // Over the default buffer, `execFileSync` throws, which this path reported as "could not be read" — a
    // false FAILURE, and one the working-tree read (plain `readFileSync`) would not produce for the same
    // bytes. Both reads must agree on what is readable so the parser decides what is valid.
    const padding = " ".repeat(1024 * 1024 + 1);
    const { dir, sha } = repoWithBaseline({ text: padding + floorJson({ b: 66, f: 68, l: 70, s: 70 }) });

    const read = readBaselineAtCommit({ root: dir, sha });

    expect(read.isOk()).toBe(true);
    expect(unwrap(read).summary).toEqual(FLOOR.summary);
  });

  it("refuses a floor whose number overflows to Infinity", () => {
    // `JSON.parse("1e400")` is Infinity, which would compare as greater than any real floor. Not an escape:
    // `z.number()` is finite-only, so this is rejected as malformed before any comparison. Pinned because
    // that property of zod is easy to assume the other way, and the whole gate rests on it.
    expect(JSON.parse("1e400")).toBe(Number.POSITIVE_INFINITY);
    const { dir, sha } = repoWithBaseline({
      text: '{"summary":{"branches":1e400,"functions":68,"lines":70,"statements":70},"version":1}\n',
    });

    const read = readBaselineAtCommit({ root: dir, sha });

    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).message).toContain("malformed");
  });

  it("ignores a refs/replace substitution and reads the real committed object", () => {
    // `git show` honours replacement refs by default, so `git replace HEAD <other>` silently makes the gate
    // verify a different commit's floor. Same hazard class as an ambient GIT_DIR: repository state steering
    // what a verification gate reads.
    const { dir } = repoWithBaseline({ text: floorJson({ b: 1, f: 1, l: 1, s: 1 }) });
    const realHead = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
    writeFileSync(join(dir, "coverage-baseline.json"), floorJson({ b: 100, f: 100, l: 100, s: 100 }));
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "a flattering floor to hide behind"], cwd: dir });
    const decoy = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
    gitInTemp({ args: ["checkout", "-q", realHead], cwd: dir });
    gitInTemp({ args: ["replace", realHead, decoy], cwd: dir });

    const read = readBaselineAtCommit({ root: dir, sha: "HEAD" });

    expect(read.isOk()).toBe(true);
    expect(unwrap(read).summary).toEqual(metrics({ b: 1, f: 1, l: 1, s: 1 }));
  });

  it("is unaffected by an ambient GIT_NAMESPACE", () => {
    // A review pass claimed a namespaced HEAD could substitute another commit here. Measured on git 2.50.1:
    // it cannot. `GIT_NAMESPACE` remaps refs at the TRANSPORT layer only — `ls-remote` under the namespace
    // does show the decoy — while local resolution by `show`/`rev-parse` ignores it, and HEAD is not under
    // `refs/` at all. Pinned so that if git ever changes this, something says so.
    const { dir } = repoWithBaseline({ text: floorJson({ b: 66, f: 68, l: 70, s: 70 }) });
    const real = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
    writeFileSync(join(dir, "coverage-baseline.json"), floorJson({ b: 100, f: 100, l: 100, s: 100 }));
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-qm", "decoy"], cwd: dir });
    const decoy = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
    gitInTemp({ args: ["checkout", "-q", real], cwd: dir });
    gitInTemp({ args: ["update-ref", "refs/namespaces/decoy/HEAD", decoy], cwd: dir });
    const saved = process.env["GIT_NAMESPACE"];
    process.env["GIT_NAMESPACE"] = "decoy";

    const read = readBaselineAtCommit({ root: dir, sha: "HEAD" });

    restoreEnvVar({ name: "GIT_NAMESPACE", saved });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read).summary).toEqual(FLOOR.summary);
  });

  it("reads the requested repository even when an ambient GIT_DIR points elsewhere", () => {
    // Git exports GIT_DIR into hooks and it OVERRIDES `-C`. The pre-push hook is where this gate runs most,
    // so a naive implementation would read the wrong repo — or fail and, if it failed open, print clean.
    const { dir, sha } = repoWithBaseline({ text: floorJson({ b: 66, f: 68, l: 70, s: 70 }) });
    const decoy = mkdtempSync(join(tmpdir(), "slopweaver-decoy-"));
    gitInTemp({ args: ["init", "-q"], cwd: decoy });
    const saved = process.env["GIT_DIR"];
    process.env["GIT_DIR"] = join(decoy, ".git");

    const read = readBaselineAtCommit({ root: dir, sha });

    restoreEnvVar({ name: "GIT_DIR", saved });
    rmSync(decoy, { force: true, recursive: true });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read).summary).toEqual(FLOOR.summary);
  });
});
