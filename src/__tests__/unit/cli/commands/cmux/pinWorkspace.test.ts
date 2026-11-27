/**
 * The cmux arm of `cmux pin`, and `cmux unpin`, over plain fakes journalling every effect in order: the
 * supervisor-pin lock is the first effect each takes, a held one refuses before anything is read, and it is released
 * on every path. No socket, no cmux, no file.
 */
import { describe, expect, it } from "vitest";

import {
  type CmuxWorkspacePinDeps,
  type CmuxWorkspaceUnpinDeps,
  pinCmuxWorkspace,
  unpinCmuxWorkspace,
} from "../../../../../cli/commands/cmux/pinWorkspace.js";
import type { StaleRecordOutcome } from "../../../../../cli/commands/cmux/recordPin.js";
import type { CmuxWorkspaceSummary } from "../../../../../cmux/client.js";
import { CmuxErrors } from "../../../../../cmux/errors.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { SupervisorPinDisposition } from "../../../../../sessions/supervisorPinStore.js";
import { fakePinLock, HELD_LOCK_MESSAGE } from "./pinLockFake.js";

const NOW = "2026-11-27T10:00:00.000Z";
const APP_ID = "a0000120-0000-4000-8000-0000000000a1";

/** One listed workspace. */
function workspace({ id, pinned = false }: { id: string; pinned?: boolean }): CmuxWorkspaceSummary {
  return {
    currentDirectory: "/work/acme",
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned,
    selected: false,
    title: undefined,
    windowId: "window-1",
    workspaceId: id,
    workspaceRef: `workspace:${id}`,
  };
}

/** The cmux arm's fakes, each journalling into `events`. */
function pinFakes({
  events,
  held = false,
  workspaces = [workspace({ id: "ws-own" })],
  disposition = { kind: "absent" },
  pins = true,
}: {
  events: string[];
  held?: boolean;
  workspaces?: readonly CmuxWorkspaceSummary[];
  disposition?: SupervisorPinDisposition;
  pins?: boolean;
}): CmuxWorkspacePinDeps {
  return {
    holdPinLock: fakePinLock({ events, held }),
    listWorkspaces: async () => {
      events.push("list");
      return ok(workspaces);
    },
    nowIso: () => NOW,
    pinWorkspace: async ({ workspaceId }) => {
      events.push(`pin ${workspaceId}`);
      return pins
        ? ok(undefined)
        : err(CmuxErrors.malformedReply({ detail: "cmux said no", method: "workspace.action" }));
    },
    readDisposition: () => {
      events.push("record-read");
      return disposition;
    },
    recordPin: ({ pinnedWorkspaceId, ownWorkspaceId }) => {
      events.push(`record-write ${pinnedWorkspaceId}`);
      return ownWorkspaceId === pinnedWorkspaceId;
    },
    targetWorkspaceId: async ({ workspaceRef }) => {
      if (workspaceRef === undefined) {
        events.push("own");
        return ok("ws-own");
      }
      events.push(`target ${workspaceRef}`);
      return ok(workspaceRef);
    },
  };
}

