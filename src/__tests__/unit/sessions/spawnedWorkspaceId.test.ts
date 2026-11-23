/**
 * A `spawned` event's `workspaceId` — the cmux UUID that survives a restart a ref does not, and what `handover
 * reconcile` binds a seat to its row by — round-trips the log and reaches the folded row; a row written before the
 * field existed still reads, and a mistyped one is refused like any other malformed field.
 */
import { describe, expect, it } from "vitest";
import { foldSessions, parseSessionLog, type SessionEvent, sessionEventLine } from "../../../sessions/session.js";

const spawned: SessionEvent = {
  branch: "feat/some-branch",
  cwd: "/w/feat-some-branch",
  kind: "spawned",
  sessionKey: "fix-the-join",
  slug: "fix-the-join",
  surfaceRef: "surface:1",
  tsIso: "2026-11-05T10:00:00.000Z",
  workspaceId: "6F0C-SEAT",
  workspaceRef: "workspace:9",
};

describe("a spawned event's workspaceId", () => {
  it("round-trips through the log", () => {
    expect(parseSessionLog({ text: sessionEventLine({ event: spawned }) }).events).toEqual([spawned]);
  });

  it("reaches the folded row", () => {
    expect(foldSessions({ events: [spawned] }).map((item) => [item.slug, item.workspaceId])).toEqual([
      ["fix-the-join", "6F0C-SEAT"],
    ]);
  });

  it("is absent, not invented, on a row written before the field existed", () => {
    const { workspaceId: _dropped, ...legacy } = spawned;
    const parsed = parseSessionLog({ text: sessionEventLine({ event: legacy }) });
    expect(parsed.events).toEqual([legacy]);
    expect(foldSessions({ events: parsed.events }).map((item) => item.workspaceId)).toEqual([undefined]);
  });

  it("refuses a line whose workspaceId is not a string", () => {
    const line = sessionEventLine({ event: spawned }).replace('"6F0C-SEAT"', "42");
    const parsed = parseSessionLog({ text: line });
    expect([parsed.events.length, parsed.unreadable.length]).toEqual([0, 1]);
  });
});
