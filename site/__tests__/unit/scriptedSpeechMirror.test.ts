/*
 * The cut-ins count and the console agree on the progress line: when it was said, and that it is said no more.
 *
 * `src/talk/progressLine.ts` keeps the words of the progress line the console once spoke, before a sound
 * replaced it (`site/lib/orbCue.ts`), and restates `site/lib/planCallContract.ts`'s intervals
 * because `src/` never imports `site/`. This file, in the lane that reaches both roots, binds the intervals, holds the
 * console to scripting none of those words again — a scripted line matching them would be counted as a cut-in it
 * never was — and keeps every historical line readable, so the chart over older calls draws what happened.
 */

import { describe, expect, it } from "vitest";

import {
  CALL_LIFETIME_MS_MIRROR,
  cutInOf,
  PROGRESS_CLAUSES_MIRROR,
  PROGRESS_FIRST_MS_MIRROR,
  PROGRESS_OPENERS_MIRROR,
} from "../../../src/talk/progressLine";
import { PLAN_CALL_LIMITS } from "../../lib/planCallContract";
import { SCRIPTED_SPEECH } from "../../lib/talkPlanWords";

/** Every progress line the console could speak before it stopped: each opener with each clause. */
const HISTORICAL_LINES = PROGRESS_OPENERS_MIRROR.flatMap((opener) =>
  PROGRESS_CLAUSES_MIRROR.map((clause) => `${opener} ${clause}`),
);

describe("the cut-ins count and the console's retired progress line agree", () => {
  it("on how long a turn runs before the first progress cue, the line's old first interval", () => {
    expect(PROGRESS_FIRST_MS_MIRROR).toBe(PLAN_CALL_LIMITS.progressFirstMs);
  });

  it("on how long a call can last, which bounds a turn with no recorded end", () => {
    expect(CALL_LIFETIME_MS_MIRROR).toBe(PLAN_CALL_LIMITS.lifetimeMs);
  });

  it("and nothing the console scripts now holds a progress opener or reads as a progress line", () => {
    expect(SCRIPTED_SPEECH.length).toBeGreaterThan(0);
    const openers = PROGRESS_OPENERS_MIRROR.map((opener) => opener.replace(/[.!?]+$/u, "").toLowerCase());
    expect(SCRIPTED_SPEECH.filter((line) => openers.some((opener) => line.toLowerCase().includes(opener)))).toEqual([]);
    expect(SCRIPTED_SPEECH.filter((line) => cutInOf({ text: `The draft tags Kyle. ${line}` }) !== undefined)).toEqual(
      [],
    );
  });

  it("and every historical progress line is still found when it lands inside an answer", () => {
    expect(HISTORICAL_LINES.length).toBe(16);
    expect(HISTORICAL_LINES.filter((line) => cutInOf({ text: `The draft tags Kyle. ${line}` })?.line !== line)).toEqual(
      [],
    );
  });
});
