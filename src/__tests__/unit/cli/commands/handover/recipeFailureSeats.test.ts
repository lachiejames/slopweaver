import { describe, expect, it } from "vitest";

import {
  duplicateRecipeFailureSlugs,
  hostPidsFrom,
  pidsOfTree,
  provenRecipeFailureSeats,
  type RecipeFailureSeatReads,
  recipeFailureWorkspaceIds,
  withProvenRecipeFailureSeats,
} from "../../../../../cli/commands/handover/recipeFailureSeats.js";
import type { CmuxWorkspaceSummary } from "../../../../../cmux/client.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { SessionRecord } from "../../../../../sessions/liveSessions.js";
import type { SessionItem } from "../../../../../sessions/session.js";

const FINDING = "recipe-failing-resync-corpus-notion-2026-10-12t13-00-00.000z-a1";

/** One listed workspace whose directory is a worktree named `slug`. */
function workspace({ id, slug }: { id: string; slug: string }): CmuxWorkspaceSummary {
  return {
    currentDirectory: `/repo/.claude/worktrees.noindex/${slug}`,
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: undefined,
    windowId: "window:1",
    workspaceId: id,
    workspaceRef: `workspace:${id}`,
  };
}

/** Reads answering from fixed tables, recording which trees were asked for. */
function tableReads({
  hosts,
  trees,
}: {
  hosts: Result<ReadonlySet<number>, string>;
  trees: Readonly<Record<string, Result<readonly number[], string>>>;
}): { asked: string[]; reads: RecipeFailureSeatReads } {
  const asked: string[] = [];
  return {
    asked,
    reads: {
      hostPids: () => hosts,
      treePids: async ({ workspaceId }) => {
        asked.push(workspaceId);
        return trees[workspaceId]!;
      },
    },
  };
}

/** One board doc claiming `slug`. */
function doc({ file, slug }: { file: string; slug: string }): ReturnType<typeof parseHandoverDoc> {
  return parseHandoverDoc({ path: `/state/handovers/${file}.md`, text: `---\nslug: ${slug}\nstatus: ready\n---\n` });
}

const SEAT = workspace({ id: "w-seat", slug: FINDING });
const OTHER = workspace({ id: "w-other", slug: "some-ordinary-row" });

/** Both rows on the board, and a ledger binding no seat — every seat is read off its directory. */
const UNBOUND: { readonly rowIds: ReadonlySet<string>; readonly sessions: readonly SessionItem[] } = {
  rowIds: new Set([FINDING, "some-ordinary-row"]),
  sessions: [],
};

describe("pidsOfTree", () => {
  it("collects every pid in the tree, children included", () => {
    expect(
      pidsOfTree({
        processes: [
          { children: [{ children: [], name: "2.1.241", pid: 3 }], name: "zsh", pid: 2 },
          { children: [], name: "sleep", pid: 4 },
        ],
      }),
    ).toEqual([2, 3, 4]);
  });
});

describe("recipeFailureWorkspaceIds", () => {
  it("names only the workspaces whose directory is a recipe failure finding", () => {
    expect(recipeFailureWorkspaceIds({ ...UNBOUND, workspaces: [OTHER, SEAT] })).toEqual(["w-seat"]);
  });

  it("reads each seat by the worktree it stands in, wherever its shell moved under it", () => {
    const moved = { ...SEAT, currentDirectory: `${SEAT.currentDirectory}/src` };
    const ordinary = { ...OTHER, currentDirectory: `${OTHER.currentDirectory}/tmp/${FINDING}` };
    expect(recipeFailureWorkspaceIds({ ...UNBOUND, workspaces: [ordinary, moved] })).toEqual(["w-seat"]);
  });
});

describe("withProvenRecipeFailureSeats", () => {
  it("drops a recipe failure workspace no host was proven in, and keeps every other workspace", () => {
    expect(withProvenRecipeFailureSeats({ ...UNBOUND, hosted: new Set(), workspaces: [OTHER, SEAT] })).toEqual([OTHER]);
  });

  it("keeps a recipe failure workspace a host was proven in", () => {
    expect(
      withProvenRecipeFailureSeats({ ...UNBOUND, hosted: new Set(["w-seat"]), workspaces: [OTHER, SEAT] }),
    ).toEqual([OTHER, SEAT]);
  });
});

/**
 * A seat `cmux spawn` placed on a recipe failure finding from a worktree named for its BRANCH: only the session
 * ledger's binding says it is on that row, so the host proof must read the same binding `workedFromCmux` does, or
 * a bare shell there would count as repairing the finding.
 */
describe("recipeFailureWorkspaceIds — a seat the ledger binds", () => {
  const branchSeat = workspace({ id: "w-branch", slug: "feat-some-branch" });
  /** The open ledger row binding `w-branch` to `slug`. */
  function bound({ slug }: { slug: string }): SessionItem {
    return {
      branch: "feat/some-branch",
      cwd: branchSeat.currentDirectory,
      lastEventIso: "2026-11-05T10:00:00.000Z",
      sessionKey: slug,
      slug,
      spawnedIso: "2026-11-05T10:00:00.000Z",
      status: "open",
      surfaceRef: "surface:1",
      workspaceId: "w-branch",
      workspaceRef: "workspace:w-branch",
    };
  }

  it("owes a host proof for a branch-named seat bound to a recipe failure finding", () => {
    const sessions = [bound({ slug: FINDING })];
    expect(recipeFailureWorkspaceIds({ ...UNBOUND, sessions, workspaces: [OTHER, branchSeat] })).toEqual(["w-branch"]);
  });

  it("drops that seat when no host is proven in it", () => {
    const sessions = [bound({ slug: FINDING })];
    expect(
      withProvenRecipeFailureSeats({ ...UNBOUND, hosted: new Set(), sessions, workspaces: [OTHER, branchSeat] }),
    ).toEqual([OTHER]);
  });

  it("owes nothing for the same seat bound to an ordinary row", () => {
    const sessions = [bound({ slug: "some-ordinary-row" })];
    expect(recipeFailureWorkspaceIds({ ...UNBOUND, sessions, workspaces: [OTHER, branchSeat] })).toEqual([]);
  });

  it("still owes a proof for a recipe failure worktree a ledger binding places on an ordinary row", () => {
    // Bound in place: spawned into the recipe failure worktree itself, so the binding to the ordinary row HOLDS.
    const sessions = [{ ...bound({ slug: "some-ordinary-row" }), cwd: SEAT.currentDirectory, workspaceId: "w-seat" }];
    expect(recipeFailureWorkspaceIds({ ...UNBOUND, sessions, workspaces: [OTHER, SEAT] })).toEqual(["w-seat"]);
  });
});

