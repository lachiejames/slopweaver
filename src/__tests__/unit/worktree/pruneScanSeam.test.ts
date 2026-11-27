/**
 * The SCAN's own decisions, driven through its injected git seam rather than a repository on disk.
 *
 * `scanWorktree` is the effectful half of the prune, and every question it asks is a git call — so a plain
 * fake `GitRunner` (a function passed in, never a mock) plus a real temp directory for the mtime and the
 * run journal is enough to exercise the whole decision tree. What is under test here is the SHIPPED
 * function: the order it asks its questions in, which answers it declines to ask for, and what a `null`
 * from git turns into.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { classifyWorktree, type PruneVerdict, type WorktreeFacts } from "../../../worktree/pruneClassify.js";
import type { GitRunner } from "../../../worktree/pruneGit.js";
import {
  branchAbsorbed,
  detachedHead,
  listRepoWorktrees,
  scanWorktree,
  trunkRefOf,
} from "../../../worktree/pruneScan.js";

const dirs: string[] = [];

const tempDir = ({ name }: { name: string }): string => {
  const dir = mkdtempSync(join(tmpdir(), `sw-scan-${name}-`));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fake git: the first key whose words all appear in the argv wins, so a case names only what it cares about. */
const fakeGit = ({ answers }: { answers: Readonly<Record<string, string | null>> }): GitRunner => {
  return ({ args }) => {
    const argv = args.join(" ");
    const key = Object.keys(answers).find((words) => words.split(" ").every((word) => argv.includes(word)));
    if (key === undefined) {
      return null;
    }
    return answers[key]!;
  };
};

const ALL_NULL: Readonly<Record<string, string | null>> = {};

/**
 * The ignored-file and stash reads answered empty. Spread FIRST, because the fake takes the first key that
 * matches and `ls-files -s` would otherwise answer the ignored listing too.
 */
const CONTEXT_READ: Readonly<Record<string, string | null>> = {
  "--ignored": "",
  "rev-parse HEAD": "abc1234",
  "stash list": "",
};

/** A tree with one tracked edit and one untracked file, on a branch the trunk has absorbed. */
const DIRTY_TREE: Readonly<Record<string, string | null>> = {
  "status --porcelain": " M src/a.ts\n?? src/b.ts",
  "ls-files -v": "H src/a.ts",
  "ls-files -s": "",
  "rev-list --count": "0",
  "log -1": "1756000000",
};

/**
 * The verdict on a scanned tree a fortnight after its last activity, past both thresholds.
 *
 * @param facts what the scan read
 * @returns the classifier's verdict
 */
const weekColdVerdict = ({ facts }: { facts: WorktreeFacts }): PruneVerdict => {
  const week = 7 * 86_400_000;
  return classifyWorktree({
    facts: { ...facts, lastActivityMs: 1_756_000_000_000 },
    nowMs: 1_756_000_000_000 + 2 * week,
    nukeAfterMs: week,
    olderThanMs: 86_400_000,
  });
};

describe("detachedHead", () => {
  it("names the first REMOTE-qualified ref that contains the head, never the bare origin symref", () => {
    const git = fakeGit({
      answers: { "rev-parse HEAD": "abc1234", "branch --remotes --contains": "origin\norigin/main\norigin/topic" },
    });
    expect(detachedHead({ git, path: "/w", repoRoot: "/r" })).toEqual({
      headOnRemoteRef: "origin/main",
      headSha: "abc1234",
    });
  });

  it("reports no carrier when every containing ref is the bare symref", () => {
    const git = fakeGit({ answers: { "rev-parse HEAD": "abc1234", "branch --remotes --contains": "origin" } });
    expect(detachedHead({ git, path: "/w", repoRoot: "/r" })).toEqual({
      headOnRemoteRef: null,
      headSha: "abc1234",
    });
  });

  it("reports neither fact when the head itself cannot be resolved", () => {
    expect(detachedHead({ git: fakeGit({ answers: ALL_NULL }), path: "/w", repoRoot: "/r" })).toEqual({
      headOnRemoteRef: null,
      headSha: null,
    });
  });

  it("keeps the sha and reports no carrier when the contains query fails", () => {
    const git = fakeGit({ answers: { "rev-parse HEAD": "abc1234" } });
    expect(detachedHead({ git, path: "/w", repoRoot: "/r" }).headOnRemoteRef).toBe(null);
  });

  it("treats an EMPTY rev-parse as unresolvable rather than as a sha of no characters", () => {
    const git = fakeGit({ answers: { "rev-parse HEAD": "" } });
    expect(detachedHead({ git, path: "/w", repoRoot: "/r" }).headSha).toBe(null);
  });
});

