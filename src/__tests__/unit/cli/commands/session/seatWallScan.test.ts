/**
 * The one screen scan `session watch` and `session re-seat` share: which seats it reads, what it reads as a wall,
 * and that an unread screen is reported rather than passed as clear. The client is a plain fake recording reads.
 */
import { describe, expect, it } from "vitest";

import { callerWorkspaceId, scanSeatWalls } from "../../../../../cli/commands/session/seatWallScan.js";
import type { CmuxClient, CmuxWorkspaceSummary } from "../../../../../cmux/client.js";
import { CmuxErrors } from "../../../../../cmux/errors.js";
import { err, ok } from "../../../../../lib/result.js";

const LIMIT_LINE = "✻ Weekly limit reached · Retrying in 5h (Sep 13 at 8am) · attempt 1/300";

/** One live workspace as `cmux list` reports it. */
function workspace({ id, pinned = false }: { id: string; pinned?: boolean }): CmuxWorkspaceSummary {
  return {
    currentDirectory: `/w/${id}`,
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned,
    selected: false,
    title: id,
    windowId: "window:1",
    workspaceId: id,
    workspaceRef: `workspace:${id}`,
  };
}

/** A client whose only live method reads the named screens, logging each read; a missing screen errors. */
function screenClient({ screens, reads }: { screens: Readonly<Record<string, string>>; reads: string[] }): CmuxClient {
  const unreachable = (): never => {
    throw new Error("the scan only reads screens");
  };
  return {
    close: () => undefined,
    closeWorkspace: unreachable,
    createWorkspace: unreachable,
    identify: unreachable,
    interruptTurn: unreachable,
    listWorkspaces: unreachable,
    pinWorkspace: unreachable,
    processTree: unreachable,
    workspaceTop: unreachable,
    readResumeBinding: unreachable,
    readScreen: ({ target }) => {
      reads.push(target.workspaceId);
      const screen = screens[target.workspaceId];
      return Promise.resolve(
        screen === undefined
          ? err(CmuxErrors.malformedReply({ detail: "settling", method: "terminal.text" }))
          : ok(screen),
      );
    },
    readScreenGrid: unreachable,
    renameWorkspace: unreachable,
    resolveWorkspace: unreachable,
    sendLine: unreachable,
    submitComposer: unreachable,
    unpinWorkspace: unreachable,
    listWorkspacesStrict: unreachable,
    topologyStrict: unreachable,
    workspaceSurface: unreachable,
  };
}

describe("scanSeatWalls", () => {
  it("reads every seat but the pinned chair and the caller, and names each wall it finds", async () => {
    const reads: string[] = [];
    const scanned = await scanSeatWalls({
      client: screenClient({
        reads,
        screens: {
          busy: "⏺ Reading a file\n│ > │",
          chair: LIMIT_LINE,
          limited: `${LIMIT_LINE}\n│ > │`,
          mine: LIMIT_LINE,
          out: "│ > │\n  Not logged in · Please run /login",
        },
      }),
      chairWorkspaceId: undefined,
      ownWorkspaceId: "mine",
      workspaces: [
        workspace({ id: "chair", pinned: true }),
        workspace({ id: "mine" }),
        workspace({ id: "busy" }),
        workspace({ id: "limited" }),
        workspace({ id: "out" }),
        workspace({ id: "gone" }),
      ],
    });

    expect(reads).toEqual(["busy", "limited", "out", "gone"]);
    expect([...scanned.walls]).toEqual([
      ["limited", { banner: LIMIT_LINE, kind: "limit-retrying" }],
      ["out", { kind: "logged-out" }],
    ]);
    expect(
      scanned.scanProblems.map((problem) => [problem.kind, problem.workspace.workspaceId, problem.message]),
    ).toEqual([["screen-unreadable", "gone", "cmux terminal.text replied with an unusable shape: settling"]]);
  });
});

describe("callerWorkspaceId", () => {
  it("answers the trimmed id cmux exported", () => {
    expect(callerWorkspaceId({ env: { CMUX_WORKSPACE_ID: " ws-1 \n" } })).toBe("ws-1");
  });

  it("answers undefined outside cmux, and for a blank id", () => {
    expect(callerWorkspaceId({ env: {} })).toBe(undefined);
    expect(callerWorkspaceId({ env: { CMUX_WORKSPACE_ID: "  " } })).toBe(undefined);
  });
});
