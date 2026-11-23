/*
 * The star cluster's shape: how it draws its points, the greys they are drawn in, its count and its flicker.
 */
import { describe, expect, it } from "vitest";

import { STAR_CLUSTER_STYLE, SWARM_GREYS, swarmCount, twinkled } from "../../lib/swarmStyle";

describe("the star cluster", () => {
  it("draws sparse haloed points that twinkle", () => {
    expect(STAR_CLUSTER_STYLE).toEqual({ density: 0.45, halo: 2.4, overlap: 0.2, size: 0.8, twinkle: 0.9 });
  });

  it("draws in four close mid greys, so only a pile of points climbs to white", () => {
    expect(SWARM_GREYS).toEqual(["rgb(50% 50% 50%)", "rgb(56% 56% 56%)", "rgb(46% 46% 46%)", "rgb(53% 53% 53%)"]);
  });
});

describe("swarmCount", () => {
  it("draws the size's count at full density, scales it otherwise, and never draws none", () => {
    expect(swarmCount({ areaCount: 120, density: 1 })).toBe(120);
    expect(swarmCount({ areaCount: 120, density: 0.45 })).toBe(54);
    expect(swarmCount({ areaCount: 10, density: 0.001 })).toBe(1);
  });
});

describe("twinkled", () => {
  it("leaves a point alone with no flicker, and keeps a flickering one inside 0 to 1, never brighter", () => {
    expect(twinkled({ depth: 0, glow: 0.7, phase: 1, timeS: 3 })).toBe(0.7);
    const flickered = Array.from({ length: 64 }, (_, step) =>
      twinkled({ depth: 0.9, glow: 0.7, phase: 1, timeS: step / 8 }),
    );
    expect(flickered.filter((glow) => glow < 0 || glow > 0.7)).toEqual([]);
    expect(Math.min(...flickered)).toBeLessThan(0.2);
  });
});
