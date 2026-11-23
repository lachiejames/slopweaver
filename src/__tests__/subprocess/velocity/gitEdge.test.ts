/**
 * `gitEdge.ts` against a real, throwaway repository — the only sanctioned way to shell git from a test is
 * `gitInTemp` (`src/__tests__/tempGitRepo.ts`), which builds the fixture here; the module under test then
 * runs its own git calls exactly as production code would.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { mergesPerDay, resolveVelocityRef } from "../../../velocity/gitEdge.js";
import { trailingDayWindows } from "../../../velocity/windows.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh repo on branch `main`, with the `user.*` config git commit needs and no upstream. */
function freshRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-velocity-git-"));
  fixtureDirs.push(dir);
  gitInTemp({ args: ["init", "-b", "main"], cwd: dir });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: dir });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: dir });
  return dir;
}

/** One commit with `subject`, touching a file so the commit is never empty. */
function commit({ dir, subject }: { dir: string; subject: string }): void {
  writeFileSync(join(dir, `${String(Math.random()).slice(2)}.txt`), "x");
  gitInTemp({ args: ["add", "."], cwd: dir });
  gitInTemp({ args: ["commit", "-m", subject], cwd: dir });
}

describe("mergesPerDay", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("counts only today's squash-merge-shaped subjects, within today's window", () => {
    const dir = freshRepo();
    commit({ dir, subject: "feat(x): thing (#1)" });
    commit({ dir, subject: "docs: readme" });
    commit({ dir, subject: "fix(y): other (#2)" });

    const windows = trailingDayWindows({ days: 1, nowIso: new Date().toISOString() });
    const counts = mergesPerDay({ cwd: dir, ref: "main", windows });

    expect(counts).toEqual([{ dayKey: windows[0]?.dayKey, merges: 2 }]);
  });

  it("reads a ref that starts with a dash as a revision, never as an option that opens a file", () => {
    const dir = freshRepo();
    commit({ dir, subject: "feat(x): thing (#1)" });
    const windows = trailingDayWindows({ days: 1, nowIso: new Date().toISOString() });

    writeFileSync(join(dir, "order.txt"), "x");

    // Before `--end-of-options`, git took these as `-p -O <file>`: it read one and failed reading the other, which
    // told a caller whether a file existed. Now both are refused alike, before anything is opened.
    for (const ref of ["-pOorder.txt", "-pOmissing.txt"]) {
      expect(() => mergesPerDay({ cwd: dir, ref, windows })).toThrow(
        `option '${ref}' must come before non-option arguments`,
      );
    }
  });

  it("reports 0 for a window with no commits in it at all", () => {
    const dir = freshRepo();
    commit({ dir, subject: "feat(x): thing (#1)" });

    const counts = mergesPerDay({
      cwd: dir,
      ref: "main",
      windows: [{ dayKey: "2000-01-01", sinceIso: "2000-01-01T00:00:00.000Z", untilIso: "2000-01-02T00:00:00.000Z" }],
    });

    expect(counts).toEqual([{ dayKey: "2000-01-01", merges: 0 }]);
  });
});

describe("resolveVelocityRef", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("returns the caller's explicit ref unchanged, without touching git", () => {
    expect(resolveVelocityRef({ cwd: "/does/not/exist", ref: "some-ref" })).toBe("some-ref");
  });

  it("falls back to main when origin/main does not exist", () => {
    const dir = freshRepo();
    commit({ dir, subject: "chore: init" });

    expect(resolveVelocityRef({ cwd: dir })).toBe("main");
  });

  it("falls back to HEAD when neither origin/main nor main resolve", () => {
    const dir = freshRepo();
    gitInTemp({ args: ["checkout", "-b", "some-other-branch"], cwd: dir });
    commit({ dir, subject: "chore: init" });

    expect(resolveVelocityRef({ cwd: dir })).toBe("HEAD");
  });
});
