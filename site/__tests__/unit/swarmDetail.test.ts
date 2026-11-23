/*
 * How a swarm draws each dot: refined caps a lit dot's growth, nudges it off the sunflower and feathers its halo,
 * while `plain` draws the lattice's own geometry, the corner's.
 */
import { describe, expect, it } from "vitest";

import { particleCountFor } from "../../lib/particleField";
import {
  CORE_OVERLAP,
  detailedPoint,
  HALO_ALPHA,
  haloPasses,
  isSwarmDetail,
  REFINED_GROWTH_CAP_PX,
  REFINED_JITTER_SHARE,
  REFINED_MIN_HALO,
  SWARM_DETAILS,
  swarmRadius,
} from "../../lib/swarmDetail";

/** One lattice spacing in CSS pixels for a square box at the loudest swell, as `swarmPainter.ts` computes it. */
function reachFor({ box }: { box: number }): number {
  const count = particleCountFor({ height: box, width: box });
  return Math.sqrt(Math.PI / count) * (box / 2) * 1.25;
}

describe("isSwarmDetail", () => {
  it("accepts each detail and nothing else", () => {
    expect(SWARM_DETAILS.length).toBeGreaterThan(0);
    expect(SWARM_DETAILS.filter((detail) => !isSwarmDetail(detail))).toEqual([]);
    expect(isSwarmDetail("smooth")).toBe(false);
    expect(isSwarmDetail("original")).toBe(false);
    expect(isSwarmDetail(undefined)).toBe(false);
  });
});

describe("swarmRadius", () => {
  it("grows a plain dot by its full share of the spacing", () => {
    expect(swarmRadius({ detail: "plain", glow: 0.5, overlap: 1.4, reach: 10, rest: 1 })).toBe(
      1 + 0.25 * CORE_OVERLAP * 1.4 * 10,
    );
  });

  it("caps a lit dot's growth at what the corner's 56px box draws at its loudest", () => {
    const corner = swarmRadius({ detail: "plain", glow: 1, overlap: 1, reach: reachFor({ box: 56 }), rest: 0 });
    expect(corner).toBeCloseTo(2.38, 2);
    expect(REFINED_GROWTH_CAP_PX).toBeGreaterThanOrEqual(corner);
    expect(REFINED_GROWTH_CAP_PX).toBeLessThan(corner + 0.1);
  });

  it("caps a lit dot's growth on the 480px stage, where plain grows it to a disc", () => {
    const reach = reachFor({ box: 480 });
    expect(swarmRadius({ detail: "refined", glow: 1, overlap: 1, reach, rest: 0 })).toBe(REFINED_GROWTH_CAP_PX);
    expect(swarmRadius({ detail: "plain", glow: 1, overlap: 1, reach, rest: 0 })).toBeCloseTo(7.9, 1);
  });

  it("leaves a dimmer dot's growth under the cap untouched", () => {
    expect(swarmRadius({ detail: "refined", glow: 0.5, overlap: 1, reach: 10, rest: 1 })).toBe(
      swarmRadius({ detail: "plain", glow: 0.5, overlap: 1, reach: 10, rest: 1 }),
    );
  });

  it("applies the look's own overlap after the cap, so a look that overlaps more still does", () => {
    expect(swarmRadius({ detail: "refined", glow: 1, overlap: 2, reach: 100, rest: 1 })).toBe(
      1 + REFINED_GROWTH_CAP_PX * 2,
    );
  });

  it("grows an unlit dot not at all", () => {
    expect(swarmRadius({ detail: "refined", glow: 0, overlap: 1.4, reach: 100, rest: 1.5 })).toBe(1.5);
  });
});

describe("detailedPoint", () => {
  const phases = Array.from({ length: 64 }, (_, index) => (index / 64) * Math.PI * 2);

  it("leaves a plain dot on its lattice seat", () => {
    expect(detailedPoint({ detail: "plain", phase: 1.3, spacing: 0.1, x: 0.2, y: -0.4 })).toEqual({
      x: 0.2,
      y: -0.4,
    });
  });

  it("nudges a refined dot by less than its share of the spacing", () => {
    const nudges = phases.map((phase) => {
      const at = detailedPoint({ detail: "refined", phase, spacing: 0.1, x: 0, y: 0 });
      return Math.hypot(at.x, at.y);
    });
    expect(nudges.filter((nudge) => nudge >= REFINED_JITTER_SHARE * 0.1)).toEqual([]);
    expect(nudges.filter((nudge) => nudge > 0.001).length).toBeGreaterThan(phases.length / 2);
  });

  it("gives one dot the same nudge every frame", () => {
    const once = detailedPoint({ detail: "refined", phase: 2.2, spacing: 0.1, x: 0.3, y: 0.1 });
    const again = detailedPoint({ detail: "refined", phase: 2.2, spacing: 0.1, x: 0.3, y: 0.1 });
    expect(again).toEqual(once);
  });
});

describe("haloPasses", () => {
  it("draws none for a plain look with no halo", () => {
    expect(haloPasses({ detail: "plain", halo: 0, radius: 4 })).toEqual([]);
  });

  it("is one disc at the halo's reach when plain", () => {
    expect(haloPasses({ detail: "plain", halo: 2, radius: 4 })).toEqual([{ alpha: HALO_ALPHA, radius: 8 }]);
  });

  it("gives a refined look with no halo of its own the least glow, so a bright cloud still reads as one shape", () => {
    const passes = haloPasses({ detail: "refined", halo: 0, radius: 2 });
    expect(REFINED_MIN_HALO).toBe(2.6);
    expect(passes.map((pass) => Number(pass.radius.toFixed(6)))).toEqual([5.98, 4.16, 2.6]);
  });

  it("feathers into three discs, outermost faintest, whose brightness adds to the plain halo's", () => {
    const passes = haloPasses({ detail: "refined", halo: 4, radius: 2 });
    expect(passes.map((pass) => Number(pass.radius.toFixed(6)))).toEqual([9.2, 6.4, 4]);
    expect(passes.reduce((sum, pass) => sum + pass.alpha, 0)).toBeCloseTo(HALO_ALPHA, 10);
    expect(passes.map((pass) => pass.alpha).toSorted((a, b) => a - b)).toEqual(passes.map((pass) => pass.alpha));
  });
});
