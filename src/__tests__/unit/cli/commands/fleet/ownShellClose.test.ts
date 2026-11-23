import { describe, expect, it } from "vitest";

import { ok } from "#lib/result.js";

import { closeOwnShell } from "../../../../../cli/commands/fleet/ownShellClose.js";
import type { CmuxClient, CmuxWorkspaceSummary } from "../../../../../cmux/client.js";
import { fakeClient, workspace } from "./fleetKit.js";

const OWN = "workspace-own";
const FINISH = { attemptId: "attempt-1", outcome: "healthy" } as const;

/**
 * A client listing `listed` with `surfaces` panes in this tab, recording every call `closeOwnShell` makes.
 *
 * @param listed the workspaces cmux lists
 * @param surfaces how many panes the tab reports
 * @param calls where each list, top and close call is written
 * @returns the client
 */
function recordingClient({
  listed,
  surfaces,
  calls,
}: {
  listed: readonly CmuxWorkspaceSummary[];
  surfaces: number;
  calls: string[];
}): CmuxClient {
  return {
    ...fakeClient({}),
    closeWorkspace: ({ workspaceId }) => {
      calls.push(`close ${workspaceId}`);
      return Promise.resolve(ok(undefined));
    },
    listWorkspaces: () => {
      calls.push("list");
      return Promise.resolve(ok(listed));
    },
    workspaceTop: ({ workspaceId }) => {
      calls.push(`top ${workspaceId}`);
      return Promise.resolve(ok({ surfaces, trees: [], ttys: [], unattributedTtyPids: [] }));
    },
  };
}

describe("closeOwnShell", () => {
  it("touches cmux not at all outside a cmux tab", async () => {
    const calls: string[] = [];
    const client = recordingClient({ calls, listed: [workspace({ id: OWN })], surfaces: 1 });
    await closeOwnShell({
      client,
      episodeNamed: true,
      finish: FINISH,
      finishJournalled: true,
      ownWorkspaceId: undefined,
    });
    expect(calls).toEqual([]);
  });

  it("touches cmux not at all when the finish never reached the journal", async () => {
    const calls: string[] = [];
    const client = recordingClient({ calls, listed: [workspace({ id: OWN })], surfaces: 1 });
    await closeOwnShell({ client, episodeNamed: true, finish: FINISH, finishJournalled: false, ownWorkspaceId: OWN });
    expect(calls).toEqual([]);
  });

  it("leaves a tab cmux lists as pinned", async () => {
    const calls: string[] = [];
    const client = recordingClient({ calls, listed: [workspace({ id: OWN, pinned: true })], surfaces: 1 });
    await closeOwnShell({ client, episodeNamed: true, finish: FINISH, finishJournalled: true, ownWorkspaceId: OWN });
    expect(calls).toEqual(["list"]);
  });

  it("leaves a tab cmux no longer lists", async () => {
    const calls: string[] = [];
    const client = recordingClient({ calls, listed: [workspace({ id: "workspace-other" })], surfaces: 1 });
    await closeOwnShell({ client, episodeNamed: true, finish: FINISH, finishJournalled: true, ownWorkspaceId: OWN });
    expect(calls).toEqual(["list"]);
  });

  it("leaves a split tab, whose other pane is nobody's to end", async () => {
    const calls: string[] = [];
    const client = recordingClient({ calls, listed: [workspace({ id: OWN })], surfaces: 2 });
    await closeOwnShell({ client, episodeNamed: true, finish: FINISH, finishJournalled: true, ownWorkspaceId: OWN });
    expect(calls).toEqual(["list", `top ${OWN}`]);
  });
});
