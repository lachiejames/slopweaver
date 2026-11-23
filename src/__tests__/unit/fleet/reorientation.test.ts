/**
 * Who may say the supervisor is caught up, and against which attempt.
 */
import { describe, expect, it } from "vitest";

import { type FleetAttemptFold, STANDALONE_REORIENTATION } from "../../../fleet/journal.js";
import { decideReorientation } from "../../../fleet/reorientation.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { SupervisorPinRecord } from "../../../sessions/supervisorPin.js";

const CHAIR = "a0000006-0000-4000-8000-000000000007";
const PIN: SupervisorPinRecord = {
  session: { host: "claude-code", id: CHAIR },
  pinnedAtIso: "t0",
  workspaceId: "ws",
  workspaceRef: "workspace:1",
};

/** An attempt whose chair is in the given state. */
function attempt({ chair }: { chair: FleetAttemptFold["chair"] }): FleetAttemptFold {
  return {
    attemptId: "att",
    chair,
    console: undefined,
    episodeId: "ep",
    finished: undefined,
    pid: 9,
    pidStart: undefined,
    seats: new Map(),
    startedAtIso: "t1",
  };
}

const AWAITING = attempt({ chair: { chairSessionId: CHAIR, chairWorkspaceId: "ws", kind: "awaiting" } });

describe("decideReorientation", () => {
  it("answers the attempt awaiting this chair", () => {
    expect(unwrap(decideReorientation({ attempt: AWAITING, pin: PIN, requested: "att", sessionId: CHAIR }))).toEqual({
      already: false,
      attemptId: "att",
    });
  });

  it("answers the awaiting attempt even when the chair names none", () => {
    expect(
      unwrap(decideReorientation({ attempt: AWAITING, pin: PIN, requested: undefined, sessionId: CHAIR })).attemptId,
    ).toBe("att");
  });

  it("records a standalone line when no attempt waits on it", () => {
    expect(
      unwrap(decideReorientation({ attempt: undefined, pin: PIN, requested: undefined, sessionId: CHAIR })).attemptId,
    ).toBe(STANDALONE_REORIENTATION);
  });

  it("refuses a session that is not the pinned supervisor", () => {
    const error = unwrapErr(decideReorientation({ attempt: AWAITING, pin: PIN, requested: "att", sessionId: "other" }));
    expect(error.code).toBe("REORIENTATION_REFUSED");
    expect(error.message).toContain("is not the supervisor the pin names");
  });

  it("refuses with no session id in the environment", () => {
    expect(
      unwrapErr(decideReorientation({ attempt: AWAITING, pin: PIN, requested: "att", sessionId: undefined })).message,
    ).toContain("CLAUDE_CODE_SESSION_ID is not set");
  });

  it("refuses an attempt id that is not the newest", () => {
    expect(
      unwrapErr(decideReorientation({ attempt: AWAITING, pin: PIN, requested: "older", sessionId: CHAIR })).message,
    ).toContain("is not the newest recovery attempt");
  });

  it("is idempotent once this attempt holds the chair's line", () => {
    const done = attempt({ chair: { atIso: "t5", chairSessionId: CHAIR, kind: "reoriented" } });
    expect(unwrap(decideReorientation({ attempt: done, pin: PIN, requested: "att", sessionId: CHAIR }))).toEqual({
      already: true,
      attemptId: "att",
    });
  });
});
