/**
 * The Codex ranking's policy, asserted as exact orders over hand-built observations.
 *
 * Every case here is pure: `rankCodexPlans` takes a snapshot's observations and an instant, so a fixture is
 * a complete test and nothing reaches a real Codex home. The one property these hold down together is that
 * an ABSENT reading can never be mistaken for a full one — the failure that would send every new seat to
 * whichever account nobody has ever run a turn on.
 */
import { describe, expect, it } from "vitest";

import { gauge, NOW, OBSERVED, observation, rankCodexPlans, weeklyAt, window } from "./rankFixtures.js";

describe("ranking registered Codex destinations", () => {
  it("sends new work to the least-used week, which is the ruling this extends", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [weeklyAt({ alias: "codex-one", percent: 60 }), weeklyAt({ alias: "codex-two", percent: 5 })],
    });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-two", "codex-one"]);
    expect(ranking.basis).toBe("weekly");
  });

  it("sends new work to the week an hour from its reset with 38 points still on it, over one barely started", () => {
    // An owner ruling: 80% resetting in an hour is not 80% that reset an hour ago. The 60% home's line stands at
    // 99 × (167/168) ≈ 98.4, so it is ~38.4 behind; the 5% home's week opened just now, so it is 5 ahead.
    // Ranked on level alone, those 38 points strand at the reset.
    const soonReset = observation({
      alias: "codex-soon",
      gauge: gauge({ windows: [window({ resetAtIso: "2026-09-22T13:00:00.000Z", usedPercent: 60 })] }),
    });

    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [weeklyAt({ alias: "codex-idle", percent: 5 }), soonReset],
    });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-soon", "codex-idle"]);
  });

  it("counts the line in POINTS, so a home near its wall never outranks an empty one further behind", () => {
    // 78% a day from its reset: line 99 × 6/7 ≈ 84.9, ~6.9 behind. 0% six days out: line 99 × 1/7 ≈ 14.1,
    // ~14.1 behind. Points per hour left would invert this and pile every spawn onto the nearly-walled home.
    const nearWall = observation({
      alias: "codex-near-wall",
      gauge: gauge({ windows: [window({ resetAtIso: "2026-09-23T12:00:00.000Z", usedPercent: 78 })] }),
    });
    const empty = observation({
      alias: "codex-empty",
      gauge: gauge({ windows: [window({ resetAtIso: "2026-09-28T12:00:00.000Z", usedPercent: 0 })] }),
    });

    const ranking = rankCodexPlans({ nowIso: NOW, observations: [nearWall, empty] });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-empty", "codex-near-wall"]);
  });

  it("judges the line NOW, so the home nobody has spent in three days reads as far behind as it is", () => {
    // Both weeks reset four days out, so both lines stand at 99 × 3/7 ≈ 42.4 now. The idle home read 20%
    // three days ago — 22.4 behind now. Judged at its own instant (line 0) it would read 20 AHEAD and lose
    // to the busy home at 30%, which is 12.4 behind.
    const reset = "2026-09-26T12:00:00.000Z";
    const idle = observation({
      alias: "codex-idle",
      gauge: gauge({
        observedAtIso: "2026-09-19T12:00:00.000Z",
        windows: [window({ resetAtIso: reset, usedPercent: 20 })],
      }),
    });
    const busy = observation({
      alias: "codex-busy",
      gauge: gauge({ windows: [window({ resetAtIso: reset, usedPercent: 30 })] }),
    });

    const ranking = rankCodexPlans({ nowIso: NOW, observations: [busy, idle] });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-idle", "codex-busy"]);
  });

  it("ranks a weekly reading with no reset behind every lined one and ahead of every unmeasured one", () => {
    const unlined = observation({
      alias: "codex-unlined",
      gauge: gauge({
        windows: [{ label: "weekly", resetAtIso: undefined, slot: "primary", usedPercent: 10, windowMinutes: 10080 }],
      }),
    });

    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        observation({ alias: "codex-fresh", gauge: undefined }),
        unlined,
        weeklyAt({ alias: "codex-lined", percent: 90 }),
      ],
    });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual([
      "codex-lined",
      "codex-unlined",
      "codex-fresh",
    ]);
    expect(ranking.deferredUnmeasured).toEqual(["codex-fresh"]);
    expect(ranking.basis).toBe("weekly-partial");
  });

  it("breaks an exact weekly tie on the five-hour window, then on the earlier reset", () => {
    const busyHour = observation({
      alias: "codex-busy-hour",
      gauge: gauge({
        windows: [
          window({ usedPercent: 40 }),
          window({ label: "five-hour", slot: "secondary", usedPercent: 90, windowMinutes: 300 }),
        ],
      }),
    });
    const quietHour = observation({
      alias: "codex-quiet-hour",
      gauge: gauge({
        windows: [
          window({ usedPercent: 40 }),
          window({ label: "five-hour", slot: "secondary", usedPercent: 10, windowMinutes: 300 }),
        ],
      }),
    });

    const ranking = rankCodexPlans({ nowIso: NOW, observations: [busyHour, quietHour] });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-quiet-hour", "codex-busy-hour"]);
  });

  it("reads the window by LABEL, so a swapped slot does not swap the ranking", () => {
    // On 3,270 real events the five-hour window sits in `primary` and the weekly one in `secondary`. A
    // ranking that read `windows[0]` would compare one plan's week against the other plan's five hours.
    const swapped = observation({
      alias: "codex-swapped",
      gauge: gauge({
        windows: [
          window({ label: "five-hour", slot: "primary", usedPercent: 3, windowMinutes: 300 }),
          window({ label: "weekly", slot: "secondary", usedPercent: 80 }),
        ],
      }),
    });

    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [swapped, weeklyAt({ alias: "codex-plain", percent: 50 })],
    });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-plain", "codex-swapped"]);
  });

  it("defers a destination nobody has run a turn on, and never ranks it as empty", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        observation({ alias: "codex-fresh", gauge: undefined }),
        weeklyAt({ alias: "codex-used", percent: 72 }),
      ],
    });

    // 72% beats "no reading at all": absent is NOT MEASURED. Ranked as 0% the fresh home would win every time.
    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-used", "codex-fresh"]);
    expect(ranking.deferredUnmeasured).toEqual(["codex-fresh"]);
    expect(ranking.basis).toBe("weekly-partial");
  });

  it("reports weekly-unmeasured when no destination carried a usable weekly reading", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        observation({ alias: "codex-a", gauge: undefined }),
        observation({ alias: "codex-b", gauge: undefined }),
      ],
    });

    expect(ranking.basis).toBe("weekly-unmeasured");
    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-a", "codex-b"]);
    expect(ranking.deferredUnmeasured).toEqual(["codex-a", "codex-b"]);
  });

  it("refuses to believe a percentage outside the provider's own scale", () => {
    const nonsense = observation({
      alias: "codex-nonsense",
      gauge: gauge({ windows: [window({ usedPercent: 4200 })] }),
    });

    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [nonsense, weeklyAt({ alias: "codex-real", percent: 98 })],
    });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-real", "codex-nonsense"]);
    expect(ranking.deferredUnmeasured).toEqual(["codex-nonsense"]);
  });

  it("refuses to believe a reading dated after the instant it is judged against", () => {
    const fromTheFuture = observation({
      alias: "codex-future",
      gauge: gauge({ observedAtIso: "2026-09-23T12:00:00.000Z", windows: [window({ usedPercent: 1 })] }),
    });

    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [fromTheFuture, weeklyAt({ alias: "codex-now", percent: 88 })],
    });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-now", "codex-future"]);
  });

  it("ranks an offset-bearing reset by INSTANT, never as text", () => {
    // The `+01:00` offset reading is the EARLIER instant, while sorting LATER than the `Z` reading as text. Both
    // weeks read 40%, so the reset is the deciding key and a text comparison reverses this exact pair.
    const offset = observation({
      alias: "codex-offset",
      gauge: gauge({ windows: [window({ resetAtIso: "2026-09-23T08:00:00+01:00", usedPercent: 40 })] }),
    });
    const zulu = observation({
      alias: "codex-zulu",
      gauge: gauge({ windows: [window({ resetAtIso: "2026-09-23T07:31:24.319Z", usedPercent: 40 })] }),
    });

    const ranking = rankCodexPlans({ nowIso: NOW, observations: [offset, zulu] });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-offset", "codex-zulu"]);
  });

  it("discards a reset the clock has already crossed rather than ordering on a refilled window", () => {
    const crossed = observation({
      alias: "codex-crossed",
      gauge: gauge({ windows: [window({ resetAtIso: "2026-09-22T06:00:00.000Z", usedPercent: 40 })] }),
    });
    const future = observation({
      alias: "codex-future-reset",
      gauge: gauge({ windows: [window({ resetAtIso: "2026-09-25T06:00:00.000Z", usedPercent: 40 })] }),
    });

    const ranking = rankCodexPlans({ nowIso: NOW, observations: [crossed, future] });

    // A known future reset outranks an unknowable one; the crossed reset is not treated as "reopens first".
    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-future-reset", "codex-crossed"]);
  });

  it("does not rank on a window that has already REOPENED — a stale 100% is unmeasured, not full", () => {
    const refilled = observation({
      alias: "codex-refilled",
      gauge: gauge({ windows: [window({ resetAtIso: "2026-09-22T06:00:00.000Z", usedPercent: 100 })] }),
    });
    const busy = observation({
      alias: "codex-busy",
      gauge: gauge({ windows: [window({ resetAtIso: "2026-09-25T06:00:00.000Z", usedPercent: 60 })] }),
    });

    const ranking = rankCodexPlans({ nowIso: NOW, observations: [refilled, busy] });

    // Measured first, then unmeasured: the reopened window is deferred, never read as 100% or as 0%.
    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-busy", "codex-refilled"]);
    expect(ranking.basis).toBe("weekly-partial");
  });

  it("excludes a refusing destination and draws a pinned one down like every other", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        weeklyAt({ alias: "codex-pinned", percent: 2, pinned: true }),
        observation({
          alias: "codex-capped",
          gauge: gauge({ windows: [window({ usedPercent: 1 })] }),
          refuse: "weekly window at 100%",
        }),
        weeklyAt({ alias: "codex-plain", percent: 70 }),
      ],
    });

    // An owner ruling: every plan drawn down at an equal rate. A legacy pin reserves nothing, so the 2%
    // destination leads the 70% one; the capped plan is emptier still and takes none at all.
    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-pinned", "codex-plain"]);
    expect(ranking.excluded).toEqual([
      {
        destination: { alias: "codex-capped", codexHome: "/homes/codex-capped" },
        kind: "quota-refused",
        reason: "weekly window at 100%",
      },
    ]);
  });

  it("names a paused row as paused even when it is also refusing", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        observation({
          alias: "codex-out",
          paused: { reason: "card expired", sinceIso: OBSERVED },
          refuse: "weekly window at 100%",
        }),
      ],
    });

    expect(ranking.excluded.map((exclusion) => exclusion.kind)).toEqual(["paused"]);
    expect(ranking.excluded[0]!.reason).toBe("card expired");
    expect(ranking.basis).toBe("no-eligible-destination");
  });

  // The incident: `~/.codex-one` held no sign-in, carried no refusal, ranked FIRST, and the pass routed there
  // failed `401 Missing bearer`. A store the live read proved signed out never takes a pass.
  it("excludes a signed-out store, naming the login that fixes it, however empty its week reads", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        observation({ alias: "codex-one", live: "signed-out" }),
        observation({ alias: "codex-gone", live: "store-missing" }),
        weeklyAt({ alias: "codex-busy", percent: 90 }),
      ],
    });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-busy"]);
    expect(ranking.excluded).toEqual([
      {
        destination: { alias: "codex-one", codexHome: "/homes/codex-one" },
        kind: "signed-out",
        reason: "nothing is signed in there — run mkdir -p /homes/codex-one && CODEX_HOME=/homes/codex-one codex login",
      },
      {
        destination: { alias: "codex-gone", codexHome: "/homes/codex-gone" },
        kind: "signed-out",
        reason:
          "its store directory does not exist — run mkdir -p /homes/codex-gone && CODEX_HOME=/homes/codex-gone codex login",
      },
    ]);
  });

  it("names a paused signed-out row as paused, and a signed-out refusing row as signed out", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        observation({ alias: "codex-a", live: "signed-out", paused: { reason: "sign in first", sinceIso: OBSERVED } }),
        observation({ alias: "codex-b", live: "signed-out", refuse: "weekly window at 100%" }),
      ],
    });

    expect(ranking.excluded.map((exclusion) => exclusion.kind)).toEqual(["paused", "signed-out"]);
  });

  it("answers no-eligible-destination on an empty register rather than an empty healthy fleet", () => {
    const ranking = rankCodexPlans({ nowIso: NOW, observations: [] });

    expect(ranking.basis).toBe("no-eligible-destination");
    expect(ranking.ranked).toEqual([]);
    expect(ranking.excluded).toEqual([]);
  });

  it("keeps register order as the final tie-break, so an identical fleet still has one answer", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [weeklyAt({ alias: "codex-b", percent: 30 }), weeklyAt({ alias: "codex-a", percent: 30 })],
    });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-b", "codex-a"]);
  });
});

