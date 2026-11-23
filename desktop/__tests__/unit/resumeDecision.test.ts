/**
 * A call ended for an update, decided each time the shell looks: hand the start over, look again, or clear the flag.
 * The flag survives every look that could not hand the start to a listening voice page — clearing it first is what
 * leaves the call ended.
 */
import { describe, expect, it } from "vitest";

import { RESUME_WITHIN_MS, resumeDecision, resumeLogDecision } from "../../src/updatePlan";

const SINCE = "2026-11-01T05:32:32.000Z";
const SINCE_MS = Date.parse(SINCE);
const RESUME = { sinceIso: SINCE };

/** A look five seconds after the call ended: no hang-up pending, no call up, a voice page listening. */
const CLEAR_LOOK = {
  callLive: false,
  hangingUp: false,
  nowMs: SINCE_MS + 5000,
  overlayListening: true,
  resume: RESUME,
};

describe("resumeDecision", () => {
  it("hands the start over once a voice page listens and no call is up", () => {
    expect(resumeDecision(CLEAR_LOOK)).toEqual({ kind: "hand" });
  });

  it("keeps the flag and looks again while no voice page listens — the reload's page, or a boot's", () => {
    expect(resumeDecision({ ...CLEAR_LOOK, overlayListening: false })).toEqual({
      kind: "retry",
      reason: "overlay-not-listening",
    });
  });

  it("clears on a call already up, your own press included, so your hang-up never starts another", () => {
    expect(resumeDecision({ ...CLEAR_LOOK, callLive: true })).toEqual({ kind: "clear", reason: "call-live" });
    expect(resumeDecision({ ...CLEAR_LOOK, callLive: true, overlayListening: false })).toEqual({
      kind: "clear",
      reason: "call-live",
    });
  });

  // A reload landing while the shell still waits on its own hang-up must not read the call being ended as one
  // already up, or it clears the flag and the reload then ends that call with nothing left owed.
  it("keeps the flag while its own hang-up is under way, the call being ended still reading live", () => {
    expect(resumeDecision({ ...CLEAR_LOOK, callLive: true, hangingUp: true })).toEqual({
      kind: "retry",
      reason: "hanging-up",
    });
  });

  it("hands over at the window's edge and clears one millisecond past it, ahead of every other reason", () => {
    expect(resumeDecision({ ...CLEAR_LOOK, nowMs: SINCE_MS + RESUME_WITHIN_MS })).toEqual({ kind: "hand" });
    expect(
      resumeDecision({
        ...CLEAR_LOOK,
        callLive: true,
        hangingUp: true,
        nowMs: SINCE_MS + RESUME_WITHIN_MS + 1,
        overlayListening: false,
      }),
    ).toEqual({ kind: "clear", reason: "expired" });
  });

  it("still hands over after the clock moved back within the window", () => {
    expect(resumeDecision({ ...CLEAR_LOOK, nowMs: SINCE_MS - 1000 })).toEqual({ kind: "hand" });
  });

  it("clears a flag whose instant does not parse", () => {
    expect(resumeDecision({ ...CLEAR_LOOK, resume: { sinceIso: "not a date" } })).toEqual({
      kind: "clear",
      reason: "expired",
    });
  });
});

describe("resumeLogDecision", () => {
  it("names every decision the way the event log and the e2e parser read it", () => {
    expect(
      [
        { kind: "hand" } as const,
        { kind: "retry", reason: "hanging-up" } as const,
        { kind: "retry", reason: "overlay-not-listening" } as const,
        { kind: "clear", reason: "expired" } as const,
        { kind: "clear", reason: "call-live" } as const,
      ].map((decision) => resumeLogDecision({ decision })),
    ).toEqual(["handed", "retry-hanging-up", "retry-overlay-not-listening", "expired", "call-live"]);
  });
});
