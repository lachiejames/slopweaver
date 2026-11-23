/**
 * The particles look's field: a seeded swarm, the shape it gathers into for each mood, and one step of its motion.
 * The canvas that draws it is `components/voice/StageParticles.tsx`; this is the pure half, with the clock the
 * caller's.
 *
 * The look is free-flowing particles that sometimes take the shape of an orb and sometimes other shapes, colours
 * spinning in opposite directions at different paces inside it. The particles constantly create new forms, collapse,
 * disband and re-emerge into new forms, conveying the voice's state through them — but never a magnifying glass or a
 * robot face: sleek and elegant, and informative by looking at it.
 *
 * So the swarm is crisp, even dots on one sunflower lattice in two bands, each its own colours, and it takes a
 * different shape for what the voice is doing ({@link formationOf}): a moving cloud while it listens and speaks
 * (`site/lib/particleCloud.ts` — cloudy skies whose clouds keep moving around), two
 * counter-turning rings while it thinks, rows of light read across by a bright head while it reads, a loop leaning
 * away while it hands a steer on, a low settled drift when a turn has stalled, a shiver when it errs. Every particle
 * is pulled toward its place in the current shape by a damped spring ({@link stepParticle}), so a change of state
 * flows into the new shape, never a cut: it flows into the new shape.
 *
 * Every shape is drawn at its UNIT size: how far the voice swells it is applied as one scale when it is drawn
 * (`swellOf`, `site/lib/particleMotion.ts`), so the diameter follows a syllable rather than lagging behind a spring.
 *
 * Coordinates are the orb's box normalised to −1…1 each way, the centre at the origin. No shape reaches past
 * {@link FIELD_REACH}, so the swarm never runs into the canvas's edge and shows a hard border.
 */
import type { OrbMood } from "./orbMood";
import { BAND_TURN, cloudPlace, GOLDEN_ANGLE } from "./particleCloud";

