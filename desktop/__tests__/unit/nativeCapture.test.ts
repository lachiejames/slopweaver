/**
 * The voice's native look at your screen:the size asked of macOS and kept, the display it is of, and the one refusal
 * when macOS has not let the shell see your screen.
 */
import { describe, expect, it } from "vitest";

import {
  captureAskOf,
  fittedNativeCaptureSize,
  lookRefusal,
  messengerHeldOpen,
  NATIVE_CAPTURE_LONG_EDGE,
  nativeCaptureSize,
  noCallRefusal,
  SCREEN_RECORDING_OFF,
  screenRecordingRefusal,
  sourceForDisplay,
} from "../../src/nativeCapture";

describe("noCallRefusal", () => {
  const NO_CALL = "the voice looks only during a call you started, and none is up";

  it("lets a look through only while the voice reports a call and holds a live microphone track", () => {
    expect(noCallRefusal({ overlayAudioTracks: 1, overlayCallActive: true })).toBeUndefined();
  });

  it("refuses with no call reported, or a reported call holding no live microphone", () => {
    // The window exists with no call up, and its page asks for a picture anyway.
    expect(noCallRefusal({ overlayAudioTracks: 1, overlayCallActive: false })).toBe(NO_CALL);
    expect(noCallRefusal({ overlayAudioTracks: 0, overlayCallActive: true })).toBe(NO_CALL);
    expect(noCallRefusal({ overlayAudioTracks: 0, overlayCallActive: false })).toBe(NO_CALL);
  });
});

describe("lookRefusal", () => {
  const closed = { messengerOpen: false, overlayAudioTracks: 0, overlayCallActive: false, typedAsk: false };

  it("refuses with no call and no typed ask", () => {
    expect(lookRefusal(closed)).toBe("the voice looks only during a call you started, and none is up");
  });

  it("allows a typed ask while the messenger is open, with no call", () => {
    expect(lookRefusal({ ...closed, messengerOpen: true, typedAsk: true })).toBe(undefined);
  });

  it("refuses a typed ask once the messenger has closed", () => {
    expect(lookRefusal({ ...closed, typedAsk: true })).toBe("a typed look needs the messenger open, and it was closed");
  });

  it("refuses a typed ask once the messenger has closed, even with a live call's proof", () => {
    expect(lookRefusal({ ...closed, overlayAudioTracks: 1, overlayCallActive: true, typedAsk: true })).toBe(
      "a typed look needs the messenger open, and it was closed",
    );
  });

  it("refuses a look with the messenger open that no typed message asked for", () => {
    expect(lookRefusal({ ...closed, messengerOpen: true })).toBe(
      "the voice looks only during a call you started, and none is up",
    );
  });

  it("keeps the live-call proof for a call's own look", () => {
    expect(lookRefusal({ ...closed, overlayAudioTracks: 1, overlayCallActive: true })).toBe(undefined);
  });
});

describe("messengerHeldOpen", () => {
  const started = { epoch: 3, open: true };

  it("holds while the messenger stayed open on the same epoch", () => {
    expect(messengerHeldOpen({ now: { epoch: 3, open: true }, started })).toBe(true);
  });

  it("fails once it closed", () => {
    expect(messengerHeldOpen({ now: { epoch: 4, open: false }, started })).toBe(false);
  });

  it("fails after a close and a reopen inside the look", () => {
    expect(messengerHeldOpen({ now: { epoch: 5, open: true }, started })).toBe(false);
  });
});

describe("captureAskOf", () => {
  it("reads nothing at all as a call's look", () => {
    expect(captureAskOf({ value: undefined })).toEqual({ typedAsk: false });
  });

  it("reads exactly a typed ask", () => {
    expect(captureAskOf({ value: { typedAsk: true } })).toEqual({ typedAsk: true });
  });

  it.each([
    ["a false flag", { typedAsk: false }],
    ["an extra key", { other: 1, typedAsk: true }],
    ["another key", { other: true }],
    ["a truthy non-boolean", { typedAsk: "true" }],
    ["null", null],
    ["a string", "typedAsk"],
  ])("refuses %s", (_name, value) => {
    expect(captureAskOf({ value })).toBe(undefined);
  });
});

