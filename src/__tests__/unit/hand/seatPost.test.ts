/*
 * The seat gate: only the pinned supervisor posts a floating note. Identity is the environment the
 * caller runs in, never `--by-session`, so every case drives the two variables and the recorded pin.
 */
import { describe, expect, it } from "vitest";

import { SEAT_HAND_POST_HATCH, seatPostVerdict } from "../../../hand/seatPost.js";
import type { AppSupervisorPinRecord, CmuxSupervisorPinRecord } from "../../../sessions/supervisorPin.js";

const PIN: CmuxSupervisorPinRecord = {
  session: { host: "claude-code", id: "4c829e9d-d903-49b4-b446-6bb88b198511" },
  pinnedAtIso: "2026-09-27T01:22:59.139Z",
  workspaceId: "806BA6F7-871B-4A34-97FF-B35915EE6FB7",
  workspaceRef: "workspace:374",
};

const SEAT = {
  CLAUDE_CODE_SESSION_ID: "297eb49e-d49c-4c40-94f1-c112b29a020d",
  CMUX_WORKSPACE_ID: "2BEB69BC-5135-48BB-9C9A-4F4FE1B5C80C",
};

const COMMAND = "slopweaver hand post";

describe("seatPostVerdict", () => {
  it("refuses a seat, naming the chair, the hatch and both routes that still reach the owner", () => {
    const verdict = seatPostVerdict({ command: COMMAND, env: SEAT, pin: PIN });
    expect(verdict.kind).toBe("refused");
    const text = (verdict as { lines: readonly string[] }).lines.join("\n");
    expect(text).toContain("the pinned supervisor is workspace:374");
    expect(text).toContain(`${SEAT_HAND_POST_HATCH}=1 ${COMMAND}`);
    expect(text).toContain("SendMessage");
    expect(text).toContain("slopweaver handover ask");
    expect(text).toContain("slopweaver cmux pin");
  });

  it("admits the chair by its Claude session", () => {
    const env = { ...SEAT, CLAUDE_CODE_SESSION_ID: PIN.session.id };
    expect(seatPostVerdict({ command: COMMAND, env, pin: PIN })).toEqual({ kind: "ok" });
  });

  it("admits the chair's workspace when its Claude session changed in place", () => {
    const env = { ...SEAT, CMUX_WORKSPACE_ID: PIN.workspaceId };
    expect(seatPostVerdict({ command: COMMAND, env, pin: PIN })).toEqual({ kind: "ok" });
  });

  it("refuses a seat carrying only one of the two identities", () => {
    const env = { CMUX_WORKSPACE_ID: SEAT.CMUX_WORKSPACE_ID };
    expect(seatPostVerdict({ command: COMMAND, env, pin: PIN }).kind).toBe("refused");
  });

  it("is inert with no pin recorded", () => {
    expect(seatPostVerdict({ command: COMMAND, env: SEAT, pin: undefined })).toEqual({ kind: "ok" });
  });

  it("is inert for a caller carrying no session identity, blank counting as absent", () => {
    expect(seatPostVerdict({ command: COMMAND, env: {}, pin: PIN })).toEqual({ kind: "ok" });
    const blank = { CLAUDE_CODE_SESSION_ID: " ", CMUX_WORKSPACE_ID: "" };
    expect(seatPostVerdict({ command: COMMAND, env: blank, pin: PIN })).toEqual({ kind: "ok" });
  });

  it("records past the hatch, and says so", () => {
    const env = { ...SEAT, [SEAT_HAND_POST_HATCH]: "1" };
    expect(seatPostVerdict({ command: COMMAND, env, pin: PIN })).toEqual({
      kind: "hatched",
      lines: [`admitted past ${SEAT_HAND_POST_HATCH}=1: this session is not the pinned supervisor workspace:374`],
    });
  });
});

describe("seatPostVerdict with an app-hosted chair", () => {
  const APP_ID = "5f0c2a1e-7d3b-4c8e-9a6f-1b2c3d4e5f60";
  const APP_PIN: AppSupervisorPinRecord = { appSessionId: APP_ID, pinnedAtIso: PIN.pinnedAtIso, session: PIN.session };

  it("admits the app chair by its session", () => {
    const env = { CLAUDE_CODE_SESSION_ID: PIN.session.id };
    expect(seatPostVerdict({ command: COMMAND, env, pin: APP_PIN })).toEqual({ kind: "ok" });
  });

  it("never admits a cmux seat whose workspace id equals the app session id", () => {
    const env = { ...SEAT, CMUX_WORKSPACE_ID: APP_ID };
    const verdict = seatPostVerdict({ command: COMMAND, env, pin: APP_PIN });
    expect(verdict.kind).toBe("refused");
    expect((verdict as { lines: readonly string[] }).lines.join("\n")).toContain(
      `the pinned supervisor is app:${APP_ID}`,
    );
  });
});
