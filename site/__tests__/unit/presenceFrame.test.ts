/*
 * The orb's paint rate as a decision: a resting orb paints at most thirty times a second, anything live paints
 * every frame.
 */
import { describe, expect, it } from "vitest";

import { ORB_MOODS } from "../../lib/orbMood";
import {
  PRESENCE_MAX_STEP_MS,
  PRESENCE_REST_FPS,
  PRESENCE_REST_LEVEL_EPSILON,
  PRESENCE_REST_SLACK_MS,
  presenceRestIntervalMs,
  shouldPaintPresenceFrame,
} from "../../lib/presenceFrame";

/** One frame of a 60 Hz display, the slowest one the resting gap is bounded for, in milliseconds. */
const FRAME_60HZ_MS = 1000 / 60;

/**
 * The gap a resting orb waits on a display whose frames are `periodMs` apart: the first frame the gate paints.
 *
 * @param periodMs the display's frame period
 * @returns the milliseconds from one resting paint to the next
 */
const restingGapMs = ({ periodMs }: { periodMs: number }): number => {
  let gap = periodMs;
  while (!shouldPaintPresenceFrame({ elapsedMs: gap, level: 0, mood: "idle" })) {
    gap += periodMs;
  }
  return gap;
};

describe("presenceRestIntervalMs", () => {
  it("is a thirtieth of a second, under the loop's longest step", () => {
    expect(PRESENCE_REST_FPS).toBe(30);
    expect(presenceRestIntervalMs()).toBeCloseTo(33.3333, 4);
    expect(PRESENCE_MAX_STEP_MS).toBe(50);
    expect(presenceRestIntervalMs()).toBeLessThan(PRESENCE_MAX_STEP_MS);
  });

  it("keeps a resting gap under the step cap on any display at 60 Hz or faster", () => {
    expect(PRESENCE_REST_SLACK_MS).toBe(2);
    expect(presenceRestIntervalMs() - PRESENCE_REST_SLACK_MS + FRAME_60HZ_MS).toBeLessThan(PRESENCE_MAX_STEP_MS);
  });

  it.each([
    [60, 33.3333],
    [90, 33.3333],
    [120, 33.3333],
    [144, 34.7222],
  ])("rests a %d Hz display on a %s ms gap, inside the step cap", (hz, gapMs) => {
    expect(restingGapMs({ periodMs: 1000 / hz })).toBeCloseTo(gapMs, 3);
  });
});

describe("shouldPaintPresenceFrame", () => {
  it.each(["off", "idle"] as const)("holds a silent %s orb until a thirtieth of a second has passed", (mood) => {
    expect(shouldPaintPresenceFrame({ elapsedMs: 8.3, level: 0, mood })).toBe(false);
    expect(shouldPaintPresenceFrame({ elapsedMs: 25, level: 0, mood })).toBe(false);
    expect(shouldPaintPresenceFrame({ elapsedMs: 31.3, level: 0, mood })).toBe(false);
    expect(shouldPaintPresenceFrame({ elapsedMs: presenceRestIntervalMs(), level: 0, mood })).toBe(true);
    expect(shouldPaintPresenceFrame({ elapsedMs: 40, level: 0, mood })).toBe(true);
  });

  it.each(["off", "idle"] as const)("paints a silent %s orb on a 60 Hz second frame that jitters short", (mood) => {
    expect(shouldPaintPresenceFrame({ elapsedMs: 33.32, level: 0, mood })).toBe(true);
    expect(shouldPaintPresenceFrame({ elapsedMs: 31.34, level: 0, mood })).toBe(true);
  });

  it.each(["off", "idle"] as const)("keeps a %s orb at rest at exactly the level epsilon", (mood) => {
    expect(PRESENCE_REST_LEVEL_EPSILON).toBe(0.01);
    expect(shouldPaintPresenceFrame({ elapsedMs: 8.3, level: 0.01, mood })).toBe(false);
  });

  it.each(["off", "idle"] as const)("paints a %s orb every frame once its level is past the epsilon", (mood) => {
    expect(shouldPaintPresenceFrame({ elapsedMs: 0, level: 0.011, mood })).toBe(true);
  });

  it("paints every other mood every frame, silent or not", () => {
    const live = ORB_MOODS.filter((mood) => mood !== "off" && mood !== "idle");
    expect(live.length).toBe(ORB_MOODS.length - 2);
    expect(live.length).toBeGreaterThan(0);
    expect(live.filter((mood) => !shouldPaintPresenceFrame({ elapsedMs: 0, level: 0, mood }))).toEqual([]);
  });
});