describe("the 99% pause bar — about one percent left, never five", () => {
  const RESET = "2026-09-29T12:00:00.000Z";

  it("keeps a destination at 98.99% in the pool and pauses one at exactly 99%", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        weeklyAt({ alias: "codex-full", percent: 99 }),
        weeklyAt({ alias: "codex-nearly", percent: 98.99 }),
      ],
    });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-nearly"]);
    expect(ranking.excluded).toEqual([
      {
        destination: { alias: "codex-full", codexHome: "/homes/codex-full" },
        kind: "near-cap",
        reason: `weekly window at 99% used, resets ${RESET} — paused for new work at 99% (about 1 percent left)`,
      },
    ]);
  });

  it("does not pause at 95%, the Claude bar the owner ruled too early for Codex", () => {
    const ranking = rankCodexPlans({ nowIso: NOW, observations: [weeklyAt({ alias: "codex-95", percent: 95 })] });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-95"]);
    expect(ranking.excluded).toEqual([]);
  });

  it("pauses on the five-hour window too, and names both windows weekly first", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        observation({
          alias: "codex-both",
          gauge: gauge({
            windows: [
              window({
                label: "five-hour",
                resetAtIso: "2026-09-22T14:00:00.000Z",
                usedPercent: 100,
                windowMinutes: 300,
              }),
              window({ slot: "secondary", usedPercent: 99.5 }),
            ],
          }),
        }),
        observation({
          alias: "codex-burst",
          gauge: gauge({
            windows: [
              window({ usedPercent: 10 }),
              window({
                label: "five-hour",
                resetAtIso: "2026-09-22T14:00:00.000Z",
                slot: "secondary",
                usedPercent: 99,
                windowMinutes: 300,
              }),
            ],
          }),
        }),
      ],
    });

    expect(ranking.ranked).toEqual([]);
    expect(ranking.excluded.map((exclusion) => exclusion.reason)).toEqual([
      `weekly window at 99.5% used, resets ${RESET}; five-hour window at 100% used, resets 2026-09-22T14:00:00.000Z — paused for new work at 99% (about 1 percent left)`,
      "five-hour window at 99% used, resets 2026-09-22T14:00:00.000Z — paused for new work at 99% (about 1 percent left)",
    ]);
  });

  it("names the bar before a quota refusal, so a 100% reading reports the bar it crossed first", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        observation({
          alias: "codex-spent",
          gauge: gauge({ windows: [window({ usedPercent: 100 })] }),
          refuse: "Codex exhausted its 10080-minute window",
        }),
      ],
    });

    expect(ranking.excluded.map((exclusion) => exclusion.kind)).toEqual(["near-cap"]);
  });

  it("never pauses on a reading it cannot date: a reset already passed, absent, or unparseable", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        observation({
          alias: "codex-reopened",
          gauge: gauge({ windows: [window({ resetAtIso: "2026-09-22T11:30:00.000Z", usedPercent: 100 })] }),
        }),
        // Built by hand: `window()` defaults an undefined reset back to a real one.
        observation({
          alias: "codex-undated",
          gauge: gauge({
            windows: [
              { label: "weekly", resetAtIso: undefined, slot: "primary", usedPercent: 100, windowMinutes: 10080 },
            ],
          }),
        }),
        observation({
          alias: "codex-garbled",
          gauge: gauge({ windows: [window({ resetAtIso: "not a date", usedPercent: 100 })] }),
        }),
      ],
    });

    expect(ranking.excluded).toEqual([]);
    expect(ranking.ranked.map((destination) => destination.alias)).toEqual([
      "codex-undated",
      "codex-garbled",
      "codex-reopened",
    ]);
  });

  it("never pauses on a reading dated after the instant it is judged against, or off the provider's scale", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        observation({
          alias: "codex-future",
          gauge: gauge({ observedAtIso: "2026-09-23T12:00:00.000Z", windows: [window({ usedPercent: 100 })] }),
        }),
        observation({ alias: "codex-offscale", gauge: gauge({ windows: [window({ usedPercent: 250 })] }) }),
      ],
    });

    expect(ranking.excluded).toEqual([]);
    // The future reading is not believed at all; the off-scale one keeps its reset as a tie-break key.
    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-offscale", "codex-future"]);
  });
});
