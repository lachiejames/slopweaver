/*
 * Every orb cue leaves one line on the call file saying what became of it, and only a played cue reads as not refused, so a silent
 * call always has a record of which rule held its work sound. A cue held or dropped for somebody talking names which
 * signal said so and both levels it read, so twenty "somebody was talking" lines over stretches nobody's words were
 * in are visible.
 */
import { describe, expect, it } from "vitest";

import { cueTraceLine } from "../../lib/cueTrace";
import type { Talking } from "../../lib/voiceTalking";

/**
 * A hissy microphone over a silent voice, as a trace recorded it before `HEARING_RMS` joined the gate: the line only
 * formats what it is handed, so this quiet room still renders though `talkingOf` no longer names it.
 */
const HISS: Talking = {
  micLevel: 0.2874,
  micRms: 0.0031,
  muted: false,
  outputLevel: 0,
  outputRms: 0,
  signal: "mic-level",
};

describe("cueTraceLine", () => {
  it("writes a played cue as the one outcome that is not refused", () => {
    const line = cueTraceLine({
      cue: "looking",
      outcome: { kind: "played" },
      source: "badge",
      stale: undefined,
      talking: undefined,
    });
    expect(line).toEqual({ detail: "looking (badge) played", refused: false });
  });

  it("names the still-due check a dropped cue failed, and where in routing it was dropped", () => {
    const line = cueTraceLine({
      cue: "working",
      outcome: { at: "after-routing", kind: "stale" },
      source: "progress",
      stale: "work-ended",
      talking: undefined,
    });
    expect(line).toEqual({ detail: "working (progress) dropped after routing: the work had ended", refused: true });
  });

  it("names which signal held a badge over speech, with both levels and their RMS to three places", () => {
    const line = cueTraceLine({
      cue: "working",
      outcome: { cue: "working", kind: "held" },
      source: "badge",
      stale: undefined,
      talking: HISS,
    });
    expect(line).toEqual({
      detail: "working (badge) held: the owner's microphone was loud (mic 0.287 rms 0.003, output 0.000 rms 0.000)",
      refused: true,
    });
  });

  it("words every talking signal apart, and says when the owner's microphone was muted", () => {
    const held = (talking: Talking): string =>
      cueTraceLine({ cue: "code", outcome: { cue: "code", kind: "held" }, source: "badge", stale: undefined, talking })
        .detail;
    const levels = { micLevel: 0.05, micRms: 0.01, muted: true, outputLevel: 0.5, outputRms: 0.125 };
    expect([
      held({ ...levels, signal: "yielded" }),
      held({ ...levels, signal: "output-level" }),
      held({ ...levels, signal: "spoke-hold" }),
      held({ ...levels, signal: "mic-level" }),
      held({ ...levels, signal: "heard-hold" }),
    ]).toEqual([
      "code (badge) held: the voice had just stopped for the owner (mic 0.050 rms 0.010, output 0.500 rms 0.125, muted)",
      "code (badge) held: the voice's output was loud (mic 0.050 rms 0.010, output 0.500 rms 0.125, muted)",
      "code (badge) held: the voice spoke moments ago (mic 0.050 rms 0.010, output 0.500 rms 0.125, muted)",
      "code (badge) held: the owner's microphone was loud (mic 0.050 rms 0.010, output 0.500 rms 0.125, muted)",
      "code (badge) held: the owner was transcribed moments ago (mic 0.050 rms 0.010, output 0.500 rms 0.125, muted)",
    ]);
  });

  it("keeps the old words for a held badge with no signal named, since the phase can outlive a reset by a sample", () => {
    const line = cueTraceLine({
      cue: "looking",
      outcome: { cue: "looking", kind: "held" },
      source: "badge",
      stale: undefined,
      talking: undefined,
    });
    expect(line.detail).toBe("looking (badge) held: somebody was talking, or no call was up");
  });

  it("names the talking signal for a cue dropped or faded because somebody started talking", () => {
    const dropped = cueTraceLine({
      cue: "working",
      outcome: { at: "before-routing", kind: "stale" },
      source: "progress",
      stale: "not-quiet",
      talking: HISS,
    });
    const faded = cueTraceLine({
      cue: "browsing",
      outcome: { kind: "faded" },
      source: "badge",
      stale: "not-quiet",
      talking: undefined,
    });
    expect([dropped.detail, faded.detail]).toEqual([
      "working (progress) dropped before routing: the owner's microphone was loud (mic 0.287 rms 0.003, output 0.000 rms 0.000)",
      "browsing (badge) faded mid-note: somebody was talking, or no call was up",
    ]);
  });

  it("says which throttle silenced a badge, whoever was talking", () => {
    const gap = cueTraceLine({
      cue: "slack",
      outcome: { cue: "slack", kind: "throttled", why: "gap" },
      source: "badge",
      stale: undefined,
      talking: HISS,
    });
    const repeat = cueTraceLine({
      cue: "code",
      outcome: { cue: "code", kind: "throttled", why: "repeat" },
      source: "badge",
      stale: undefined,
      talking: undefined,
    });
    expect([gap.detail, repeat.detail]).toEqual([
      "slack (badge) silent: another cue had just played",
      "code (badge) silent: the same cue had just played",
    ]);
  });

  it("blames the speaker when a cue went stale with no check named, since only the latch saw the change", () => {
    const line = cueTraceLine({
      cue: "looking",
      outcome: { kind: "faded" },
      source: "sample",
      stale: undefined,
      talking: HISS,
    });
    expect(line.detail).toBe("looking (sample) faded mid-note: the speaker changed, or none was known");
  });

  it("traces a herald under its own source, and names the two checks one can fail", () => {
    const played = cueTraceLine({
      cue: "focus",
      outcome: { kind: "played" },
      source: "announce",
      stale: undefined,
      talking: undefined,
    });
    const ended = cueTraceLine({
      cue: "reminder",
      outcome: { at: "before-routing", kind: "stale" },
      source: "announce",
      stale: "no-call",
      talking: undefined,
    });
    const muted = cueTraceLine({
      cue: "attention",
      outcome: { at: "after-routing", kind: "stale" },
      source: "announce",
      stale: "sound-off",
      talking: undefined,
    });
    expect([played, ended.detail, muted.detail]).toEqual([
      { detail: "focus (announce) played", refused: false },
      "reminder (announce) dropped before routing: the call was no longer up",
      "attention (announce) dropped after routing: the owner's sounds were off",
    ]);
  });

  it("carries the browser's own message for a refused route or resume, and names an unroutable speaker", () => {
    const refused = cueTraceLine({
      cue: "stalled",
      outcome: { kind: "refused", why: "NotFoundError: device gone" },
      source: "badge",
      stale: undefined,
      talking: undefined,
    });
    const unroutable = cueTraceLine({
      cue: "stalled",
      outcome: { kind: "unroutable" },
      source: "badge",
      stale: undefined,
      talking: undefined,
    });
    expect([refused.detail, unroutable.detail]).toEqual([
      "stalled (badge) dropped: the browser refused it (NotFoundError: device gone)",
      "stalled (badge) dropped: the voice's speaker cannot be routed to from this page",
    ]);
  });
});
