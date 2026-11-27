/**
 * Every read the scan uses to call a commit BACKED UP names `origin` alone, never every remote.
 *
 * `--not --remotes` counts an `archive` remote's refs too, and that remote holds a history the public
 * repository does not share — so a commit only the archive carries would read as backed up and its tree go.
 * Driven through the scan's injected git seam: a plain recording function, never a mock.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { GitRunner } from "../../../worktree/pruneGit.js";
import { branchAbsorbed, detachedHead, scanWorktree } from "../../../worktree/pruneScan.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A fake git where the first key whose words all appear in the argv wins, recording each argv it was handed.
 *
 * @param answers what each matched argv answers; an argv matching none answers `null`
 * @returns the recorded argv list and the runner
 */
const recordingGit = ({
  answers,
}: {
  answers: Readonly<Record<string, string | null>>;
}): { asked: string[]; git: GitRunner } => {
  const asked: string[] = [];
  const git: GitRunner = ({ args }) => {
    const argv = args.join(" ");
    asked.push(argv);
    const key = Object.keys(answers).find((words) => words.split(" ").every((word) => argv.includes(word)));
    if (key === undefined) {
      return null;
    }
    return answers[key]!;
  };
  return { asked, git };
};

describe("every backed-up read names origin alone, never every remote", () => {
  it("asks for a detached head's carrier among origin's branches only", () => {
    const { asked, git } = recordingGit({ answers: { "rev-parse HEAD": "abc1234", "branch --remotes": "" } });
    expect(detachedHead({ git, path: "/w", repoRoot: "/r" }).headOnRemoteRef).toBe(null);
    expect(asked).toEqual([
      "rev-parse HEAD",
      "branch --remotes --contains abc1234 --list origin/* --format=%(refname:short)",
    ]);
  });

  it("counts a branch's local merges against origin alone", () => {
    const { asked, git } = recordingGit({ answers: { "--merges": "1", "rev-list --count": "2" } });
    expect(branchAbsorbed({ branch: "b", git, repoRoot: "/r", trunk: "origin/main" })).toBe(false);
    expect(asked).toContain("rev-list --count --merges b --not --remotes=origin");
    expect(asked.filter((argv) => argv.endsWith("--not --remotes"))).toEqual([]);
  });

  it("counts a branch's unbacked commits against origin alone, so an archive remote's copy backs nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-scan-origin-only-"));
    dirs.push(dir);
    // The ignored-file and stash reads come FIRST, because the first matching key wins and `ls-files -s`
    // would otherwise answer the ignored listing too.
    const { asked, git } = recordingGit({
      answers: {
        "--ignored": "",
        "rev-parse HEAD": "abc1234",
        "stash list": "",
        "status --porcelain": "",
        "ls-files -v": "",
        "ls-files -s": "",
        "--merges": "0",
        "rev-list --count": "2",
        "rev-list topic --not --remotes=origin": "aaa\nbbb",
        "log -1": "1756000000",
      },
    });
    const facts = scanWorktree({
      git,
      liveRefs: [],
      mainCheckout: "/repo",
      openPullRequests: [],
      repoRoot: "/repo",
      runsDir: "/runs",
      trunk: "origin/main",
      worktree: { branch: "topic", path: dir },
    });
    expect(facts.unbackedCommits).toBe(2);
    expect(asked).toContain("rev-list topic --not --remotes=origin");
    expect(asked.filter((argv) => argv.endsWith("--not --remotes"))).toEqual([]);
  });
});