/** Commit shas and patch ids for the patch-id fixtures: any 40 hex characters read as one. */
const A = "a".repeat(40);
const B = "b".repeat(40);
const T = "c".repeat(40);
const U = "d".repeat(40);
const P1 = "1".repeat(40);
const P2 = "2".repeat(40);

/** The two path listings, keyed by the range each side asks — branch side first. */
const SIDES = {
  branch: "--name-only origin/main..b",
  trunk: "--name-only b..origin/main",
} as const;

describe("branchAbsorbed", () => {
  it("answers true off the commit graph alone when the branch is nothing ahead of the trunk", () => {
    const git = fakeGit({ answers: { "rev-list --count": "0", "patch-id": null } });
    expect(branchAbsorbed({ branch: "b", git, repoRoot: "/r", trunk: "origin/main" })).toBe(true);
  });

  it("reads a commit landed under a new SHA as absorbed, because its verbatim patch id matches", () => {
    const git = fakeGit({
      answers: {
        [SIDES.branch]: `\0${A}\n\nsrc/a.ts`,
        [SIDES.trunk]: `\0${T}\n\nsrc/a.ts\n\0${U}\n\nsrc/b.ts`,
        "patch-id": `${P1} ${A}\n${P1} ${T}`,
        "--no-walk": "commit …",
        "--merges": "0",
        "rev-list --count": "1",
      },
    });
    expect(branchAbsorbed({ branch: "b", git, repoRoot: "/r", trunk: "origin/main" })).toBe(true);
  });

  it("hashes only the branch commits and the trunk commits sharing a path set, from an untrimmed log", () => {
    const calls: { args: readonly string[]; stdin: string | undefined; untrimmed: boolean | undefined }[] = [];
    const answers: Readonly<Record<string, string | null>> = {
      [SIDES.branch]: `\0${A}\n\nsrc/a.ts`,
      [SIDES.trunk]: `\0${T}\n\nsrc/a.ts\n\0${U}\n\nsrc/b.ts`,
      "patch-id": `${P1} ${A}\n${P1} ${T}`,
      "--no-walk": "commit … +x \n",
      "--merges": "0",
      "rev-list --count": "1",
    };
    const inner = fakeGit({ answers });
    const git: GitRunner = (input) => {
      calls.push({ args: input.args, stdin: input.stdin, untrimmed: input.untrimmed });
      return inner(input);
    };
    branchAbsorbed({ branch: "b", git, repoRoot: "/r", trunk: "origin/main" });
    const log = calls.find((call) => call.args.includes("--no-walk"))!;
    expect(log.args).toEqual([
      "log",
      "-p",
      "--no-merges",
      "--no-renames",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--full-index",
      "--binary",
      "--format=commit %H",
      "--no-walk",
      A,
      T,
      "--",
    ]);
    expect(log.untrimmed).toBe(true);
    expect(calls.find((call) => call.args.includes("patch-id"))!.stdin).toBe("commit … +x \n");
  });

  it("answers false when one commit's patch is not among the trunk's", () => {
    const git = fakeGit({
      answers: {
        [SIDES.branch]: `\0${A}\n\nsrc/a.ts\n\0${B}\n\nsrc/a.ts`,
        [SIDES.trunk]: `\0${T}\n\nsrc/a.ts`,
        "patch-id": `${P1} ${A}\n${P2} ${B}\n${P1} ${T}`,
        "--no-walk": "commit …",
        "--merges": "0",
        "rev-list --count": "2",
      },
    });
    expect(branchAbsorbed({ branch: "b", git, repoRoot: "/r", trunk: "origin/main" })).toBe(false);
  });

  it("answers false without reading a patch when no trunk commit touches the branch's set of paths", () => {
    const git = fakeGit({
      answers: {
        [SIDES.branch]: `\0${A}\n\nsrc/a.ts`,
        [SIDES.trunk]: `\0${T}\n\nsrc/a.ts\nsrc/b.ts`,
        "patch-id": null,
        "--merges": "0",
        "rev-list --count": "1",
      },
    });
    expect(branchAbsorbed({ branch: "b", git, repoRoot: "/r", trunk: "origin/main" })).toBe(false);
  });

  it("answers false for a merge commit no remote carries, which patch ids never list", () => {
    const git = fakeGit({ answers: { "--merges": "1", "rev-list --count": "2" } });
    expect(branchAbsorbed({ branch: "b", git, repoRoot: "/r", trunk: "origin/main" })).toBe(false);
  });

  it("answers null — UNANSWERABLE, never a clean bill — when the merge count fails", () => {
    const git = fakeGit({ answers: { "--merges": null, "rev-list --count": "2" } });
    expect(branchAbsorbed({ branch: "b", git, repoRoot: "/r", trunk: "origin/main" })).toBe(null);
  });

  it("answers null — UNANSWERABLE, never a clean bill — when a path listing fails", () => {
    const git = fakeGit({
      answers: { [SIDES.branch]: `\0${A}\n\nsrc/a.ts`, [SIDES.trunk]: null, "--merges": "0", "rev-list --count": "1" },
    });
    expect(branchAbsorbed({ branch: "b", git, repoRoot: "/r", trunk: "origin/main" })).toBe(null);
  });

  it("answers null — UNANSWERABLE, never a clean bill — when patch-id itself fails", () => {
    const git = fakeGit({
      answers: {
        [SIDES.branch]: `\0${A}\n\nsrc/a.ts`,
        [SIDES.trunk]: `\0${T}\n\nsrc/a.ts`,
        "patch-id": null,
        "--no-walk": "commit …",
        "--merges": "0",
        "rev-list --count": "1",
      },
    });
    expect(branchAbsorbed({ branch: "b", git, repoRoot: "/r", trunk: "origin/main" })).toBe(null);
  });
});

