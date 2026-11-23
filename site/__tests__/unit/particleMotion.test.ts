/*
 * How the particles look moves as a whole: the swell with a voice, the drift for who is talking, the level follower,
 * and the rare flourish — plus the two speakers' colours, which must read apart at a glance.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ORB_MOODS } from "../../lib/orbMood";
import { PARTICLE_FORMATIONS } from "../../lib/particleField";
import {
  carryFlourish,
  easeToward,
  FLOURISH_ODDS,
  FLOURISH_PHASES,
  flourishEnvelope,
  flowOf,
  idleFlourishAfterS,
  rippleGlow,
  rollsFlourish,
  scheduleFlourish,
  swellOf,
  YIELD_BEAT_S,
  yieldBeat,
  yieldCatch,
} from "../../lib/particleMotion";

const LENGTH = FLOURISH_PHASES.rise + FLOURISH_PHASES.hold + FLOURISH_PHASES.fizzle;

describe("swellOf", () => {
  it("swells the cloud half again as wide at the loudest, and every shape to its full reach", () => {
    expect(swellOf({ formation: "cloud", level: 1 }) / swellOf({ formation: "cloud", level: 0 })).toBeGreaterThan(1.5);
    expect(PARTICLE_FORMATIONS.map((formation) => swellOf({ formation, level: 1 }))).toEqual(
      PARTICLE_FORMATIONS.map(() => 1),
    );
  });

  it("holds a level outside 0 to 1 to the shape's own range", () => {
    expect(swellOf({ formation: "cloud", level: -2 })).toBe(swellOf({ formation: "cloud", level: 0 }));
    expect(swellOf({ formation: "cloud", level: 7 })).toBe(1);
  });

  it("swells the cloud most of all, and a reading row barely, so it never balloons", () => {
    const growth = ({ formation }: { formation: (typeof PARTICLE_FORMATIONS)[number] }): number =>
      swellOf({ formation, level: 1 }) - swellOf({ formation, level: 0 });
    expect(Math.max(...PARTICLE_FORMATIONS.map((formation) => growth({ formation })))).toBe(
      growth({ formation: "cloud" }),
    );
    expect(growth({ formation: "lines" })).toBeLessThan(0.1);
  });
});

describe("flowOf", () => {
  it("draws the cloud in for the owner and once it stops for them, out for the voice, and neither way for anything else", () => {
    expect(flowOf({ mood: "hearing" })).toBe(-1);
    expect(flowOf({ mood: "yielded" })).toBe(-1);
    expect(flowOf({ mood: "speaking" })).toBe(1);
    const talking = new Set(["hearing", "yielded", "speaking"]);
    expect(ORB_MOODS.filter((mood) => !talking.has(mood) && flowOf({ mood }) !== 0)).toEqual([]);
  });
});

describe("the beat when the voice stops for the owner", () => {
  it("runs only inside its length", () => {
    expect(yieldBeat({ sinceS: 0 })).toBe(0);
    expect(yieldBeat({ sinceS: YIELD_BEAT_S / 2 })).toBe(0.5);
    expect(yieldBeat({ sinceS: YIELD_BEAT_S })).toBe(0);
  });

  it("catches hard and fast, then lets go slowly", () => {
    expect(yieldCatch({ beat: 0.12 })).toBe(1);
    expect(yieldCatch({ beat: 0.06 })).toBeCloseTo(0.5, 9);
    expect(yieldCatch({ beat: 0.56 })).toBeCloseTo(0.5, 9);
    expect(yieldCatch({ beat: 0 })).toBe(0);
    expect(yieldCatch({ beat: 1 })).toBe(0);
  });

  it("runs one ring of light in from the rim to the centre, fading as it goes", () => {
    expect(rippleGlow({ beat: 0.25, radius: 0.75 })).toBeCloseTo(0.6375, 9);
    expect(rippleGlow({ beat: 0.25, radius: 0.2 })).toBeLessThan(0.001);
    expect(rippleGlow({ beat: 0.75, radius: 0.25 })).toBeCloseTo(0.2125, 9);
    expect(rippleGlow({ beat: 0, radius: 1 })).toBe(0);
  });
});

describe("easeToward", () => {
  it("moves the same distance in a second at 60 frames a second as at 120", () => {
    let at60 = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      at60 = easeToward({ current: at60, dtS: 1 / 60, rate: 14, target: 1 });
    }
    let at120 = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      at120 = easeToward({ current: at120, dtS: 1 / 120, rate: 14, target: 1 });
    }
    expect(at60).toBeCloseTo(at120, 10);
  });

  it("moves a fifth of the way in one 60 Hz frame at rate 14, and nowhere in no time", () => {
    expect(easeToward({ current: 0, dtS: 1 / 60, rate: 14, target: 1 })).toBeCloseTo(0.208, 3);
    expect(easeToward({ current: 0.3, dtS: 0, rate: 14, target: 1 })).toBe(0.3);
    expect(easeToward({ current: 0.3, dtS: -1, rate: 14, target: 1 })).toBe(0.3);
  });
});

describe("rollsFlourish", () => {
  it("comes up on exactly one in twenty rolls", () => {
    const rolls = Array.from({ length: 2000 }, (_, index) => (index + 0.5) / 2000);
    expect(FLOURISH_ODDS).toBe(20);
    expect(rolls.filter((roll) => rollsFlourish({ roll }))).toHaveLength(100);
  });
});

describe("idleFlourishAfterS", () => {
  it("never comes round sooner than a minute and a half, and waits longer on a higher roll", () => {
    expect(idleFlourishAfterS({ roll: 0 })).toBe(90);
    expect(idleFlourishAfterS({ roll: -3 })).toBe(90);
    expect(idleFlourishAfterS({ roll: 0.5 })).toBeCloseTo(90 + 150 * Math.LN2);
    expect(idleFlourishAfterS({ roll: 1 })).toBe(idleFlourishAfterS({ roll: 0.999 }));
  });
});

describe("scheduleFlourish", () => {
  const quiet = { nextIdleS: 500, startedS: undefined };
  const base = { clock: quiet, entered: false, idle: false, idleAfterS: 120, nowS: 100, roll: 0.5, settleS: 20 };

  it("starts one on a lucky entry into thinking, and not on an unlucky one", () => {
    expect(scheduleFlourish({ ...base, entered: true, roll: 0.01 })).toEqual({ nextIdleS: 500, startedS: 100 });
    expect(scheduleFlourish({ ...base, entered: true, roll: 0.06 })).toBe(quiet);
  });

  it("starts one while it listens once the idle timer is due, and books the next", () => {
    expect(scheduleFlourish({ ...base, idle: true, nowS: 499 })).toBe(quiet);
    expect(scheduleFlourish({ ...base, idle: true, nowS: 500 })).toEqual({ nextIdleS: 620, startedS: 500 });
  });

  it("never starts one over one already running, and allows the next once it has fizzled out", () => {
    const running = { nextIdleS: 0, startedS: 100 };
    expect(
      scheduleFlourish({ ...base, clock: running, entered: true, idle: true, nowS: 100 + LENGTH - 0.01, roll: 0 }),
    ).toBe(running);
    expect(scheduleFlourish({ ...base, clock: running, entered: true, nowS: 100 + LENGTH, roll: 0 })).toEqual({
      nextIdleS: 100 + LENGTH + 20,
      startedS: 100 + LENGTH,
    });
  });

  it("holds the idle flourish a settled quiet off while anything else goes on, so it never lands as a turn ends", () => {
    const talking = scheduleFlourish({ ...base, nowS: 9999, roll: 0 });
    expect(talking).toEqual({ nextIdleS: 10019, startedS: undefined });
    expect(scheduleFlourish({ ...base, clock: talking, idle: true, nowS: 10018 })).toBe(talking);
    expect(scheduleFlourish({ ...base, clock: talking, idle: true, nowS: 10019 })).toEqual({
      nextIdleS: 10139,
      startedS: 10019,
    });
  });

  it("leaves a timer already further off than the settle alone while something else goes on", () => {
    expect(scheduleFlourish({ ...base, nowS: 480, roll: 0 })).toBe(quiet);
  });
});

describe("carryFlourish", () => {
  const running = { nextIdleS: 400, startedS: 100 };
  const base = { clock: running, idleAfterS: 150, nowS: 101, previewEnded: false, shifted: false };

  it("keeps a running flourish while nothing changes under it", () => {
    expect(carryFlourish(base)).toBe(running);
  });

  it("ends a running flourish when the shape or the speaker changes, so it never hides the owner starting to talk", () => {
    expect(carryFlourish({ ...base, shifted: true })).toEqual({ nextIdleS: 400, startedS: undefined });
  });

  it("starts the idle timer afresh when a made-up-voice preview ends, so nothing it forced reaches a call", () => {
    expect(carryFlourish({ ...base, previewEnded: true })).toEqual({ nextIdleS: 251, startedS: undefined });
    expect(carryFlourish({ ...base, clock: { nextIdleS: 105, startedS: undefined }, previewEnded: true })).toEqual({
      nextIdleS: 251,
      startedS: undefined,
    });
  });
});

describe("flourishEnvelope", () => {
  it("gathers from nothing, holds whole, and fizzles back to nothing", () => {
    expect(flourishEnvelope({ sinceS: -1 })).toBe(0);
    expect(flourishEnvelope({ sinceS: 0 })).toBe(0);
    expect(flourishEnvelope({ sinceS: FLOURISH_PHASES.rise / 2 })).toBeCloseTo(0.5);
    expect(flourishEnvelope({ sinceS: FLOURISH_PHASES.rise + FLOURISH_PHASES.hold / 2 })).toBe(1);
    expect(flourishEnvelope({ sinceS: LENGTH - FLOURISH_PHASES.fizzle / 2 })).toBeCloseTo(0.5);
    expect(flourishEnvelope({ sinceS: LENGTH })).toBe(0);
  });
});

describe("the two speakers' colours", () => {
  /** Every mood's ring hue, read from the one class that sets them; the theme's own colour has none fixed. */
  const hues = new Map(
    [
      ...readFileSync(join(__dirname, "../../components/voice/orbParts.tsx"), "utf8").matchAll(
        /data-\[mood=([a-z]+)\]:\[--v-ring:oklch\([\d.]+_[\d.]+_([\d.]+)\)\]/gu,
      ),
    ].map((match) => [match[1], Number(match[2])]),
  );
  const apart = ({ a, b }: { a: number; b: number }): number => {
    const turn = Math.abs(a - b) % 360;
    return Math.min(turn, 360 - turn);
  };

  it("puts the owner and the voice at least sixty degrees apart on the wheel", () => {
    expect(apart({ a: hues.get("hearing")!, b: hues.get("speaking")! })).toBeGreaterThanOrEqual(60);
  });

  it("keeps every other cloud or thinking mood at least thirty degrees off the owner's colour", () => {
    expect(hues.size).toBeGreaterThan(10);
    const near = ["speaking", "thinking", "working", "writing", "code"].filter(
      (mood) => apart({ a: hues.get("hearing")!, b: hues.get(mood)! }) < 30,
    );
    expect(near).toEqual([]);
  });

  it("lights stopping for the owner in their own colour, well off the voice's", () => {
    expect(apart({ a: hues.get("hearing")!, b: hues.get("yielded")! })).toBeLessThan(30);
    expect(apart({ a: hues.get("speaking")!, b: hues.get("yielded")! })).toBeGreaterThanOrEqual(45);
  });

  it("keeps the voice speaking apart from thinking and relaying, which it alternates with inside one reply", () => {
    const near = ["thinking", "relaying"].filter(
      (mood) => apart({ a: hues.get("speaking")!, b: hues.get(mood)! }) < 25,
    );
    expect(near).toEqual([]);
  });

  it("keeps the voice speaking out of the green band that reads badly on the neon look", () => {
    const green = ["speaking"].filter((mood) => hues.get(mood)! >= 100 && hues.get(mood)! <= 180);
    expect(green).toEqual([]);
  });
});
