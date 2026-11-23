/**
 * The star cluster: a free-flowing field of crisp points that a moving sky of cloud lights up and gathers
 * (`site/lib/particleCloud.ts`), in a shape for what the voice is doing (`site/lib/particleField.ts`). It replaces an
 * iridescent orb: a free-form, free-flowing presence has no hard borders, no triangles coming out of the corner and no
 * white halo, and the colours spinning around in opposite directions at different paces are the part worth keeping.
 * The moving sky of cloud reads like cloudy skies whose clouds keep moving around, and its dots stay crisp little dots.
 *
 * **It reads the three numbers every presence reads**: the pace runs its clock, the move level SWELLS it — one scale
 * on the whole swarm as it is drawn, so its diameter follows each syllable of whoever is talking (`swellOf`,
 * `site/lib/particleMotion.ts`) — and the level lights it. Who is talking is in the cloud's drift: in toward the middle
 * while the owner speaks, out from it while the voice does (`flowOf`).
 *
 * **When the voice stops because the owner cut in** (`yielded`, `site/lib/voiceTurnTaking.ts`) the swarm answers their
 * "do I talk now?" in one beat (`yieldBeat`): its clock all but stops, its drift swings from outward to inward at once, it
 * draws in, and one ring of light runs in from its rim to its heart, before it is simply the hearing cloud.
 *
 * **Once in a while it does a little more** — one in twenty entries into thinking, and every few minutes while it
 * listens (`scheduleFlourish`): the clouds let go and the bare lattice shows as one crisp sunflower, or the thinking
 * rings gather into spokes, then it fizzles back. A `?voice=sim` preview does it every time, so it can be recorded.
 * Under reduce-motion the clock stops and there is no flourish: the swarm snaps to its mood's formation, never moving
 * into it, and while the mood holds it only swells.
 *
 * **The detail says how each point is drawn** (full screen must not give a trypophobia-type feeling): `refined` caps a lit point's growth so the big stage never draws a field of discs,
 * feathers the halo into three passes and nudges each point off the sunflower; `plain`, the corner's, draws the
 * lattice's own geometry (`site/lib/swarmDetail.ts`). The shape is {@link STAR_CLUSTER_STYLE}: sparse haloed points
 * twinkling, the halo a second, fainter point rather than a canvas blur.
 */
import type { OrbMood } from "../../lib/orbMood";
import {
  formationOf,
  formationTarget,
  type Particle,
  type ParticleFormation,
  particleCountFor,
  seedParticles,
  stepParticle,
} from "../../lib/particleField";
import {
  carryFlourish,
  easeToward,
  type FlourishClock,
  flourishEnvelope,
  flowOf,
  IDLE_SETTLE_S,
  idleFlourishAfterS,
  rippleGlow,
  SWELL,
  scheduleFlourish,
  YIELD_DRAW_IN,
  YIELD_FLOW_RATE,
  yieldBeat,
  yieldCatch,
} from "../../lib/particleMotion";
import { detailedPoint, haloPasses, swarmRadius } from "../../lib/swarmDetail";
import { STAR_CLUSTER_STYLE, SWARM_GREYS, swarmCount, twinkled } from "../../lib/swarmStyle";
import { type PresencePainter, type PresencePaintFrame, presenceLightOf } from "./presencePainter";

/** The field's reach as a share of the orb's half-width: past 1, inside the canvas's bleed, so points never meet its edge. */
const FIELD_SCALE = 1.25;

/** The seed every swarm is cut from, so the stage's and the corner's are the same swarm. */
const SWARM_SEED = 23;

/** How many brightness steps a frame batches its points into, per grey: few enough to be cheap, enough to be smooth. */
const ALPHA_STEPS = 8;

/** How quickly a change of shape's resting size, and of who is talking, eases in, per second. */
const SHAPE_RATE = 4;

/** How often a `?voice=sim` preview's idle flourish comes round, seconds. */
const SIM_IDLE_FLOURISH_S = 8;

/** How long a `?voice=sim` preview's quiet must last before its idle flourish, seconds. */
const SIM_IDLE_SETTLE_S = 2;

/** What the swarm carries from one frame to the next. */
interface SwarmState {
  readonly particles: readonly Particle[];
  /** Each particle's brightness this frame, in the particles' order. */
  readonly glows: readonly number[];
  readonly clock: number;
  readonly rest: number;
  readonly flow: number;
  readonly formation: ParticleFormation;
  readonly flourish: FlourishClock;
  /** Who was talking last frame: −1 the owner, 1 the voice, 0 nobody. */
  readonly speaker: number;
  /** Whether last frame was a made-up-voice preview. */
  readonly sim: boolean;
  /** When the voice stopped for the owner, while the mood still says so. */
  readonly yieldedAtS: number | undefined;
  /** How hard the swarm is caught by that stop this frame, 0 to 1 (`yieldCatch`). */
  readonly caught: number;
}

