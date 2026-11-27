/**
 * `cmux takeover`'s predecessor gates when cmux cannot be read, over plain fakes and a throwaway home: an app caller
 * over the app session the pin record names goes on through the app alone; with no record or a cmux record it
 * refuses; and a readable cmux still runs the cross-host collision check.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { predecessorGates } from "../../../../../cli/commands/cmux/takeoverHosts.js";
import type { CmuxWorkspaceSummary } from "../../../../../cmux/client.js";
import { CmuxErrors } from "../../../../../cmux/errors.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import type { CmuxHostInventoryError, CmuxHostSurface } from "../../../../../sessionHarness/cmuxHost.js";
import type { SessionHarness } from "../../../../../sessionHarness/sessionHarness.js";
import { appendSessionEvent } from "../../../../../sessions/sessionStore.js";
import type { SupervisorPinRecord } from "../../../../../sessions/supervisorPin.js";
import { writeSupervisorPin } from "../../../../../sessions/supervisorPinStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const PREDECESSOR_ID = "5f0c2a1e-7d3b-4c8e-9a6f-1b2c3d4e5f60";
const CALLER_ID = "5f0c2a1e-7d3b-4c8e-9a6f-1b2c3d4e5f61";
const PREDECESSOR_DIR = "/w/.claude/worktrees/fresh-supervisor-handoff-9291";
const PREDECESSOR_SLUG = "fresh-supervisor-handoff-9291";
const SESSION = { host: "claude-code", id: "a0000013-0000-4000-8000-000000000014" } as const;
const AT = "2026-11-09T01:00:00.000Z";
const APP_CALLER = { appSessionId: CALLER_ID, kind: "app" } as const;
const REFUSING = CmuxErrors.accessDenied({ refusal: "not a child of cmux", socketPath: "/tmp/cmux.sock" });

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "takeover-hosts-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The cmux fake: what each listing answers, and how many times either was asked. */
function cmux({ listed }: { listed: Result<readonly CmuxWorkspaceSummary[], CmuxHostInventoryError> }): {
  client: Pick<CmuxHostSurface, "listWorkspaces" | "listWorkspacesStrict">;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    client: {
      listWorkspaces: async () => {
        calls.push("listWorkspaces");
        return listed;
      },
      listWorkspacesStrict: async () => {
        calls.push("listWorkspacesStrict");
        return err(REFUSING);
      },
    },
  };
}

/** The app fake: it resolves the predecessor's handle to a live session in its worktree, and records each ask. */
function app(): { appHarness: Pick<SessionHarness, "resolve">; resolved: string[] } {
  const resolved: string[] = [];
  return {
    appHarness: {
      resolve: async ({ handle }) => {
        resolved.push(handle);
        return ok({
          session: {
            description: undefined,
            directory: PREDECESSOR_DIR,
            groupId: "app",
            handle,
            id: PREDECESSOR_ID,
            latestConversationMessage: undefined,
            latestSubmittedAtIso: undefined,
            latestSubmittedMessage: undefined,
            pinned: false,
            selected: false,
            title: PREDECESSOR_SLUG,
          },
        });
      },
    },
    resolved,
  };
}

/** Record the pin, then the predecessor's ledger row and finished run, so gate (c) has a chair to confirm. */
function finishedAppChair({ record }: { record: SupervisorPinRecord }): void {
  writeSupervisorPin({ home, record });
  appendSessionEvent({
    event: {
      branch: PREDECESSOR_SLUG,
      cwd: PREDECESSOR_DIR,
      harness: "app",
      kind: "spawned",
      sessionId: PREDECESSOR_ID,
      sessionKey: PREDECESSOR_SLUG,
      slug: PREDECESSOR_SLUG,
      surfaceRef: `app:${PREDECESSOR_ID}`,
      tsIso: AT,
      workspaceRef: `app:${PREDECESSOR_ID}`,
    },
    home,
  });
  const runsDir = stateHomePaths({ home }).runs;
  appendRunEvent({
    event: { atIso: AT, branch: PREDECESSOR_SLUG, docHash: "h", kind: "started" },
    runsDir,
    slug: PREDECESSOR_SLUG,
  });
  appendRunEvent({ event: { atIso: AT, kind: "finished", residue: [] }, runsDir, slug: PREDECESSOR_SLUG });
}

/** One pinned cmux workspace as `cmux list` reports it. */
function pinnedWorkspace(): CmuxWorkspaceSummary {
  return {
    currentDirectory: "/w/.claude/worktrees/fresh-supervisor-handoff-9290",
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: true,
    selected: false,
    title: "/slopweaver:supervisor",
    windowId: "window:1",
    workspaceId: "id-chair",
    workspaceRef: "workspace:7",
  };
}

const APP_RECORD: SupervisorPinRecord = { appSessionId: PREDECESSOR_ID, pinnedAtIso: AT, session: SESSION };
const CMUX_RECORD: SupervisorPinRecord = {
  pinnedAtIso: AT,
  session: SESSION,
  workspaceId: "id-chair",
  workspaceRef: "workspace:7",
};

describe("predecessorGates when cmux refuses this process its socket", () => {
  it("resolves an app caller's app predecessor through the app alone, and gates its run", async () => {
    finishedAppChair({ record: APP_RECORD });
    const { client, calls } = cmux({ listed: err(REFUSING) });
    const { appHarness, resolved } = app();
    const gated = await predecessorGates({ appHarness, caller: APP_CALLER, client, home });
    expect(gated).toEqual(
      expect.objectContaining({
        appSessionId: PREDECESSOR_ID,
        kind: "app",
        label: `app:${PREDECESSOR_ID}`,
        run: expect.objectContaining({ slug: PREDECESSOR_SLUG }),
      }),
    );
    expect(calls).toEqual(["listWorkspaces"]);
    expect(resolved).toEqual([`app:${PREDECESSOR_ID}`]);
  });

  it("refuses with no pin record, since an unrecorded cmux pin cannot be ruled out, and asks the app nothing", async () => {
    const { client } = cmux({ listed: err(REFUSING) });
    const { appHarness, resolved } = app();
    expect(await predecessorGates({ appHarness, caller: APP_CALLER, client, home })).toBe(1);
    expect(resolved).toEqual([]);
  });

  it("refuses over a cmux pin record, the refusal that stands while cmux cannot be read", async () => {
    writeSupervisorPin({ home, record: CMUX_RECORD });
    const { client, calls } = cmux({ listed: err(REFUSING) });
    const { appHarness, resolved } = app();
    expect(await predecessorGates({ appHarness, caller: APP_CALLER, client, home })).toBe(1);
    expect(calls).toEqual(["listWorkspaces"]);
    expect(resolved).toEqual([]);
  });

  it("refuses a cmux caller over an app record, which would pin cmux through a cmux it cannot read", async () => {
    finishedAppChair({ record: APP_RECORD });
    const { client } = cmux({ listed: err(REFUSING) });
    const { appHarness, resolved } = app();
    expect(await predecessorGates({ appHarness, caller: { kind: "cmux", workspaceId: "own" }, client, home })).toBe(1);
    expect(resolved).toEqual([]);
  });
});

describe("predecessorGates when cmux can be read", () => {
  it("still refuses a cmux pin beside an app record as two supervisors, never taking the app path", async () => {
    finishedAppChair({ record: APP_RECORD });
    const { client } = cmux({ listed: ok([pinnedWorkspace()]) });
    const { appHarness, resolved } = app();
    expect(await predecessorGates({ appHarness, caller: APP_CALLER, client, home })).toBe(1);
    expect(resolved).toEqual([]);
  });
});
