/**
 * The fact the landing floor's carried-review rule rests on: the diff hash a PULL REQUEST HEAD produces from
 * any checkout equals the one `codex review` recorded in a clean checkout — and survives a conflict-free
 * rebase, which is exactly when the duplicate-pass gate (`codex/duplicate.ts`) refuses a re-run.
 *
 * Real git, per `.claude/rules/testing.md`'s fixture allowance: the subject IS git's diff bytes, so a fake
 * would prove nothing about them.
 */

import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { commitDiffSha256 } from "../../../codex/diffsNow.js";
import { captureReviewDiff, captureTreeFingerprint } from "../../../codex/gitDiff.js";
import { unwrap } from "../../../lib/result.js";
import { seedTemplate } from "../../seedTemplate.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const REAL_GIT = { timeout: REAL_GIT_TIMEOUT_MS };
const MAX_BYTES = 1024 * 1024;
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Commit everything in the working tree. */
function commitAll({ dir, message }: { dir: string; message: string }): void {
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-m", message], cwd: dir });
}

/**
 * The seeded repository every case copies, built ONCE per file and never written: its `init`, two `config` calls,
 * two commits and a branch were a third of this file's git spawns. A copy carries the index's stale stat data,
 * which git content-checks rather than trusts, so every diff and fingerprint reads it exactly as the seed.
 */
let template: string | undefined;

afterAll(() => {
  if (template !== undefined) {
    rmSync(template, { force: true, recursive: true });
  }
});

/** The seeded template, built by whichever case asks first. */
function templateRepo(): string {
  if (template !== undefined) {
    return template;
  }
  template = seedTemplate({ prefix: "slopweaver-cds-template-", seed: seedFeatureRepo });
  return template;
}

/** A `main` with one commit, and a `feature` branch off it carrying one change — checked out on `feature`. */
function featureRepo({ label }: { label: string }): string {
  const source = templateRepo();
  const dir = mkdtempSync(join(tmpdir(), `slopweaver-cds-${label}-`));
  dirs.push(dir);
  cpSync(source, dir, { recursive: true });
  return dir;
}

/** Build the repository {@link featureRepo} describes at `dir`, with real git. */
function seedFeatureRepo({ dir }: { dir: string }): void {
  const steps: readonly (readonly string[])[] = [
    ["init", "--initial-branch=main"],
    ["config", "user.email", "dev@example.invalid"],
    ["config", "user.name", "Dev"],
  ];
  for (const args of steps) {
    gitInTemp({ args, cwd: dir });
  }
  writeFileSync(join(dir, "a.txt"), "one\n");
  commitAll({ dir, message: "base" });
  gitInTemp({ args: ["checkout", "-b", "feature"], cwd: dir });
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  commitAll({ dir, message: "feature" });
}

/** The review diff's sha256 as `codex review` would record it in this checkout, against `main`. */
function recordedSha({ dir }: { dir: string }): string {
  return unwrap(unwrap(captureReviewDiff({ base: "main", cwd: dir, maxBytes: MAX_BYTES }))).sha256;
}

describe("commitDiffSha256", () => {
  it("equals the sha a clean checkout at that commit records for its review diff", REAL_GIT, () => {
    const dir = featureRepo({ label: "equal" });
    const head = unwrap(captureTreeFingerprint({ cwd: dir })).headSha;

    expect(unwrap(commitDiffSha256({ base: "main", commit: head, cwd: dir }))).toBe(recordedSha({ dir }));
  });

  /**
   * The finding itself: a conflict-free rebase moves HEAD and the committed tree
   * — the tree fingerprint calls every review STALE — while the reviewed diff does not move at all.
   */
  it("holds across a conflict-free rebase that moves HEAD and the tree", REAL_GIT, () => {
    const dir = featureRepo({ label: "rebase" });
    const before = unwrap(captureTreeFingerprint({ cwd: dir }));
    const reviewed = recordedSha({ dir });
    gitInTemp({ args: ["checkout", "main"], cwd: dir });
    writeFileSync(join(dir, "b.txt"), "unrelated\n");
    commitAll({ dir, message: "main moves" });
    gitInTemp({ args: ["checkout", "feature"], cwd: dir });
    gitInTemp({ args: ["rebase", "main"], cwd: dir });

    const after = unwrap(captureTreeFingerprint({ cwd: dir }));

    expect(after.treeSha).not.toBe(before.treeSha);
    expect(unwrap(commitDiffSha256({ base: "main", commit: after.headSha, cwd: dir }))).toBe(reviewed);
  });

  it("moves when the branch's own change moves", REAL_GIT, () => {
    const dir = featureRepo({ label: "moves" });
    const reviewed = recordedSha({ dir });
    writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
    commitAll({ dir, message: "more" });
    const head = unwrap(captureTreeFingerprint({ cwd: dir })).headSha;

    expect(unwrap(commitDiffSha256({ base: "main", commit: head, cwd: dir }))).not.toBe(reviewed);
  });

  it("fails on a base ref git cannot resolve, rather than hashing an empty diff", REAL_GIT, () => {
    const dir = featureRepo({ label: "unknown-base" });
    const head = unwrap(captureTreeFingerprint({ cwd: dir })).headSha;

    const digest = commitDiffSha256({ base: "no-such-ref", commit: head, cwd: dir });

    expect(digest.isErr()).toBe(true);
    expect(digest._unsafeUnwrapErr().message).toContain("merge-base");
  });
});
