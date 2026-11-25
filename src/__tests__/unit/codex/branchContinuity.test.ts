/*
 * Which recorded branch names a branch continues (`src/codex/branchContinuity.ts`): reflog lines in, proven
 * continuations and the windows they open out. Pure: every reflog here is a literal.
 */
import { describe, expect, it } from "vitest";

import {
  type BranchContinuation,
  branchContinuations,
  carryWindows,
  defaultBranches,
  parseReflog,
  type ReflogEntry,
} from "../../../codex/branchContinuity.js";
import { unwrap } from "../../../lib/result.js";

const SHA = "1".repeat(40);
const OTHER_SHA = "2".repeat(40);
const ROOT = "/w/acme";
const HEADS = new Map([["HEAD", ROOT]]);
const BASES: ReadonlySet<string> = new Set(["main"]);

/** One line of `git reflog show --all --date=unix --format=%gD%x00%H%x00%gs`. */
function line({
  selector,
  epoch,
  sha = SHA,
  subject,
}: {
  selector: string;
  epoch: number;
  sha?: string;
  subject: string;
}): string {
  return [`${selector}@{${String(epoch)}}`, sha, subject].join("\u0000");
}

/** The entries a reflog text parses to, which every case expects to parse. */
function entriesOf({ lines }: { lines: readonly string[] }): readonly ReflogEntry[] {
  return unwrap(parseReflog({ text: `${lines.join("\n")}\n` }));
}

/** A continuation, scoped to one checkout for a cut and to every checkout for a rename. */
function link({ from, to, at, root }: { from: string; to: string; at: number; root?: string }): BranchContinuation {
  return { epochSeconds: at, from, root, to };
}

describe("parseReflog", () => {
  it("reads the selector, the epoch, the commit and the subject", () => {
    expect(
      entriesOf({ lines: [line({ epoch: 1700000000, selector: "refs/heads/abc-1", subject: "commit: seed" })] }),
    ).toEqual([{ epochSeconds: 1700000000, selector: "refs/heads/abc-1", sha: SHA, subject: "commit: seed" }]);
  });

  it("reads an empty reflog as no entries", () => {
    expect(unwrap(parseReflog({ text: "" }))).toEqual([]);
  });

  it("refuses a line with no epoch selector rather than skipping it", () => {
    const parsed = parseReflog({ text: `refs/heads/abc-1@{0}x\u0000${SHA}\u0000commit: seed\n` });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().code).toBe("REFLOG_LINE_UNREADABLE");
  });

  it("refuses a line missing its subject", () => {
    const parsed = parseReflog({ text: `refs/heads/abc-1@{1700000000}\u0000${SHA}\n` });
    expect(parsed._unsafeUnwrapErr().code).toBe("REFLOG_LINE_UNREADABLE");
  });
});

