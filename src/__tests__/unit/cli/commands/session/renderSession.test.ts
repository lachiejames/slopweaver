/** `session list`'s human line: the row, then the plan the spawn recorded, when it recorded one. */
import { describe, expect, it } from "vitest";

import { redactedSessionItem, renderSession } from "../../../../../cli/commands/session/run.js";
import type { SessionPlanChoice } from "../../../../../sessions/planChoice.js";
import { foldSessions, type SessionEvent } from "../../../../../sessions/session.js";

const SPAWNED: SessionEvent = {
  branch: "s",
  cwd: "/w/s",
  kind: "spawned",
  sessionKey: "abc-1",
  surfaceRef: "surface:1",
  tsIso: "2026-11-05T10:00:00.000Z",
  workspaceRef: "workspace:9",
};

const CHOICE: SessionPlanChoice = {
  alias: "plan-two",
  basis: "requested",
  kind: "named",
  alternative: "--plan <alias> names another plan; omit --plan to route on live gauges",
  readings: [{ alias: "plan-two", reading: "all-models week 30%", state: "chosen" }],
  reason: "--plan named it; its own gauge allows it",
  vendor: "claude",
};

describe("renderSession", () => {
  it("prints a row with no recorded choice on one line, as before", () => {
    const [item] = foldSessions({ events: [SPAWNED] });
    expect(renderSession({ item: item! })).toBe("abc-1 — open  model=unrecorded  workspace:9");
  });

  it("prints the recorded choice indented under its row", () => {
    const [item] = foldSessions({ events: [{ ...SPAWNED, planChoice: CHOICE }] });
    expect(renderSession({ item: item! })).toBe(
      "abc-1 — open  model=unrecorded  workspace:9\n" +
        "    plan: plan-two (claude, requested) — --plan named it; its own gauge allows it; readings: plan-two chosen " +
        "(all-models week 30%); alternative: --plan <alias> names another plan; omit --plan to route on live gauges",
    );
  });
});

describe("redactedSessionItem", () => {
  const NOTE =
    "seated on some-slug at 2026-11-05T10:05:00.000Z, ts 1000000000.000001; asked someone@example.com from 203.0.113.7";
  const REDACTED_NOTE =
    "seated on some-slug at 2026-11-05T10:05:00.000Z, ts 1000000000.000001; asked [email] from [ip]";
  const NOTED: SessionEvent = { kind: "noted", note: NOTE, sessionKey: "abc-1", tsIso: "2026-11-05T10:05:00.000Z" };

  it("redacts the note's email and IP, leaving the slug, time, ts and every structural field whole", () => {
    const [item] = foldSessions({ events: [SPAWNED, NOTED] });
    expect(item!.latestNote).toBe(NOTE);
    expect(redactedSessionItem({ item: item! })).toEqual({ ...item!, latestNote: REDACTED_NOTE });
  });

  it("prints the redacted note on the plain row", () => {
    const [item] = foldSessions({ events: [SPAWNED, NOTED] });
    expect(renderSession({ item: redactedSessionItem({ item: item! }) })).toBe(
      `abc-1 — open  model=unrecorded  workspace:9  note: ${REDACTED_NOTE}`,
    );
  });

  it("carries the redacted note, and no address, into the --json document", () => {
    const [item] = foldSessions({ events: [SPAWNED, NOTED] });
    const line = JSON.stringify({ sessions: [redactedSessionItem({ item: item! })], unreadable: [] });
    expect(JSON.parse(line)).toEqual({ sessions: [{ ...item!, latestNote: REDACTED_NOTE }], unreadable: [] });
    expect(line).not.toContain("someone@example.com");
    expect(line).not.toContain("203.0.113.7");
  });

  it("leaves a session with no note without one", () => {
    const [item] = foldSessions({ events: [SPAWNED] });
    const redacted = redactedSessionItem({ item: item! });
    expect(redacted).toEqual(item!);
    expect("latestNote" in redacted).toBe(false);
  });
});
