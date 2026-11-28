/**
 * Whether the tree a spawn would reuse is another row's (`cmux/treeOccupancy.ts`): which journals hold a directory,
 * and the verdict over them. The defect it closes is a different row's spawn opening a second session inside a
 * working seat's tree because the row declared that seat's branch.
 */
import { describe, expect, it } from "vitest";

import { foreignHolderDetail, type TreeHolder, treeHoldersOf, treeOccupancy } from "../../../cmux/treeOccupancy.js";
import type { RunEvent } from "../../../handover/ledger.js";
import type { ParkedEvent } from "../../../handover/parkedEvent.js";

const AT = "2026-11-27T12:00:00.000Z";
const SEAT_TREE = "/repo/.claude/worktrees.noindex/seat-a";
const OTHER_TREE = "/repo/.claude/worktrees.noindex/seat-ab";
const TREES = ["/repo", SEAT_TREE, OTHER_TREE];

const STARTED: RunEvent = { atIso: AT, branch: "seat-a-pr-branch", docHash: "abc", kind: "started" };
const launched = ({ worktree }: { worktree: string }): RunEvent => ({
  atIso: AT,
  host: "claude-code",
  kind: "launched",
  pid: 4242,
  sessionId: "session-a",
  worktree,
});
const parked: ParkedEvent = {
  atIso: AT,
  branch: "seat-a-pr-branch",
  kind: "parked",
  screenTail: "❯ ",
  sessionId: "session-a",
  workspaceRef: "workspace:9",
  worktree: SEAT_TREE,
};

const runHolder = ({
  slug,
  path,
  sessionId = "session-a",
}: {
  slug: string;
  path: string;
  sessionId?: string;
}): TreeHolder => ({ path, sessionId, slug, via: "run" });

/** The verdict with `/repo` as the main checkout, the shape every spawn asks in. */
const occupancy = (args: {
  holders: readonly TreeHolder[];
  slug: string;
  tree: string;
  worktrees: readonly string[];
}) => treeOccupancy({ ...args, mainCheckouts: ["/repo"] });

describe("treeHoldersOf", () => {
  it("holds the writer's tree while the run is open", () => {
    expect(treeHoldersOf({ events: [STARTED, launched({ worktree: SEAT_TREE })], slug: "seat-a" })).toEqual([
      runHolder({ path: SEAT_TREE, slug: "seat-a" }),
    ]);
  });

  it("holds nothing once the run is closed, so a landing row may reuse a finished seat's tree", () => {
    const events: RunEvent[] = [
      STARTED,
      launched({ worktree: SEAT_TREE }),
      { atIso: AT, kind: "finished", residue: [] },
    ];

    expect(treeHoldersOf({ events, slug: "seat-a" })).toEqual([]);
  });

  it("holds a released writer's tree: a handoff in progress is not a free tree", () => {
    const events: RunEvent[] = [
      STARTED,
      launched({ worktree: SEAT_TREE }),
      { atIso: AT, kind: "released", sessionId: "session-a", why: "handing off" },
    ];

    expect(treeHoldersOf({ events, slug: "seat-a" })).toEqual([runHolder({ path: SEAT_TREE, slug: "seat-a" })]);
  });

  it("holds a parked seat's tree although the park released its writer", () => {
    const events: RunEvent[] = [STARTED, launched({ worktree: SEAT_TREE }), parked];

    expect(treeHoldersOf({ events, slug: "seat-a" })).toEqual([
      { path: SEAT_TREE, sessionId: "session-a", slug: "seat-a", via: "parked" },
    ]);
  });

  it("holds nothing for a run no writer ever launched", () => {
    expect(treeHoldersOf({ events: [STARTED], slug: "seat-a" })).toEqual([]);
  });

  it("holds nothing for a row that never started", () => {
    expect(treeHoldersOf({ events: [], slug: "seat-a" })).toEqual([]);
  });
});

