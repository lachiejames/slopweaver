/*
 * The particles look's cloud: two counter-turning layers of moving cloud lighting an even lattice, gathering its dots
 * into solid masses, drifting in for the owner and out for the voice.
 */
import { describe, expect, it } from "vitest";

import { BAND_TURN, cloudField, cloudPlace, cloudStrength } from "../../lib/particleCloud";
import { seedParticles } from "../../lib/particleField";

/** A grid of points inside the disc. */
const GRID: readonly (readonly [number, number])[] = Array.from({ length: 21 * 21 }, (_, index) => [
  -0.8 + 0.08 * (index % 21),
  -0.8 + 0.08 * Math.floor(index / 21),
]).filter(([x, y]) => Math.hypot(x, y) < 0.8) as [number, number][];

/** The Pearson correlation of two equal-length series. */
function correlation({ a, b }: { a: readonly number[]; b: readonly number[] }): number {
  const mean = ({ values }: { values: readonly number[] }): number =>
    values.reduce((sum, v) => sum + v, 0) / values.length;
  const ma = mean({ values: a });
  const mb = mean({ values: b });
  let top = 0;
  let da = 0;
  let db = 0;
  a.forEach((value, index) => {
    top += (value - ma) * (b[index] - mb);
    da += (value - ma) ** 2;
    db += (b[index] - mb) ** 2;
  });
  return top / Math.sqrt(da * db);
}

describe("cloudField", () => {
  it("turns each layer its own way: a layer a moment on matches itself turned WITH its band, not against it", () => {
    const dt = 0.6;
    const matches = ({ band, way }: { band: 0 | 1; way: 1 | -1 }): number => {
      const by = way * BAND_TURN[band] * dt;
      const later = GRID.map(([x, y]) => cloudField({ band, fine: 1, flow: 0, timeS: 3 + dt, x, y }));
      const turned = GRID.map(([x, y]) =>
        cloudField({
          band,
          fine: 1,
          flow: 0,
          timeS: 3,
          x: x * Math.cos(-by) - y * Math.sin(-by),
          y: x * Math.sin(-by) + y * Math.cos(-by),
        }),
      );
      return correlation({ a: later, b: turned });
    };
    expect(GRID.length).toBeGreaterThan(100);
    expect(Math.sign(BAND_TURN[0])).toBe(-Math.sign(BAND_TURN[1]));
    expect(matches({ band: 0, way: 1 })).toBeGreaterThan(matches({ band: 0, way: -1 }));
    expect(matches({ band: 1, way: 1 })).toBeGreaterThan(matches({ band: 1, way: -1 }));
  });

  it("runs its ring wave outward while the voice speaks and inward while the owner does", () => {
    const ring = ({ flow, radius, timeS }: { flow: number; radius: number; timeS: number }): number =>
      cloudField({ band: 0, fine: 1, flow, timeS, x: radius, y: 0 }) -
      cloudField({ band: 0, fine: 1, flow: 0, timeS, x: radius, y: 0 });
    // A crest at radius r and time t is at r + 5δ/7 a time δ later: outward for the voice, inward for the owner.
    expect(ring({ flow: 1, radius: 0.5 + (5 * 0.1) / 7, timeS: 2.1 })).toBeCloseTo(
      ring({ flow: 1, radius: 0.5, timeS: 2 }),
    );
    expect(ring({ flow: -1, radius: 0.5 - (5 * 0.1) / 7, timeS: 2.1 })).toBeCloseTo(
      ring({ flow: -1, radius: 0.5, timeS: 2 }),
    );
    expect(ring({ flow: 0, radius: 0.5, timeS: 2 })).toBe(0);
  });
});

describe("cloudStrength", () => {
  it("is clear sky below the cloud's edge, whole cloud above it, and eased between", () => {
    expect(cloudStrength({ value: 0.3 })).toBe(0);
    expect(cloudStrength({ value: 0.45 })).toBe(0);
    expect(cloudStrength({ value: 0.575 })).toBeCloseTo(0.5);
    expect(cloudStrength({ value: 0.7 })).toBe(1);
    expect(cloudStrength({ value: 0.95 })).toBe(1);
  });
});

describe("cloudPlace", () => {
  const swarm = seedParticles({ count: 750, seed: 23 });
  const places = swarm.map((particle) => cloudPlace({ flow: 0, order: 0, seat: particle.seed, timeS: 7 }));

  /** The mean distance from each of these places to its nearest neighbour among them. */
  const meanNearest = ({ points }: { points: readonly { x: number; y: number }[] }): number =>
    points
      .map((point, index) =>
        Math.min(
          ...points
            .filter((_, other) => other !== index)
            .map((other) => Math.hypot(other.x - point.x, other.y - point.y)),
        ),
      )
      .reduce((sum, distance) => sum + distance, 0) / points.length;

  it("gathers a cloud's dots into a core denser than the even lattice, so it reads as one solid shape", () => {
    const core = swarm.map((_, index) => index).filter((index) => places[index].glow > 0.85);
    expect(core.length).toBeGreaterThan(20);
    const lattice = core.map((index) => cloudPlace({ flow: 0, order: 1, seat: swarm[index].seed, timeS: 7 }));
    expect(meanNearest({ points: core.map((index) => places[index]) })).toBeLessThan(
      meanNearest({ points: lattice }) * 0.85,
    );
  });

  it("leaves the lattice even at the height of the flourish", () => {
    const even = swarm.map((particle) => cloudPlace({ flow: 0, order: 1, seat: particle.seed, timeS: 7 }));
    const bare = swarm.map((particle) => ({
      x: Math.cos(particle.seed.angle + 0.05 * 7) * particle.seed.reach,
      y: Math.sin(particle.seed.angle + 0.05 * 7) * particle.seed.reach,
    }));
    expect(even.map((place) => [place.x, place.y])).toEqual(bare.map((place) => [place.x, place.y]));
  });

  it("never presses a dot out past the lattice's rim, whoever is talking", () => {
    const outside = [-1, 0, 1].flatMap((flow) =>
      [0.5, 3, 11, 40].flatMap((timeS) =>
        swarm
          .map((particle) => cloudPlace({ flow, order: 0, seat: particle.seed, timeS }))
          .filter((place) => Math.hypot(place.x, place.y) > 1),
      ),
    );
    expect(outside).toEqual([]);
  });

  it("fades the lattice's last rings, so the cloud has no bright rim", () => {
    const rim = swarm.filter((particle) => particle.seed.reach > 0.98).map((particle) => particle.seed);
    expect(rim.length).toBeGreaterThan(0);
    const bright = rim.filter((seat) => cloudPlace({ flow: 0, order: 1, seat, timeS: 7 }).glow > 0.3);
    expect(bright).toEqual([]);
  });
});
