/*
 * The floating orb's level meter, as pure functions of the analyser's bins.
 */
import { describe, expect, it } from "vitest";

import { LEVEL_BARS, levelBars, overallLevel, waveformLevel } from "../../lib/voiceMeter";

describe("levelBars", () => {
  it("folds the lower half of the spectrum into the bar count, each 0 to 1", () => {
    const bins = [255, 255, 0, 0, 51, 51, 0, 0, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9];
    expect(levelBars({ bars: 5, bins })).toEqual([1, 0, 0.2, 0, 9 / 255]);
  });

  it("always answers the bar count, even for silence", () => {
    expect(levelBars({ bars: LEVEL_BARS, bins: new Uint8Array(32) })).toEqual(
      Array.from({ length: LEVEL_BARS }, () => 0),
    );
  });
});

describe("overallLevel", () => {
  it("is the mean, and zero for no bars", () => {
    expect(overallLevel({ bars: [0.2, 0.4] })).toBeCloseTo(0.3);
    expect(overallLevel({ bars: [] })).toBe(0);
  });
});

describe("waveformLevel", () => {
  it("reads centred silence as 0, and no samples as 0", () => {
    expect(waveformLevel({ samples: [128, 128, 128, 128] })).toBe(0);
    expect(waveformLevel({ samples: [] })).toBe(0);
  });

  it("reads a square wave as its amplitude, and the byte floor held as 1", () => {
    expect(waveformLevel({ samples: [192, 64, 192, 64] })).toBe(0.5);
    expect(waveformLevel({ samples: [0, 0] })).toBe(1);
  });

  it("does not move with the analyser's decibel window: a hiss one step off silence stays under 0.01", () => {
    expect(waveformLevel({ samples: [129, 127, 129, 127] })).toBe(0.0078125);
  });
});
