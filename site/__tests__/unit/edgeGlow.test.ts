/*
 * The window's edge: steady while the owner's screen is shared, one pulse per frame taken, a glow while the voice speaks.
 */
import { describe, expect, it } from "vitest";

import { edgeGlowOf, framePulseKey, framePulsesOn, frameTakenOf, pulseMove } from "../../lib/edgeGlow";
import type { HeardSegment } from "../../lib/voiceTranscript";

const ASKED: HeardSegment = { final: true, id: "h1", text: "look at my screen", who: "owner" };
const SPOKE_AGAIN: HeardSegment = { final: false, id: "h2", text: "and now", who: "owner" };

describe("edgeGlowOf", () => {
  const on = { callActive: true };

  it("glows steady while shared, and with the voice while it speaks, through every call", () => {
    expect(edgeGlowOf({ ...on, phase: "listening", sharing: true })).toBe("shared");
    expect(edgeGlowOf({ ...on, phase: "speaking", sharing: false })).toBe("speaking");
    expect(edgeGlowOf({ ...on, phase: "speaking", sharing: true })).toBe("shared-speaking");
  });

  it("stays dark with nothing shared and nothing said", () => {
    expect(edgeGlowOf({ ...on, phase: "working", sharing: false })).toBe("off");
  });

  it("stays dark with no call up, even with a share left open and the voice's phase speaking", () => {
    expect(edgeGlowOf({ callActive: false, phase: "off", sharing: true })).toBe("off");
    expect(edgeGlowOf({ callActive: false, phase: "speaking", sharing: true })).toBe("off");
  });
});

describe("framePulsesOn", () => {
  const on = { callActive: true };

  it("lets a frame flash while a share draws its steady border, in either sight", () => {
    expect(framePulsesOn({ ...on, sight: "share", state: "shared" })).toBe(true);
    expect(framePulsesOn({ ...on, sight: "native", state: "shared-speaking" })).toBe(true);
  });

  it("lets the desktop app's own look flash with no share and so no steady border", () => {
    expect(framePulsesOn({ ...on, sight: "native", state: "off" })).toBe(true);
    expect(framePulsesOn({ ...on, sight: "native", state: "speaking" })).toBe(true);
  });

  it("never flashes in the browser without a share, nor in the app with no call up", () => {
    expect(framePulsesOn({ ...on, sight: "share", state: "speaking" })).toBe(false);
    expect(framePulsesOn({ callActive: false, sight: "native", state: "off" })).toBe(false);
  });
});

describe("frameTakenOf and framePulseKey", () => {
  it("pulses once per frame taken, keyed by the look that took it", () => {
    const frame = frameTakenOf({ segments: [ASKED], token: "a" });
    expect(frame).toEqual({ after: "h1", token: "a" });
    expect(framePulseKey({ frame, segments: [ASKED] })).toBe("a");
  });

  it("still pulses for a frame the owner talked over while the look ran, since it was taken after they spoke", () => {
    // The owner says "and now" while the still is being encoded; the frame lands after that stretch began.
    const frame = frameTakenOf({ segments: [ASKED, SPOKE_AGAIN], token: "a" });
    expect(framePulseKey({ frame, segments: [ASKED, SPOKE_AGAIN] })).toBe("a");
  });

  it("names no key once the owner has spoken after the frame, so a stale frame can never pulse again", () => {
    const frame = frameTakenOf({ segments: [ASKED], token: "a" });
    expect(framePulseKey({ frame, segments: [ASKED, SPOKE_AGAIN] })).toBeUndefined();
  });

  it("does not pulse before any frame is taken — a refused look records none", () => {
    expect(framePulseKey({ frame: undefined, segments: [ASKED] })).toBeUndefined();
  });

  it("keys a frame taken before the owner has said anything to that silence", () => {
    const frame = frameTakenOf({ segments: [], token: "z" });
    expect(frame).toEqual({ after: undefined, token: "z" });
    expect(framePulseKey({ frame, segments: [] })).toBe("z");
    expect(framePulseKey({ frame, segments: [ASKED] })).toBeUndefined();
  });
});

describe("pulseMove", () => {
  it("draws a fresh key while it may flash, and keeps drawing it through its own flash", () => {
    expect(pulseMove({ flashing: undefined, pulse: "t1", pulses: true, spent: undefined })).toEqual({
      draw: true,
      dropFlashing: false,
      spendUnseen: false,
    });
    expect(pulseMove({ flashing: "t1", pulse: "t1", pulses: true, spent: "t1" }).draw).toBe(true);
  });

  it("never draws a key once its flash has ended", () => {
    expect(pulseMove({ flashing: undefined, pulse: "t1", pulses: true, spent: "t1" }).draw).toBe(false);
  });

  it("drops a flash cut short when the edge goes dark or the share closes, so it is not drawn again", () => {
    // t1 starts flashing, the edge goes dark mid-flash, then lights again with nothing new said.
    const cut = pulseMove({ flashing: "t1", pulse: "t1", pulses: false, spent: "t1" });
    expect(cut).toEqual({ draw: false, dropFlashing: true, spendUnseen: false });
    expect(pulseMove({ flashing: undefined, pulse: "t1", pulses: true, spent: "t1" }).draw).toBe(false);
    const shareClosed = pulseMove({ flashing: "t1", pulse: undefined, pulses: false, spent: "t1" });
    expect(shareClosed.dropFlashing).toBe(true);
  });

  it("spends unseen a key that arrives while the edge is dark, so turning it on never shows that frame late", () => {
    expect(pulseMove({ flashing: undefined, pulse: "t2", pulses: false, spent: "t1" })).toEqual({
      draw: false,
      dropFlashing: false,
      spendUnseen: true,
    });
  });

  it("spends a frame taken with the share closed, so reopening the share before the owner speaks never flashes it", () => {
    // read_screen t1 runs with no share; the owner reopens the share with nothing new said.
    const pulse = framePulseKey({ frame: frameTakenOf({ segments: [ASKED], token: "t1" }), segments: [ASKED] });
    expect(pulse).toBe("t1");
    expect(pulseMove({ flashing: undefined, pulse, pulses: false, spent: undefined }).spendUnseen).toBe(true);
    expect(pulseMove({ flashing: undefined, pulse, pulses: true, spent: "t1" }).draw).toBe(false);
  });

  it("does nothing with no frame being taken", () => {
    expect(pulseMove({ flashing: undefined, pulse: undefined, pulses: true, spent: undefined })).toEqual({
      draw: false,
      dropFlashing: false,
      spendUnseen: false,
    });
  });
});
