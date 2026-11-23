/**
 * `handover reconcile` places a live cmux workspace on its board row by the session ledger's recorded binding to
 * its workspace ID first, and by the worktree directory only where nothing is bound (`seatBinding.ts`). A seat
 * `cmux spawn` opened into a REUSED worktree named for its branch stands in a directory naming no row, and before
 * the binding was read it counted as unregistered for ever — short the live and seat counts the supervisor fills
 * capacity from. Every case here is over the pure join, `workedFromCmux`.
 */
import { describe, expect, it } from "vitest";

import { workedFromCmux } from "../../../cli/commands/handover/reconcileRows.js";
import { seatRowOf } from "../../../cli/commands/handover/seatBinding.js";
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import type { BoardRow } from "../../../handover/rank.js";
import type { SessionItem } from "../../../sessions/session.js";

/** One in-flight board row. */
function row({ id }: { id: string }): BoardRow {
  return {
    groomed: true,
    id,
    kind: "doc",
    label: id,
    openedIso: undefined,
    priority: "p2",
    ready: false,
    ruled: false,
    standing: "in-flight",
    waitingHours: 0,
  };
}

/** One cmux workspace, by default a seat in a worktree named for its BRANCH, which names no board row. */
function workspace(over: Partial<CmuxWorkspaceSummary> = {}): CmuxWorkspaceSummary {
  return {
    currentDirectory: "/w/.claude/worktrees.noindex/feat-some-branch",
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: "feat-some-branch",
    windowId: "window:1",
    workspaceId: "6F0C-SEAT",
    workspaceRef: "workspace:7",
    ...over,
  };
}

/** The open ledger row `cmux spawn` wrote for that seat, binding workspace `6F0C-SEAT` to `fix-the-join`. */
function spawned(over: Partial<SessionItem> = {}): SessionItem {
  return {
    branch: "feat/some-branch",
    cwd: "/w/.claude/worktrees.noindex/feat-some-branch",
    lastEventIso: "2026-11-05T10:00:00.000Z",
    sessionKey: "fix-the-join",
    slug: "fix-the-join",
    spawnedIso: "2026-11-05T10:00:00.000Z",
    status: "open",
    surfaceRef: "surface:7",
    workspaceId: "6F0C-SEAT",
    workspaceRef: "workspace:7",
    ...over,
  };
}

const rows: readonly BoardRow[] = [row({ id: "fix-the-join" }), row({ id: "other-row" })];

/** A worktree named for the OTHER board row. */
const OTHER_ROW_TREE = "/w/.claude/worktrees.noindex/other-row";

