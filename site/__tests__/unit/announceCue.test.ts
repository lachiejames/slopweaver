/*
 * The four herald chimes: each is told apart by its
 * shape, each is over before the server's lead is up, each is louder than any work cue, and none waits for quiet.
 */
import { describe, expect, it } from "vitest";

import {
  ANNOUNCE_CUE_MEANINGS,
  ANNOUNCE_CUES,
  ANNOUNCE_KEPT,
  ANNOUNCE_LEAD_MS,
  ANNOUNCE_TONES,
  announceStaleReason,
  type HeardHerald,
  triageDingStaleReason,
  unheardHeralds,
  withHerald,
} from "../../lib/announceCue";
import { CUE_SOUNDS, CUE_TONES, type Tone } from "../../lib/orbCue";

/** When the last of `tones` ends. */
const endMs = (tones: readonly Tone[]): number => Math.max(...tones.map((t) => t.startMs + t.lengthMs));

/** The loudest of `tones`. */
const peak = (tones: readonly Tone[]): number => Math.max(...tones.map((t) => t.gain));

describe("ANNOUNCE_TONES", () => {
  it("strikes each herald in its own shape: one bell, two rising, two falling, three level", () => {
    expect(ANNOUNCE_CUES.length).toBeGreaterThan(0);
    const fundamentals = ANNOUNCE_CUES.map((cue) =>
      ANNOUNCE_TONES[cue].filter((t) => t.gain >= 0.08).map((t) => t.fromHz),
    );
    expect(fundamentals).toEqual([[659], [784, 587], [523, 784], [698, 698, 698]]);
  });

  it("ends every herald well inside the lead the server waits before the line", () => {
    expect(ANNOUNCE_CUES.map((cue) => endMs(ANNOUNCE_TONES[cue]))).toEqual([580, 570, 340, 450]);
    expect(Math.max(...ANNOUNCE_CUES.map((cue) => endMs(ANNOUNCE_TONES[cue])))).toBeLessThanOrEqual(
      ANNOUNCE_LEAD_MS - 400,
    );
  });

  it("is louder than every work cue, and quieter than the drop cue's 0.18", () => {
    const work = CUE_SOUNDS.flatMap((sound) => Object.values(CUE_TONES[sound]).flat());
    expect(work.length).toBeGreaterThan(0);
    const loudestWork = peak(work);
    expect(ANNOUNCE_CUES.filter((cue) => peak(ANNOUNCE_TONES[cue]) <= loudestWork)).toEqual([]);
    expect(ANNOUNCE_CUES.map((cue) => peak(ANNOUNCE_TONES[cue]))).toEqual([0.095, 0.085, 0.08, 0.08]);
  });

  it("names a meaning for every herald, and none for anything else", () => {
    expect(Object.keys(ANNOUNCE_CUE_MEANINGS).toSorted()).toEqual([...ANNOUNCE_CUES].toSorted());
  });
});

describe("announceStaleReason", () => {
  it("drops a herald once the call is down, whatever the owner's sounds are", () => {
    expect(announceStaleReason({ callActive: false, setting: "chimes" })).toBe("no-call");
    expect(announceStaleReason({ callActive: false, setting: "off" })).toBe("no-call");
  });

  it("drops a herald when the owner's sounds are off", () => {
    expect(announceStaleReason({ callActive: true, setting: "off" })).toBe("sound-off");
  });

  it("plays the same herald under every sound the owner can pick, with no question of who is talking", () => {
    expect(CUE_SOUNDS.map((setting) => announceStaleReason({ callActive: true, setting }))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("triageDingStaleReason", () => {
  it("drops the page's chime once a call is up anywhere, whose own line is the chime, whatever the owner's sounds are", () => {
    expect(triageDingStaleReason({ callUpAnywhere: true, setting: "chimes" })).toBe("call-up");
    expect(triageDingStaleReason({ callUpAnywhere: true, setting: "off" })).toBe("call-up");
  });

  it("drops it off a call when the owner's sounds are off", () => {
    expect(triageDingStaleReason({ callUpAnywhere: false, setting: "off" })).toBe("sound-off");
  });

  it("plays it off a call under every sound the owner can pick", () => {
    expect(CUE_SOUNDS.length).toBeGreaterThan(0);
    expect(CUE_SOUNDS.map((setting) => triageDingStaleReason({ callUpAnywhere: false, setting }))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("withHerald / unheardHeralds", () => {
  it("keeps two heralds set in one render, so a player that last took neither plays both in order", () => {
    const kept = withHerald({ cue: "done", kept: withHerald({ cue: "focus", kept: [] }) });
    expect(kept).toEqual([
      { cue: "focus", seq: 1 },
      { cue: "done", seq: 2 },
    ]);
    expect(unheardHeralds({ heard: 0, kept })).toEqual(kept);
    expect(unheardHeralds({ heard: 1, kept })).toEqual([{ cue: "done", seq: 2 }]);
    expect(unheardHeralds({ heard: 2, kept })).toEqual([]);
  });

  it("numbers two of the same kind apart and drops the oldest past the kept count", () => {
    let kept: readonly HeardHerald[] = [];
    for (let i = 0; i < ANNOUNCE_KEPT + 1; i += 1) {
      kept = withHerald({ cue: "focus", kept });
    }
    expect(kept.map(({ seq }) => seq)).toEqual([2, 3, 4, 5]);
  });
});
