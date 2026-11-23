/*
 * What crosses when the voice's window asks the console window for the Queue on screen, and how main judges one
 * ask.
 */
import { describe, expect, it } from "vitest";

import {
  movedTwiceAnswer,
  parseVoiceQueueReply,
  VOICE_QUEUE_DEADLINE_MS,
  VOICE_QUEUE_WIRE_MAX_CHARS,
  voiceQueueOutcome,
} from "../../src/voiceQueueWire";

const snapshot = JSON.stringify({ path: "/queue" });

describe("parseVoiceQueueReply", () => {
  it("keeps a snapshot opaque, as the string the console window sent", () => {
    expect(parseVoiceQueueReply({ value: { id: "req-1", snapshot } })).toStrictEqual({ id: "req-1", snapshot });
  });

  it("reads a missing or null snapshot as none", () => {
    expect(parseVoiceQueueReply({ value: { id: "req-1", snapshot: null } })).toStrictEqual({
      id: "req-1",
      snapshot: null,
    });
    expect(parseVoiceQueueReply({ value: { id: "req-1" } })).toStrictEqual({ id: "req-1", snapshot: null });
  });

  it("carries a snapshot exactly at the bound and refuses one a unit past it", () => {
    const atBound = "x".repeat(VOICE_QUEUE_WIRE_MAX_CHARS);
    expect(parseVoiceQueueReply({ value: { id: "req-1", snapshot: atBound } })).toStrictEqual({
      id: "req-1",
      snapshot: atBound,
    });
    expect(parseVoiceQueueReply({ value: { id: "req-1", snapshot: `${atBound}x` } })).toBeUndefined();
  });

  it("refuses anything that is not exactly one reply", () => {
    expect(parseVoiceQueueReply({ value: "req-1" })).toBeUndefined();
    expect(parseVoiceQueueReply({ value: [] })).toBeUndefined();
    expect(parseVoiceQueueReply({ value: null })).toBeUndefined();
    expect(parseVoiceQueueReply({ value: { id: "", snapshot } })).toBeUndefined();
    expect(parseVoiceQueueReply({ value: { id: "x".repeat(65), snapshot } })).toBeUndefined();
    expect(parseVoiceQueueReply({ value: { id: "req-1", snapshot: 3 } })).toBeUndefined();
    expect(parseVoiceQueueReply({ value: { extra: true, id: "req-1", snapshot } })).toBeUndefined();
  });
});

describe("voiceQueueOutcome", () => {
  const reply = { id: "req-1", snapshot };

  it("serves a reply from the tab still in front", () => {
    expect(voiceQueueOutcome({ ask: { kind: "replied", reply, tabNow: "tab-a" }, askedTab: "tab-a" })).toStrictEqual({
      kind: "served",
      snapshot,
    });
  });

  it("asks again when the owner changed tab or the page navigated under the ask", () => {
    expect(voiceQueueOutcome({ ask: { kind: "replied", reply, tabNow: "tab-b" }, askedTab: "tab-a" })).toBe("retry");
    expect(voiceQueueOutcome({ ask: { kind: "navigated" }, askedTab: "tab-a" })).toBe("retry");
  });

  it("says why when nothing can be served, never an empty Queue", () => {
    expect(voiceQueueOutcome({ ask: { kind: "no-tab" }, askedTab: undefined })).toStrictEqual({
      kind: "unreached",
      why: "no console window is open to read the Queue from",
    });
    expect(voiceQueueOutcome({ ask: { kind: "deadline" }, askedTab: "tab-a" })).toStrictEqual({
      kind: "unreached",
      why: `the console window did not answer within ${String(VOICE_QUEUE_DEADLINE_MS)} ms`,
    });
    const none = { id: "req-1", snapshot: null };
    expect(voiceQueueOutcome({ ask: { kind: "replied", reply: none, tabNow: "tab-a" }, askedTab: "tab-a" })).toEqual({
      kind: "unreached",
      why: "the console window holds no Queue to hand over: its page was built before it could, or past the bound",
    });
    expect(movedTwiceAnswer()).toStrictEqual({
      kind: "unreached",
      why: "the console window changed page or tab twice while it was asked",
    });
  });
});
