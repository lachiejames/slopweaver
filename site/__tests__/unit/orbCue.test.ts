/*
 * The orb's sound says what its badge says, without saying too much: once per badge, never
 * over either voice, still due when it plays, one sound for a flicker, and nothing for an error the drop cue already
 * sounds — in whichever of a few sounds the owner picked.
 */
import { describe, expect, it } from "vitest";

import {
  CUE_GAP_MS,
  CUE_REPEAT_MS,
  CUE_SOUNDS,
  CUE_TONES,
  type CueMoment,
  type CueNow,
  cueOfBadge,
  cueStaleReason,
  cueStillDue,
  isOrbCueSetting,
  latchDue,
  ORB_CUES,
  OrbCuer,
  PROGRESS_CUE,
  progressCueStaleReason,
  progressCueStillDue,
  sampleStaleReason,
  sampleStillDue,
} from "../../lib/orbCue";

/**
 * A cuer over a hand-driven clock, and a one-argument way to show it a moment.
 *
 * @returns the cuer's `see`, and the clock's hand
 */
function driven(): { see: (moment: CueMoment) => string | undefined; clock: { now: number } } {
  const clock = { now: 10_000 };
  const cuer = new OrbCuer({ clock: () => clock.now });
  return { clock, see: (moment) => cuer.observe({ moment }) };
}

/**
 * Show the cuer one moment per step, the clock moving `everyMs` between them.
 *
 * @returns what each step played, `undefined` for silence
 */
function walk({ steps, everyMs }: { steps: readonly CueMoment[]; everyMs: number }): readonly (string | undefined)[] {
  const { clock, see } = driven();
  return steps.map((step) => {
    clock.now += everyMs;
    return see(step);
  });
}

describe("OrbCuer", () => {
  it("announces each new badge once, however many renders wear it", () => {
    const played = walk({
      everyMs: 7000,
      steps: [
        { audible: true, badge: "thinking" },
        { audible: true, badge: "thinking" },
        { audible: true, badge: "looking" },
        { audible: true, badge: "looking" },
        { audible: true, badge: "relaying" },
      ],
    });
    expect(played).toEqual(["thinking", undefined, "looking", undefined, "relaying"]);
  });

  it("holds a badge over speech and announces it at the first quiet moment it is still worn", () => {
    const played = walk({
      everyMs: 500,
      steps: [
        { audible: false, badge: "looking" },
        { audible: false, badge: "looking" },
        { audible: true, badge: "looking" },
      ],
    });
    expect(played).toEqual([undefined, undefined, "looking"]);
  });

  it("never announces work that ended while somebody was talking", () => {
    const played = walk({
      everyMs: 500,
      steps: [
        { audible: false, badge: "looking" },
        { audible: false, badge: undefined },
        { audible: true, badge: undefined },
      ],
    });
    expect(played).toEqual([undefined, undefined, undefined]);
  });

  it("announces only the badge worn now when another replaced it over speech", () => {
    const played = walk({
      everyMs: 500,
      steps: [
        { audible: false, badge: "looking" },
        { audible: false, badge: "code" },
        { audible: true, badge: "code" },
      ],
    });
    expect(played).toEqual([undefined, undefined, "code"]);
  });

  it(`makes tool after tool inside ${String(CUE_GAP_MS)} ms one sound, and opens again exactly at the gap`, () => {
    const { clock, see } = driven();
    const first = see({ audible: true, badge: "code" });
    clock.now += CUE_GAP_MS - 1;
    const inside = see({ audible: true, badge: "slack" });
    clock.now += 1;
    const sameBadgeAfter = see({ audible: true, badge: "slack" });
    const next = see({ audible: true, badge: "looking" });
    expect([first, inside, sameBadgeAfter, next]).toEqual(["code", undefined, undefined, "looking"]);
  });

  it(`does not repeat a cue inside ${String(CUE_REPEAT_MS)} ms, and does exactly at it`, () => {
    const { clock, see } = driven();
    const played = [see({ audible: true, badge: "thinking" })];
    clock.now += 2000;
    played.push(see({ audible: true, badge: "code" }));
    clock.now += CUE_REPEAT_MS - 2001;
    played.push(see({ audible: true, badge: "thinking" }));
    played.push(see({ audible: true, badge: undefined }));
    clock.now += 1;
    played.push(see({ audible: true, badge: "thinking" }));
    expect(played).toEqual(["thinking", "code", undefined, undefined, "thinking"]);
  });

  it("is silent for the error badge, the drop cue's to sound, and for the badge clearing", () => {
    const played = walk({
      everyMs: 7000,
      steps: [
        { audible: true, badge: "error" },
        { audible: true, badge: undefined },
        { audible: true, badge: "stalled" },
      ],
    });
    expect(played).toEqual([undefined, undefined, "stalled"]);
  });
});

