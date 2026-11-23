/*
 * What `planEffectHandler` asks the console for off each plan effect: a look line, a finding-it line and a frame at
 * the hand-off of the owner's look or lookup ask, and the voice-turn and voice-finished inputs the activity fold reads. Every
 * seam is a plain recording fake; nothing is mocked.
 */
import { describe, expect, it } from "vitest";

import { planEffectHandler } from "../../components/voice/planWiringEffects";
import type { PlanEffect } from "../../lib/talkPlanEvents";
import type { ActivityInput } from "../../lib/voiceActivity";

describe("planEffectHandler on a look the owner asked for", () => {
  /** A handler that records, by effect number, each look line and frame it asked for. */
  const recording = () => {
    const looks: number[] = [];
    const asks: string[] = [];
    const frames: number[] = [];
    let effects = 0;
    const handle = planEffectHandler({
      act: () => undefined,
      framing: () => frames.push(effects),
      gateLog: { current: [] },
      looking: ({ ask }) => {
        looks.push(effects);
        asks.push(ask);
      },
      note: () => undefined,
      show: () => undefined,
    });
    const run = (effect: PlanEffect): void => {
      effects += 1;
      handle(effect);
    };
    return { asks, frames, looks, run };
  };

  it("asks for the look line once, at the hand-off of the owner's look ask, and never for a voice that already spoke", () => {
    const { looks, frames, run } = recording();
    run({ final: false, id: "t-1", kind: "segment", text: " Look at my screen", who: "owner" });
    run({ id: "d-1", kind: "delegated", target: "codex" });
    run({ id: "d-2", kind: "delegated", target: "codex" });
    run({ final: false, id: "t-2", kind: "segment", text: " So here it is", who: "owner" });
    run({ id: "d-3", kind: "delegated", target: "codex" });
    run({ kind: "spoke" });
    run({ final: false, id: "t-2", kind: "segment", text: " So here it is, take a look at this", who: "owner" });
    run({ final: false, id: "t-3", kind: "segment", text: " Screenshot, please", who: "owner" });
    run({ id: "d-4", kind: "delegated", target: "codex" });
    expect(looks).toEqual([2, 9]);
    // The frame does not wait on the voice's silence: turn 2's late look ask still gets one.
    expect(frames).toEqual([2, 7, 9]);
  });

  // "Could you look at my screen for a second", then "Having a look now." from the voice itself and no
  // hand-off — so no line from the console, but the frame all the same.
  it("asks for the frame when the owner's look ask is final with no hand-off, and no look line over the voice's own", () => {
    const { looks, frames, run } = recording();
    run({ final: false, id: "t-1", kind: "segment", text: " Can you take a look", who: "owner" });
    run({
      final: true,
      id: "t-1",
      kind: "segment",
      text: " Could you look at my screen for a second",
      who: "owner",
    });
    run({ final: true, id: "v-1", kind: "segment", text: " Having a look now.", who: "voice" });
    run({ id: "d-1", kind: "delegated", target: "codex" });
    expect([looks, frames]).toEqual([[], [2]]);
  });

  it("asks for no frame on a hand-off that never asked for a look", () => {
    const { looks, frames, run } = recording();
    run({ final: false, id: "t-1", kind: "segment", text: " Archive it", who: "owner" });
    run({ id: "d-1", kind: "delegated", target: "codex" });
    expect([looks, frames]).toEqual([[], []]);
  });

  // "bring up the Jasper card" can go a minute with no word from the voice.
  it("asks for the finding-it line, and no frame, at the hand-off of the owner's lookup ask", () => {
    const { asks, looks, frames, run } = recording();
    run({ final: false, id: "t-1", kind: "segment", text: " you can look this up, right?", who: "owner" });
    run({ id: "d-1", kind: "delegated", target: "codex" });
    expect([asks, looks, frames]).toEqual([["find"], [2], []]);
  });
});

// "Good, yeah, that's clear." asks the owner nothing, and the page has to know that.
describe("planEffectHandler on the voice's finished turn", () => {
  it("feeds the fold each voice turn's ID, whether each finished one ended on a question, and only the owner's turn's state for the owner's", () => {
    const acts: ActivityInput[] = [];
    const handle = planEffectHandler({
      act: ({ input }) => {
        acts.push(input);
      },
      framing: () => undefined,
      gateLog: { current: [] },
      looking: () => undefined,
      note: () => undefined,
      show: () => undefined,
    });
    handle({ final: false, id: "v-1", kind: "segment", text: " Is that", who: "voice" });
    handle({ final: true, id: "v-1", kind: "segment", text: " Is that it?", who: "voice" });
    handle({ final: false, id: "t-1", kind: "segment", text: " That's exactly", who: "owner" });
    handle({ final: true, id: "t-1", kind: "segment", text: " Yes, that's the one, thanks", who: "owner" });
    handle({ final: true, id: "v-2", kind: "segment", text: " Good, yeah, that's clear .", who: "voice" });
    handle({ final: true, id: "v-3", kind: "segment", text: ' You said "ship it?"', who: "voice" });
    handle({ final: true, id: "v-4", kind: "segment", text: " ", who: "voice" });
    // A promise that started nothing, a promise put as a question, and one put as a tag question the transcript
    // carried with no "?".
    handle({ final: true, id: "v-5", kind: "segment", text: " Right. Let me check those. One sec.", who: "voice" });
    handle({ final: true, id: "v-6", kind: "segment", text: " Let me check that for you?", who: "voice" });
    handle({ final: true, id: "v-7", kind: "segment", text: " Let me check that for you, okay", who: "voice" });
    // A measured call: an answer the voice closed on a promise of its own.
    handle({ final: true, id: "v-8", kind: "segment", text: " The check failed. I'll keep digging.", who: "voice" });
    expect(acts).toEqual([
      { id: "v-1", kind: "voice-turn" },
      { id: "v-1", kind: "voice-turn" },
      { asked: true, kind: "voice-finished", promised: false },
      { event: { final: false, id: "t-1", kind: "segment" }, kind: "owner" },
      { event: { final: true, id: "t-1", kind: "segment" }, kind: "owner" },
      { id: "v-2", kind: "voice-turn" },
      { asked: false, kind: "voice-finished", promised: false },
      { id: "v-3", kind: "voice-turn" },
      { asked: true, kind: "voice-finished", promised: false },
      { id: "v-4", kind: "voice-turn" },
      { id: "v-5", kind: "voice-turn" },
      { asked: false, kind: "voice-finished", promised: "whole-turn" },
      { id: "v-6", kind: "voice-turn" },
      { asked: true, kind: "voice-finished", promised: false },
      { id: "v-7", kind: "voice-turn" },
      { asked: false, kind: "voice-finished", promised: false },
      { id: "v-8", kind: "voice-turn" },
      { asked: false, kind: "voice-finished", promised: "terminal" },
    ]);
  });
});
