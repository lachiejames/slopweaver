/**
 * The supervisor-pin record — parsing it, and the exact host-and-id scoping that keeps the depth guard inert for
 * every session that is not the pinned supervisor. Pure.
 */
import { describe, expect, it } from "vitest";

import {
  type AppSupervisorPinRecord,
  appHeldPin,
  type CmuxSupervisorPinRecord,
  claudeCmuxHeldPin,
  cmuxHeldPin,
  isRegisteredSupervisor,
  parseSupervisorPin,
  sessionsNamedByPinText,
  supervisorPinLabel,
  supervisorPinTarget,
} from "../../../sessions/supervisorPin.js";

/** The Claude Code session the default record names. */
const SUPER = { host: "claude-code", id: "sess-super" } as const;

/** The desktop control plane's id for the hosted session the default app record names. */
const APP_ID = "5f0c2a1e-7d3b-4c8e-9a6f-1b2c3d4e5f60";

/** One cmux record, overridable field by field. */
function record(over: Partial<CmuxSupervisorPinRecord> = {}): CmuxSupervisorPinRecord {
  return {
    pinnedAtIso: "2026-09-02T04:47:00.000Z",
    session: SUPER,
    workspaceId: "03A2AD7A",
    workspaceRef: "workspace:936",
    ...over,
  };
}

/** One app record, overridable field by field. */
function appRecord(over: Partial<AppSupervisorPinRecord> = {}): AppSupervisorPinRecord {
  return { appSessionId: APP_ID, pinnedAtIso: "2026-09-02T04:47:00.000Z", session: SUPER, ...over };
}

/** The record as a pin written before the chair could be Codex: `claudeSessionId`, no `session`. */
function legacyText({ claudeSessionId }: { claudeSessionId: string }): string {
  const { pinnedAtIso, workspaceId, workspaceRef } = record();
  return JSON.stringify({ claudeSessionId, pinnedAtIso, workspaceId, workspaceRef });
}

