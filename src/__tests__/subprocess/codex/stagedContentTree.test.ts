/**
 * `captureStagedContentTree` against REAL temporary git repositories.
 *
 * The property `github stack push` relies on is "the pin equals the tree the caller's own `git add --all`
 * would stage" — a statement about git as actually invoked, so a fake could only prove itself. Each case
 * pins, then runs the real add and `write-tree`, and compares.
 */

import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { captureStagedContentTree } from "../../../codex/snapshot.js";
import { unwrap } from "../../../lib/result.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/** `stackPushGit.ts`'s lineage format, restated: a fake could only prove the copy, so git reads it here. */
const AMEND_LINEAGE_FORMAT = "--format=%P%x00%an%x00%ae%x00%ai%x00%B%x00.";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Holds only this file's scratch indexes, so counting it is cheap and says nothing about other suites. */
const stagingRoot = mkdtempSync(join(tmpdir(), "slopweaver-staged-test-root-"));

afterAll(() => {
  rmSync(stagingRoot, { force: true, recursive: true });
});

/** A repository with committed files of each kind the edge cases below change. */
function seededRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-staged-src-"));
  fixtureDirs.push(dir);
  gitIn({ args: ["init", "-q"], dir });
  gitIn({ args: ["config", "user.email", "test@example.com"], dir });
  gitIn({ args: ["config", "user.name", "Test"], dir });
  writeFileSync(join(dir, "tracked.txt"), "committed\n");
  writeFileSync(join(dir, "script.sh"), "echo hi\n");
  writeFileSync(join(dir, "doomed.txt"), "to be deleted\n");
  writeFileSync(join(dir, "hidden.txt"), "skip-worktree\n");
  writeFileSync(join(dir, "target-a.txt"), "a\n");
  writeFileSync(join(dir, "target-b.txt"), "b\n");
  symlinkSync("target-a.txt", join(dir, "link"));
  writeFileSync(join(dir, ".gitignore"), "ignored/\n");
  gitIn({ args: ["add", "-A"], dir });
  gitIn({ args: ["commit", "-qm", "seed"], dir });
  return dir;
}

function gitIn({ dir, args }: { dir: string; args: readonly string[] }): string {
  return gitInTemp({ args: [...args], cwd: dir });
}

/** What the caller's own `git add --all` stages, read back as a tree id. */
function realStagedTree({ dir }: { dir: string }): string {
  gitIn({ args: ["add", "--all"], dir });
  return gitIn({ args: ["write-tree"], dir });
}

function pin({ dir }: { dir: string }): string {
  return unwrap(captureStagedContentTree({ repoRoot: dir, stagingParent: stagingRoot }));
}