describe("treeOccupancy", () => {
  it("is foreign when another row's open run holds the selected tree — the measured defect", () => {
    const holder = runHolder({ path: SEAT_TREE, slug: "seat-a" });

    expect(occupancy({ holders: [holder], slug: "finding-b", tree: SEAT_TREE, worktrees: TREES })).toEqual({
      holder,
      kind: "foreign",
    });
  });

  it("is the row's own when its own run holds the tree, so a reseat opens where it stood", () => {
    const holders = [runHolder({ path: SEAT_TREE, slug: "seat-a" })];

    expect(occupancy({ holders, slug: "seat-a", tree: SEAT_TREE, worktrees: TREES })).toEqual({ kind: "own" });
  });

  it("is free when no journal holds the tree", () => {
    const holders = [runHolder({ path: OTHER_TREE, slug: "seat-ab" })];

    expect(occupancy({ holders, slug: "finding-b", tree: SEAT_TREE, worktrees: TREES })).toEqual({
      kind: "free",
    });
  });

  it("counts a writer that stood in a subdirectory of the tree", () => {
    const holder = runHolder({ path: `${SEAT_TREE}/apps/web`, slug: "seat-a" });

    expect(occupancy({ holders: [holder], slug: "finding-b", tree: SEAT_TREE, worktrees: TREES })).toEqual({
      holder,
      kind: "foreign",
    });
  });

  it("never matches a sibling whose name only begins with the tree's", () => {
    const holders = [runHolder({ path: OTHER_TREE, slug: "seat-ab" })];

    expect(occupancy({ holders, slug: "finding-b", tree: SEAT_TREE, worktrees: TREES }).kind).toBe("free");
  });

  it("never asks of the main checkout, however many other rows stand there", () => {
    const holders = [runHolder({ path: "/repo", slug: "console-1" }), runHolder({ path: "/repo/src", slug: "row-2" })];

    expect(occupancy({ holders, slug: "finding-b", tree: "/private/repo", worktrees: TREES })).toEqual({
      kind: "main",
    });
  });

  it("charges a writer to the innermost tree, never to a tree above it", () => {
    const holders = [runHolder({ path: SEAT_TREE, slug: "seat-a" })];

    expect(treeOccupancy({ holders, mainCheckouts: [], slug: "finding-b", tree: "/repo", worktrees: TREES })).toEqual({
      kind: "free",
    });
  });

  it("reads another row started by the same session in its own tree as one occupant", () => {
    const holders = [runHolder({ path: SEAT_TREE, slug: "seat-a" }), runHolder({ path: SEAT_TREE, slug: "relay-b" })];

    expect(occupancy({ holders, slug: "seat-a", tree: SEAT_TREE, worktrees: TREES })).toEqual({ kind: "own" });
  });

  it("keeps an unparsed holder foreign beside the row's own holding, since it names no session", () => {
    const unparsed: TreeHolder = { path: SEAT_TREE, sessionId: undefined, slug: "relay-b", via: "unparsed" };
    const holders = [runHolder({ path: SEAT_TREE, slug: "seat-a" }), unparsed];

    expect(occupancy({ holders, slug: "seat-a", tree: SEAT_TREE, worktrees: TREES })).toEqual({
      holder: unparsed,
      kind: "foreign",
    });
  });

  it("gives no session pass to a row with no holding of its own in the tree", () => {
    const holder = runHolder({ path: SEAT_TREE, slug: "seat-a" });

    expect(occupancy({ holders: [holder], slug: "relay-b", tree: SEAT_TREE, worktrees: TREES })).toEqual({
      holder,
      kind: "foreign",
    });
  });

  it("matches across the worktrees alias and the macOS /private prefix", () => {
    const holder = runHolder({ path: "/private/repo/.claude/worktrees/seat-a", slug: "seat-a" });

    expect(occupancy({ holders: [holder], slug: "finding-b", tree: SEAT_TREE, worktrees: TREES }).kind).toBe("foreign");
  });

  it("is foreign for another row's over-bound journal that names the tree, and own for the row's own", () => {
    const unparsed: TreeHolder = { path: SEAT_TREE, sessionId: undefined, slug: "seat-a", via: "unparsed" };

    expect(occupancy({ holders: [unparsed], slug: "finding-b", tree: SEAT_TREE, worktrees: TREES })).toEqual({
      holder: unparsed,
      kind: "foreign",
    });
    expect(occupancy({ holders: [unparsed], slug: "seat-a", tree: SEAT_TREE, worktrees: TREES })).toEqual({
      kind: "own",
    });
  });

  it("is foreign when another row's DIFFERENT session holds the tree beside the row's own holding", () => {
    const foreign = runHolder({ path: SEAT_TREE, sessionId: "session-z", slug: "seat-a" });
    const holders = [runHolder({ path: SEAT_TREE, slug: "finding-b" }), foreign];

    expect(occupancy({ holders, slug: "finding-b", tree: SEAT_TREE, worktrees: TREES })).toEqual({
      holder: foreign,
      kind: "foreign",
    });
  });
});

describe("foreignHolderDetail", () => {
  it("names the holding row, how it holds the tree, its session and the tree", () => {
    expect(
      foreignHolderDetail({
        holder: runHolder({ path: SEAT_TREE, slug: "seat-a" }),
        slug: "finding-b",
        tree: SEAT_TREE,
      }),
    ).toBe(
      `${SEAT_TREE} is held by row seat-a through an unclosed run (session session-a), so finding-b would share its working tree and index`,
    );
  });

  it("says a parked seat holds it when that is the holding", () => {
    const holder: TreeHolder = { path: SEAT_TREE, sessionId: "session-a", slug: "seat-a", via: "parked" };

    expect(foreignHolderDetail({ holder, slug: "finding-b", tree: SEAT_TREE })).toBe(
      `${SEAT_TREE} is held by row seat-a through a seat parked there (session session-a), so finding-b would share its working tree and index`,
    );
  });

  it("says an unparsed journal may hold it, naming no session it never read", () => {
    const holder: TreeHolder = { path: SEAT_TREE, sessionId: undefined, slug: "seat-a", via: "unparsed" };

    expect(foreignHolderDetail({ holder, slug: "finding-b", tree: SEAT_TREE })).toBe(
      `${SEAT_TREE} may be held by row seat-a, whose run journal names it but is over the read bound and was not parsed, so finding-b could share its working tree and index`,
    );
  });
});
