/*
 * Embers as arithmetic: how many sparks a voice strikes a frame, the fraction it carries, and where a spark is a frame
 * later — and that under reduce-motion neither moves anything.
 */
import { describe, expect, it } from "vitest";

import { EMBER_LIFE_S, type EmberSpark, emberAfter, emberEmissionOf } from "../../lib/presenceEmbers";

const SPARK: EmberSpark = {
  ageS: 0.5,
  grey: 0.6,
  radiusShare: 0.02,
  swayPhase: 1,
  vxShareS: 0.1,
  vyShareS: -0.4,
  xShare: 0.05,
  yShare: 0.48,
};

describe("EMBER_LIFE_S", () => {
  it("is the gallery's life, falling by 0.45 a second", () => {
    expect(EMBER_LIFE_S).toBeCloseTo(2.2222, 4);
  });
});

describe("emberEmissionOf", () => {
  it("strikes 0.4 a second in silence, carrying the fraction to the next frame", () => {
    expect(emberEmissionOf({ carry: 0, dtS: 1, level: 0, moving: true })).toEqual({ carry: 0.4, count: 0 });
    const second = emberEmissionOf({ carry: 0.8, dtS: 1, level: 0, moving: true });
    expect(second.count).toBe(1);
    expect(second.carry).toBeCloseTo(0.2, 10);
  });

  it("strikes 40 more a second at full level", () => {
    const loud = emberEmissionOf({ carry: 0, dtS: 0.5, level: 1, moving: true });
    expect(loud.count).toBe(20);
    expect(loud.carry).toBeCloseTo(0.2, 10);
  });

  it("strikes more the louder the voice", () => {
    expect([0, 0.25, 0.5, 1].map((level) => emberEmissionOf({ carry: 0, dtS: 1, level, moving: true }).count)).toEqual([
      0, 10, 20, 40,
    ]);
  });

  it("strikes nothing under reduce-motion and keeps the carry exactly", () => {
    expect(emberEmissionOf({ carry: 0.7, dtS: 1, level: 1, moving: false })).toEqual({ carry: 0.7, count: 0 });
  });
});

describe("emberAfter", () => {
  it("ages a spark and moves it by its own speed", () => {
    const after = emberAfter({ dtS: 0.5, moving: true, spark: SPARK });
    expect(after.ageS).toBe(1);
    expect(after.xShare).toBeCloseTo(0.1, 10);
    expect(after.yShare).toBeCloseTo(0.28, 10);
    expect([after.grey, after.radiusShare, after.swayPhase, after.vxShareS, after.vyShareS]).toEqual([
      0.6, 0.02, 1, 0.1, -0.4,
    ]);
  });

  it("hands the same spark back under reduce-motion", () => {
    expect(emberAfter({ dtS: 0.5, moving: false, spark: SPARK })).toBe(SPARK);
  });
});
