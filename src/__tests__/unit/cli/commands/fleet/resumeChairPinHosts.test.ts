/**
 * Which cmux workspace a recovery pass treats as the chair, for each arm of the supervisor pin: a cmux pin names its
 * own workspace, and an app pin names a session the desktop app hosts, which is never a cmux workspace.
 */
import { describe, expect, it } from "vitest";

import { chairWorkspaceOf } from "../../../../../cli/commands/fleet/resumeChair.js";
import type { ClaudeCmuxSupervisorPin } from "../../../../../sessions/supervisorPin.js";
import { workspace } from "./fleetKit.js";

const SESSION = { host: "claude-code", id: "00000000-0000-4000-8000-00000000dead" } as const;
const PINNED_AT = "2026-10-04T05:00:00.000Z";

const CMUX_PIN: ClaudeCmuxSupervisorPin = {
  pinnedAtIso: PINNED_AT,
  session: SESSION,
  workspaceId: "chair-id",
  workspaceRef: "workspace:chair-id",
};

describe("chairWorkspaceOf, by pin arm", () => {
  it("finds a cmux pin's own workspace", () => {
    expect(
      chairWorkspaceOf({ pin: CMUX_PIN, workspaces: [workspace({ id: "other" }), workspace({ id: "chair-id" })] })!
        .workspaceId,
    ).toBe("chair-id");
  });

  it("never matches an app pin's session id against a workspace id", () => {
    const appId = "5f0c2a1e-7d3b-4c8e-9a6f-1b2c3d4e5f60";
    const pin = { appSessionId: appId, pinnedAtIso: PINNED_AT, session: SESSION };
    expect(chairWorkspaceOf({ pin, workspaces: [workspace({ id: appId })] })).toBe(undefined);
  });
});
