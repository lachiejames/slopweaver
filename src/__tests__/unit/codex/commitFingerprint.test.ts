/**
 * The one arithmetic fact the landing floor's whole design rests on.
 *
 * `commitTreeFingerprint` lets a landing verb judge a pull request it is not standing on, by computing the
 * fingerprint a CLEAN checkout at the head commit WOULD have. That is only sound if the two are genuinely the
 * same value — so this asserts the equality against real git rather than restating the formula, and it is
 * what keeps the claim in `../../../codex/landingGate.ts`'s header from becoming a comment nobody re-checked.
 *
 * Real git, per `.claude/rules/testing.md`'s fixture allowance: the subject IS git's tree object, so a fake
 * would prove nothing about it.
 */

import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { captureTreeFingerprint, commitTreeFingerprint } from "../../../codex/gitDiff.js";
import { unwrap } from "../../../lib/result.js";
import { seedTemplate } from "../../seedTemplate.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const REAL_GIT = { timeout: REAL_GIT_TIMEOUT_MS };
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * The seeded repository every case copies, committed ONCE per file and never written: its `init`, two `config`
 * calls, `add` and `commit` were a third of this file's git spawns. A copy carries the index's stale stat data,
 * which git content-checks rather than trusts, so a copy captures exactly as the seed would.
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
  template = seedTemplate({ prefix: "slopweaver-fp-template-", seed: seedRepo });
  return template;
}

/** A one-commit repository on `feature`: a copy of the seeded template. */
function scratchRepo({ label }: { label: string }): string {
  const source = templateRepo();
  const dir = mkdtempSync(join(tmpdir(), `slopweaver-fp-${label}-`));
  dirs.push(dir);
  cpSync(source, dir, { recursive: true });
  return dir;
}

/** Commit one file into a new repository on `feature` at `dir`, built with the only sanctioned git runner. */
function seedRepo({ dir }: { dir: string }): void {
  const steps: readonly (readonly string[])[] = [
    ["init", "--initial-branch=feature"],
    ["config", "user.email", "dev@example.invalid"],
    ["config", "user.name", "Dev"],
  ];
  for (const args of steps) {
    gitInTemp({ args, cwd: dir });
  }
  writeFileSync(join(dir, "a.txt"), "one\n");
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-m", "first"], cwd: dir });
}

describe("commitTreeFingerprint", () => {
  it(
    "equals what a clean checkout at that commit captures, which is what lets a landing verb judge from elsewhere",
    REAL_GIT,
    () => {
      const dir = scratchRepo({ label: "equal" });
      const captured = unwrap(captureTreeFingerprint({ cwd: dir }));

      const computed = unwrap(commitTreeFingerprint({ commit: captured.headSha, cwd: dir }));

      expect(computed).toEqual(captured);
      expect(computed.dirtyBytes).toBe(0);
    },
  );

  /**
   * The equality is about the COMMIT, not about what the working tree happens to hold — which is the whole
   * point, since the presser's tree is now irrelevant. Dirty the checkout and the computed value must not
   * budge, while the captured one must.
   */
  it("is unmoved by uncommitted change, where capturing the same tree is not", REAL_GIT, () => {
    const dir = scratchRepo({ label: "dirty" });
    const clean = unwrap(captureTreeFingerprint({ cwd: dir }));
    writeFileSync(join(dir, "a.txt"), "one\ntwo\n");

    const computed = unwrap(commitTreeFingerprint({ commit: clean.headSha, cwd: dir }));
    const captured = unwrap(captureTreeFingerprint({ cwd: dir }));

    expect(computed.digest).toBe(clean.digest);
    expect(captured.digest).not.toBe(clean.digest);
    expect(captured.dirtyBytes).toBeGreaterThan(0);
  });

  /**
   * The refusal the qualifying check is built on: git answers "I do not have that object" rather than this
   * code guessing. A bare `rev-parse <sha>` would echo an unknown argument straight back and succeed, which
   * is why `--verify` and the `^{tree}` peel are both load-bearing.
   */
  it("fails on a commit this checkout does not hold, rather than inventing a tree", REAL_GIT, () => {
    const dir = scratchRepo({ label: "absent" });

    const computed = commitTreeFingerprint({ commit: "0".repeat(40), cwd: dir });

    expect(computed.isErr()).toBe(true);
    // Name the failure rather than only that there was one: `rev-parse` refusing an ABSENT OBJECT is the
    // fact the qualifying check rests on, and a refusal for any other reason would pass a bare `isErr`.
    expect(computed._unsafeUnwrapErr().message).toContain("rev-parse");
  });

  /**
   * A repository root is a raw pathname and may hold a newline. `captureTreeFingerprint` reads the root, HEAD
   * and its tree from ONE `rev-parse`, so the root has to be the last line it splits off, or a legal path
   * splits into an extra line and the capture fails where three separate calls succeeded.
   */
  it("captures from a repository whose root path holds a newline", REAL_GIT, () => {
    const parent = scratchRepo({ label: "newline" });
    const dir = join(parent, "repo\nline");
    cpSync(template!, dir, { recursive: true });

    const captured = unwrap(captureTreeFingerprint({ cwd: dir }));
    const computed = unwrap(commitTreeFingerprint({ commit: captured.headSha, cwd: dir }));

    expect(computed).toEqual(captured);
  });

  /** Two commits with different content must not collide, or staleness could never be measured at all. */
  it("moves when the committed tree moves", REAL_GIT, () => {
    const dir = scratchRepo({ label: "moves" });
    const first = unwrap(captureTreeFingerprint({ cwd: dir })).headSha;
    writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
    gitInTemp({ args: ["add", "-A"], cwd: dir });
    gitInTemp({ args: ["commit", "-m", "second"], cwd: dir });
    const second = unwrap(captureTreeFingerprint({ cwd: dir })).headSha;

    const before = unwrap(commitTreeFingerprint({ commit: first, cwd: dir }));
    const after = unwrap(commitTreeFingerprint({ commit: second, cwd: dir }));

    expect(before.digest).not.toBe(after.digest);
  });
});