describe("OrbCuer.decide", () => {
  it("says a badge was held over speech once, then plays it at the first quiet moment still wearing it", () => {
    const cuer = new OrbCuer({ clock: () => 10_000 });
    const decided = [
      cuer.decide({ moment: { audible: false, badge: "looking" } }),
      cuer.decide({ moment: { audible: false, badge: "looking" } }),
      cuer.decide({ moment: { audible: true, badge: "looking" } }),
    ];
    expect(decided).toEqual([{ cue: "looking", kind: "held" }, undefined, { cue: "looking", kind: "play" }]);
  });

  it("says each badge held over speech, so one that came and went while somebody talked is on the record", () => {
    const cuer = new OrbCuer({ clock: () => 10_000 });
    const decided = [
      cuer.decide({ moment: { audible: false, badge: "looking" } }),
      cuer.decide({ moment: { audible: false, badge: "working" } }),
      cuer.decide({ moment: { audible: false, badge: undefined } }),
      cuer.decide({ moment: { audible: true, badge: undefined } }),
    ];
    expect(decided).toEqual([{ cue: "looking", kind: "held" }, { cue: "working", kind: "held" }, undefined, undefined]);
  });

  it(`names the throttle that silenced a cue: the ${String(CUE_GAP_MS)} ms gap, or the ${String(CUE_REPEAT_MS)} ms repeat`, () => {
    const clock = { now: 10_000 };
    const cuer = new OrbCuer({ clock: () => clock.now });
    const first = cuer.decide({ moment: { audible: true, badge: "code" } });
    clock.now += CUE_GAP_MS - 1;
    const gap = cuer.decide({ moment: { audible: true, badge: "slack" } });
    clock.now += CUE_GAP_MS;
    const repeat = cuer.decide({ moment: { audible: true, badge: "code" } });
    expect([first, gap, repeat]).toEqual([
      { cue: "code", kind: "play" },
      { cue: "slack", kind: "throttled", why: "gap" },
      { cue: "code", kind: "throttled", why: "repeat" },
    ]);
  });
});

/** A quiet call with the orb looking and chimes picked, for one field at a time to be moved off. */
const STILL: CueNow = { badge: "looking", quiet: true, setting: "chimes" };

describe("cueStaleReason", () => {
  it("names no check while the cue is still due", () => {
    expect(cueStaleReason({ cue: "looking", now: STILL, sound: "chimes" })).toBe(undefined);
  });

  it("names the first failed check: talking or no call before the pick, the pick before the badge", () => {
    const everything: CueNow = { badge: "code", quiet: false, setting: "taps" };
    expect(cueStaleReason({ cue: "looking", now: everything, sound: "chimes" })).toBe("not-quiet");
    expect(cueStaleReason({ cue: "looking", now: { ...everything, quiet: true }, sound: "chimes" })).toBe(
      "sound-changed",
    );
    expect(cueStaleReason({ cue: "looking", now: { ...STILL, badge: "code" }, sound: "chimes" })).toBe("badge-moved");
  });
});

describe("progressCueStaleReason", () => {
  it("names a superseded event before ended work, and ended work before talking", () => {
    const talking: CueNow = { ...STILL, quiet: false };
    const reasons = [
      progressCueStaleReason({ expected: 2, generation: 3, now: talking, sound: "chimes", workRunning: false }),
      progressCueStaleReason({ expected: 3, generation: 3, now: talking, sound: "chimes", workRunning: false }),
      progressCueStaleReason({ expected: 3, generation: 3, now: talking, sound: "chimes", workRunning: true }),
      progressCueStaleReason({ expected: 3, generation: 3, now: STILL, sound: "glass", workRunning: true }),
      progressCueStaleReason({ expected: 3, generation: 3, now: STILL, sound: "chimes", workRunning: true }),
    ];
    expect(reasons).toEqual(["superseded", "work-ended", "not-quiet", "sound-changed", undefined]);
  });
});

describe("sampleStaleReason", () => {
  it("names talking or no call, then a changed pick, and nothing for a due sample whatever the badge", () => {
    const reasons = [
      sampleStaleReason({ now: { ...STILL, quiet: false }, sound: "chimes" }),
      sampleStaleReason({ now: STILL, sound: "taps" }),
      sampleStaleReason({ now: { ...STILL, badge: undefined }, sound: "chimes" }),
    ];
    expect(reasons).toEqual(["not-quiet", "sound-changed", undefined]);
  });
});

