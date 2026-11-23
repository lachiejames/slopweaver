/** {@link spendReport} — the window, repriced drains, seat split and units per landed change. */
import { describe, expect, it } from "vitest";

import { measured, unmeasurable } from "../../../measurement/status.js";
import type { UsageTotals } from "../../../sessions/sessionCost.js";
import { type SeatKind, type TranscriptSpend, zeroRefusals } from "../../../sessions/spendFold.js";
import { spendReport, windowDays } from "../../../sessions/spendReport.js";

/** Totals with only output and cache-read tokens, which keeps the arithmetic below checkable by hand. */
function totals({ turns, output, cacheRead }: { turns: number; output: number; cacheRead: number }): UsageTotals {
  return { cacheCreationTokens: 0, cacheReadTokens: cacheRead, inputTokens: 0, outputTokens: output, turns };
}

/** One transcript on one day and model. */
function transcript({
  seat,
  model,
  day = "2026-09-27",
  usage,
  python = 0,
  floor = 1_000,
}: {
  seat: SeatKind;
  model: string;
  day?: string;
  usage: UsageTotals;
  python?: number;
  floor?: number;
}): TranscriptSpend {
  return {
    contextFloor: floor,
    cwd: "/w/acme",
    path: `/p/${seat}-${model}-${String(floor)}.jsonl`,
    refusals: { ...zeroRefusals(), python },
    seat,
    unreadable: 0,
    usage: [{ day, model, totals: usage }],
  };
}

/** One Opus 5.5 subagent that opened on `floor` tokens, with no spend of its own but its turns. */
function leaf({ floor, turns }: { floor: number; turns: number }): TranscriptSpend {
  return transcript({
    floor,
    model: "claude-opus-5-5",
    seat: "subagent",
    usage: totals({ cacheRead: 0, output: 1, turns }),
  });
}

describe("windowDays", () => {
  it("is the whole UTC days before the observed one, oldest first", () => {
    expect(windowDays({ days: 3, observedAtIso: "2026-09-28T11:30:00.000Z" })).toEqual([
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
    ]);
  });
});

