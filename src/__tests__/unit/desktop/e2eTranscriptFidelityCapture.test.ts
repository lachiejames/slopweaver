import { describe, expect, it } from "vitest";

import { parseMicCaptures } from "../../../desktop/e2eTranscriptFidelityCapture.js";

describe("parseMicCaptures", () => {
  it("reads each capture, keeping a flag Chromium omitted as null", () => {
    expect(
      parseMicCaptures({
        value: [{ autoGainControl: null, echoCancellation: true, noiseSuppression: false, openedAtMs: 1000 }],
      }),
    ).toEqual([
      { applied: { autoGainControl: null, echoCancellation: true, noiseSuppression: false }, openedAtMs: 1000 },
    ]);
  });

  it("reads an empty list as no microphone opened", () => {
    expect(parseMicCaptures({ value: [] })).toEqual([]);
  });

  it("refuses what is not a list of captures: nothing, a string flag, a missing time", () => {
    expect([
      parseMicCaptures({ value: undefined }),
      parseMicCaptures({
        value: [{ autoGainControl: "true", echoCancellation: true, noiseSuppression: true, openedAtMs: 1 }],
      }),
      parseMicCaptures({ value: [{ autoGainControl: true, echoCancellation: true, noiseSuppression: true }] }),
      parseMicCaptures({ value: [null] }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