describe("captureStagedContentTree", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("pins exactly the tree the real add stages, leaving the caller's index byte-for-byte alone", () => {
    const dir = seededRepo();
    writeFileSync(join(dir, "tracked.txt"), "edited\n");
    writeFileSync(join(dir, "new.txt"), "untracked\n");
    const indexBefore = readFileSync(join(dir, ".git", "index"));
    const pinned = pin({ dir });
    expect(readFileSync(join(dir, ".git", "index")).equals(indexBefore)).toBe(true);
    expect(readdirSync(stagingRoot)).toEqual([]);
    expect(realStagedTree({ dir })).toBe(pinned);
  });

  it("differs once the worktree is edited after the pin, and git names the edited path", () => {
    const dir = seededRepo();
    writeFileSync(join(dir, "tracked.txt"), "reviewed\n");
    const pinned = pin({ dir });
    writeFileSync(join(dir, "tracked.txt"), "edited mid-push\n");
    const staged = realStagedTree({ dir });
    expect(staged).not.toBe(pinned);
    expect(gitIn({ args: ["diff", "--name-only", "-z", "--no-renames", pinned, staged], dir })).toBe("tracked.txt\0");
  });

  it("agrees with the real add on a mode change, a symlink retarget, a deletion and a newline filename", () => {
    const dir = seededRepo();
    chmodSync(join(dir, "script.sh"), 0o755);
    unlinkSync(join(dir, "link"));
    symlinkSync("target-b.txt", join(dir, "link"));
    unlinkSync(join(dir, "doomed.txt"));
    writeFileSync(join(dir, "two\nlines.txt"), "newline in the name\n");
    writeFileSync(join(dir, "ignored-not.txt"), "untracked\n");
    const pinned = pin({ dir });
    expect(pinned).not.toBe(gitIn({ args: ["rev-parse", "HEAD^{tree}"], dir }));
    expect(realStagedTree({ dir })).toBe(pinned);
  });

  it("sees a commit's real tree through a replace ref only with --no-replace-objects, as the amend reads it", () => {
    const dir = seededRepo();
    const original = gitIn({ args: ["rev-parse", "HEAD"], dir });
    const pinned = pin({ dir });
    writeFileSync(join(dir, "tracked.txt"), "a hook's edit\n");
    gitIn({ args: ["commit", "-qam", "amended"], dir });
    const amended = gitIn({ args: ["rev-parse", "HEAD"], dir });
    gitIn({ args: ["replace", amended, original], dir });
    expect(gitIn({ args: ["rev-parse", `${amended}^{tree}`], dir })).toBe(pinned);
    expect(gitIn({ args: ["--no-replace-objects", "rev-parse", `${amended}^{tree}`], dir })).not.toBe(pinned);
  });

  it("keeps the lineage stack push compares across an amend, and tells a raced same-tree commit apart", () => {
    const dir = seededRepo();
    const lineage = ({ sha }: { sha: string }): string =>
      gitIn({
        args: [
          "--no-replace-objects",
          "show",
          "-s",
          "--no-show-signature",
          "--encoding=UTF-8",
          AMEND_LINEAGE_FORMAT,
          sha,
        ],
        dir,
      });
    writeFileSync(join(dir, "tracked.txt"), "second\n");
    gitIn({ args: ["commit", "-qam", "the commit under review"], dir });
    const checked = gitIn({ args: ["rev-parse", "HEAD"], dir });
    const raced = gitIn({ args: ["commit-tree", "HEAD^{tree}", "-p", "HEAD~1", "-m", "a raced commit"], dir });
    writeFileSync(join(dir, "tracked.txt"), "amended\n");
    gitIn({ args: ["add", "--all"], dir });
    gitIn({ args: ["commit", "-q", "--amend", "--no-edit"], dir });
    expect(lineage({ sha: gitIn({ args: ["rev-parse", "HEAD"], dir }) })).toBe(lineage({ sha: checked }));
    expect(lineage({ sha: raced })).not.toBe(lineage({ sha: checked }));
    // A commit-msg hook adding only trailing whitespace still reads as a different message, trim or no trim.
    gitIn({ args: ["commit", "-q", "--amend", "--cleanup=verbatim", "-m", "the commit under review \n"], dir });
    expect(lineage({ sha: gitIn({ args: ["rev-parse", "HEAD"], dir }) })).not.toBe(lineage({ sha: checked }));
  });

  it("pins what the real add stages when the caller has no index file at all", () => {
    const dir = seededRepo();
    unlinkSync(join(dir, ".git", "index"));
    const pinned = pin({ dir });
    expect(realStagedTree({ dir })).toBe(pinned);
  });

  it("carries the caller's index state: a staged-then-deleted file, intent-to-add and skip-worktree", () => {
    const dir = seededRepo();
    writeFileSync(join(dir, "staged-then-gone.txt"), "staged\n");
    gitIn({ args: ["add", "staged-then-gone.txt"], dir });
    unlinkSync(join(dir, "staged-then-gone.txt"));
    writeFileSync(join(dir, "intent.txt"), "intent to add\n");
    gitIn({ args: ["add", "--intent-to-add", "intent.txt"], dir });
    gitIn({ args: ["update-index", "--skip-worktree", "hidden.txt"], dir });
    writeFileSync(join(dir, "hidden.txt"), "edited behind skip-worktree\n");
    const pinned = pin({ dir });
    expect(realStagedTree({ dir })).toBe(pinned);
  });
});