describe("trunkRefOf and listRepoWorktrees", () => {
  it("reads the remote's own default branch, fully qualified so no local name can answer for it", () => {
    const asked: (readonly string[])[] = [];
    const git: GitRunner = ({ args }) => {
      asked.push(args);
      return "refs/remotes/origin/main";
    };
    expect(trunkRefOf({ git, repoRoot: "/r" })).toBe("refs/remotes/origin/main");
    expect(asked).toEqual([["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]]);
  });

  it("answers null for an unresolvable remote head, and for an empty one", () => {
    expect(trunkRefOf({ git: fakeGit({ answers: ALL_NULL }), repoRoot: "/r" })).toBe(null);
    expect(trunkRefOf({ git: fakeGit({ answers: { "symbolic-ref": "" } }), repoRoot: "/r" })).toBe(null);
  });

  it("parses git's porcelain listing into entries", () => {
    const git = fakeGit({
      answers: {
        "worktree list": "worktree /a\nHEAD abc\nbranch refs/heads/topic\n\nworktree /b\nHEAD def\ndetached\n",
      },
    });
    expect(listRepoWorktrees({ git, repoRoot: "/r" })).toEqual([
      { branch: "topic", path: "/a" },
      { branch: null, path: "/b" },
    ]);
  });

  it("answers null when git could not be asked at all, which is not an empty list", () => {
    expect(listRepoWorktrees({ git: fakeGit({ answers: ALL_NULL }), repoRoot: "/r" })).toBe(null);
  });
});

describe("scanWorktree", () => {
  const scan = ({
    answers,
    branch,
    path,
    runsDir,
  }: {
    answers: Readonly<Record<string, string | null>>;
    branch: string | null;
    path: string;
    runsDir: string;
  }) =>
    scanWorktree({
      git: fakeGit({ answers }),
      liveRefs: [],
      mainCheckout: "/repo",
      openPullRequests: [],
      repoRoot: "/repo",
      runsDir,
      trunk: "origin/main",
      worktree: { branch, path },
    });

  it("asks nothing at all of a registered directory that is absent from disk", () => {
    const facts = scan({ answers: ALL_NULL, branch: "topic", path: "/definitely/not/here", runsDir: "/runs" });
    expect(facts.missing).toBe(true);
    expect(facts.dirtyCount).toBe(null);
    expect(facts.mergedIntoTrunk).toBe(null);
  });

  it("carries git's lock onto the facts, even for an absent directory, and reads an unlocked entry as unlocked", () => {
    const base = {
      git: fakeGit({ answers: ALL_NULL }),
      liveRefs: [],
      mainCheckout: "/repo",
      openPullRequests: [],
      repoRoot: "/repo",
      runsDir: "/runs",
      trunk: "origin/main",
    };
    const path = "/definitely/not/here";
    expect(scanWorktree({ ...base, worktree: { branch: "topic", locked: true, path } }).locked).toBe(true);
    expect(scanWorktree({ ...base, worktree: { branch: "topic", path } }).locked).toBe(false);
  });

  it("asks nothing of the repository's own main checkout", () => {
    const facts = scan({ answers: ALL_NULL, branch: "main", path: "/repo", runsDir: "/runs" });
    expect(facts.isMainCheckout).toBe(true);
    expect(facts.unbackedCommits).toBe(null);
  });

  it("asks the merge question of a dirty tree too, so a week-cold one reaches salvage rather than a false hold", () => {
    const path = tempDir({ name: "dirty" });
    const facts = scan({
      answers: { ...CONTEXT_READ, ...DIRTY_TREE },
      branch: "topic",
      path,
      runsDir: "/runs",
    });
    expect(facts.dirtyCount).toBe(2);
    expect(facts.deletionsOnly).toBe(false);
    expect(facts.mergedIntoTrunk).toBe(true);
    expect(weekColdVerdict({ facts }).cls).toBe("salvaged");
  });

  it("reads a failed ignored-file listing or stash listing as unknown, and the unknown holds past the week", () => {
    const noIgnored = scan({
      answers: { ...CONTEXT_READ, "--ignored": null, ...DIRTY_TREE },
      branch: "topic",
      path: tempDir({ name: "no-ignored" }),
      runsDir: "/runs",
    });
    expect(noIgnored.ignoredWork).toBe(null);
    expect(weekColdVerdict({ facts: noIgnored }).reason).toBe("its ignored files could not be listed");

    const noStash = scan({
      answers: { ...CONTEXT_READ, "stash list": null, ...DIRTY_TREE },
      branch: "topic",
      path: tempDir({ name: "no-stash" }),
      runsDir: "/runs",
    });
    expect(noStash.stashes).toBe(null);
    expect(weekColdVerdict({ facts: noStash }).reason).toBe("its stashes could not be listed");
  });

  it("holds an ignored file no build writes again and a stash made from the tree, past the week too", () => {
    const facts = scan({
      answers: {
        ...CONTEXT_READ,
        "--ignored": ".slopweaver/run.json\0node_modules/\0",
        "stash list": "s1\tabc1234\tWIP on topic: abc1234 wip\ns2\tfff\tOn other: unrelated",
        ...DIRTY_TREE,
      },
      branch: "topic",
      path: tempDir({ name: "context" }),
      runsDir: "/runs",
    });
    expect(facts.ignoredWork).toEqual([".slopweaver/run.json"]);
    expect(facts.stashes).toBe(1);
    expect(weekColdVerdict({ facts }).reason).toBe(
      "1 ignored file(s) no build writes again, such as .slopweaver/run.json",
    );
  });

  it("DOES ask the merge question of an all-deletions tree, because that answer decides its class", () => {
    const path = tempDir({ name: "gutted" });
    const facts = scan({
      answers: { "status --porcelain": " D src/a.ts\n D src/b.ts", "rev-list --count": "0", "log -1": "1756000000" },
      branch: "topic",
      path,
      runsDir: "/runs",
    });
    expect(facts.deletionsOnly).toBe(true);
    expect(facts.mergedIntoTrunk).toBe(true);
    expect(facts.lastActivityMs).toBe(1_756_000_000_000);
  });

  it("reports ZERO unbacked commits on an absorbed branch without asking, since the trunk is on a remote", () => {
    const path = tempDir({ name: "landed" });
    const facts = scan({
      answers: { "status --porcelain": "", "rev-list --count": "0", "log -1": "1756000000" },
      branch: "topic",
      path,
      runsDir: "/runs",
    });
    expect(facts.mergedIntoTrunk).toBe(true);
    expect(facts.unbackedCommits).toBe(0);
  });

  it("counts the unbacked commits of a branch the trunk has not absorbed", () => {
    const path = tempDir({ name: "ahead" });
    const facts = scan({
      answers: {
        "status --porcelain": "",
        "--name-only origin/main..refs/heads/topic": `\0${A}\n\nsrc/a.ts\n\0${B}\n\nsrc/b.ts`,
        "--name-only refs/heads/topic..origin/main": "",
        "--merges": "0",
        "rev-list --count": "2",
        "rev-list topic --not --remotes=origin": "aaa\nbbb",
        "log -1": "1756000000",
      },
      branch: "topic",
      path,
      runsDir: "/runs",
    });
    expect(facts.mergedIntoTrunk).toBe(false);
    expect(facts.unbackedCommits).toBe(2);
  });

  it("dates nothing when a branch's commit read fails, never the directory's mtime alone", () => {
    const facts = scan({
      answers: { "status --porcelain": "", "rev-list --count": "0", "log -1": null },
      branch: "topic",
      path: tempDir({ name: "no-commit-stamp" }),
      runsDir: "/runs",
    });
    expect(facts.lastActivityMs).toBe(null);
  });

  it("dates nothing when a detached head's commit read fails, never the directory's mtime alone", () => {
    const facts = scan({
      answers: {
        "status --porcelain": "",
        "rev-parse HEAD": "abc1234",
        "branch --remotes --contains": "origin/main",
        "log -1": null,
      },
      branch: null,
      path: tempDir({ name: "no-detached-stamp" }),
      runsDir: "/runs",
    });
    expect(facts.lastActivityMs).toBe(null);
  });

  it("resolves a DETACHED tree's head and reads its carrier, with an unbacked count of zero", () => {
    const path = tempDir({ name: "detached" });
    const facts = scan({
      answers: {
        "status --porcelain": "",
        "rev-parse HEAD": "abc1234",
        "branch --remotes --contains": "origin/main",
        "log -1": "1756000000",
      },
      branch: null,
      path,
      runsDir: "/runs",
    });
    expect(facts.headSha).toBe("abc1234");
    expect(facts.headOnRemoteRef).toBe("origin/main");
    expect(facts.unbackedCommits).toBe(0);
  });

  it("leaves a detached tree no remote carries UNBACKED-UNKNOWN, so the classifier holds it", () => {
    const path = tempDir({ name: "orphan" });
    const facts = scan({
      answers: { "status --porcelain": "", "rev-parse HEAD": "abc1234", "log -1": "1756000000" },
      branch: null,
      path,
      runsDir: "/runs",
    });
    expect(facts.headOnRemoteRef).toBe(null);
    expect(facts.unbackedCommits).toBe(null);
  });

  it("reads a CLOSED board row off the tree's own slug, and matches the journal's branch to the checkout", () => {
    const runsDir = tempDir({ name: "runs" });
    const root = tempDir({ name: "trees" });
    const path = join(root, "a-closed-run");
    mkdirSync(path);
    writeFileSync(
      join(runsDir, "a-closed-run.jsonl"),
      [
        JSON.stringify({ atIso: "2026-09-01T00:00:00.000Z", branch: "a-closed-run", docHash: "h", kind: "started" }),
        JSON.stringify({ atIso: "2026-09-02T00:00:00.000Z", kind: "closed", residue: [], summary: "shipped" }),
      ].join("\n") + "\n",
    );
    const answers = { "status --porcelain": "", "rev-list --count": "0", "log -1": "1756000000" };
    expect(scan({ answers, branch: "a-closed-run", path, runsDir }).runClosed).toBe(true);
    expect(scan({ answers, branch: "some-other-branch", path, runsDir }).runClosed).toBe(false);
  });

  it("reports no closed row when the tree has no journal, and never for a detached tree", () => {
    const runsDir = tempDir({ name: "empty-runs" });
    const path = tempDir({ name: "unjournalled" });
    const answers = { "status --porcelain": "", "rev-list --count": "0", "log -1": "1756000000" };
    expect(scan({ answers, branch: "topic", path, runsDir }).runClosed).toBe(false);
    expect(scan({ answers, branch: null, path, runsDir }).runClosed).toBe(false);
  });

  it("reports an unreadable working tree as unknown rather than as clean", () => {
    const path = tempDir({ name: "unreadable" });
    const facts = scan({ answers: ALL_NULL, branch: "topic", path, runsDir: "/runs" });
    expect(facts.dirtyCount).toBe(null);
    expect(facts.mergedIntoTrunk).toBe(null);
  });
});