describe("workedFromCmux — the recorded session binding", () => {
  it("maps a seat in a branch-named worktree to the row its open spawn binding names", () => {
    expect(workedFromCmux({ rows, sessions: [spawned()], workspaces: [workspace()] })).toEqual([
      { rowId: "fix-the-join", session: "workspace:7" },
    ]);
  });

  it("reads the same seat as unregistered with no binding — the defect the binding closes", () => {
    expect(workedFromCmux({ rows, sessions: [], workspaces: [workspace()] })).toEqual([
      { rowId: undefined, session: "workspace:7" },
    ]);
  });

  it("ignores a CLOSED binding, whose workspace is retired", () => {
    expect(workedFromCmux({ rows, sessions: [spawned({ status: "closed" })], workspaces: [workspace()] })).toEqual([
      { rowId: undefined, session: "workspace:7" },
    ]);
  });

  it("ignores a binding to a slug the board does not carry, falling back to the directory", () => {
    const sessions = [spawned({ cwd: OTHER_ROW_TREE, slug: "settled-long-ago" })];
    const named = workspace({ currentDirectory: OTHER_ROW_TREE });
    expect(workedFromCmux({ rows, sessions, workspaces: [named] })).toEqual([
      { rowId: "other-row", session: "workspace:7" },
    ]);
  });

  it("reads a seat spawned into a REUSED worktree named for another row as the row it was spawned for", () => {
    const sessions = [spawned({ cwd: OTHER_ROW_TREE })];
    const reused = workspace({ currentDirectory: OTHER_ROW_TREE });
    expect(workedFromCmux({ rows, sessions, workspaces: [reused] })).toEqual([
      { rowId: "fix-the-join", session: "workspace:7" },
    ]);
  });

  it("keeps the binding when the seat's shell moved into a subdirectory of its worktree", () => {
    const moved = workspace({ currentDirectory: "/w/.claude/worktrees.noindex/feat-some-branch/src/handover" });
    expect(workedFromCmux({ rows, sessions: [spawned()], workspaces: [moved] })).toEqual([
      { rowId: "fix-the-join", session: "workspace:7" },
    ]);
  });

  it("drops a binding whose workspace has since left for another row's worktree, so the directory decides", () => {
    const left = workspace({ currentDirectory: OTHER_ROW_TREE });
    expect(workedFromCmux({ rows, sessions: [spawned()], workspaces: [left] })).toEqual([
      { rowId: "other-row", session: "workspace:7" },
    ]);
  });

  it("does not read a sibling worktree sharing the spawn directory's prefix as under it", () => {
    const sibling = workspace({ currentDirectory: "/w/.claude/worktrees.noindex/feat-some-branch-2" });
    expect(workedFromCmux({ rows, sessions: [spawned()], workspaces: [sibling] })).toEqual([
      { rowId: undefined, session: "workspace:7" },
    ]);
  });

  it("does not read a path that climbs out of the spawn directory with `..` as under it", () => {
    const climbed = workspace({ currentDirectory: "/w/.claude/worktrees.noindex/feat-some-branch/../other-row" });
    expect(workedFromCmux({ rows, sessions: [spawned()], workspaces: [climbed] })).toEqual([
      { rowId: "other-row", session: "workspace:7" },
    ]);
  });

  it("holds a binding cmux reports under macOS's `/private` alias of its spawn directory", () => {
    const aliased = workspace({ currentDirectory: "/private/w/.claude/worktrees.noindex/feat-some-branch" });
    expect(workedFromCmux({ rows, sessions: [spawned()], workspaces: [aliased] })).toEqual([
      { rowId: "fix-the-join", session: "workspace:7" },
    ]);
  });

  it("holds a binding across the `worktrees`/`worktrees.noindex` spellings of one checkout", () => {
    const sessions = [spawned({ cwd: "/w/.claude/worktrees/feat-some-branch" })];
    expect(workedFromCmux({ rows, sessions, workspaces: [workspace()] })).toEqual([
      { rowId: "fix-the-join", session: "workspace:7" },
    ]);
  });

  it("holds a binding across two spellings of a worktree nested in another row's", () => {
    const inner = "/w/.claude/worktrees.noindex/other-row/nested/.claude/worktrees.noindex/feat-some-branch";
    const spelled = "/w/.claude/worktrees.noindex/other-row/nested/.claude/worktrees/feat-some-branch";
    expect(
      workedFromCmux({
        rows,
        sessions: [spawned({ cwd: inner })],
        workspaces: [workspace({ currentDirectory: spelled })],
      }),
    ).toEqual([{ rowId: "fix-the-join", session: "workspace:7" }]);
  });

  it("holds a reused-worktree binding cmux reports in another case on a case-insensitive volume", () => {
    const sessions = [spawned({ cwd: OTHER_ROW_TREE })];
    const recased = workspace({ currentDirectory: "/w/.CLAUDE/worktrees.noindex/other-row" });
    expect(workedFromCmux({ rows, sessions, workspaces: [recased] })).toEqual([
      { rowId: "fix-the-join", session: "workspace:7" },
    ]);
  });

  it("lets the directory decide once a root-recorded seat stands in another row's worktree", () => {
    const moved = workspace({ currentDirectory: OTHER_ROW_TREE });
    expect(workedFromCmux({ rows, sessions: [spawned({ cwd: "/" })], workspaces: [moved] })).toEqual([
      { rowId: "other-row", session: "workspace:7" },
    ]);
  });

  it("holds a binding whose recorded spawn directory climbs with `..` into the worktree the seat stands in", () => {
    const climbed = "/w/.claude/worktrees.noindex/fix-the-join/../other-row";
    const sessions = [spawned({ cwd: climbed })];
    expect(workedFromCmux({ rows, sessions, workspaces: [workspace({ currentDirectory: climbed })] })).toEqual([
      { rowId: "fix-the-join", session: "workspace:7" },
    ]);
  });

  it("holds a binding whose spawn directory is the filesystem root", () => {
    expect(workedFromCmux({ rows, sessions: [spawned({ cwd: "/" })], workspaces: [workspace()] })).toEqual([
      { rowId: "fix-the-join", session: "workspace:7" },
    ]);
  });

  it("takes the most recently spawned of two open bindings on one workspace", () => {
    const sessions = [spawned({ sessionKey: "other-row", slug: "other-row" }), spawned()];
    expect(workedFromCmux({ rows, sessions, workspaces: [workspace()] })).toEqual([
      { rowId: "other-row", session: "workspace:7" },
    ]);
  });

  it("never lets an older binding stand in for a newer one to a slug off the board", () => {
    const sessions = [spawned({ sessionKey: "settled-long-ago", slug: "settled-long-ago" }), spawned()];
    expect(workedFromCmux({ rows, sessions, workspaces: [workspace()] })).toEqual([
      { rowId: undefined, session: "workspace:7" },
    ]);
  });

  it("never lets an older open binding stand in for a newer CLOSED one", () => {
    const sessions = [spawned({ sessionKey: "other-row", slug: "other-row", status: "closed" }), spawned()];
    expect(workedFromCmux({ rows, sessions, workspaces: [workspace()] })).toEqual([
      { rowId: undefined, session: "workspace:7" },
    ]);
  });

  it("never lets an older binding stand in for a newer one the workspace has left", () => {
    const sessions = [spawned({ cwd: "/w/.claude/worktrees.noindex/elsewhere", slug: "other-row" }), spawned()];
    expect(workedFromCmux({ rows, sessions, workspaces: [workspace()] })).toEqual([
      { rowId: undefined, session: "workspace:7" },
    ]);
  });

  it("does not bind a stranger a cmux restart handed the dead seat's REF, since only the id survives a restart", () => {
    const stranger = workspace({ workspaceId: "A11D-STRANGER" });
    expect(workedFromCmux({ rows, sessions: [spawned()], workspaces: [stranger] })).toEqual([
      { rowId: undefined, session: "workspace:7" },
    ]);
  });

  it("binds a seat by its id after a restart renumbered its ref", () => {
    const renumbered = workspace({ workspaceRef: "workspace:2" });
    expect(workedFromCmux({ rows, sessions: [spawned()], workspaces: [renumbered] })).toEqual([
      { rowId: "fix-the-join", session: "workspace:2" },
    ]);
  });

  it("binds nothing off a row written before the id was recorded, keeping the directory reading", () => {
    const legacy = spawned({ workspaceId: undefined });
    expect(workedFromCmux({ rows, sessions: [legacy], workspaces: [workspace()] })).toEqual([
      { rowId: undefined, session: "workspace:7" },
    ]);
  });
});

describe("seatRowOf — the resolver the recipe failure filter calls directly", () => {
  const rowIds = new Set(["fix-the-join", "other-row"]);

  it("answers the bound row for a seat in a branch-named worktree", () => {
    expect(seatRowOf({ rowIds, sessions: [spawned()], workspace: workspace() })).toBe("fix-the-join");
  });

  it("answers undefined when neither the ledger nor the directory names a board row", () => {
    expect(seatRowOf({ rowIds, sessions: [], workspace: workspace() })).toBe(undefined);
  });
});
