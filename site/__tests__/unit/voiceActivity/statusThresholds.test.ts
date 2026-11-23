import { describe, expect, it } from "vitest";

import {
  HEARING_HOLD_MS,
  NO_ACTIVITY,
  SPEAKING_HOLD_MS,
  STALL_MS,
  UNANSWERED_FORGET_MS,
  UNANSWERED_MS,
  voiceStatusOf,
} from "../../../lib/voiceActivity";
import { delegated, play, quietAt } from "./harness";

describe("voiceStatusOf thresholds", () => {
  it("calls a silent reasoning turn working until STALL_MS with no event of its own, then stalled", () => {
    const activity = play({ script: [[0, delegated({ id: "d1" })]] });
    expect(quietAt({ activity, nowMs: 20_000 }).phase).toBe("working");
    expect(quietAt({ activity, nowMs: STALL_MS - 1 }).phase).toBe("working");
    expect(quietAt({ activity, nowMs: STALL_MS })).toEqual({
      detail: "reasoning · no update for 35s",
      headline: "no update",
      phase: "stalled",
      seconds: 35,
    });
  });

  it("times a tool from its own dispatch, not from unrelated events", () => {
    const activity = play({
      script: [
        [0, { callId: "c1", kind: "tool-started", name: "read_screen" }],
        [20_000, { kind: "spoke" }],
      ],
    });
    expect(quietAt({ activity, nowMs: 21_000 })).toEqual({
      detail: "running read_screen · 21s",
      headline: "checking",
      phase: "working",
      seconds: 21,
    });
  });

  it("calls the owner's turn still waiting only after UNANSWERED_MS of silence with nothing from the voice", () => {
    const activity = play({
      script: [
        [1_000, { kind: "spoke" }],
        [2_000, { kind: "heard" }],
      ],
    });
    expect(quietAt({ activity, nowMs: 2_000 + HEARING_HOLD_MS - 1 }).phase).toBe("hearing");
    expect(quietAt({ activity, nowMs: 2_000 + UNANSWERED_MS - 1 }).phase).toBe("listening");
    expect(quietAt({ activity, nowMs: 2_000 + UNANSWERED_MS })).toEqual({
      detail: "no answer since you spoke",
      headline: "still waiting",
      nudge: "ask",
      phase: "stalled",
      seconds: 12,
    });
    expect(quietAt({ activity, nowMs: 2_000 + UNANSWERED_FORGET_MS }).phase).toBe("listening");
  });

  it("does not call the owner's turn unanswered once the voice has spoken or delegated after it", () => {
    const spoke = play({
      script: [
        [2_000, { kind: "heard" }],
        [3_000, { kind: "spoke" }],
      ],
    });
    expect(quietAt({ activity: spoke, nowMs: 20_000 }).phase).toBe("listening");
    const working = play({
      script: [
        [2_000, { kind: "heard" }],
        [3_000, delegated({ id: "d1" })],
      ],
    });
    expect(quietAt({ activity: working, nowMs: 20_000 }).phase).toBe("working");
  });

  it("calls a tool in flight stalled, never the owner's turn still waiting", () => {
    const stalled = play({
      script: [
        [0, { kind: "heard" }],
        [100, { callId: "c1", kind: "tool-started", name: "x" }],
      ],
    });
    expect(quietAt({ activity: stalled, nowMs: STALL_MS + 100 }).headline).toBe("no update");
    // A nudge would stop the Codex turn the tool belongs to mid-write, hiding what it did.
    expect(quietAt({ activity: stalled, nowMs: STALL_MS + 100 }).nudge).toBe(undefined);
  });

  it("holds speaking for SPEAKING_HOLD_MS after the last spoken fragment", () => {
    const activity = play({ script: [[1_000, { kind: "spoke" }]] });
    expect(quietAt({ activity, nowMs: 1_000 + SPEAKING_HOLD_MS - 1 }).phase).toBe("speaking");
    expect(quietAt({ activity, nowMs: 1_000 + SPEAKING_HOLD_MS }).phase).toBe("listening");
  });

  it("hears the owner by their microphone before any transcript, unless muted", () => {
    const hot = {
      activity: NO_ACTIVITY,
      link: "live" as const,
      micLevel: 0.3,
      micRms: 0.042,
      nowMs: 0,
      outputLevel: 0,
    };
    expect(voiceStatusOf({ ...hot, muted: false }).phase).toBe("hearing");
    expect(voiceStatusOf({ ...hot, muted: true })).toEqual({
      detail: undefined,
      headline: "muted",
      phase: "listening",
      seconds: undefined,
    });
  });

  // A quiet room reads 0.346 on the spectral level and 0.003 RMS: the RMS is the speech evidence, so it is not a cue.
  // Repro, from the home: `grep -o 'held: the owner's microphone was loud (mic 0.346 rms 0.003' talk/calls/<call-id>-*.jsonl`
  it("reads a quiet room whose spectrum is loud as listening, not the owner", () => {
    const room = { activity: NO_ACTIVITY, link: "live" as const, micLevel: 0.346, micRms: 0.003, muted: false };
    expect(voiceStatusOf({ ...room, nowMs: 0, outputLevel: 0 })).toEqual({
      detail: undefined,
      headline: "listening",
      phase: "listening",
      seconds: undefined,
    });
  });

  it("maps a link that is not live straight through", () => {
    const base = { activity: NO_ACTIVITY, micLevel: 0, micRms: 0, muted: false, nowMs: 0, outputLevel: 1 };
    expect(voiceStatusOf({ ...base, link: "off" }).headline).toBe("talk");
    expect(voiceStatusOf({ ...base, link: "connecting" }).phase).toBe("connecting");
    expect(voiceStatusOf({ ...base, link: "failed" })).toEqual({
      detail: undefined,
      headline: "stopped",
      phase: "error",
      seconds: undefined,
    });
  });

  // Reconnecting changes the orb's colour and shape, so it is a phase of its own, never connecting.
  it("draws a call coming back as its own reconnecting phase, apart from a fresh connect", () => {
    const base = { activity: NO_ACTIVITY, micLevel: 0, micRms: 0, muted: false, nowMs: 0, outputLevel: 1 };
    expect(voiceStatusOf({ ...base, link: "reconnecting" })).toEqual({
      detail: undefined,
      headline: "reconnecting",
      nudge: undefined,
      phase: "reconnecting",
      seconds: undefined,
    });
    expect(voiceStatusOf({ ...base, link: "connecting" }).phase).toBe("connecting");
  });
});
