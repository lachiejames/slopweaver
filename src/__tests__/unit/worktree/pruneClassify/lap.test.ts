/*
 * The `lap` class: a `github lap` tree its lap never disposed, because a signal skipped the lap's `finally`. Measured:
 * eight such trees, about 8 GB, each held by the never-waived ignored-files rule over the lap's own reports, or by
 * the detached-HEAD-on-no-remote rule. A MARKED tree goes once its minter is gone; an UNMARKED one only on the
 * explicit run, and only on a kept ref's word.
 */
import { describe, expect, it } from "vitest";

import type { LapTreeFacts, LapTreeMarkerV1 } from "../../../../worktree/lapTreeProvenance.js";
import { classifyWorktree, type WorktreeFacts } from "../../../../worktree/pruneClassify.js";
import { lapWorkHold, unmarkedWitnessLine } from "../../../../worktree/pruneLapClass.js";
import { classify, DAY_MS, facts, NOW_MS, NUKE_AFTER_MS, OLDER_THAN_MS } from "./harness.js";

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);
const PATH = "/cache/lap-trees.noindex/sw-lap-57T5js";

const MARKER: LapTreeMarkerV1 = {
  kind: "github-lap-tree",
  mintedHead: HEAD,
  pid: 4242,
  processStart: "Thu Nov 26 09:00:00 2026",
  version: 1,
};

/** A spent lap tree as the scan reads it: detached, on no remote, holding the lap's own vitest reports. */
const SPENT = {
  branch: null,
  headSha: HEAD,
  ignoredWork: [".vitest-reports/"],
  lastActivityMs: NOW_MS - 2 * DAY_MS,
  mergedIntoTrunk: null,
  path: PATH,
  unbackedCommits: null,
} as const;

const marked = (over: Partial<Extract<LapTreeFacts, { kind: "marked" }>> = {}): LapTreeFacts => ({
  head: HEAD,
  holderLive: false,
  kind: "marked",
  marker: MARKER,
  ...over,
});

const unmarked = ({ witness }: { witness: string | null | undefined }): LapTreeFacts => ({
  head: HEAD,
  kind: "unmarked",
  witness,
});

/** Classify on the explicit `--include-unmarked-lap` run. */
const explicit = (over: Partial<WorktreeFacts>): ReturnType<typeof classify> =>
  classifyWorktree({
    facts: facts(over),
    includeUnmarkedLap: true,
    nowMs: NOW_MS,
    nukeAfterMs: NUKE_AFTER_MS,
    olderThanMs: OLDER_THAN_MS,
  });

describe("classifyWorktree — a marked lap tree", () => {
  it("takes one whose minter is gone, carrying the marker to the pin", () => {
    expect(classify({ ...SPENT, lapTree: marked() })).toEqual({
      branch: null,
      cls: "lap",
      deleteBranch: false,
      diskKib: 500_000,
      dropsDeps: false,
      lap: { kind: "marked", marker: MARKER },
      path: PATH,
      reason: "a lap tree its minting lap (pid 4242) left behind at HEAD aaaaaaaaaa, pinned before removal",
      scannedHead: HEAD,
    });
  });

  it("holds one whose minting lap is still that running process", () => {
    expect(classify({ ...SPENT, lapTree: marked({ holderLive: true }) }).reason).toBe(
      "its minting lap, pid 4242, is still running",
    );
  });

  it("holds one whose HEAD moved off the commit the lap minted it at", () => {
    expect(classify({ ...SPENT, lapTree: marked({ head: OTHER }) }).reason).toBe(
      "its HEAD bbbbbbbbbb moved off aaaaaaaaaa, the commit the lap minted it at",
    );
  });

  it("holds one whose marker is not a readable one, never reading it as unmarked", () => {
    expect(classify({ ...SPENT, lapTree: { kind: "invalid", reason: "bad json" } }).reason).toBe(
      "a lap tree whose marker is not a readable one (bad json) — never removed as a lap",
    );
  });

  it("holds one a live session references, or one git has locked", () => {
    expect(classify({ ...SPENT, lapTree: marked(), liveRefs: ["pid 7"] }).reason).toBe("referenced by pid 7");
    expect(classify({ ...SPENT, lapTree: marked(), locked: true }).reason).toBe("locked by `git worktree lock`");
  });

  it("holds one carrying an ignored file the lap does not write", () => {
    expect(classify({ ...SPENT, ignoredWork: [".vitest-reports/", "notes.local"], lapTree: marked() }).reason).toBe(
      "1 ignored file(s) the lap does not write, such as notes.local — only .vitest-reports/, coverage/, coverage-integration/, playwright-report/, test-results/ are a lap's own",
    );
  });

  it("holds one with an uncommitted change or a stash", () => {
    expect(classify({ ...SPENT, dirtyCount: 2, lapTree: marked() }).reason).toBe("2 uncommitted change(s)");
    expect(classify({ ...SPENT, lapTree: marked(), stashes: 1 }).reason).toBe("1 stash(es) made from it");
  });
});