describe("pinCmuxWorkspace", () => {
  it("refuses on a held lock before any target, cmux or record read", async () => {
    const events: string[] = [];
    const refused = unwrapErr(
      await pinCmuxWorkspace({ deps: pinFakes({ events, held: true }), workspaceRef: "ws-own" }),
    );
    expect(refused.code).toBe("LOCK_CONTENDED");
    expect(refused.message).toBe(HELD_LOCK_MESSAGE);
    expect(events).toEqual(["lock"]);
  });

  it("holds the lock from the first target read through the record write", async () => {
    const events: string[] = [];
    expect(unwrap(await pinCmuxWorkspace({ deps: pinFakes({ events }), workspaceRef: "ws-own" }))).toEqual({
      ref: "workspace:ws-own",
      self: true,
    });
    expect(events).toEqual([
      "lock",
      "target ws-own",
      "list",
      "own",
      "record-read",
      "pin ws-own",
      "record-write ws-own",
      "release",
    ]);
  });

  it("releases after refusing a second pinned workspace, reading no record and pinning nothing", async () => {
    const events: string[] = [];
    const deps = pinFakes({
      events,
      workspaces: [workspace({ id: "ws-own" }), workspace({ id: "ws-chair", pinned: true })],
    });
    expect(unwrapErr(await pinCmuxWorkspace({ deps, workspaceRef: "ws-own" })).code).toBe("ALREADY_PINNED_ELSEWHERE");
    expect(events).toEqual(["lock", "target ws-own", "list", "release"]);
  });

  it("releases after refusing over an app record, pinning nothing", async () => {
    const events: string[] = [];
    const deps = pinFakes({
      disposition: {
        kind: "pin",
        record: {
          appSessionId: APP_ID,
          pinnedAtIso: NOW,
          session: { host: "claude-code", id: "a0000120-0000-4000-8000-0000000000c1" },
        },
      },
      events,
    });
    expect(unwrapErr(await pinCmuxWorkspace({ deps, workspaceRef: "ws-own" })).code).toBe("APP_PIN_RECORDED");
    expect(events).toEqual(["lock", "target ws-own", "list", "own", "record-read", "release"]);
  });

  it("releases when cmux will not pin, writing no record", async () => {
    const events: string[] = [];
    const refused = unwrapErr(
      await pinCmuxWorkspace({ deps: pinFakes({ events, pins: false }), workspaceRef: "ws-own" }),
    );
    expect(refused.message).toContain("cmux said no");
    expect(events).toEqual(["lock", "target ws-own", "list", "own", "record-read", "pin ws-own", "release"]);
  });
});

/** The unpin's fakes, each journalling into `events`. */
function unpinFakes({
  events,
  held = false,
  unpins = true,
  stale = "removed",
}: {
  events: string[];
  held?: boolean;
  unpins?: boolean;
  stale?: StaleRecordOutcome;
}): CmuxWorkspaceUnpinDeps {
  return {
    forgetRecord: ({ unpinnedWorkspaceId }) => {
      events.push(`forget ${unpinnedWorkspaceId}`);
      return stale;
    },
    holdPinLock: fakePinLock({ events, held }),
    label: async ({ workspaceId }) => {
      events.push(`label ${workspaceId}`);
      return `cmux:${workspaceId}`;
    },
    targetWorkspaceId: async ({ workspaceRef }) => {
      events.push(`target ${String(workspaceRef)}`);
      return ok("ws-chair");
    },
    unpinWorkspace: async ({ workspaceId }) => {
      events.push(`unpin ${workspaceId}`);
      return unpins
        ? ok(undefined)
        : err(CmuxErrors.malformedReply({ detail: "cmux said no", method: "workspace.action" }));
    },
  };
}

describe("unpinCmuxWorkspace", () => {
  it("refuses on a held lock before resolving any target", async () => {
    const events: string[] = [];
    const refused = unwrapErr(
      await unpinCmuxWorkspace({ deps: unpinFakes({ events, held: true }), workspaceRef: "ws-chair" }),
    );
    expect(refused.message).toBe(HELD_LOCK_MESSAGE);
    expect(events).toEqual(["lock"]);
  });

  it("holds the lock through the unpin and the record it forgets", async () => {
    const events: string[] = [];
    expect(unwrap(await unpinCmuxWorkspace({ deps: unpinFakes({ events }), workspaceRef: "ws-chair" }))).toEqual({
      label: "cmux:ws-chair",
      stale: "removed",
    });
    expect(events).toEqual([
      "lock",
      "target ws-chair",
      "label ws-chair",
      "unpin ws-chair",
      "forget ws-chair",
      "release",
    ]);
  });

  it("releases when cmux will not unpin, forgetting nothing", async () => {
    const events: string[] = [];
    const refused = unwrapErr(
      await unpinCmuxWorkspace({ deps: unpinFakes({ events, unpins: false }), workspaceRef: "ws-chair" }),
    );
    expect(refused.message).toContain("cmux said no");
    expect(events).toEqual(["lock", "target ws-chair", "label ws-chair", "unpin ws-chair", "release"]);
  });

  it("releases and carries a record that would not go", async () => {
    const events: string[] = [];
    const outcome = unwrap(
      await unpinCmuxWorkspace({ deps: unpinFakes({ events, stale: "failed" }), workspaceRef: "ws-chair" }),
    );
    expect(outcome.stale).toBe("failed");
    expect(events.at(-1)).toBe("release");
  });
});
