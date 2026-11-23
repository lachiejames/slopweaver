/*
 * A call that drops makes a sound; a call the owner or the page ended, or one that never went live, does not
 * (the owner is not always looking at the computer when it happens).
 */
import { describe, expect, it } from "vitest";

import {
  CallDropCue,
  CONNECTING_CUE_EVERY_MS,
  CONNECTING_CUE_FIRST_MS,
  callCueTones,
  shouldPlayCallDropCue,
} from "../../lib/callDropCue";

const LIMIT = "the plan call ended: the console's own 90-minute call limit was reached";

/**
 * A cue over a counter in place of the speaker.
 *
 * @returns the cue and how many times it has played
 */
function counted(): { cue: CallDropCue; played: { count: number } } {
  const played = { count: 0 };
  const cue = new CallDropCue({
    play: () => {
      played.count += 1;
    },
  });
  return { cue, played };
}

describe("CallDropCue", () => {
  it("plays once for a live call that drops, however many times its teardown reports the end", () => {
    const { cue, played } = counted();
    cue.wentLive();
    cue.ended({ ownerEnding: false, why: LIMIT });
    cue.ended({ ownerEnding: false, why: "the connection closed" });
    expect(played.count).toBe(1);
  });

  it("stays silent for a call that ends before it went live, and for the owner's own end of a live one", () => {
    const { cue, played } = counted();
    cue.ended({ ownerEnding: false, why: "the microphone was not available: denied" });
    cue.wentLive();
    cue.ended({ ownerEnding: true, why: LIMIT });
    expect(played.count).toBe(0);
  });

  it("plays again for the next call that goes live and drops", () => {
    const { cue, played } = counted();
    cue.wentLive();
    cue.ended({ ownerEnding: false, why: LIMIT });
    cue.wentLive();
    cue.ended({ ownerEnding: false, why: LIMIT });
    expect(played.count).toBe(2);
  });

  // The drop sounds when the link is read lost (`site/lib/callLink.ts`), before the call is ended.
  it("plays at the loss, and stays silent for the drop that ends the same call — still answering it was a drop", () => {
    const { cue, played } = counted();
    cue.wentLive();
    cue.lost();
    cue.lost();
    const dropped = cue.ended({ ownerEnding: false, why: LIMIT });
    expect([played.count, dropped]).toEqual([1, true]);
  });

  it("plays again for a second loss after the link healed", () => {
    const { cue, played } = counted();
    cue.wentLive();
    cue.lost();
    cue.healed();
    cue.lost();
    expect(played.count).toBe(2);
  });

  it("stays silent for a loss read on a call that is not live", () => {
    const { cue, played } = counted();
    cue.lost();
    cue.wentLive();
    cue.ended({ ownerEnding: true, why: LIMIT });
    cue.lost();
    expect(played.count).toBe(0);
  });

  // The answer is what reconnects the call (`site/lib/callReconnect.ts`), so the two can never disagree on a drop.
  it("answers whether the end was a drop, once per live call", () => {
    const { cue } = counted();
    cue.wentLive();
    const answers = [
      cue.ended({ ownerEnding: false, why: LIMIT }),
      cue.ended({ ownerEnding: false, why: "the connection closed" }),
    ];
    cue.wentLive();
    answers.push(cue.ended({ ownerEnding: false, why: undefined }));
    expect(answers).toEqual([true, false, false]);
  });
});

// A Messenger-style cut-out. A drop is overlapping falling glides clipped off; back is their mirror.
describe("callCueTones", () => {
  it("cuts the drop out: a bright glide falling and clipped in 8ms, a lower body falling under its start", () => {
    const [bright, body] = callCueTones({ kind: "drop" });
    expect([bright.fromHz, bright.toHz, bright.startS, bright.lengthS, bright.releaseS]).toEqual([
      780, 310, 0, 0.28, 0.008,
    ]);
    expect([body.fromHz, body.toHz, body.startS, body.lengthS]).toEqual([330, 190, 0.04, 0.12]);
    expect(body.startS).toBeLessThan(bright.startS + bright.lengthS);
  });

  it("brings it back on the same glides rising, the bright one resolving rather than cut", () => {
    const [drop] = callCueTones({ kind: "drop" });
    const [bright, body] = callCueTones({ kind: "back" });
    expect([bright.fromHz, bright.toHz, body.fromHz, body.toHz]).toEqual([310, 780, 190, 330]);
    expect(bright.releaseS).toBe(0.06);
    expect(bright.releaseS).toBeGreaterThan(drop.releaseS);
  });

  // Disconnected, reconnected and connecting each get a different sound.
  it("says connecting with two quiet pips at one pitch — neither falling nor rising, and softer than both", () => {
    const [first, second] = callCueTones({ kind: "connecting" });
    const [dropBright] = callCueTones({ kind: "drop" });
    const [backBright] = callCueTones({ kind: "back" });
    expect([first.fromHz, first.toHz, second.fromHz, second.toHz]).toEqual([523, 523, 523, 523]);
    expect([first.startS, first.lengthS, second.startS, second.lengthS]).toEqual([0, 0.07, 0.16, 0.07]);
    expect(second.startS).toBeGreaterThan(first.startS + first.lengthS);
    expect([first.gain, second.gain]).toEqual([0.45, 0.45]);
    expect(first.gain).toBeLessThan(dropBright.gain);
    expect(first.gain).toBeLessThan(backBright.gain);
  });

  it("repeats the connecting cue after the drop cue has finished, and not before", () => {
    const [bright, body] = callCueTones({ kind: "drop" });
    const dropEndsMs = Math.max(bright.startS + bright.lengthS, body.startS + body.lengthS) * 1000;
    expect(CONNECTING_CUE_FIRST_MS).toBeGreaterThan(dropEndsMs);
    expect(CONNECTING_CUE_EVERY_MS).toBe(2_500);
  });
});

describe("shouldPlayCallDropCue", () => {
  it("sounds for a live call ending with a reason the owner did not ask for", () => {
    expect(shouldPlayCallDropCue({ ownerEnding: false, wasLive: true, why: LIMIT })).toBe(true);
  });

  it("stays silent when a reason races the owner's own press of end", () => {
    expect(shouldPlayCallDropCue({ ownerEnding: true, wasLive: true, why: "the session ended — timeout" })).toBe(false);
  });

  it("stays silent for the owner's hang-up or a page leave, which carry no reason", () => {
    expect(shouldPlayCallDropCue({ ownerEnding: false, wasLive: true, why: undefined })).toBe(false);
  });

  it("stays silent for a start that failed before the call was live", () => {
    expect(
      shouldPlayCallDropCue({ ownerEnding: false, wasLive: false, why: "the microphone was not available: denied" }),
    ).toBe(false);
  });
});