describe("parseSupervisorPin", () => {
  it("round-trips a record, a Codex holder included", () => {
    const codex = record({ session: { host: "codex", id: "thread-1" } });

    expect(parseSupervisorPin({ text: JSON.stringify(record()) })).toStrictEqual(record());
    expect(parseSupervisorPin({ text: JSON.stringify(codex) })).toStrictEqual(codex);
  });

  it("round-trips a Codex holder's recorded home, and refuses one on a Claude holder or a relative one", () => {
    const codex = record({ codexHome: "/h/.codex", session: { host: "codex", id: "thread-1" } });
    const onClaude = JSON.stringify(record({ codexHome: "/h/.codex" }));
    const relative = JSON.stringify(record({ codexHome: ".codex", session: { host: "codex", id: "thread-1" } }));
    const blank = JSON.stringify(record({ codexHome: " ", session: { host: "codex", id: "thread-1" } }));

    expect(parseSupervisorPin({ text: JSON.stringify(codex) })).toStrictEqual(codex);
    expect([onClaude, relative, blank].map((text) => parseSupervisorPin({ text }))).toStrictEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("reads a legacy `claudeSessionId` record as the Claude session it always named", () => {
    expect(parseSupervisorPin({ text: legacyText({ claudeSessionId: "sess-super" }) })).toStrictEqual(record());
  });

  it("refuses a record carrying BOTH shapes rather than picking one", () => {
    const both = JSON.stringify({ ...record(), claudeSessionId: "sess-other" });

    expect(parseSupervisorPin({ text: both })).toBeUndefined();
  });

  it("refuses text that is not JSON", () => {
    expect(parseSupervisorPin({ text: "" })).toBeUndefined();
  });

  it("refuses a JSON array", () => {
    expect(parseSupervisorPin({ text: "[]" })).toBeUndefined();
  });

  it("refuses a record with no session rather than repairing it", () => {
    const { session, ...rest } = record();
    expect(session).toStrictEqual(SUPER);
    expect(parseSupervisorPin({ text: JSON.stringify(rest) })).toBeUndefined();
  });

  it("refuses a blank session id, in either shape", () => {
    const blank = record({ session: { host: "claude-code", id: "  " } });

    expect(parseSupervisorPin({ text: JSON.stringify(blank) })).toBeUndefined();
    expect(parseSupervisorPin({ text: legacyText({ claudeSessionId: "  " }) })).toBeUndefined();
  });

  it("refuses a blank workspace id, the key a pin move forgets the record by", () => {
    expect(parseSupervisorPin({ text: JSON.stringify(record({ workspaceId: "" })) })).toBeUndefined();
  });

  it("refuses a partial cmux arm, either workspace field missing", () => {
    const { workspaceRef, ...noRef } = record();
    const { workspaceId, ...noId } = record();
    expect([workspaceRef, workspaceId]).toStrictEqual(["workspace:936", "03A2AD7A"]);

    expect(parseSupervisorPin({ text: JSON.stringify(noRef) })).toBeUndefined();
    expect(parseSupervisorPin({ text: JSON.stringify(noId) })).toBeUndefined();
  });

  it("round-trips an app record, a Claude holder and a Codex holder", () => {
    const codex = appRecord({ session: { host: "codex", id: "thread-1" } });

    expect(parseSupervisorPin({ text: JSON.stringify(appRecord()) })).toStrictEqual(appRecord());
    expect(parseSupervisorPin({ text: JSON.stringify(codex) })).toStrictEqual(codex);
  });

  it("refuses a blank or path-shaped app session id", () => {
    expect(parseSupervisorPin({ text: JSON.stringify(appRecord({ appSessionId: "" })) })).toBeUndefined();
    expect(parseSupervisorPin({ text: JSON.stringify(appRecord({ appSessionId: "  " })) })).toBeUndefined();
    expect(parseSupervisorPin({ text: JSON.stringify(appRecord({ appSessionId: "../x" })) })).toBeUndefined();
  });

  it("refuses an app session id beside either or both workspace fields rather than choosing an arm", () => {
    const withId = { ...appRecord(), workspaceId: "03A2AD7A" };
    const withRef = { ...appRecord(), workspaceRef: "workspace:936" };
    const withBoth = { ...appRecord(), workspaceId: "03A2AD7A", workspaceRef: "workspace:936" };

    expect(parseSupervisorPin({ text: JSON.stringify(withId) })).toBeUndefined();
    expect(parseSupervisorPin({ text: JSON.stringify(withRef) })).toBeUndefined();
    expect(parseSupervisorPin({ text: JSON.stringify(withBoth) })).toBeUndefined();
  });

  it("refuses an app arm naming its holder by the legacy `claudeSessionId`", () => {
    const { session, ...rest } = appRecord();
    expect(session).toStrictEqual(SUPER);

    expect(parseSupervisorPin({ text: JSON.stringify({ ...rest, claudeSessionId: "sess-super" }) })).toBeUndefined();
  });

  it("refuses an app arm with no session or no instant", () => {
    const { session, ...noSession } = appRecord();
    const { pinnedAtIso, ...noInstant } = appRecord();
    expect([session, pinnedAtIso]).toStrictEqual([SUPER, "2026-09-02T04:47:00.000Z"]);

    expect(parseSupervisorPin({ text: JSON.stringify(noSession) })).toBeUndefined();
    expect(parseSupervisorPin({ text: JSON.stringify(noInstant) })).toBeUndefined();
  });
});

describe("sessionsNamedByPinText", () => {
  const CODEX = { host: "codex", id: "thread-1" } as const;

  it("names both sessions of a record carrying both shapes, in the record's own key order", () => {
    expect(sessionsNamedByPinText({ text: JSON.stringify({ claudeSessionId: SUPER.id, session: CODEX }) })).toEqual([
      SUPER,
      CODEX,
    ]);
    expect(sessionsNamedByPinText({ text: JSON.stringify({ session: CODEX, claudeSessionId: SUPER.id }) })).toEqual([
      CODEX,
      SUPER,
    ]);
  });

  it("names a session once when both shapes carry the same Claude session", () => {
    expect(sessionsNamedByPinText({ text: JSON.stringify({ claudeSessionId: SUPER.id, session: SUPER }) })).toEqual([
      SUPER,
    ]);
  });

  it("leaves out a malformed identity beside a well-formed one", () => {
    const text = JSON.stringify({ claudeSessionId: "../escape", session: CODEX });
    expect(sessionsNamedByPinText({ text })).toEqual([CODEX]);
  });

  it("names nobody for text that is not one JSON object, or an object naming no session", () => {
    expect(sessionsNamedByPinText({ text: "not json" })).toEqual([]);
    expect(sessionsNamedByPinText({ text: JSON.stringify([{ session: CODEX }]) })).toEqual([]);
    expect(sessionsNamedByPinText({ text: JSON.stringify({ workspaceId: "03A2AD7A" }) })).toEqual([]);
  });
});

describe("supervisorPinTarget and supervisorPinLabel", () => {
  it("names the cmux workspace for a cmux pin", () => {
    expect(supervisorPinTarget({ pin: record() })).toStrictEqual({
      kind: "cmux",
      workspaceId: "03A2AD7A",
      workspaceRef: "workspace:936",
    });
    expect(supervisorPinLabel({ pin: record() })).toBe("workspace:936");
  });

  it("names the app session for an app pin, its label the harness handle", () => {
    expect(supervisorPinTarget({ pin: appRecord() })).toStrictEqual({ appSessionId: APP_ID, kind: "app" });
    expect(supervisorPinLabel({ pin: appRecord() })).toBe(`app:${APP_ID}`);
  });
});

describe("cmuxHeldPin, appHeldPin and claudeCmuxHeldPin", () => {
  it("narrows each arm to itself and never to the other", () => {
    expect(cmuxHeldPin({ pin: record() })).toStrictEqual(record());
    expect(cmuxHeldPin({ pin: appRecord() })).toBeUndefined();
    expect(appHeldPin({ pin: appRecord() })).toStrictEqual(appRecord());
    expect(appHeldPin({ pin: record() })).toBeUndefined();
  });

  it("keeps a cmux pin a Claude session holds and refuses a Codex holder or an app-hosted Claude", () => {
    expect(claudeCmuxHeldPin({ pin: record() })).toStrictEqual(record());
    expect(claudeCmuxHeldPin({ pin: record({ session: { host: "codex", id: "sess-super" } }) })).toBeUndefined();
    expect(claudeCmuxHeldPin({ pin: appRecord() })).toBeUndefined();
  });
});

describe("isRegisteredSupervisor", () => {
  it("matches the exact recorded session", () => {
    expect(isRegisteredSupervisor({ record: record(), session: SUPER })).toBe(true);
  });

  it("does not match a different session, nor the same id under the other host", () => {
    expect(isRegisteredSupervisor({ record: record(), session: { host: "claude-code", id: "sess-worker" } })).toBe(
      false,
    );
    expect(isRegisteredSupervisor({ record: record(), session: { host: "codex", id: "sess-super" } })).toBe(false);
  });

  it("matches on host and id alone across both arms, location never part of it", () => {
    expect(isRegisteredSupervisor({ record: appRecord(), session: SUPER })).toBe(true);
    expect(isRegisteredSupervisor({ record: appRecord(), session: { host: "codex", id: "sess-super" } })).toBe(false);
  });

  it("is inert when nothing is registered at all", () => {
    expect(isRegisteredSupervisor({ record: undefined, session: SUPER })).toBe(false);
  });

  it("never matches on a blank caller id", () => {
    const blank = { host: "claude-code", id: "" } as const;

    expect(isRegisteredSupervisor({ record: record({ session: blank }), session: blank })).toBe(false);
  });
});
