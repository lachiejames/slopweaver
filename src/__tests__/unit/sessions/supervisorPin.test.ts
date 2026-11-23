/**
 * The supervisor-pin record — parsing it, and the exact host-and-id scoping that keeps the depth guard inert for
 * every session that is not the pinned supervisor. Pure.
 */
import { describe, expect, it } from "vitest";

import {
  claudeHeldPin,
  isRegisteredSupervisor,
  parseSupervisorPin,
  type SupervisorPinRecord,
} from "../../../sessions/supervisorPin.js";

/** The Claude Code session the default record names. */
const SUPER = { host: "claude-code", id: "sess-super" } as const;

/** One record, overridable field by field. */
function record(over: Partial<SupervisorPinRecord> = {}): SupervisorPinRecord {
  return {
    pinnedAtIso: "2026-09-02T04:47:00.000Z",
    session: SUPER,
    workspaceId: "03A2AD7A",
    workspaceRef: "workspace:936",
    ...over,
  };
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
});

describe("claudeHeldPin", () => {
  it("keeps a pin a Claude session holds and refuses one a Codex thread holds", () => {
    expect(claudeHeldPin({ pin: record() })).toStrictEqual(record());
    expect(claudeHeldPin({ pin: record({ session: { host: "codex", id: "sess-super" } }) })).toBeUndefined();
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

  it("is inert when nothing is registered at all", () => {
    expect(isRegisteredSupervisor({ record: undefined, session: SUPER })).toBe(false);
  });

  it("never matches on a blank caller id", () => {
    const blank = { host: "claude-code", id: "" } as const;

    expect(isRegisteredSupervisor({ record: record({ session: blank }), session: blank })).toBe(false);
  });
});
