/*
 * The particles look's field: the shape for each mood, the seeded swarm, where each particle belongs, and the step
 * that pulls it there.
 */
import { describe, expect, it } from "vitest";

import { ORB_MOODS } from "../../lib/orbMood";
import {
  FIELD_REACH,
  formationOf,
  formationTarget,
  MAX_PARTICLES,
  MIN_PARTICLES,
  PARTICLE_FORMATIONS,
  PARTICLE_HUES,
  type ParticleFormation,
  particleCountFor,
  READING_ROWS,
  readingCursor,
  seedParticles,
  stepParticle,
} from "../../lib/particleField";

const SWARM = seedParticles({ count: 120, seed: 23 });

/** Nobody talking, no flourish. */
const CALM = { flow: 0, order: 0 } as const;

/** Every particle's target in a formation at a few instants, levels, speakers and flourishes. */
function targetsOf({ formation }: { formation: ParticleFormation }): { x: number; y: number; glow: number }[] {
  return [0, 0.7, 3.1, 12.4, 97].flatMap((timeS) =>
    [0, 0.5, 1].flatMap((spread) =>
      [-1, 0, 1].flatMap((flow) =>
        [0, 1].flatMap((order) =>
          SWARM.map((particle) => formationTarget({ flow, formation, order, particle: particle.seed, spread, timeS })),
        ),
      ),
    ),
  );
}

describe("formationOf", () => {
  it("gives every mood a shape", () => {
    expect(ORB_MOODS.length).toBeGreaterThan(0);
    expect(ORB_MOODS.filter((mood) => !PARTICLE_FORMATIONS.includes(formationOf({ mood })))).toEqual([]);
  });

  it("listens and speaks as a cloud, thinks as a vortex, and reads as rows whatever it reads", () => {
    expect((["idle", "hearing", "speaking", "off"] as const).map((mood) => formationOf({ mood }))).toEqual([
      "cloud",
      "cloud",
      "cloud",
      "cloud",
    ]);
    expect(formationOf({ mood: "thinking" })).toBe("vortex");
    expect(formationOf({ mood: "working" })).toBe("vortex");
    expect(
      (["looking", "slack", "code", "recalling", "browsing"] as const).map((mood) => formationOf({ mood })),
    ).toEqual(["lines", "lines", "lines", "lines", "lines"]);
  });

  it("hands on as a loop, rests when stalled and scatters on an error", () => {
    expect(formationOf({ mood: "relaying" })).toBe("loop");
    expect(formationOf({ mood: "stalled" })).toBe("rest");
    expect(formationOf({ mood: "error" })).toBe("scatter");
  });

  it("uses every shape for some mood", () => {
    const used = new Set(ORB_MOODS.map((mood) => formationOf({ mood })));
    expect([...used].toSorted()).toEqual([...PARTICLE_FORMATIONS].toSorted());
  });
});

describe("seedParticles", () => {
  it("cuts the same swarm from the same seed, and a different one from another", () => {
    expect(seedParticles({ count: 120, seed: 23 })).toEqual(SWARM);
    expect(seedParticles({ count: 120, seed: 24 })).not.toEqual(SWARM);
    expect(SWARM).toHaveLength(120);
  });

  it("splits the swarm into two bands, each wearing its own two colours", () => {
    expect(SWARM.filter((particle) => particle.seed.band === 0)).toHaveLength(60);
    const hues = ({ band }: { band: 0 | 1 }): number[] =>
      [...new Set(SWARM.filter((p) => p.seed.band === band).map((p) => p.seed.hue))].toSorted((a, b) => a - b);
    expect(hues({ band: 0 })).toEqual([0, 2]);
    expect(hues({ band: 1 })).toEqual([1, 3]);
  });

  it("starts every particle at rest, in its place in the cloud", () => {
    expect(SWARM.filter((particle) => particle.vx !== 0 || particle.vy !== 0)).toEqual([]);
    const homes = SWARM.map((particle) =>
      formationTarget({ ...CALM, formation: "cloud", particle: particle.seed, spread: 0, timeS: 0 }),
    );
    expect(SWARM.map((particle) => [particle.x, particle.y])).toEqual(homes.map((home) => [home.x, home.y]));
  });

  it("seats the swarm on an even sunflower lattice: each dot the golden angle round, out by its share's root", () => {
    expect(SWARM[0].seed.reach).toBeCloseTo(Math.sqrt(0.5 / 120));
    expect(SWARM.at(-1)!.seed.reach).toBeCloseTo(Math.sqrt(119.5 / 120));
    expect(SWARM[1].seed.angle - SWARM[0].seed.angle).toBeCloseTo(Math.PI * (3 - Math.sqrt(5)));
    expect(new Set(SWARM.map((particle) => particle.seed.spacing))).toEqual(new Set([Math.sqrt(Math.PI / 120)]));
  });
});

describe("PARTICLE_HUES", () => {
  it("stays within 20 degrees of the mood's hue, so the owner's colour and the voice's never share a palette", () => {
    expect(PARTICLE_HUES.length).toBeGreaterThan(0);
    expect(PARTICLE_HUES.filter((degrees) => Math.abs(degrees) > 20)).toEqual([]);
  });
});