/** A fixed, repeatable stream of numbers in [0, 1), so the swarm is the same on every render and every machine. */
function seeded({ seed }: { seed: number }): () => number {
  let state = seed >>> 0;
  return () => {
    // mulberry32: small, fast and good enough to seat a few hundred dots.
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The shapes the swarm gathers into. */
export const PARTICLE_FORMATIONS = ["cloud", "vortex", "lines", "loop", "rest", "scatter"] as const;

/** One of {@link PARTICLE_FORMATIONS}. */
export type ParticleFormation = (typeof PARTICLE_FORMATIONS)[number];

/** How far from the centre any shape places a particle, at the widest the level spreads it. */
export const FIELD_REACH = 1;

/**
 * The hue turns the swarm's colours are drawn at, round the mood's `--v-ring`. Band 0 wears the even ones and band 1
 * the odd, so the two layers turning against each other are visibly two sets of colour — close enough round the
 * mood's hue that the mood still reads as ONE colour, so the owner's voice and the voice's own never share a palette.
 */
export const PARTICLE_HUES = [-16, -6, 8, 18] as const;

/** One of the four colours, by its index in {@link PARTICLE_HUES}. */
export type ParticleHue = 0 | 1 | 2 | 3;

/** Who a particle is, fixed at seeding: what makes its place in each shape its own. */
export interface ParticleSeed {
  /** Its angle on the sunflower lattice, radians. */
  readonly angle: number;
  /** How far out it sits on the lattice, 0 at the centre to just under 1 at the edge. */
  readonly reach: number;
  /** The lattice's spacing between neighbours, in the normalised box: the same for every particle of a swarm. */
  readonly spacing: number;
  /** Which of the two counter-turning layers it is in. */
  readonly band: 0 | 1;
  /** Which colour it wears. */
  readonly hue: ParticleHue;
  /** Its own offset in every wave it rides, so no two move in step. */
  readonly phase: number;
  /** Which row of light it sits on while the voice reads. */
  readonly row: number;
  /** Where along its row, or round the loop, it sits, 0 to 1. */
  readonly along: number;
}

/** A particle: who it is, where it is, and how fast it is moving. */
export interface Particle {
  readonly seed: ParticleSeed;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

/** Where a particle is pulled toward this instant, and how bright it should be there, 0 to 1. */
export interface ParticleTarget {
  readonly x: number;
  readonly y: number;
  readonly glow: number;
}

/** How many rows of light the reading shape has. */
export const READING_ROWS = 5;

/** Each reading row's length, as a share of the widest: the ragged right edge of a paragraph. */
const ROW_LENGTHS: readonly number[] = [1, 0.86, 0.95, 0.72, 0.5];

/** The reading rows' height apart, in the normalised box. */
const ROW_GAP = 0.2;

/** How wide the widest reading row is, either side of the centre. */
const ROW_HALF_WIDTH = 0.62;

/** The spring that pulls a particle to its place: firm enough to re-form in about a second, damped so it never rings. */
const SPRING = 12;

/** The damping on that spring. */
const DAMPING = 6.2;

/** The longest step one call takes, so a frame after a stall never flings the swarm. */
const MAX_STEP_S = 0.05;

/**
 * The shape the swarm gathers into for a mood. Every reading tool shares one shape — what it reads is the badge's and
 * the words' to say — so the shape says the KIND of thing the voice is doing, readable at a glance.
 *
 * @returns the formation
 */
export function formationOf({ mood }: { mood: OrbMood }): ParticleFormation {
  switch (mood) {
    case "off":
    case "connecting":
    case "reconnecting":
    case "idle":
    case "hearing":
    case "yielded":
    case "speaking":
      return "cloud";
    case "thinking":
    case "writing":
    case "working":
      return "vortex";
    case "looking":
    case "slack":
    case "code":
    case "recalling":
    case "browsing":
      return "lines";
    case "relaying":
      return "loop";
    case "stalled":
      return "rest";
    case "error":
      return "scatter";
    default: {
      const unreachable: never = mood;
      return unreachable;
    }
  }
}

/**
 * A swarm, the same for the same seed on every machine, every particle starting at its place in a resting cloud.
 * Its seats are a sunflower lattice — each one the golden angle round from the last, at the square root of its share
 * of the count out — so the dots are evenly spread with no rings or clumps of their own: every clump on screen is a
 * cloud's.
 *
 * @param count how many particles
 * @param seed fixes each particle's colour, phase and reading seat
 * @returns the swarm
 */
export function seedParticles({ count, seed }: { count: number; seed: number }): readonly Particle[] {
  const random = seeded({ seed });
  const particles: Particle[] = [];
  const spacing = Math.sqrt(Math.PI / Math.max(1, count));
  for (let index = 0; index < count; index += 1) {
    const band: 0 | 1 = index % 2 === 0 ? 0 : 1;
    let hue: ParticleHue = 0;
    if (band === 0 && random() >= 0.5) {
      hue = 2;
    } else if (band === 1) {
      hue = random() >= 0.5 ? 3 : 1;
    }
    const particleSeed: ParticleSeed = {
      along: random(),
      angle: (index * GOLDEN_ANGLE) % (Math.PI * 2),
      band,
      hue,
      phase: random() * Math.PI * 2,
      reach: Math.sqrt((index + 0.5) / count),
      row: Math.floor(random() * READING_ROWS),
      spacing,
    };
    const home = formationTarget({ ...STILL, formation: "cloud", particle: particleSeed, timeS: 0 });
    particles.push({ seed: particleSeed, vx: 0, vy: 0, x: home.x, y: home.y });
  }
  return particles;
}

/** A shape with nobody talking, no flourish and no level: where a swarm is seeded. */
const STILL = { flow: 0, order: 0, spread: 0 } as const;

/** How far the cloud's lattice reaches, so a dot pulled toward a cloud near the rim stays inside the field. */
const CLOUD_REACH = 0.96;

/**
 * Where a particle belongs in a shape at an instant, and how bright it is there, at the shape's unit size. `timeS` is
 * the swarm's own clock — the caller runs it at the mood's pace — and `spread` is the voice's level as it MOVES the
 * swarm (`--move-lvl`), 0 to 1, which sets an edge shimmering; how far it SWELLS the shape is the caller's, at draw
 * time.
 *
 * @param formation the shape
 * @param particle the particle's seed
 * @param timeS the swarm's clock, seconds
 * @param spread the voice's level as it moves the swarm, 0 to 1
 * @param flow who is talking: −1 the owner, 1 the voice, 0 neither, and between while it eases from one to the other
 * @param order the rare flourish, 0 to 1: the shape's own motion lets go and its even structure shows
 * @returns its place and glow
 */
export function formationTarget({
  formation,
  particle,
  timeS,
  spread,
  flow,
  order,
}: {
  formation: ParticleFormation;
  particle: ParticleSeed;
  timeS: number;
  spread: number;
  flow: number;
  order: number;
}): ParticleTarget {
  const level = Math.min(1, Math.max(0, spread));
  switch (formation) {
    case "cloud":
      return cloudTarget({ flow, order, particle, timeS });
    case "vortex":
      return vortexTarget({ level, order, particle, timeS });
    case "lines":
      return linesTarget({ level, particle, timeS });
    case "loop":
      return loopTarget({ level, particle, timeS });
    case "rest":
      return restTarget({ particle, timeS });
    case "scatter":
      return scatterTarget({ level, particle, timeS });
    default: {
      const unreachable: never = formation;
      return unreachable;
    }
  }
}

/** A point at an angle and distance from the centre, never past {@link FIELD_REACH}. */
function polar({ angle, radius, glow }: { angle: number; radius: number; glow: number }): ParticleTarget {
  const r = Math.min(FIELD_REACH, Math.max(0, radius));
  return { glow: Math.min(1, Math.max(0, glow)), x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

/** The cloud: the lattice, lit and gathered by the two counter-turning layers of cloud (`particleCloud.ts`). */
function cloudTarget({
  particle,
  timeS,
  flow,
  order,
}: {
  particle: ParticleSeed;
  timeS: number;
  flow: number;
  order: number;
}): ParticleTarget {
  const place = cloudPlace({ flow, order, seat: particle, timeS });
  return clamped({ glow: place.glow, x: place.x * CLOUD_REACH, y: place.y * CLOUD_REACH });
}

/** How many spokes the vortex's flourish gathers each ring into. */
const SPOKES = 12;

/**
 * The vortex: the bands pulled apart into two rings, the outer one way, the inner the other way and quicker. Its
 * flourish gathers each ring's dots into spokes that turn with it, then lets them go.
 */
function vortexTarget({
  particle,
  timeS,
  level,
  order,
}: {
  particle: ParticleSeed;
  timeS: number;
  level: number;
  order: number;
}): ParticleTarget {
  const outer = particle.band === 0;
  let ring = 0.36;
  let turn = -1.05;
  if (outer) {
    ring = 0.68;
    turn = 0.62;
  }
  const loose = Math.min(1, Math.max(0, order));
  // Its spoke is fixed by its seat, so the gathering turns with the ring and no dot ever jumps to the next one.
  const step = (Math.PI * 2) / SPOKES;
  const spoke = Math.round(particle.angle / step) * step;
  const angle = particle.angle + (spoke - particle.angle) * loose + turn * timeS;
  const thickness = (0.16 + 0.3 * loose) * (particle.reach - 0.5);
  const wobble = 0.03 * (1 - loose) * Math.sin(2 * angle + 1.3 * timeS + particle.phase);
  return polar({
    angle,
    glow: 0.55 + 0.35 * Math.sin(angle * 2 + timeS) ** 2 + 0.1 * loose,
    radius: (ring + thickness + wobble) * (1 + 0.06 * level),
  });
}

/**
 * The rows of light: the swarm lines up like a paragraph, and a bright head reads along it a row at a time, the way
 * eyes do — the voice is reading, and this is the shape of it without a glyph.
 */
function linesTarget({
  particle,
  timeS,
  level,
}: {
  particle: ParticleSeed;
  timeS: number;
  level: number;
}): ParticleTarget {
  const row = Math.min(READING_ROWS - 1, Math.max(0, particle.row));
  const length = ROW_LENGTHS[row];
  const x = -ROW_HALF_WIDTH + particle.along * 2 * ROW_HALF_WIDTH * length;
  const y = (row - (READING_ROWS - 1) / 2) * ROW_GAP + 0.012 * Math.sin(2 * timeS + particle.phase);
  const cursor = readingCursor({ timeS });
  let glow = 0.28 + 0.12 * level;
  if (cursor.row === row) {
    const near = (x - cursor.x) / 0.14;
    glow += 0.72 * Math.exp(-near * near);
  }
  return clamped({ glow, x, y });
}

/** How long the reading head takes over one row, in the swarm's clock. */
const ROW_SECONDS = 1.1;

/**
 * Where the reading head is: which row, and how far along it, sweeping each row left to right in turn and starting
 * again at the top.
 *
 * @returns the row and the head's x in the normalised box
 */
export function readingCursor({ timeS }: { timeS: number }): { readonly row: number; readonly x: number } {
  const rows = Math.max(0, timeS) / ROW_SECONDS;
  const row = Math.floor(rows) % READING_ROWS;
  const length = ROW_LENGTHS[row];
  const share = rows - Math.floor(rows);
  return { row, x: -ROW_HALF_WIDTH + share * 2 * ROW_HALF_WIDTH * length };
}

/** The loop: the swarm streams round a closed teardrop leaning to one side — handing something on, never jumping. */
function loopTarget({
  particle,
  timeS,
  level,
}: {
  particle: ParticleSeed;
  timeS: number;
  level: number;
}): ParticleTarget {
  const angle = particle.along * Math.PI * 2 + 0.9 * timeS;
  const thickness = 1 + 0.35 * (particle.reach - 0.5) + 0.1 * level;
  const x = (0.12 + 0.62 * Math.cos(angle)) * thickness;
  const y = 0.3 * Math.sin(angle) * (0.62 + 0.38 * Math.cos(angle)) * thickness;
  return clamped({ glow: 0.4 + 0.5 * ((Math.cos(angle) + 1) / 2), x, y });
}

/** The rest: a stalled turn settles into a low, flat drift that barely moves. */
function restTarget({ particle, timeS }: { particle: ParticleSeed; timeS: number }): ParticleTarget {
  const angle = particle.angle + BAND_TURN[particle.band] * 0.25 * timeS;
  const x = Math.cos(angle) * particle.reach * 0.62;
  const y = 0.28 + Math.sin(angle) * particle.reach * 0.14;
  return clamped({ glow: 0.32 + 0.2 * (1 - particle.reach), x, y });
}

/** The scatter: an error throws the swarm wide, shivering. */
function scatterTarget({
  particle,
  timeS,
  level,
}: {
  particle: ParticleSeed;
  timeS: number;
  level: number;
}): ParticleTarget {
  const shiver = 0.03 * Math.sin(17 * timeS + 7 * particle.phase);
  return polar({
    angle: particle.angle + 0.05 * timeS * (particle.band === 0 ? 1 : -1),
    glow: 0.5 + 0.2 * level,
    radius: 0.32 + 0.6 * particle.reach + shiver,
  });
}

/** A point held inside the field's reach, keeping its direction. */
function clamped({ x, y, glow }: { x: number; y: number; glow: number }): ParticleTarget {
  return polar({ angle: Math.atan2(y, x), glow, radius: Math.hypot(x, y) });
}

/**
 * One step of a particle toward its place: a damped spring, plus a small drift of its own so the swarm is never
 * frozen in formation. `dtS` is wall time, never the mood's pace, so the swarm re-forms at the same speed whatever
 * it is doing; a step is capped at {@link MAX_STEP_S}, and a step of zero moves nothing.
 *
 * @param particle where it is now
 * @param target where it is pulled
 * @param dtS seconds since the last step
 * @param timeS the swarm's clock, for its own drift
 * @returns where it is after the step
 */
export function stepParticle({
  particle,
  target,
  dtS,
  timeS,
}: {
  particle: Particle;
  target: ParticleTarget;
  dtS: number;
  timeS: number;
}): Particle {
  const dt = Math.min(MAX_STEP_S, Math.max(0, dtS));
  if (dt === 0) {
    return particle;
  }
  const { phase } = particle.seed;
  const driftX = 0.18 * Math.sin(1.3 * timeS + 5 * phase);
  const driftY = 0.18 * Math.cos(1.1 * timeS + 3 * phase);
  const ax = SPRING * (target.x - particle.x) - DAMPING * particle.vx + driftX;
  const ay = SPRING * (target.y - particle.y) - DAMPING * particle.vy + driftY;
  const vx = particle.vx + ax * dt;
  const vy = particle.vy + ay * dt;
  return { seed: particle.seed, vx, vy, x: particle.x + vx * dt, y: particle.y + vy * dt };
}

/** The fewest particles any orb draws, so the corner's is still a swarm. */
export const MIN_PARTICLES = 120;

/**
 * The most any orb draws, so a large stage stays cheap. Dense enough that a cloud's crowded core reads as one solid
 * shape: the stage's ~300px box gets ~750 dots, about 8px apart before a cloud gathers them.
 */
export const MAX_PARTICLES = 800;

/** The CSS square pixels of orb each particle is drawn for. */
const AREA_PER_PARTICLE = 120;

/**
 * How many particles an orb of a size draws: in proportion to its area, so the stage's large orb is dense and the
 * corner's small one is cheap, between {@link MIN_PARTICLES} and {@link MAX_PARTICLES}.
 *
 * @param width the orb's box, CSS pixels
 * @param height the orb's box, CSS pixels
 * @returns the count
 */
export function particleCountFor({ width, height }: { width: number; height: number }): number {
  const byArea = Math.round((Math.max(0, width) * Math.max(0, height)) / AREA_PER_PARTICLE);
  return Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, byArea));
}
