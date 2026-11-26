/**
 * What a Recovery press reads of the supervisor before it decides: live is what the host says, a successor already
 * running is starting, and a pin it cannot judge restarts nothing.
 */
import { describe, expect, it } from "vitest";

import { recoveryChairVerdictOf } from "../../../fleet/recoveryChairReading.js";
import type { AppSessionSnapshot } from "../../../sessionHarness/appProtocol.js";
import type { SupervisorPinDisposition } from "../../../sessions/supervisorPinStore.js";

const SESSION = { host: "claude-code", id: "11111111-1111-4111-8111-111111111111" } as const;

const APP_PIN: SupervisorPinDisposition = {
  kind: "pin",
  record: { appSessionId: "old-chair", pinnedAtIso: "2026-11-25T08:00:00.000Z", session: SESSION },
};

const CMUX_PIN: SupervisorPinDisposition = {
  kind: "pin",
  record: {
    pinnedAtIso: "2026-11-25T08:00:00.000Z",
    session: SESSION,
    workspaceId: "AAAA-BBBB",
    workspaceRef: "workspace:9",
  },
};

/** A session the app lists. */
function listed({
  sessionId,
  ledgerKey,
  state,
}: {
  sessionId: string;
  ledgerKey: string;
  state: AppSessionSnapshot["state"];
}): AppSessionSnapshot {
  return {
    directory: "/repo",
    handle: `app:${sessionId}`,
    ledgerKey,
    openedAtIso: "2026-11-25T08:00:00.000Z",
    sessionId,
    state,
    title: "Supervisor",
    vendor: "claude",
  };
}

describe("recoveryChairVerdictOf", () => {
  it("reads an app chair the app still runs as live, however quiet", () => {
    const sessions = [listed({ ledgerKey: "fresh-supervisor-handoff-9040", sessionId: "old-chair", state: "idle" })];
    expect(recoveryChairVerdictOf({ cmux: undefined, disposition: APP_PIN, sessions })).toEqual({
      kind: "live",
      label: "app:old-chair",
    });
  });

  it("reads an app chair the app ended as down, carrying the ended session", () => {
    const chair = listed({ ledgerKey: "fresh-supervisor-handoff-9040", sessionId: "old-chair", state: "closed" });
    expect(recoveryChairVerdictOf({ cmux: undefined, disposition: APP_PIN, sessions: [chair] })).toEqual({
      kind: "down",
      listed: chair,
      target: { appSessionId: "old-chair", kind: "app" },
      why: "the supervisor on app:old-chair was closed",
    });
  });

  it("reads an app chair the app no longer lists as down", () => {
    expect(recoveryChairVerdictOf({ cmux: undefined, disposition: APP_PIN, sessions: [] })).toEqual({
      kind: "down",
      target: { appSessionId: "old-chair", kind: "app" },
      why: "the desktop app no longer runs the supervisor on app:old-chair",
    });
  });

  it("reads a running successor beside a down chair as starting, and an ended one as nothing", () => {
    const sessions = [
      listed({ ledgerKey: "fresh-supervisor-handoff-9041", sessionId: "gone", state: "failed" }),
      listed({ ledgerKey: "seat:other-work", sessionId: "seat", state: "running" }),
      listed({ ledgerKey: "fresh-supervisor-handoff-9042", sessionId: "new-chair", state: "running" }),
    ];
    expect(recoveryChairVerdictOf({ cmux: undefined, disposition: { kind: "absent" }, sessions })).toEqual({
      kind: "booting",
      label: "app:new-chair",
      slug: "fresh-supervisor-handoff-9042",
    });
    expect(recoveryChairVerdictOf({ cmux: undefined, disposition: { kind: "absent" }, sessions: [] })).toEqual({
      kind: "down",
      why: "no supervisor is pinned",
    });
  });

  it("reads a cmux chair by cmux's strict inventory, and restarts nothing it cannot confirm", () => {
    expect(recoveryChairVerdictOf({ cmux: { kind: "listed" }, disposition: CMUX_PIN, sessions: [] })).toEqual({
      kind: "live",
      label: "workspace:9",
    });
    expect(recoveryChairVerdictOf({ cmux: { kind: "absent" }, disposition: CMUX_PIN, sessions: [] })).toEqual({
      kind: "down",
      target: { kind: "cmux", workspaceId: "AAAA-BBBB", workspaceRef: "workspace:9" },
      why: "cmux no longer lists the supervisor's workspace workspace:9",
    });
    const denied = { kind: "unreadable", why: "access denied" } as const;
    expect(recoveryChairVerdictOf({ cmux: denied, disposition: CMUX_PIN, sessions: [] })).toEqual({
      kind: "unknown",
      why: "cmux could not confirm whether the supervisor's workspace workspace:9 still runs: access denied",
    });
    expect(recoveryChairVerdictOf({ cmux: undefined, disposition: CMUX_PIN, sessions: [] })).toEqual({
      kind: "unknown",
      why: "cmux was not asked whether the supervisor's workspace workspace:9 still runs",
    });
  });

  it("restarts nothing over a pin record it cannot read", () => {
    const disposition: SupervisorPinDisposition = { kind: "unreadable", why: "it holds both shapes" };
    expect(recoveryChairVerdictOf({ cmux: undefined, disposition, sessions: [] })).toEqual({
      kind: "unknown",
      why: "the supervisor pin record could not be read: it holds both shapes",
    });
  });
});