describe("formationTarget", () => {
  it("never places a particle past the field's reach, nor outside a glow of 0 to 1, in any shape", () => {
    expect(PARTICLE_FORMATIONS.length).toBeGreaterThan(0);
    const outside = PARTICLE_FORMATIONS.flatMap((formation) =>
      targetsOf({ formation }).filter(
        (target) => Math.hypot(target.x, target.y) > FIELD_REACH + 1e-9 || target.glow < 0 || target.glow > 1,
      ),
    );
    expect(outside).toEqual([]);
  });

  it("lights the cloud unevenly — bright masses and dim sky — and evenly once the flourish lets the clouds go", () => {
    const glows = ({ order }: { order: number }): number[] =>
      SWARM.map(
        (particle) =>
          formationTarget({ flow: 0, formation: "cloud", order, particle: particle.seed, spread: 0, timeS: 5 }).glow,
      ).filter((_, index) => SWARM[index].seed.reach < 0.6);
    const spread = ({ order }: { order: number }): number =>
      Math.max(...glows({ order })) - Math.min(...glows({ order }));
    expect(spread({ order: 0 })).toBeGreaterThan(0.6);
    expect(spread({ order: 1 })).toBeLessThan(0.05);
  });

  it("pulls the vortex's two bands apart into an outer ring and an inner one", () => {
    const radii = ({ band }: { band: 0 | 1 }): number[] =>
      SWARM.filter((particle) => particle.seed.band === band).map((particle) => {
        const target = formationTarget({ ...CALM, formation: "vortex", particle: particle.seed, spread: 0, timeS: 4 });
        return Math.hypot(target.x, target.y);
      });
    expect(Math.min(...radii({ band: 0 }))).toBeGreaterThan(Math.max(...radii({ band: 1 })));
  });

  it("gathers the vortex into twelve spokes at the height of its flourish", () => {
    const angles = SWARM.map((particle) => {
      const target = formationTarget({
        flow: 0,
        formation: "vortex",
        order: 1,
        particle: particle.seed,
        spread: 0,
        timeS: 0,
      });
      return Math.atan2(target.y, target.x);
    });
    const step = (Math.PI * 2) / 12;
    const offSpoke = angles.filter((angle) => Math.abs(angle / step - Math.round(angle / step)) > 1e-6);
    expect(offSpoke).toEqual([]);
  });

  it("lines the swarm up on the reading rows, and lights the ones the head is passing", () => {
    const targets = SWARM.map((particle) =>
      formationTarget({ ...CALM, formation: "lines", particle: particle.seed, spread: 0, timeS: 0.5 }),
    );
    const rows = new Set(targets.map((target) => Math.round(target.y * 10)));
    expect(rows.size).toBe(READING_ROWS);
    const cursor = readingCursor({ timeS: 0.5 });
    const lit = targets.filter((target) => target.glow > 0.6);
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.filter((target) => Math.abs(target.x - cursor.x) > 0.3)).toEqual([]);
  });
});

describe("readingCursor", () => {
  it("reads each row left to right, then the next, starting again at the top", () => {
    expect(readingCursor({ timeS: 0 })).toEqual({ row: 0, x: -0.62 });
    expect(readingCursor({ timeS: 0.55 }).row).toBe(0);
    expect(readingCursor({ timeS: 0.55 }).x).toBeCloseTo(0);
    expect(readingCursor({ timeS: 1.1 }).row).toBe(1);
    expect(readingCursor({ timeS: 1.1 * READING_ROWS + 0.2 }).row).toBe(0);
  });
});

describe("stepParticle", () => {
  const particle = SWARM[0];
  const target = { glow: 1, x: 0.5, y: -0.4 };

  it("pulls a particle toward its place, closer with every step", () => {
    let now = particle;
    const distances = [Math.hypot(now.x - target.x, now.y - target.y)];
    for (let step = 0; step < 90; step += 1) {
      now = stepParticle({ dtS: 1 / 60, particle: now, target, timeS: step / 60 });
      distances.push(Math.hypot(now.x - target.x, now.y - target.y));
    }
    expect(distances.at(-1)!).toBeLessThan(distances[0] * 0.1);
  });

  it("moves nothing in a step of no time", () => {
    expect(stepParticle({ dtS: 0, particle, target, timeS: 3 })).toBe(particle);
  });

  it("caps a long step, so a frame after a stall never flings the swarm", () => {
    expect(stepParticle({ dtS: 5, particle, target, timeS: 3 })).toEqual(
      stepParticle({ dtS: 0.05, particle, target, timeS: 3 }),
    );
  });
});

describe("particleCountFor", () => {
  it("draws in proportion to the orb's area, between the floor and the ceiling", () => {
    expect(particleCountFor({ height: 56, width: 56 })).toBe(MIN_PARTICLES);
    expect(particleCountFor({ height: 300, width: 300 })).toBe(750);
    expect(particleCountFor({ height: 2000, width: 2000 })).toBe(MAX_PARTICLES);
    expect(particleCountFor({ height: 0, width: 0 })).toBe(MIN_PARTICLES);
  });
});