describe("classifyWorktree — an unmarked lap tree", () => {
  it("holds one on the hourly run whatever keeps its HEAD, saying which ref does", () => {
    expect(classify({ ...SPENT, lapTree: unmarked({ witness: "refs/remotes/origin/main" }) }).reason).toBe(
      "a lap-shaped tree with no provenance marker — the hourly prune never removes one; review it with `worktree prune --include-unmarked-lap` — " +
        `HEAD ${HEAD}, admitted by refs/remotes/origin/main`,
    );
  });

  it("takes one on the explicit run when a kept ref contains its HEAD, naming that ref", () => {
    expect(explicit({ ...SPENT, lapTree: unmarked({ witness: "refs/heads/feature" }) })).toEqual({
      branch: null,
      cls: "lap",
      deleteBranch: false,
      diskKib: 500_000,
      dropsDeps: false,
      lap: { kind: "unmarked", witness: "refs/heads/feature" },
      path: PATH,
      reason: `an unmarked lap tree a kept ref already holds, its HEAD pinned before removal — HEAD ${HEAD}, admitted by refs/heads/feature`,
      scannedHead: HEAD,
    });
  });

  it("refuses one on the explicit run when no kept ref contains its HEAD, naming the operator pin", () => {
    expect(explicit({ ...SPENT, lapTree: unmarked({ witness: null }) }).reason).toBe(
      `no kept ref contains its HEAD, so nothing could recreate this tree — to take it, pin it as refs/slopweaver/operator-lap/${HEAD} first — HEAD ${HEAD}, admitted by no kept ref`,
    );
  });

  it("holds one whose kept refs could not be read", () => {
    expect(explicit({ ...SPENT, lapTree: unmarked({ witness: undefined }) }).reason).toBe(
      `which kept refs contain its HEAD could not be read — HEAD ${HEAD}, its kept refs could not be read`,
    );
  });
});

describe("classifyWorktree — the lap exception is the lap class's alone", () => {
  it("still holds an ordinary detached tree carrying .vitest-reports/ under the never-waived rule", () => {
    const verdict = classify({ ...SPENT, path: "/repo/.claude/worktrees/ordinary" });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toContain("1 ignored file(s) no build writes again, such as .vitest-reports/");
    expect(verdict.lap).toBeUndefined();
  });
});

describe("lapWorkHold", () => {
  it("reads every report directory the lap writes, and anything under one, as the lap's own", () => {
    expect(
      lapWorkHold({ facts: facts({ ignoredWork: [".vitest-reports/", "coverage/lcov.info", "test-results/"] }) }),
    ).toBeUndefined();
  });

  it("holds when a fact could not be read", () => {
    expect(lapWorkHold({ facts: facts({ ignoredWork: null }) })).toBe("its ignored files could not be listed");
    expect(lapWorkHold({ facts: facts({ dirtyCount: null }) })).toBe("its working tree could not be read");
  });
});

describe("unmarkedWitnessLine", () => {
  it("names the HEAD and what admitted it, or that nothing could be asked", () => {
    expect(unmarkedWitnessLine({ head: HEAD, witness: "refs/tags/v1" })).toBe(`HEAD ${HEAD}, admitted by refs/tags/v1`);
    expect(unmarkedWitnessLine({ head: HEAD, witness: null })).toBe(`HEAD ${HEAD}, admitted by no kept ref`);
    expect(unmarkedWitnessLine({ head: HEAD, witness: undefined })).toBe(
      `HEAD ${HEAD}, its kept refs could not be read`,
    );
    expect(unmarkedWitnessLine({ head: null, witness: undefined })).toBe("HEAD unreadable, so no kept ref was asked");
  });
});