describe("nativeCaptureSize", () => {
  it("multiplies a Retina display to physical pixels before bringing its long edge down", () => {
    expect(nativeCaptureSize({ scaleFactor: 2, size: { height: 900, width: 1440 } })).toEqual({
      height: 1280,
      width: NATIVE_CAPTURE_LONG_EDGE,
    });
  });

  it("keeps a display already inside the edge at its own physical size, never scaling up", () => {
    expect(nativeCaptureSize({ scaleFactor: 1, size: { height: 1080, width: 1920 } })).toEqual({
      height: 1080,
      width: 1920,
    });
  });

  it("caps a portrait display by its height", () => {
    expect(nativeCaptureSize({ scaleFactor: 2, size: { height: 1920, width: 1080 } })).toEqual({
      height: 2048,
      width: 1152,
    });
  });

  it("refuses a display reporting no usable size or scale rather than inventing one", () => {
    expect(nativeCaptureSize({ scaleFactor: 0, size: { height: 800, width: 1280 } })).toBeUndefined();
    expect(nativeCaptureSize({ scaleFactor: Number.NaN, size: { height: 800, width: 1280 } })).toBeUndefined();
    expect(nativeCaptureSize({ scaleFactor: 2, size: { height: 0, width: 1280 } })).toBeUndefined();
  });
});

describe("fittedNativeCaptureSize", () => {
  it("brings a still macOS handed back larger than asked down to the edge", () => {
    expect(fittedNativeCaptureSize({ source: { height: 1800, width: 2880 } })).toEqual({ height: 1280, width: 2048 });
  });

  it("keeps a still already inside the edge exactly", () => {
    expect(fittedNativeCaptureSize({ source: { height: 1280, width: 2048 } })).toEqual({ height: 1280, width: 2048 });
  });
});

describe("sourceForDisplay", () => {
  const laptop = { display_id: "1", id: "screen:1:0" };
  const monitor = { display_id: "4", id: "screen:4:0" };

  it("takes the source naming the voice's display, whatever order they are listed in", () => {
    expect(sourceForDisplay({ displayId: 4, sources: [laptop, monitor] })).toBe(monitor);
    expect(sourceForDisplay({ displayId: 1, sources: [monitor, laptop] })).toBe(laptop);
  });

  it("never takes another display's source for the voice's", () => {
    expect(sourceForDisplay({ displayId: 1, sources: [monitor] })).toBeUndefined();
  });

  it("never guesses at a source that names no display", () => {
    expect(sourceForDisplay({ displayId: 1, sources: [{ display_id: "", id: "screen:0:0" }] })).toBeUndefined();
  });

  it("finds nothing in no sources", () => {
    expect(sourceForDisplay({ displayId: 1, sources: [] })).toBeUndefined();
  });
});

describe("screenRecordingRefusal", () => {
  it("lets a granted shell look", () => {
    expect(screenRecordingRefusal({ status: "granted" })).toBeUndefined();
  });

  it("marks a refusal you can grant as Screen Recording's, so the relay names the switch and blames no share", () => {
    expect(screenRecordingRefusal({ status: "denied" })).toEqual({
      cause: "screen-recording-off",
      why: SCREEN_RECORDING_OFF,
    });
    expect(screenRecordingRefusal({ status: "not-determined" })).toEqual({
      cause: "screen-recording-off",
      why: SCREEN_RECORDING_OFF,
    });
    expect(SCREEN_RECORDING_OFF).toContain("Privacy & Security › Screen & System Audio Recording");
  });

  it("never tells you to grant what a device policy restricts, or what macOS gave no answer on", () => {
    expect(screenRecordingRefusal({ status: "restricted" })).toEqual({ why: SCREEN_RECORDING_OFF });
    expect(screenRecordingRefusal({ status: "unknown" })).toEqual({ why: SCREEN_RECORDING_OFF });
  });

  it("says what to do when the switch already shows on, since a grant to an earlier build reads on while refusing", () => {
    expect(SCREEN_RECORDING_OFF).toContain("already on? remove it with −, and the next look asks again");
  });
});