describe("branchContinuations", () => {
  it("reads a rename off the new branch's own reflog, in every checkout", () => {
    const entries = entriesOf({
      lines: [
        line({
          epoch: 100,
          selector: "refs/heads/abc-1",
          subject: "Branch: renamed refs/heads/abc-1-draft to refs/heads/abc-1",
        }),
      ],
    });
    expect(branchContinuations({ entries, rootOfHead: HEADS })).toEqual([
      link({ at: 100, from: "abc-1-draft", to: "abc-1" }),
    ]);
  });

  it("reads a cut from the checked-out branch, in the checkout whose HEAD moved", () => {
    const entries = entriesOf({
      lines: [
        line({ epoch: 100, selector: "refs/heads/abc-1", subject: "branch: Created from HEAD" }),
        line({ epoch: 100, selector: "HEAD", subject: "checkout: moving from abc-1-draft to abc-1" }),
      ],
    });
    expect(branchContinuations({ entries, rootOfHead: HEADS })).toEqual([
      link({ at: 100, from: "abc-1-draft", root: ROOT, to: "abc-1" }),
    ]);
  });

  it("proves no cut when a second checkout's HEAD moved onto the new branch in that second at that commit", () => {
    const entries = entriesOf({
      lines: [
        line({ epoch: 100, selector: "refs/heads/abc-1", subject: "branch: Created from HEAD" }),
        line({ epoch: 100, selector: "HEAD", subject: "checkout: moving from abc-1-draft to abc-1" }),
        line({ epoch: 100, selector: "worktrees/acme-two/HEAD", subject: "checkout: moving from abc-2 to abc-1" }),
      ],
    });
    const rootOfHead = new Map([...HEADS, ["worktrees/acme-two/HEAD", "/w/acme-two"]]);
    expect(branchContinuations({ entries, rootOfHead })).toEqual([]);
  });

  it("proves no cut when the checkout moved at another second", () => {
    const entries = entriesOf({
      lines: [
        line({ epoch: 100, selector: "refs/heads/abc-1", subject: "branch: Created from HEAD" }),
        line({ epoch: 101, selector: "HEAD", subject: "checkout: moving from abc-1-draft to abc-1" }),
      ],
    });
    expect(branchContinuations({ entries, rootOfHead: HEADS })).toEqual([]);
  });

  it("proves no cut when the checkout moved at another commit", () => {
    const entries = entriesOf({
      lines: [
        line({ epoch: 100, selector: "refs/heads/abc-1", subject: "branch: Created from HEAD" }),
        line({ epoch: 100, selector: "HEAD", sha: OTHER_SHA, subject: "checkout: moving from abc-1-draft to abc-1" }),
      ],
    });
    expect(branchContinuations({ entries, rootOfHead: HEADS })).toEqual([]);
  });

  it("proves no cut from a HEAD reflog whose checkout is not listed", () => {
    const entries = entriesOf({
      lines: [
        line({ epoch: 100, selector: "refs/heads/abc-1", subject: "branch: Created from HEAD" }),
        line({ epoch: 100, selector: "worktrees/gone/HEAD", subject: "checkout: moving from abc-1-draft to abc-1" }),
      ],
    });
    expect(branchContinuations({ entries, rootOfHead: HEADS })).toEqual([]);
  });

  it("proves nothing from a branch created off another start point, even when a checkout moved onto it", () => {
    const entries = entriesOf({
      lines: [
        line({ epoch: 100, selector: "refs/heads/abc-1", subject: "branch: Created from main" }),
        line({ epoch: 100, selector: "HEAD", subject: "checkout: moving from abc-1-draft to abc-1" }),
      ],
    });
    expect(branchContinuations({ entries, rootOfHead: HEADS })).toEqual([]);
  });

  it("proves nothing from an ordinary checkout of a branch that already existed", () => {
    const entries = entriesOf({
      lines: [
        line({ epoch: 50, selector: "refs/heads/abc-1", subject: "branch: Created from main" }),
        line({ epoch: 100, selector: "HEAD", subject: "checkout: moving from abc-1-draft to abc-1" }),
      ],
    });
    expect(branchContinuations({ entries, rootOfHead: HEADS })).toEqual([]);
  });
});