describe("provenRecipeFailureSeats", () => {
  it("keeps a seat whose tree holds a pid Claude Code registered", async () => {
    const { reads } = tableReads({ hosts: ok(new Set([3])), trees: { "w-seat": ok([2, 3]) } });
    expect(await provenRecipeFailureSeats({ ...UNBOUND, reads, workspaces: [SEAT] })).toEqual([SEAT]);
  });

  it("drops a seat whose agent exited and left a vim — a process, but no registered host", async () => {
    const { asked, reads } = tableReads({ hosts: ok(new Set([99])), trees: { "w-seat": ok([2, 5]) } });
    expect(await provenRecipeFailureSeats({ ...UNBOUND, reads, workspaces: [OTHER, SEAT] })).toEqual([OTHER]);
    expect(asked).toEqual(["w-seat"]);
  });

  it("fails closed when the tree will not read", async () => {
    const { reads } = tableReads({ hosts: ok(new Set([3])), trees: { "w-seat": err("socket refused") } });
    expect(await provenRecipeFailureSeats({ ...UNBOUND, reads, workspaces: [SEAT] })).toEqual([]);
  });

  it("fails closed when the session registry will not read, asking no tree", async () => {
    const { asked, reads } = tableReads({ hosts: err("sessions dir unreadable"), trees: { "w-seat": ok([3]) } });
    expect(await provenRecipeFailureSeats({ ...UNBOUND, reads, workspaces: [SEAT] })).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("asks nothing when no workspace is on a recipe failure finding", async () => {
    const { asked, reads } = tableReads({ hosts: err("never read"), trees: {} });
    expect(await provenRecipeFailureSeats({ ...UNBOUND, reads, workspaces: [OTHER] })).toEqual([OTHER]);
    expect(asked).toEqual([]);
  });

  it("answers no listing when cmux gave none", async () => {
    const { reads } = tableReads({ hosts: ok(new Set()), trees: {} });
    expect(await provenRecipeFailureSeats({ ...UNBOUND, reads, workspaces: undefined })).toBe(undefined);
  });
});

describe("hostPidsFrom", () => {
  const STARTED = "Tue Oct 13 01:00:00 2026";

  /** One registry record on `pid`, an interactive terminal session started at `procStart` unless overridden. */
  function record({
    entrypoint = "cli",
    pid,
    procStart = STARTED,
  }: {
    entrypoint?: string;
    pid: number;
    procStart?: string;
  }): SessionRecord {
    return {
      cwd: "/repo",
      entrypoint,
      kind: "interactive",
      name: "seat",
      pid,
      procStart,
      sessionId: `session-${String(pid)}`,
      startedAtMs: 0,
      status: "busy",
    };
  }

  it("names a pid still running the session its record describes", () => {
    const scan = { records: [record({ pid: 3 })], refused: [], unreadable: undefined };
    expect(unwrap(hostPidsFrom({ scan, starts: new Map([[3, STARTED]]) }))).toEqual(new Set([3]));
  });

  it("does not name a pid a dead session's leftover file shares with whatever started on it later", () => {
    const scan = { records: [record({ pid: 3 })], refused: [], unreadable: undefined };
    expect(unwrap(hostPidsFrom({ scan, starts: new Map([[3, "Tue Oct 13 04:00:00 2026"]]) }))).toEqual(new Set());
  });

  it("does not name a headless session, which is no seat", () => {
    const scan = { records: [record({ entrypoint: "sdk-cli", pid: 3 })], refused: [], unreadable: undefined };
    expect(unwrap(hostPidsFrom({ scan, starts: new Map([[3, STARTED]]) }))).toEqual(new Set());
  });

  it("fails the whole read on a registry file that would not read", () => {
    const scan = { records: [record({ pid: 3 })], refused: ["9.json: not JSON"], unreadable: undefined };
    const read = hostPidsFrom({ scan, starts: new Map([[3, STARTED]]) });
    expect(unwrapErr(read)).toBe("the session registry holds files that would not read: 9.json: not JSON");
  });
});

describe("duplicateRecipeFailureSlugs", () => {
  it("names a finding slug two docs claim, once, and no other slug", () => {
    const docs = [
      doc({ file: FINDING, slug: FINDING }),
      doc({ file: "hand-written-copy", slug: FINDING }),
      doc({ file: "plain", slug: "plain" }),
      doc({ file: "plain-copy", slug: "plain" }),
    ];
    expect(duplicateRecipeFailureSlugs({ docs })).toEqual([FINDING]);
  });

  it("names nothing when every finding slug is claimed once", () => {
    expect(duplicateRecipeFailureSlugs({ docs: [doc({ file: FINDING, slug: FINDING })] })).toEqual([]);
  });
});