/**
 * The star cluster's painter: a fresh swarm, its first frame its resting cloud.
 *
 * @returns the painter
 */
export function makeSwarmPainter(): PresencePainter {
  let state: SwarmState = {
    caught: 0,
    clock: 0,
    flourish: { nextIdleS: idleFlourishAfterS({ roll: Math.random() }), startedS: undefined },
    flow: 0,
    formation: "cloud",
    glows: [],
    particles: [],
    rest: SWELL.cloud.rest,
    sim: false,
    speaker: 0,
    yieldedAtS: undefined,
  };
  return (frame) => {
    state = advance({ frame, state });
    drawSwarm({ frame, state });
  };
}

/** One frame of the swarm's life: the levels followed, the flourish rolled, every particle stepped toward its place. */
function advance({ state, frame }: { state: SwarmState; frame: PresencePaintFrame }): SwarmState {
  const { box, dtS, moving, mood, nowS, pace, sim } = frame;
  const count = swarmCount({
    areaCount: particleCountFor({ height: box, width: box }),
    density: STAR_CLUSTER_STYLE.density,
  });
  let { particles } = state;
  if (particles.length !== count) {
    particles = seedParticles({ count, seed: SWARM_SEED });
  }
  const formation = formationOf({ mood });
  const speaker = flowOf({ mood });
  const stop = yieldOf({ mood, moving, nowS, state });
  let clock = state.clock;
  let flourish = carryFlourish({
    clock: state.flourish,
    idleAfterS: idleFlourishAfterS({ roll: Math.random() }),
    nowS,
    previewEnded: state.sim && !sim,
    shifted: formation !== state.formation || speaker !== state.speaker,
  });
  if (moving) {
    // Caught by the voice stopping for the owner, its clock all but stops: the speaking flow visibly breaks off.
    clock += (dtS / pace) * (1 - 0.9 * stop.caught);
    if (sim && flourish.nextIdleS > nowS + SIM_IDLE_FLOURISH_S) {
      flourish = { ...flourish, nextIdleS: nowS + SIM_IDLE_FLOURISH_S };
    }
    let idleAfterS = idleFlourishAfterS({ roll: Math.random() });
    let roll = Math.random();
    let settleS = IDLE_SETTLE_S;
    if (sim) {
      idleAfterS = SIM_IDLE_FLOURISH_S;
      roll = 0;
      settleS = SIM_IDLE_SETTLE_S;
    }
    flourish = scheduleFlourish({
      clock: flourish,
      entered: formation === "vortex" && state.formation !== "vortex",
      idle: mood === "idle",
      idleAfterS,
      nowS,
      roll,
      settleS,
    });
  }
  let order = 0;
  if (moving && flourish.startedS !== undefined) {
    order = flourishEnvelope({ sinceS: nowS - flourish.startedS });
  }
  const moveLvl = frame.moveLevel;
  let flowRate = SHAPE_RATE;
  if (mood === "yielded") {
    // The drift swings from outward to inward at once, rather than easing over as it does between turns.
    flowRate = YIELD_FLOW_RATE;
  }
  const flow = easeToward({ current: state.flow, dtS, rate: flowRate, target: speaker });
  const glows: number[] = [];
  const stepped = particles.map((particle) => {
    const target = formationTarget({ flow, formation, order, particle: particle.seed, spread: moveLvl, timeS: clock });
    if (!moving) {
      glows.push(target.glow);
      return { ...particle, vx: 0, vy: 0, x: target.x, y: target.y };
    }
    const next = stepParticle({ dtS, particle, target, timeS: clock });
    glows.push(target.glow + rippleGlow({ beat: stop.beat, radius: Math.hypot(next.x, next.y) }));
    return next;
  });
  return {
    caught: stop.caught,
    clock,
    flourish,
    flow,
    formation,
    glows,
    particles: stepped,
    rest: easeToward({ current: state.rest, dtS, rate: SHAPE_RATE, target: SWELL[formation].rest }),
    sim,
    speaker,
    yieldedAtS: stop.atS,
  };
}

/**
 * The voice stopping for the owner, as this frame draws it: when it began while the mood still says so, how far into the
 * beat the swarm is, and how hard that beat has caught it. Under reduce-motion there is no beat; the colour and the
 * words still change.
 */
