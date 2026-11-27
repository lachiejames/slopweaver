/*
 * Who may record a review-pass extension: only a session whose host and id match the supervisor pin exactly. No pin,
 * an unreadable pin, no identity, two identities and another holder each refuse, naming why.
 */
import { describe, expect, it } from "vitest";

import { passExtensionGrantVerdict } from "../../../codex/passExtensionGrant.js";
import type { CmuxSupervisorPinRecord } from "../../../sessions/supervisorPin.js";

const CHAIR = { host: "claude-code", id: "4c829e9d-d903-49b4-b446-6bb88b198511" } as const;
const SEAT = { host: "claude-code", id: "297eb49e-d49c-4c40-94f1-c112b29a020d" } as const;

const PIN: CmuxSupervisorPinRecord = {
  pinnedAtIso: "2026-11-27T00:00:00.000Z",
  session: CHAIR,
  workspaceId: "806BA6F7-871B-4A34-97FF-B35915EE6FB7",
  workspaceRef: "workspace:374",
};

describe("passExtensionGrantVerdict", () => {
  it("allows the pinned supervisor, recording it as the grantor", () => {
    expect(
      passExtensionGrantVerdict({ detection: { kind: "active", session: CHAIR }, pin: { kind: "pin", record: PIN } }),
    ).toEqual({ grantedBy: CHAIR, kind: "allowed" });
  });

  it("refuses a seat, naming the chair and the rule", () => {
    expect(
      passExtensionGrantVerdict({ detection: { kind: "active", session: SEAT }, pin: { kind: "pin", record: PIN } }),
    ).toEqual({
      kind: "refused",
      reason:
        "the pinned supervisor is workspace:374, and this is claude-code 297eb49e-d49c-4c40-94f1-c112b29a020d — " +
        "a seat never grants itself a pass",
    });
  });

  it("refuses a Codex thread carrying the chair's id, since the host is half the identity", () => {
    const verdict = passExtensionGrantVerdict({
      detection: { kind: "active", session: { host: "codex", id: CHAIR.id } },
      pin: { kind: "pin", record: PIN },
    });
    expect(verdict.kind).toBe("refused");
  });

  it("refuses with no pin recorded rather than going inert", () => {
    expect(
      passExtensionGrantVerdict({ detection: { kind: "active", session: CHAIR }, pin: { kind: "absent" } }),
    ).toEqual({
      kind: "refused",
      reason: "no supervisor pin is recorded, so no session is the chair that may grant one",
    });
  });

  it("refuses on an unreadable pin, carrying why", () => {
    expect(
      passExtensionGrantVerdict({
        detection: { kind: "active", session: CHAIR },
        pin: { kind: "unreadable", named: [], why: "the supervisor pin does not parse as one record shape" },
      }),
    ).toEqual({
      kind: "refused",
      reason: "the supervisor pin does not parse as one record shape, so which session is the chair cannot be told",
    });
  });

  it("refuses a process naming no session", () => {
    expect(passExtensionGrantVerdict({ detection: { kind: "missing" }, pin: { kind: "pin", record: PIN } })).toEqual({
      kind: "refused",
      reason: "this process names no Claude Code session or Codex thread, so it cannot be shown to be the chair",
    });
  });

  it("refuses a process naming two sessions, even when one is the chair", () => {
    expect(
      passExtensionGrantVerdict({
        detection: { kind: "ambiguous", sessions: [CHAIR, { host: "codex", id: SEAT.id }] },
        pin: { kind: "pin", record: PIN },
      }),
    ).toEqual({
      kind: "refused",
      reason: "this process names both a Claude Code session and a Codex thread, so which one is asking is unknown",
    });
  });
});