describe("cueStillDue", () => {
  it("lets a cue play while the call is quiet, the orb still wears its badge and its sound is still picked", () => {
    expect(cueStillDue({ cue: "looking", now: STILL, sound: "chimes" })).toBe(true);
  });

  it("drops a cue once somebody talks or the call ends", () => {
    expect(cueStillDue({ cue: "looking", now: { ...STILL, quiet: false }, sound: "chimes" })).toBe(false);
  });

  it("drops a cue once its badge moved on or cleared while it waited", () => {
    expect(cueStillDue({ cue: "looking", now: { ...STILL, badge: "code" }, sound: "chimes" })).toBe(false);
    expect(cueStillDue({ cue: "looking", now: { ...STILL, badge: undefined }, sound: "chimes" })).toBe(false);
  });

  it("drops a cue once the sounds went off or to another sound while it waited", () => {
    expect(cueStillDue({ cue: "looking", now: { ...STILL, setting: "off" }, sound: "chimes" })).toBe(false);
    expect(cueStillDue({ cue: "looking", now: { ...STILL, setting: "taps" }, sound: "chimes" })).toBe(false);
  });
});

describe("sampleStillDue", () => {
  it("plays a pick's sample on a quiet call while it is still the pick, whatever the badge", () => {
    expect(sampleStillDue({ now: { ...STILL, badge: undefined, setting: "taps" }, sound: "taps" })).toBe(true);
  });

  it("never plays a sample off a call or over speech", () => {
    expect(sampleStillDue({ now: { ...STILL, quiet: false, setting: "taps" }, sound: "taps" })).toBe(false);
  });

  it("drops a sample once the pick went back to off or on to another sound", () => {
    expect(sampleStillDue({ now: { ...STILL, setting: "off" }, sound: "taps" })).toBe(false);
    expect(sampleStillDue({ now: { ...STILL, setting: "glass" }, sound: "taps" })).toBe(false);
  });
});

describe("latchDue", () => {
  /**
   * Ask a latched question once per answer the live one gives, in order.
   *
   * @returns what the latched question answered each time
   */
  function asked({ answers }: { answers: readonly (string | undefined)[] }): readonly (string | undefined)[] {
    let at = 0;
    const once = latchDue({ due: () => answers[at] });
    return answers.map((_, index) => {
      at = index;
      return once();
    });
  }

  it("answers the speaker for as long as the live answer holds", () => {
    expect(asked({ answers: ["", "", ""] })).toEqual(["", "", ""]);
  });

  it("stays ended once the sound stopped being due, even when the moment comes back", () => {
    expect(asked({ answers: ["H", undefined, "H"] })).toEqual(["H", undefined, undefined]);
  });

  it("ends when the speaker changed, and stays ended when it changes back", () => {
    expect(asked({ answers: ["H", "", "H"] })).toEqual(["H", undefined, undefined]);
  });

  it("is never due when its first answer was not", () => {
    expect(asked({ answers: [undefined, "H"] })).toEqual([undefined, undefined]);
  });
});

describe("progressCueStillDue", () => {
  /** One instant a waiting progress cue reads, as `OrbCues.tsx`'s live ref holds it. */
  interface ProgressLive {
    readonly now: CueNow;
    readonly generation: number;
    readonly workRunning: boolean;
    readonly speaker: string;
  }

  /** A quiet call on chimes, the badge irrelevant, the third progress event, a turn running, the default speaker. */
  const QUIET: ProgressLive = {
    generation: 3,
    now: { badge: undefined, quiet: true, setting: "chimes" },
    speaker: "",
    workRunning: true,
  };

  /**
   * Ask a progress cue sent at generation 3 in chimes, latched as `playOrbCue` latches it, once per instant in order.
   *
   * @returns the speaker it would play on at each instant, or `undefined` once it is not due
   */
  function played({ instants }: { instants: readonly ProgressLive[] }): readonly (string | undefined)[] {
    let at = 0;
    const once = latchDue({
      due: () => {
        const { now, generation, workRunning, speaker } = instants[at];
        if (!progressCueStillDue({ expected: 3, generation, now, sound: "chimes", workRunning })) {
          return undefined;
        }
        return speaker;
      },
    });
    return instants.map((_, index) => {
      at = index;
      return once();
    });
  }

  it("plays the working cue on a quiet call while the work runs and the sound is picked, whatever the badge", () => {
    expect(PROGRESS_CUE).toBe("working");
    expect(played({ instants: [QUIET, { ...QUIET, now: { ...QUIET.now, badge: "code" } }] })).toEqual(["", ""]);
  });

  it("never plays over speech, and stays dropped when the call goes quiet again", () => {
    const talking = { ...QUIET, now: { ...QUIET.now, quiet: false } };
    expect(played({ instants: [talking, QUIET] })).toEqual([undefined, undefined]);
    expect(played({ instants: [QUIET, talking, QUIET] })).toEqual(["", undefined, undefined]);
  });

  it("drops once the owner's sounds went off or to another sound, or the speaker changed, while it waited on routing", () => {
    const off = { ...QUIET, now: { ...QUIET.now, setting: "off" as const } };
    const glass = { ...QUIET, now: { ...QUIET.now, setting: "glass" as const } };
    expect(played({ instants: [QUIET, off] })).toEqual(["", undefined]);
    expect(played({ instants: [QUIET, glass, QUIET] })).toEqual(["", undefined, undefined]);
    expect(played({ instants: [QUIET, { ...QUIET, speaker: "headset" }] })).toEqual(["", undefined]);
  });

  it("drops once the work completed before routing finished, so a cue never lands on the answer", () => {
    expect(played({ instants: [QUIET, { ...QUIET, workRunning: false }] })).toEqual(["", undefined]);
    expect(played({ instants: [{ ...QUIET, workRunning: false }] })).toEqual([undefined]);
  });

  it("drops a stale generation: a newer progress event, or a replayed one behind it, supersedes the cue", () => {
    expect(played({ instants: [QUIET, { ...QUIET, generation: 4 }] })).toEqual(["", undefined]);
    expect(played({ instants: [{ ...QUIET, generation: 5 }] })).toEqual([undefined]);
  });
});

