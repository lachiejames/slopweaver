/*
 * The console's voice picker offers exactly the plan voices the verb can mint, in the same order, starting where
 * the verb starts.
 *
 * `site/` cannot import `src/` at build time, so the list is copied; this test is what makes the copy safe.
 * It reads the verb's list from `src/talk/planVoices.ts`, which imports nothing the site build lacks, so a voice
 * added on one side only fails here.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TALK_PLAN_VOICE as VERB_PLAN_DEFAULT,
  TALK_PLAN_VOICE_NAMES as VERB_PLAN_VOICES,
} from "../../../src/talk/planVoices";
import {
  DEFAULT_TALK_PLAN_VOICE,
  isStoredTalkPlanVoice,
  isTalkPlanVoice,
  planVoiceNeedsRestart,
  TALK_PLAN_VOICES,
} from "../../lib/talkVoices";

describe("the console's plan voice list", () => {
  it("holds the verb's plan voices, in order, starting on sol", () => {
    expect(TALK_PLAN_VOICES.length).toBeGreaterThan(0);
    expect(TALK_PLAN_VOICES).toEqual([...VERB_PLAN_VOICES]);
    expect(DEFAULT_TALK_PLAN_VOICE).toBe(VERB_PLAN_DEFAULT);
  });

  it("refuses a name the mint would refuse, and a platform.openai voice is one", () => {
    expect(isTalkPlanVoice({ name: "arbor" })).toBe(true);
    expect(isTalkPlanVoice({ name: "../sol" })).toBe(false);
    expect(isTalkPlanVoice({ name: "cedar" })).toBe(false);
  });
});

describe("a voice read back from storage", () => {
  it("is kept only when it is a string naming a plan voice", () => {
    expect(["sol", "cedar", 7, undefined].map((value) => isStoredTalkPlanVoice(value))).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("planVoiceNeedsRestart", () => {
  it("offers a restart only when a running call was minted in a voice other than the one picked now", () => {
    expect(planVoiceNeedsRestart({ active: "sol", callActive: true, selected: "arbor" })).toBe(true);
    expect(planVoiceNeedsRestart({ active: "sol", callActive: true, selected: "sol" })).toBe(false);
    expect(planVoiceNeedsRestart({ active: undefined, callActive: true, selected: "arbor" })).toBe(false);
    expect(planVoiceNeedsRestart({ active: "sol", callActive: false, selected: "arbor" })).toBe(false);
  });
});
