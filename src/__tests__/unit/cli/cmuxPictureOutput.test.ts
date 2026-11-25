/*
 * What `cmux picture` prints: the session's header, its calls counted by kind with every empty kind left out, then
 * the calls in flight and the last ended, each named by its tool name or its kind. Nothing observed says so in words,
 * and dropped calls make the counts a stated floor.
 */
import { describe, expect, it } from "vitest";

import { pictureLines } from "../../../cli/commands/cmux/pictureOutput.js";
import type { AppSessionPicture } from "../../../sessionHarness/pictureWire.js";

const T0 = "2026-11-11T02:00:00.000Z";
const T1 = "2026-11-11T02:00:05.000Z";

const NONE = {
  delegate: 0,
  delete: 0,
  edit: 0,
  execute: 0,
  fetch: 0,
  move: 0,
  other: 0,
  read: 0,
  search: 0,
  switch_mode: 0,
  think: 0,
};

const QUIET: AppSessionPicture = {
  facts: { countsByKind: NONE, droppedActivityEvents: 0, inFlight: [], lastCompleted: [] },
  readAtIso: T1,
  session: { handle: "app:0b5e", sessionId: "0b5e", state: "idle", title: "abc-1", vendor: "claude" },
};

const HEADER = `app:0b5e · claude · idle · abc-1 · read ${T1}`;

describe("pictureLines", () => {
  it("says a session that called no tool has none observed", () => {
    expect(pictureLines({ picture: QUIET })).toEqual([HEADER, "tool activity: none observed in this app run"]);
  });

  it("counts the kinds called, lists each call by name or kind, and names an empty list in words", () => {
    const picture: AppSessionPicture = {
      ...QUIET,
      facts: {
        countsByKind: { ...NONE, execute: 2, other: 1 },
        droppedActivityEvents: 0,
        firstActivityAtIso: T0,
        inFlight: [
          {
            lastObservedAtIso: T1,
            name: "Bash",
            parentToolCallId: "toolu_1",
            startedAtIso: T0,
            status: "in_progress",
            toolCallId: "t2",
            toolKind: "execute",
          },
        ],
        lastActivityAtIso: T1,
        lastCompleted: [],
      },
    };
    expect(pictureLines({ picture })).toEqual([
      HEADER,
      "tool calls: 3 (execute 2, other 1)",
      `activity: first ${T0} · last ${T1}`,
      "in flight:",
      `  Bash (execute) · in_progress · started ${T0} · last seen ${T1} · under toolu_1`,
      "recent ended: none",
    ]);
  });

  it("names an unnamed call by its kind, and says the counts are a floor once a call was dropped", () => {
    const picture: AppSessionPicture = {
      ...QUIET,
      facts: {
        countsByKind: { ...NONE, read: 1 },
        droppedActivityEvents: 2,
        firstActivityAtIso: T0,
        inFlight: [],
        lastActivityAtIso: T1,
        lastCompleted: [
          { lastObservedAtIso: T1, startedAtIso: T0, status: "failed", toolCallId: "t1", toolKind: "read" },
        ],
      },
    };
    expect(pictureLines({ picture })).toEqual([
      HEADER,
      "tool calls: 1 (read 1)",
      `activity: first ${T0} · last ${T1}`,
      "counts are a floor: 2 new call(s) arrived while the in-flight list was full and were not stored",
      "in flight: none",
      "recent ended:",
      `  read · failed · started ${T0} · last seen ${T1}`,
    ]);
  });
});
