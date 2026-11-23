/**
 * How the particles look MOVES as a whole, beside the shapes `site/lib/particleField.ts` draws: how far the voice
 * swells it, which way its clouds drift for who is talking, how a level is followed, and the rare flourish.
 *
 * The diameter follows the dynamic of both voices, the owner's and the voice's — so the swell is a scale applied when
 * the swarm is drawn, frame for frame, not a target its particles spring toward a moment later. Spectacle gets
 * annoying quickly, so the flourish is a little dice roll: once every few minutes, or one in twenty times it is
 * thinking, it does a little something extra.
 */
import type { OrbMood } from "./orbMood";
import type { ParticleFormation } from "./particleField";

/** Each shape's size with nobody talking and at the loudest, as a share of the field's reach. */
export const SWELL: Readonly<Record<ParticleFormation, { readonly rest: number; readonly loud: number }>> = {
  cloud: { loud: 1, rest: 0.66 },
  lines: { loud: 1, rest: 0.94 },
  loop: { loud: 1, rest: 0.9 },
  rest: { loud: 1, rest: 0.95 },
  scatter: { loud: 1, rest: 0.95 },
  vortex: { loud: 1, rest: 0.85 },
};

/**
 * How far a level swells a shape, as a scale on its unit size: the cloud half again as wide at the loudest, the
 * shapes that carry their own meaning less, so a reading row never balloons.
 *
 * @param formation the shape
 * @param level the voice's level as it moves the swarm, 0 to 1
 * @returns the scale
 */
export function swellOf({ formation, level }: { formation: ParticleFormation; level: number }): number {
  const { rest, loud } = SWELL[formation];
  return rest + (loud - rest) * Math.min(1, Math.max(0, level));
}

/**
 * Which way the cloud drifts for who is talking: in toward the middle while the OWNER speaks — drawn in, listening —
 * and out from it while the voice does. The colours and the states are clearly distinct for whether the owner is
 * talking or the voice is. The voice having just stopped for the owner is the owner's turn, so it draws in.
 *
 * @returns −1 for the owner, 1 for the voice, 0 for nobody
 */
export function flowOf({ mood }: { mood: OrbMood }): number {
  if (mood === "hearing" || mood === "yielded") {
    return -1;
  }
  if (mood === "speaking") {
    return 1;
  }
  return 0;
}

/**
 * How long the beat lasts when the voice stops for the owner, seconds: the swarm breaks off, draws in, and one ring of
 * light runs in from its rim to its heart, before it is simply hearing the owner. It is visual feedback that the voice
 * has stopped to listen, an interrupted-state indicator.
 */
export const YIELD_BEAT_S = 1.2;

/** The share of the beat spent catching — stopping and drawing in — before it lets go again. */
const YIELD_CATCH_SHARE = 0.12;

/** How much the swarm draws in at the height of the catch, as a share of its size. */
export const YIELD_DRAW_IN = 0.16;

/** How quickly the drift swings inward when the voice stops for the owner, per second: the hearing ease's four is a drift. */
export const YIELD_FLOW_RATE = 16;

/**
 * How far into the beat the swarm is, a time since the voice stopped for the owner.
 *
 * @param sinceS seconds since the mood became `yielded`; negative is before
 * @returns 0 outside the beat, else its progress, above 0 and below 1
 */
export function yieldBeat({ sinceS }: { sinceS: number }): number {
  if (sinceS <= 0 || sinceS >= YIELD_BEAT_S) {
    return 0;
  }
  return sinceS / YIELD_BEAT_S;
}

/**
 * How hard the swarm is caught at a point in the beat, 0 to 1: sharp on the way in — it STOPS — and slow on the way
 * out, so it eases into hearing the owner rather than snapping back.
 *
 * @param beat the beat's progress ({@link yieldBeat}), 0 outside it
 * @returns 0 at rest, 1 at the height of the catch
 */
export function yieldCatch({ beat }: { beat: number }): number {
  if (beat <= 0 || beat >= 1) {
    return 0;
  }
  let share = (1 - beat) / (1 - YIELD_CATCH_SHARE);
  if (beat < YIELD_CATCH_SHARE) {
    share = beat / YIELD_CATCH_SHARE;
  }
  return share * share * (3 - 2 * share);
}

/** How wide the ring of light the beat runs inward is, in the normalised box. */
const RIPPLE_WIDTH = 0.09;

/**
 * The light the beat's ring adds to a dot: one ring running in from the rim to the centre over the beat — the swarm
 * turning toward the owner — fading as it goes, so it lands softly into hearing.
 *
 * @param radius how far out the dot is now, in the normalised box
 * @param beat the beat's progress ({@link yieldBeat}), 0 outside it
 * @returns the glow to add, 0 to 1
 */
export function rippleGlow({ radius, beat }: { radius: number; beat: number }): number {
  if (beat <= 0 || beat >= 1) {
    return 0;
  }
  const near = (radius - (1 - beat)) / RIPPLE_WIDTH;
  return 0.85 * (1 - beat) * Math.exp(-near * near);
}

/**
 * Move a value toward a target at a rate per second, the same on a 60 Hz display as a 120 Hz one: the share moved in
 * a step is `1 − e^(−rate·dt)`. At rate 14 that is the ElevenLabs follower's 0.2 a frame at 60 Hz.
 *
 * @param current the value now
 * @param target where it is heading
 * @param dtS seconds since the last step
 * @param rate how quickly, per second
 * @returns the value after the step
 */
export function easeToward({
  current,
  target,
  dtS,
  rate,
}: {
  current: number;
  target: number;
  dtS: number;
  rate: number;
}): number {
  const share = 1 - Math.exp(-rate * Math.max(0, dtS));
  return current + (target - current) * share;
}