describe("cueOfBadge", () => {
  it("names the cue for every work badge and the stall, and none for error or no badge", () => {
    expect(cueOfBadge({ badge: "slack" })).toBe("slack");
    expect(cueOfBadge({ badge: "stalled" })).toBe("stalled");
    expect(cueOfBadge({ badge: "error" })).toBeUndefined();
    expect(cueOfBadge({ badge: undefined })).toBeUndefined();
  });
});

describe("CUE_TONES", () => {
  const cues = CUE_SOUNDS.flatMap((sound) =>
    Object.entries(CUE_TONES[sound]).map(([cue, notes]) => ({ cue: `${sound}.${cue}`, notes })),
  );

  it("has notes for exactly the cues, in every sound", () => {
    expect(Object.keys(CUE_TONES).toSorted()).toEqual([...CUE_SOUNDS].toSorted());
    const keys = CUE_SOUNDS.map((sound) => Object.keys(CUE_TONES[sound]).toSorted());
    expect(keys).toEqual(CUE_SOUNDS.map(() => [...ORB_CUES].toSorted()));
  });

  it("keeps every cue under a quarter second, one to three notes", () => {
    expect(cues.length).toBe(30);
    const long = cues.filter(
      ({ notes }) => notes.length < 1 || notes.length > 3 || notes.some((n) => n.startMs + n.lengthMs > 250),
    );
    expect(long).toEqual([]);
  });

  it("keeps every note quiet — at most 0.06, under the drop cue's 0.18 — and audible", () => {
    expect(cues.length).toBe(30);
    const loud = cues.filter(({ notes }) => notes.some((n) => n.gain <= 0 || n.gain > 0.06));
    expect(loud).toEqual([]);
  });

  it("starts every note at or after the cue, with a real length and pitch", () => {
    expect(cues.length).toBe(30);
    const broken = cues.filter(({ notes }) =>
      notes.some((n) => n.startMs < 0 || n.lengthMs <= 0 || n.fromHz <= 0 || n.toHz <= 0),
    );
    expect(broken).toEqual([]);
  });

  it("gives each cue a sound of its own within a sound, so the kinds of work can be told apart", () => {
    const same = CUE_SOUNDS.filter(
      (sound) => new Set(ORB_CUES.map((cue) => JSON.stringify(CUE_TONES[sound][cue]))).size !== ORB_CUES.length,
    );
    expect(same).toEqual([]);
  });

  it("rises for looking and sinks for a stall in the chimes, and ticks lowest for a stall in the taps", () => {
    expect(CUE_TONES.chimes.looking.map((n) => n.fromHz)).toEqual([440, 660]);
    expect(CUE_TONES.chimes.stalled).toEqual([
      { fromHz: 180, gain: 0.045, lengthMs: 200, startMs: 0, toHz: 150, wave: "sine" },
    ]);
    const lowest = Math.min(...ORB_CUES.flatMap((cue) => CUE_TONES.taps[cue].map((n) => n.fromHz)));
    expect(CUE_TONES.taps.stalled.map((n) => n.fromHz)).toEqual([lowest]);
  });
});

describe("isOrbCueSetting", () => {
  it("accepts off and each sound, and nothing else", () => {
    expect(["off", "chimes", "taps", "glass", "on", "true", undefined].map((value) => isOrbCueSetting(value))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
