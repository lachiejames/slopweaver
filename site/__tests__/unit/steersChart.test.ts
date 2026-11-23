/*
 * The Alignment page's steers chart (`site/lib/steersChart.ts`): each time the owner steered lands in the column holding its day on
 * the owner's calendar, first-given and said-again apart, and every time a column cannot hold is counted as unplaced — so the
 * columns plus the unplaced equal every time the list counts.
 */

import { describe, expect, it } from "vitest";

import { dayLabel, labelledColumns, steersChart } from "../../lib/steersChart";

describe("steersChart", () => {
  it("puts each time on its week, newest week ending on the reading's day, the oldest short", () => {
    const steers = [
      { againIsos: ["2026-10-09T00:00:00.000Z", undefined], askedIso: "2026-10-01T10:00:00.000Z" },
      { againIsos: [], askedIso: "2026-10-15T08:00:00.000Z" },
      // Said again before the row recorded when the owner first said it: the repeat sets the window's floor.
      { againIsos: ["2026-09-30T23:00:00.000Z"], askedIso: undefined },
      // Later than the reading, and not an instant at all: neither is on a column, and neither is lost.
      { againIsos: ["not a date"], askedIso: "2026-10-20T00:00:00.000Z" },
    ];
    const chart = steersChart({ observedAtIso: "2026-10-15T12:00:00.000Z", steers, timeZone: "UTC" });
    expect(chart.weeks).toEqual([
      { dayCount: 2, firstGiven: 1, fromDay: "2026-09-30", saidAgain: 1, throughDay: "2026-10-01" },
      { dayCount: 7, firstGiven: 0, fromDay: "2026-10-02", saidAgain: 0, throughDay: "2026-10-08" },
      { dayCount: 7, firstGiven: 1, fromDay: "2026-10-09", saidAgain: 1, throughDay: "2026-10-15" },
    ]);
    expect(chart.firstGiven).toEqual({ placed: 2, unplaced: 2 });
    expect(chart.saidAgain).toEqual({ placed: 2, unplaced: 2 });
    // Every time the list counts: 3 + 1 + 2 + 2 said-N-times.
    const columns = chart.weeks.reduce((sum, week) => sum + week.firstGiven + week.saidAgain, 0);
    expect(columns + chart.firstGiven.unplaced + chart.saidAgain.unplaced).toBe(8);
  });

  it("counts a time on the owner's calendar's day, either side of their midnight", () => {
    const steers = [
      { againIsos: [], askedIso: "2026-10-05T12:59:00.000Z" },
      { againIsos: [], askedIso: "2026-10-05T13:01:00.000Z" },
    ];
    const chart = steersChart({
      observedAtIso: "2026-10-12T00:00:00.000Z",
      steers,
      timeZone: "Australia/Sydney",
    });
    expect(chart.weeks).toEqual([
      { dayCount: 1, firstGiven: 1, fromDay: "2026-10-05", saidAgain: 0, throughDay: "2026-10-05" },
      { dayCount: 7, firstGiven: 1, fromDay: "2026-10-06", saidAgain: 0, throughDay: "2026-10-12" },
    ]);
  });

  it("draws no column when no time can be placed, and still counts every one", () => {
    const chart = steersChart({
      observedAtIso: "2026-10-15T12:00:00.000Z",
      steers: [{ againIsos: [undefined], askedIso: undefined }],
      timeZone: "UTC",
    });
    expect(chart).toEqual({ firstGiven: { placed: 0, unplaced: 1 }, saidAgain: { placed: 0, unplaced: 1 }, weeks: [] });
  });

  it("draws no column for a register holding no steer", () => {
    expect(steersChart({ observedAtIso: "2026-10-15T12:00:00.000Z", steers: [], timeZone: "UTC" })).toEqual({
      firstGiven: { placed: 0, unplaced: 0 },
      saidAgain: { placed: 0, unplaced: 0 },
      weeks: [],
    });
  });
});

describe("dayLabel", () => {
  it("prints a day key as the day it names, whatever zone the page runs in", () => {
    expect(dayLabel({ day: "2026-10-04" })).toBe("4 Oct");
  });
});

describe("labelledColumns", () => {
  it("labels every column while they fit", () => {
    expect(labelledColumns({ count: 3, most: 12 })).toEqual([true, true, true]);
  });

  it("labels every k-th column counted back from the newest once they do not", () => {
    expect(labelledColumns({ count: 7, most: 3 })).toEqual([true, false, false, true, false, false, true]);
    expect(labelledColumns({ count: 6, most: 3 })).toEqual([false, true, false, true, false, true]);
  });

  it("holds two years of weeks to the most the width takes, the newest among them", () => {
    const flags = labelledColumns({ count: 105, most: 12 });
    expect(flags.filter(Boolean).length).toBe(12);
    expect(flags.at(-1)).toBe(true);
  });

  it("draws no labels for no columns", () => {
    expect(labelledColumns({ count: 0, most: 12 })).toEqual([]);
  });
});
