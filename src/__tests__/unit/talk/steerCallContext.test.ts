/*
 * What a typed steer's line says about the call it follows: a typed turn
 * after a call continues from what the owner said on it. Each case pins one thing the chair needs to treat the steer
 * as the next turn of that call: which call, how much of it is unread, and the owner's newest words on it.
 */
import { describe, expect, it } from "vitest";

import { steerCallContextOf } from "../../../talk/steerCallContext.js";
import type { UnreadSelection, UnreadWord } from "../../../talk/unreadWords.js";

const CALL_A = "a0000041-0000-4000-8000-000000000044";
const CALL_B = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

/** One unread stretch of the owner's, overridable. */
const word = (over: Partial<UnreadWord> = {}): UnreadWord => ({
  atIso: "2026-10-03T09:00:00.000Z",
  callId: CALL_A,
  cut: false,
  final: true,
  growingSinceRead: false,
  latestAtIso: "2026-10-03T09:00:00.000Z",
  nextRelay: undefined,
  pointer: `talk-call:${CALL_A}#s-1`,
  revisions: [],
  segmentId: "s-1",
  text: "meet at the cafe",
  ...over,
});

/** A selection holding the words given, oldest first. */
const selection = ({ words }: { words: readonly UnreadWord[] }): UnreadSelection => ({
  beforeFloor: 0,
  foreign: [],
  unparseable: [],
  words,
});

describe("steerCallContextOf", () => {
  it("is none when the chair has read every word the owner said", () => {
    expect(steerCallContextOf({ selection: selection({ words: [] }) })).toEqual({ kind: "none" });
  });

  it("is none when every unread stretch is blank", () => {
    expect(steerCallContextOf({ selection: selection({ words: [word({ text: "  " })] }) })).toEqual({ kind: "none" });
  });

  it("names the newest call, counts every unread stretch, and quotes the owner's newest two on that call", () => {
    const words = [
      word({ callId: CALL_B, text: "an older call" }),
      word({ text: "first" }),
      word({ text: "meet at the\n cafe" }),
      word({ text: "at 3pm" }),
    ];
    expect(steerCallContextOf({ selection: selection({ words }) })).toEqual({
      callId: CALL_A,
      kind: "unread",
      newest: ["meet at the cafe", "at 3pm"],
      stretches: 4,
    });
  });
});