/** One in this many entries into thinking rolls the flourish. */
export const FLOURISH_ODDS = 20;

/** The flourish's three phases, seconds: gathering, holding, fizzling back out. */
export const FLOURISH_PHASES = { fizzle: 1.6, hold: 1.6, rise: 0.8 } as const;

/**
 * Whether a roll of the dice brings the flourish on: one in {@link FLOURISH_ODDS}. The roll is the caller's, so the
 * odds are exact under test.
 *
 * @param roll a uniform draw, 0 to 1
 * @returns true for the rare one
 */
export function rollsFlourish({ roll }: { roll: number }): boolean {
  return roll < 1 / FLOURISH_ODDS;
}

/** The fewest seconds between two flourishes while it listens. */
const IDLE_FLOURISH_FLOOR_S = 90;

/** The mean extra wait past that floor. */
const IDLE_FLOURISH_MEAN_S = 150;

/**
 * How long until the next flourish while it listens with nobody talking: "once every few minutes or so", never on a
 * beat the owner could learn to expect.
 *
 * @param roll a uniform draw, 0 to 1
 * @returns seconds from now
 */
export function idleFlourishAfterS({ roll }: { roll: number }): number {
  const draw = Math.min(0.999, Math.max(0, roll));
  return IDLE_FLOURISH_FLOOR_S - Math.log(1 - draw) * IDLE_FLOURISH_MEAN_S;
}

/** When the current flourish began, if one is running or has run, and when the next idle one is due. */
export interface FlourishClock {
  readonly startedS: number | undefined;
  readonly nextIdleS: number;
}

/** The fewest seconds of quiet after anything else before an idle flourish, so one never lands as a turn ends. */
export const IDLE_SETTLE_S = 20;

/**
 * Whether a flourish starts now: on one in {@link FLOURISH_ODDS} entries into thinking, and while it listens with
 * nobody talking once the idle timer comes due — never over one already running. Anything but listening holds the
 * idle timer at least `settleS` off, so a flourish waits for a settled quiet rather than firing the moment it begins.
 *
 * @param clock the last flourish and the idle timer
 * @param entered whether the swarm has just gathered into the thinking shape
 * @param idle whether it is listening with nobody talking
 * @param nowS the caller's wall clock, seconds
 * @param roll a uniform draw, 0 to 1, for the entry's dice
 * @param idleAfterS how long after an idle flourish the next one is due — {@link idleFlourishAfterS} on a call
 * @param settleS how long a quiet must last before an idle flourish — {@link IDLE_SETTLE_S} on a call
 * @returns the clock after this instant
 */
export function scheduleFlourish({
  clock,
  entered,
  idle,
  nowS,
  roll,
  idleAfterS,
  settleS,
}: {
  clock: FlourishClock;
  entered: boolean;
  idle: boolean;
  nowS: number;
  roll: number;
  idleAfterS: number;
  settleS: number;
}): FlourishClock {
  const { rise, hold, fizzle } = FLOURISH_PHASES;
  if (clock.startedS !== undefined && nowS - clock.startedS < rise + hold + fizzle) {
    return clock;
  }
  if (entered && rollsFlourish({ roll })) {
    return { nextIdleS: Math.max(clock.nextIdleS, nowS + settleS), startedS: nowS };
  }
  if (!idle) {
    if (clock.nextIdleS >= nowS + settleS) {
      return clock;
    }
    return { nextIdleS: nowS + settleS, startedS: clock.startedS };
  }
  if (nowS >= clock.nextIdleS) {
    return { nextIdleS: nowS + idleAfterS, startedS: nowS };
  }
  return clock;
}

/**
 * The flourish clock as what the swarm draws changes under it. A new shape or a new speaker ends a running flourish,
 * so it never hides that the owner has started talking. A preview ending starts the idle timer afresh, so nothing a
 * `?voice=sim` preview forced carries into the call that follows it on the same stage.
 *
 * @param clock the clock as the last frame left it
 * @param shifted whether the shape or who is talking changed this frame
 * @param previewEnded whether a made-up-voice preview stopped this frame
 * @param nowS the caller's wall clock, seconds
 * @param idleAfterS how long a fresh idle timer runs — {@link idleFlourishAfterS} on a call
 * @returns the clock to schedule from
 */
export function carryFlourish({
  clock,
  shifted,
  previewEnded,
  nowS,
  idleAfterS,
}: {
  clock: FlourishClock;
  shifted: boolean;
  previewEnded: boolean;
  nowS: number;
  idleAfterS: number;
}): FlourishClock {
  if (previewEnded) {
    return { nextIdleS: nowS + idleAfterS, startedS: undefined };
  }
  if (shifted && clock.startedS !== undefined) {
    return { nextIdleS: clock.nextIdleS, startedS: undefined };
  }
  return clock;
}

/**
 * How far into the flourish the swarm is, 0 to 1, a time since it began: it gathers, holds, and fizzles back out,
 * so its order is a brief appearance rather than a resting state.
 *
 * @param sinceS seconds since it began; negative is before
 * @returns its order
 */
export function flourishEnvelope({ sinceS }: { sinceS: number }): number {
  const { rise, hold, fizzle } = FLOURISH_PHASES;
  if (sinceS <= 0 || sinceS >= rise + hold + fizzle) {
    return 0;
  }
  let share = 1;
  if (sinceS < rise) {
    share = sinceS / rise;
  } else if (sinceS > rise + hold) {
    share = 1 - (sinceS - rise - hold) / fizzle;
  }
  return share * share * (3 - 2 * share);
}