function yieldOf({ state, mood, nowS, moving }: { state: SwarmState; mood: OrbMood; nowS: number; moving: boolean }): {
  readonly atS: number | undefined;
  readonly beat: number;
  readonly caught: number;
} {
  if (mood !== "yielded") {
    return { atS: undefined, beat: 0, caught: 0 };
  }
  let atS = nowS;
  if (state.yieldedAtS !== undefined) {
    atS = state.yieldedAtS;
  }
  if (!moving) {
    return { atS, beat: 0, caught: 0 };
  }
  const beat = yieldBeat({ sinceS: nowS - atS });
  return { atS, beat, caught: yieldCatch({ beat }) };
}

/**
 * Draw the swarm: every point the same crisp round, batched into one path per grey and brightness step, the whole
 * swarm scaled by the voice's swell. A brighter point is a little larger, so a cloud's gathered core overlaps into one
 * solid shape, which reads better than separate dots — by at most a few pixels when refined,
 * so the full-screen view is the corner's points of light rather than a magnified field of discs (`swarmDetail.ts`).
 */
function drawSwarm({ frame, state }: { frame: PresencePaintFrame; state: SwarmState }): void {
  const { ctx, box, detail, w, h } = frame;
  const style = STAR_CLUSTER_STYLE;
  const colours = SWARM_GREYS;
  const loud = SWELL[state.formation].loud;
  const swell = state.rest + (loud - state.rest) * Math.min(1, Math.max(0, frame.moveLevel));
  // The voice stopping for the owner draws the whole swarm in, a held breath, before it lets go into hearing them.
  const half = (box / 2) * FIELD_SCALE * swell * (1 - YIELD_DRAW_IN * state.caught);
  const dot = Math.min(2.2, Math.max(1, box / 190));
  const paths = colours.map(() => Array.from({ length: ALPHA_STEPS }, () => new Path2D()));
  // One set of batched paths per halo pass — one when plain, three feathered when refined — never a path per point.
  const passAlphas = haloPasses({ detail, halo: style.halo, radius: 1 }).map((pass) => pass.alpha);
  const halos = passAlphas.map(() => colours.map(() => Array.from({ length: ALPHA_STEPS }, () => new Path2D())));
  state.particles.forEach((particle, index) => {
    // Stepped in the same pass as its particle, so every particle has its glow.
    const glow = twinkled({
      depth: style.twinkle,
      glow: Math.min(1, Math.max(0, state.glows[index])),
      phase: particle.seed.phase,
      timeS: state.clock,
    });
    const step = Math.min(ALPHA_STEPS - 1, Math.floor(glow * ALPHA_STEPS));
    const path = paths.at(particle.seed.hue)?.at(step);
    if (path === undefined) {
      return;
    }
    const at = detailedPoint({
      detail,
      phase: particle.seed.phase,
      spacing: particle.seed.spacing,
      x: particle.x,
      y: particle.y,
    });
    const radius = swarmRadius({
      detail,
      glow,
      overlap: style.overlap,
      reach: particle.seed.spacing * half,
      rest: dot * 0.75 * style.size,
    });
    const x = w / 2 + at.x * half;
    const y = h / 2 + at.y * half;
    path.moveTo(x + radius, y);
    path.arc(x, y, radius, 0, Math.PI * 2);
    haloPasses({ detail, halo: style.halo, radius }).forEach((pass, which) => {
      const halo = halos.at(which)?.at(particle.seed.hue)?.at(step);
      halo?.moveTo(x + pass.radius, y);
      halo?.arc(x, y, pass.radius, 0, Math.PI * 2);
    });
  });
  const light = presenceLightOf({ level: frame.level });
  // Where two points cross, their light adds, so a gathered cloud climbs the ramp: toward white on a dark ground,
  // toward the deeper colour on a light one.
  ctx.globalCompositeOperation = "lighter";
  paths.forEach((steps, hue) => {
    const colour = colours.at(hue);
    if (colour === undefined) {
      return;
    }
    ctx.fillStyle = colour;
    halos.forEach((pass, index) => {
      const alpha = passAlphas.at(index)!;
      pass.at(hue)?.forEach((halo, step) => {
        ctx.globalAlpha = Math.min(1, ((step + 0.5) / ALPHA_STEPS) * light * alpha);
        ctx.fill(halo);
      });
    });
    steps.forEach((path, step) => {
      ctx.globalAlpha = Math.min(1, ((step + 0.5) / ALPHA_STEPS) * light);
      ctx.fill(path);
    });
  });
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}