describe("carryWindows", () => {
  it("opens one window on a renamed predecessor, bounded by the rename", () => {
    expect(
      carryWindows({
        bases: BASES,
        continuations: [link({ at: 100, from: "abc-1-draft", to: "abc-1" })],
        target: "abc-1",
      }),
    ).toEqual([{ afterEpochSeconds: undefined, branch: "abc-1-draft", root: undefined, throughEpochSeconds: 100 }]);
  });

  it("opens nothing for a branch nothing continues into", () => {
    expect(
      carryWindows({
        bases: BASES,
        continuations: [link({ at: 100, from: "abc-1-draft", to: "abc-2" })],
        target: "abc-1",
      }),
    ).toEqual([]);
  });

  it("follows a cut then a rename, keeping the cut's checkout and its earlier instant", () => {
    const continuations = [
      link({ at: 100, from: "abc-1-draft", root: ROOT, to: "abc-1-wip" }),
      link({ at: 200, from: "abc-1-wip", to: "abc-1" }),
    ];
    expect(carryWindows({ bases: BASES, continuations, target: "abc-1" })).toEqual([
      { afterEpochSeconds: undefined, branch: "abc-1-wip", root: undefined, throughEpochSeconds: 200 },
      { afterEpochSeconds: undefined, branch: "abc-1-draft", root: ROOT, throughEpochSeconds: 100 },
    ]);
  });

  it("gives two branches cut from one each only the evidence since the earlier cut", () => {
    const continuations = [
      link({ at: 100, from: "abc-1-draft", root: ROOT, to: "abc-1" }),
      link({ at: 200, from: "abc-1-draft", root: ROOT, to: "abc-2" }),
    ];
    expect(carryWindows({ bases: BASES, continuations, target: "abc-1" })).toEqual([
      { afterEpochSeconds: undefined, branch: "abc-1-draft", root: ROOT, throughEpochSeconds: 100 },
    ]);
    expect(carryWindows({ bases: BASES, continuations, target: "abc-2" })).toEqual([
      { afterEpochSeconds: 100, branch: "abc-1-draft", root: ROOT, throughEpochSeconds: 200 },
    ]);
  });

  it("never follows a link made after the window it would feed closed", () => {
    // abc-1-draft became abc-1 at 100; a later, unrelated branch took the old name at 200 and fed nothing into abc-1.
    const continuations = [
      link({ at: 100, from: "abc-1-draft", to: "abc-1" }),
      link({ at: 200, from: "abc-1-spike", to: "abc-1-draft" }),
    ];
    expect(carryWindows({ bases: BASES, continuations, target: "abc-1" })).toEqual([
      { afterEpochSeconds: undefined, branch: "abc-1-draft", root: undefined, throughEpochSeconds: 100 },
    ]);
  });

  it("stops on a cycle back to the judged branch", () => {
    const continuations = [
      link({ at: 100, from: "abc-1", to: "abc-1-draft" }),
      link({ at: 200, from: "abc-1-draft", to: "abc-1" }),
    ];
    expect(carryWindows({ bases: BASES, continuations, target: "abc-1" })).toEqual([
      { afterEpochSeconds: undefined, branch: "abc-1-draft", root: undefined, throughEpochSeconds: 200 },
    ]);
  });

  it("never takes the default branch as a predecessor, so a pass on the base never stands as the branch's plan", () => {
    const continuations = [link({ at: 100, from: "main", root: ROOT, to: "abc-1" })];
    expect(carryWindows({ bases: BASES, continuations, target: "abc-1" })).toEqual([]);
  });

  it("stops at the default branch in a chain, keeping the link after it", () => {
    const continuations = [
      link({ at: 100, from: "main", root: ROOT, to: "abc-1-draft" }),
      link({ at: 200, from: "abc-1-draft", to: "abc-1" }),
    ];
    expect(carryWindows({ bases: BASES, continuations, target: "abc-1" })).toEqual([
      { afterEpochSeconds: undefined, branch: "abc-1-draft", root: undefined, throughEpochSeconds: 200 },
    ]);
  });

  it("carries nothing when no default branch is known, since no link can be shown not to start on one", () => {
    const continuations = [link({ at: 100, from: "abc-1-draft", to: "abc-1" })];
    expect(carryWindows({ bases: new Set(), continuations, target: "abc-1" })).toEqual([]);
  });

  it("gives neither of two cuts made in one second anything, since the reflog cannot order them", () => {
    const continuations = [
      link({ at: 100, from: "abc-1-draft", root: ROOT, to: "abc-1" }),
      link({ at: 100, from: "abc-1-draft", root: ROOT, to: "abc-2" }),
    ];
    expect(carryWindows({ bases: BASES, continuations, target: "abc-1" })).toEqual([]);
    expect(carryWindows({ bases: BASES, continuations, target: "abc-2" })).toEqual([]);
  });
});

describe("defaultBranches", () => {
  it("names every branch each remote's HEAD target could be, and nothing a plain ref names", () => {
    const text = [
      "refs/remotes/origin/HEAD\u0000refs/remotes/origin/main",
      "refs/remotes/origin/main\u0000",
      "refs/remotes/fork/HEAD\u0000refs/remotes/fork/trunk",
      "refs/remotes/origin/feature/HEAD\u0000",
      "",
    ].join("\n");
    expect([...defaultBranches({ text })]).toEqual(["origin/main", "main", "fork/trunk", "trunk"]);
  });

  it("names the branch a HEAD points at in ANOTHER remote's namespace", () => {
    const text = "refs/remotes/origin/HEAD\u0000refs/remotes/upstream/main\n";
    expect(defaultBranches({ text }).has("main")).toBe(true);
  });

  it("names both readings of a default branch with a slash in its name", () => {
    const text = "refs/remotes/origin/HEAD\u0000refs/remotes/origin/release/v2\n";
    expect([...defaultBranches({ text })]).toEqual(["origin/release/v2", "release/v2", "v2"]);
  });

  it("names nothing for a repository with no remote HEAD", () => {
    expect(defaultBranches({ text: "refs/remotes/origin/main\u0000\n" }).size).toBe(0);
  });
});
