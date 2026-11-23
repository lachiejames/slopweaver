/**
 * The merge-tree measurement, proven against a real local git fixture rather than a restatement of it.
 *
 * The "remote" is a bare repository on disk with a `refs/pull/<n>/head`, exactly the shape GitHub serves, so
 * the fetch, the merge-tree exit status and the `--name-only` parse are all exercised end to end with no
 * network — which is the property that makes the exit-code handling falsifiable: git decides the status,
 * not the test.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { measureConflictingPathsIn, parseMergeTreeNameOnly } from "../../../checkouts/conflictPaths.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Run one git command in the fixture, through the only sanctioned test door for git. */
function git({ cwd, args }: { cwd: string; args: readonly string[] }): string {
  return gitInTemp({ args, cwd });
}

/** Commit every file in `files` on the current branch of `cwd`. */
function commit({ cwd, files, message }: { cwd: string; files: Record<string, string>; message: string }): string {
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(cwd, name), content);
  }
  git({ args: ["add", "-A"], cwd });
  git({ args: ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", message], cwd });
  return git({ args: ["rev-parse", "HEAD"], cwd });
}

/**
 * A bare "origin" holding `staging` plus a pull request head at `refs/pull/<n>/head`, and a clone of it.
 *
 * @param conflicting whether the pull request and staging both rewrite the same file
 * @returns the clone to measure in, the pull request's head oid, and the paths it conflicts on
 */
function fixture({ conflicting }: { conflicting: boolean }): { checkout: string; headOid: string } {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-conflict-paths-"));
  scratch.push(root);
  const work = join(root, "work");
  git({ args: ["init", "-q", "-b", "staging", work], cwd: root });
  commit({ cwd: work, files: { "package.json": '{ "v": 1 }\n', "README.md": "one\n" }, message: "base" });
  git({ args: ["checkout", "-q", "-b", "feature"], cwd: work });
  const headOid = commit({
    cwd: work,
    files: { "package.json": '{ "v": 2 }\n', "src.ts": "export const a = 1;\n" },
    message: "feature",
  });
  git({ args: ["checkout", "-q", "staging"], cwd: work });
  commit({
    cwd: work,
    files: conflicting ? { "package.json": '{ "v": 3 }\n' } : { "README.md": "two\n" },
    message: "staging moved",
  });
  const origin = join(root, "origin.git");
  git({ args: ["clone", "-q", "--bare", work, origin], cwd: root });
  git({ args: ["update-ref", "refs/pull/1/head", headOid], cwd: origin });
  git({ args: ["update-ref", "-d", "refs/heads/feature"], cwd: origin });
  const checkout = join(root, "checkout");
  git({ args: ["clone", "-q", origin, checkout], cwd: root });
  return { checkout, headOid };
}

describe("parseMergeTreeNameOnly", () => {
  it("drops the tree oid on the first line and keeps one path per line after it", () => {
    const stdout = "86443f67477e0e27df920057178332ebf59fac60\npackage.json\napps/ops/package.json\n";
    expect(parseMergeTreeNameOnly({ stdout })).toEqual(["package.json", "apps/ops/package.json"]);
  });

  it("reads a clean merge — the oid alone — as no paths", () => {
    expect(parseMergeTreeNameOnly({ stdout: "86443f67477e0e27df920057178332ebf59fac60\n" })).toEqual([]);
  });

  it("de-duplicates a path git lists once per conflict stage", () => {
    expect(parseMergeTreeNameOnly({ stdout: "oid\nf\nf\n\ng\n" })).toEqual(["f", "g"]);
  });
});

describe("measureConflictingPathsIn", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("names the paths a pull request head conflicts with its base on, after fetching both from origin", () => {
    const { checkout, headOid } = fixture({ conflicting: true });
    const read = measureConflictingPathsIn({ baseRefName: "staging", checkout, headOid, number: 1 });
    expect(read).toEqual({ kind: "paths", paths: ["package.json"] });
  });

  it("reports a clean local merge as clean rather than as an empty conflict", () => {
    const { checkout, headOid } = fixture({ conflicting: false });
    const read = measureConflictingPathsIn({ baseRefName: "staging", checkout, headOid, number: 1 });
    expect(read).toEqual({ kind: "clean" });
  });

  it("reports a fetch that fails as unmeasured, naming the base it asked for", () => {
    const { checkout, headOid } = fixture({ conflicting: true });
    const read = measureConflictingPathsIn({ baseRefName: "no-such-branch", checkout, headOid, number: 1 });
    expect(read).toEqual({ kind: "unmeasured", why: expect.stringContaining("fetching no-such-branch") });
  });

  it("reports a head that does not resolve as unmeasured rather than as clean", () => {
    const { checkout } = fixture({ conflicting: true });
    const read = measureConflictingPathsIn({
      baseRefName: "staging",
      checkout,
      headOid: "0000000000000000000000000000000000000000",
      number: 1,
    });
    expect(read).toEqual({ kind: "unmeasured", why: expect.stringContaining("not something we can merge") });
  });
});