describe("spendReport", () => {
  const days = ["2026-09-27"];
  const transcripts = [
    // Opus 5.5: 10 turns, output 1,000 x 10 + cache read 100,000 x 0.1 = 20,000 units.
    transcript({
      model: "claude-opus-5-5",
      seat: "handover-seat",
      usage: totals({ cacheRead: 100_000, output: 1_000, turns: 10 }),
    }),
    // Fable 5.1 chair: output 1,000 x 25 + cache read 100,000 x 0.125 = 37,500; on Opus 5.5 it is 20,000.
    transcript({
      model: "claude-fable-5-1",
      python: 3,
      seat: "chair",
      usage: totals({ cacheRead: 100_000, output: 1_000, turns: 2 }),
    }),
    // Opus 5.5 subagent: 20,000 units; on Sonnet 5 it is 1,000 x 5 + 100,000 x 0.1 = 15,000.
    transcript({
      model: "claude-opus-5-5",
      seat: "subagent",
      usage: totals({ cacheRead: 100_000, output: 1_000, turns: 3 }),
    }),
    // Outside the window: never counted.
    transcript({
      day: "2026-09-20",
      model: "claude-opus-5-5",
      seat: "bot",
      usage: totals({ cacheRead: 1, output: 1, turns: 1 }),
    }),
  ];
  const report = spendReport({
    days,
    landings: measured({ value: [{ day: "2026-09-27", landed: 4 }] }),
    observedAtIso: "2026-09-28T05:30:00.000Z",
    repos: ["o/r"],
    transcripts,
  });

  it("draws only on the window's days and names the default family by turns", () => {
    expect(report.units).toBe(77_500);
    expect(report.turns).toBe(15);
    expect(report.transcripts).toBe(3);
    expect(report.defaultFamily).toBe("opus-5.5");
  });

  it("prices each drain as a repricing, biggest first, and never the chair's own model", () => {
    expect(report.drains.map((drain) => [drain.key, drain.savingUnits])).toEqual([
      ["refusals", 3 * (77_500 / 15)],
      ["subagents:opus-5.5", 5_000],
    ]);
    expect(report.drains[1]!.share).toBe(5_000 / 77_500);
  });

  it("splits the draw by seat and prices a landed change", () => {
    expect(report.bySeat.map((seat) => [seat.seat, seat.units])).toEqual([
      ["chair", 37_500],
      ["handover-seat", 20_000],
      ["subagent", 20_000],
    ]);
    expect(report.landingCost).toEqual(measured({ value: { landed: 4, units: 77_500, unitsPerLanding: 19_375 } }));
    expect(report.byDay).toEqual([{ day: "2026-09-27", landed: 4, turns: 15, units: 77_500, unitsPerLanding: 19_375 }]);
  });

  it("never divides by zero landings, and says why when landings could not be counted", () => {
    const none = spendReport({
      days,
      landings: measured({ value: [] }),
      observedAtIso: "2026-09-28T05:30:00.000Z",
      repos: [],
      transcripts,
    });
    expect(none.landingCost).toEqual(
      unmeasurable({ why: "nothing landed in the window, so a change has no cost to divide" }),
    );
    expect(none.byDay[0]!.unitsPerLanding).toBeNull();
    const failed = spendReport({
      days,
      landings: unmeasurable({ why: "rate limited" }),
      observedAtIso: "2026-09-28T05:30:00.000Z",
      repos: [],
      transcripts,
    });
    expect(failed.landingCost).toEqual(unmeasurable({ why: "landings could not be counted: rate limited" }));
    expect(failed.byDay[0]!.landed).toBeNull();
  });

  it("prices no drain for a family cheaper than the one it is compared against", () => {
    const cheap = spendReport({
      days,
      landings: measured({ value: [] }),
      observedAtIso: "2026-09-28T05:30:00.000Z",
      repos: [],
      transcripts: [
        transcript({
          model: "claude-opus-5-5",
          seat: "handover-seat",
          usage: totals({ cacheRead: 10, output: 10, turns: 5 }),
        }),
        transcript({
          model: "claude-sonnet-5",
          seat: "handover-seat",
          usage: totals({ cacheRead: 10, output: 10, turns: 1 }),
        }),
        transcript({
          model: "claude-sonnet-5",
          seat: "subagent",
          usage: totals({ cacheRead: 10, output: 10, turns: 1 }),
        }),
      ],
    });
    expect(cheap.drains).toEqual([]);
  });

  it("prices a subagent that opened on twice a fresh opening as a fork, and one under that as none", () => {
    const forked = spendReport({
      days,
      landings: measured({ value: [] }),
      observedAtIso: "2026-09-28T05:30:00.000Z",
      repos: [],
      // Fresh (lower-quartile) opening 50,000; the 99,999 one is under twice that, the 150,000 one over it.
      transcripts: [
        leaf({ floor: 40_000, turns: 1 }),
        leaf({ floor: 50_000, turns: 1 }),
        leaf({ floor: 50_000, turns: 1 }),
        leaf({ floor: 99_999, turns: 1 }),
        leaf({ floor: 150_000, turns: 4 }),
      ],
    });
    // (150,000 - 50,000) inherited x 4 turns x Opus 5.5's 0.1 cache-read weight.
    expect(forked.drains.filter((drain) => drain.key === "forks").map((drain) => drain.savingUnits)).toEqual([40_000]);
    expect(forked.drains.find((drain) => drain.key === "forks")!.what).toBe(
      "1 subagents opened on about 150k of inherited context against a fresh one's 50.0k; re-reading it cost 40.0ku",
    );
  });

  it("still sees the forks in a week where most subagents forked, which a median would hide", () => {
    const mostlyForked = spendReport({
      days,
      landings: measured({ value: [] }),
      observedAtIso: "2026-09-28T05:30:00.000Z",
      repos: [],
      // Five forks of eight: the median is a fork's 150,000, the lower quartile a fresh 45,000.
      transcripts: [
        ...[1, 2, 3].map(() => leaf({ floor: 45_000, turns: 1 })),
        ...[1, 2, 3, 4, 5].map(() => leaf({ floor: 150_000, turns: 1 })),
      ],
    });
    // (150,000 - 45,000) x 1 turn x 0.1, five times.
    expect(mostlyForked.drains.filter((drain) => drain.key === "forks").map((drain) => drain.savingUnits)).toEqual([
      52_500,
    ]);
  });
});
