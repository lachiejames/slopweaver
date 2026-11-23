import { describe, expect, it } from "vitest";
import { foldSessions, parseSessionLog, type SessionEvent, sessionEventLine } from "../../../sessions/session.js";

/** Two open rows under one key that both recorded `workspace:9` — the shape a restart's re-issued ref leaves. */
const twoRowsOnOneRef: readonly SessionEvent[] = [
  {
    branch: "s",
    cwd: "/w/s",
    kind: "spawned",
    sessionKey: "s",
    slug: "s",
    surfaceRef: "surface:1",
    tsIso: "2026-11-05T10:00:00.000Z",
    workspaceRef: "workspace:9",
  },
  {
    branch: "s",
    cwd: "/w/s",
    kind: "spawned",
    sessionKey: "s",
    slug: "s",
    surfaceRef: "surface:2",
    tsIso: "2026-11-05T11:00:00.000Z",
    workspaceRef: "workspace:9",
  },
];

describe("a closed event naming the row's spawnedIso", () => {
  it("round-trips through the log", () => {
    const event: SessionEvent = {
      kind: "closed",
      sessionKey: "s",
      spawnedIso: "2026-11-05T11:00:00.000Z",
      tsIso: "t",
      workspaceRef: "workspace:9",
    };

    expect(parseSessionLog({ text: sessionEventLine({ event }) }).events).toEqual([event]);
  });

  it("closes only the row spawned at that instant, leaving a sibling on the same recorded ref open", () => {
    const items = foldSessions({
      events: [
        ...twoRowsOnOneRef,
        {
          kind: "closed",
          sessionKey: "s",
          spawnedIso: "2026-11-05T11:00:00.000Z",
          tsIso: "2026-11-05T12:00:00.000Z",
          workspaceRef: "workspace:9",
        },
      ],
    });

    expect(items.map((item) => [item.spawnedIso, item.status])).toEqual([
      ["2026-11-05T11:00:00.000Z", "closed"],
      ["2026-11-05T10:00:00.000Z", "open"],
    ]);
  });

  it("without a spawnedIso still closes every row on that recorded ref, the ref-only closers' behaviour", () => {
    const items = foldSessions({
      events: [
        ...twoRowsOnOneRef,
        { kind: "closed", sessionKey: "s", tsIso: "2026-11-05T12:00:00.000Z", workspaceRef: "workspace:9" },
      ],
    });

    expect(items.map((item) => item.status)).toEqual(["closed", "closed"]);
  });
});
