/*
 * The reader for `slopweaver talk calls --json`, against the payload shape the verb prints: a dropped call's
 * partial line keeps `final: false`, which the page draws as "(cut off)", and an unreadable call takes the whole
 * reading down rather than being drawn without its lines.
 */

import { describe, expect, it } from "vitest";

import { readTalkCalls } from "../../components/live/readTalkCalls";

const CALL = "a0000041-0000-4000-8000-000000000044";

/** One call as the verb prints it. */
const DROPPED = {
  callId: CALL,
  end: "no end recorded — it dropped or the page went away; last heard 2026-09-25T02:31:00.000Z",
  ended: undefined,
  lastIso: "2026-09-25T02:31:00.000Z",
  notes: [
    { atIso: "2026-09-25T02:30:30.000Z", detail: "d", kind: "tool", name: "read_board", refused: false },
    {
      about: "",
      atIso: "2026-09-25T02:30:40.000Z",
      detail: "typed",
      heard: "h",
      kind: "relay",
      outcome: "relayed",
      say: "s",
      turnId: null,
    },
  ],
  openedIso: "2026-09-25T02:30:00.000Z",
  segments: [
    { atIso: "2026-09-25T02:30:10.000Z", final: true, id: "s-1", text: "merge conflicts are yours", who: "owner" },
    { atIso: "2026-09-25T02:31:00.000Z", final: false, id: "s-2", text: "and the markdown", who: "owner" },
  ],
  sessionId: "sess",
  skipped: 0,
  voice: "marin",
};

describe("readTalkCalls", () => {
  it("reads a dropped call with its partial line and its relay count", () => {
    const read = readTalkCalls({ calls: [DROPPED], observedAtIso: "2026-09-25T03:00:00.000Z", unreadable: [] })!;
    expect(read).toEqual({
      calls: [
        {
          callId: CALL,
          end: DROPPED.end,
          lines: [
            { final: true, id: "s-1", text: "merge conflicts are yours", who: "owner" },
            { final: false, id: "s-2", text: "and the markdown", who: "owner" },
          ],
          openedIso: "2026-09-25T02:30:00.000Z",
          relays: 1,
        },
      ],
      unreadable: [],
    });
  });

  it("carries the files the verb could not read", () => {
    const read = readTalkCalls({ calls: [], observedAtIso: "x", unreadable: ["a.jsonl: EACCES"] })!;
    expect(read.unreadable).toEqual(["a.jsonl: EACCES"]);
  });

  it("refuses the whole reading when one line has no speaker", () => {
    const torn = { ...DROPPED, segments: [{ final: true, id: "s-1", text: "t", who: "someone" }] };
    expect(readTalkCalls({ calls: [torn], unreadable: [] })).toBe(undefined);
  });

  it("refuses a payload with no calls list", () => {
    expect(readTalkCalls({ unreadable: [] })).toBe(undefined);
  });
});
