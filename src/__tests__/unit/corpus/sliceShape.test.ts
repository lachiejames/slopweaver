/**
 * The corpus-shape fold — the pure arithmetic behind `slopweaver dev slice-shape`.
 *
 * Every case here builds rows by hand and folds them, so a share, a percentile or a window price is checked
 * against a number a reader can compute themselves. That matters more than usual for this module: its whole
 * output is a table the owner prices a slice decision off, and a fold that quietly double-counted a
 * boundary month would be wrong in a way no consumer could notice.
 */
import { describe, expect, it } from "vitest";
import {
  absorbRow,
  dayKeyOf,
  emptySliceShape,
  finishSliceShape,
  monthKeyOf,
  percentileTable,
  type SliceShapeRow,
  threadKeyOf,
} from "../../../corpus/sliceShape.js";
import { CANDIDATE_CAPS, CANDIDATE_WINDOW_DAYS } from "../../../corpus/sliceShapePrices.js";

/** One row, with only the fields a case cares about spelled out. */
function row(over: Partial<SliceShapeRow> = {}): SliceShapeRow {
  return {
    byteLength: 100,
    container: "slack/C1",
    source: "slack",
    sourceId: "C1:1000.1",
    tsIso: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

/** Fold a list of rows and finish the reading at a fixed instant. */
function shapeOf({ rows, nowIso, top = 10 }: { rows: readonly SliceShapeRow[]; nowIso: string; top?: number }) {
  const into = emptySliceShape();
  rows.forEach((one) => {
    absorbRow({ into, row: one });
  });
  return finishSliceShape({ into, nowMs: Date.parse(nowIso), top });
}

describe("monthKeyOf", () => {
  it("reads the bucket off the ISO string's own leading characters", () => {
    expect(monthKeyOf({ tsIso: "2026-09-05T22:43:26.000Z" })).toBe("2026-09");
  });

  it("keeps the month the source wrote rather than re-interpreting its offset", () => {
    expect(monthKeyOf({ tsIso: "2026-08-01T09:00:00+10:00" })).toBe("2026-08");
  });

  it("answers undefined for a month index that cannot exist", () => {
    expect(monthKeyOf({ tsIso: "2026-13-01T00:00:00Z" })).toBeUndefined();
  });

  it("answers undefined for a value that is not a date at all", () => {
    expect(monthKeyOf({ tsIso: "not-a-date" })).toBeUndefined();
  });
});

describe("threadKeyOf", () => {
  it("makes a root message its own thread key", () => {
    expect(threadKeyOf({ source: "slack", sourceId: "C1:1787878931.458019" })).toBe("C1:1787878931.458019");
  });

  it("collapses a reply onto the root it names", () => {
    expect(threadKeyOf({ source: "slack", sourceId: "C1:1787878931.458019:reply:1787879058.103309" })).toBe(
      "C1:1787878931.458019",
    );
  });

  it("answers undefined for a source whose ids carry no thread", () => {
    expect(threadKeyOf({ source: "github", sourceId: "owner/repo#12:comment:3" })).toBeUndefined();
  });

  it("answers undefined for an empty id", () => {
    expect(threadKeyOf({ source: "slack", sourceId: "" })).toBeUndefined();
  });
});

describe("dayKeyOf", () => {
  it("reads the bucket off the ISO string's own leading characters", () => {
    expect(dayKeyOf({ tsIso: "2026-09-05T22:43:26.000Z" })).toBe("2026-09-05");
  });

  it("keeps the day the source wrote rather than re-interpreting its offset", () => {
    expect(dayKeyOf({ tsIso: "2026-08-01T09:00:00+10:00" })).toBe("2026-08-01");
  });

  it("answers undefined for a day index that cannot exist", () => {
    expect(dayKeyOf({ tsIso: "2026-09-32T00:00:00Z" })).toBeUndefined();
  });

  it("answers undefined for a value that is not a date at all", () => {
    expect(dayKeyOf({ tsIso: "yesterday" })).toBeUndefined();
  });
});

describe("percentileTable", () => {
  it("reads each percentile by nearest rank over an ascending population", () => {
    const table = percentileTable({ sorted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    expect(table).toStrictEqual([
      { percentile: 50, value: 5 },
      { percentile: 75, value: 8 },
      { percentile: 90, value: 9 },
      { percentile: 95, value: 10 },
      { percentile: 99, value: 10 },
    ]);
  });

  it("answers zero at every percentile of an empty population", () => {
    expect(percentileTable({ sorted: [] }).map((entry) => entry.value)).toStrictEqual([0, 0, 0, 0, 0]);
  });
});

describe("finishSliceShape totals", () => {
  it("counts every row and every byte it was handed", () => {
    const shape = shapeOf({
      nowIso: "2026-09-06T00:00:00.000Z",
      rows: [row({ byteLength: 10 }), row({ byteLength: 30 }), row({ byteLength: 60 })],
    });
    expect(shape.totalRecords).toBe(3);
    expect(shape.totalBytes).toBe(100);
  });

  it("splits records and bytes by source, biggest first", () => {
    const shape = shapeOf({
      nowIso: "2026-09-06T00:00:00.000Z",
      rows: [
        row({ byteLength: 10, source: "github", sourceId: "o/r#1" }),
        row({ byteLength: 20 }),
        row({ byteLength: 20, sourceId: "C1:2.0" }),
      ],
    });
    expect(shape.bySource.map((entry) => entry.source)).toStrictEqual(["slack", "github"]);
    expect(shape.bySource[0]!.records).toBe(2);
    expect(shape.bySource[0]!.recordShare).toBeCloseTo(2 / 3, 10);
    expect(shape.bySource[1]!.byteShare).toBeCloseTo(0.2, 10);
  });

  it("counts a row whose timestamp does not parse rather than dropping it silently", () => {
    const shape = shapeOf({ nowIso: "2026-09-06T00:00:00.000Z", rows: [row({ tsIso: "whenever" })] });
    expect(shape.undatedRows).toBe(1);
    expect(shape.totalRecords).toBe(1);
    expect(shape.byMonth).toStrictEqual([]);
  });

  it("reports the span the dated rows actually covered", () => {
    const shape = shapeOf({
      nowIso: "2026-09-06T00:00:00.000Z",
      rows: [
        row({ tsIso: "2024-01-15T00:00:00.000Z" }),
        row({ sourceId: "C1:2.0", tsIso: "2026-05-20T00:00:00.000Z" }),
      ],
    });
    expect(shape.oldestIso).toBe("2024-01-15T00:00:00.000Z");
    expect(shape.newestIso).toBe("2026-05-20T00:00:00.000Z");
  });

  it("leaves the span undefined when no row was datable", () => {
    const shape = shapeOf({ nowIso: "2026-09-06T00:00:00.000Z", rows: [row({ tsIso: "" })] });
    expect(shape.oldestIso).toBeUndefined();
    expect(shape.newestIso).toBeUndefined();
  });

  it("reports zero totals over no rows at all", () => {
    const shape = shapeOf({ nowIso: "2026-09-06T00:00:00.000Z", rows: [] });
    expect(shape.totalRecords).toBe(0);
    expect(shape.totalBytes).toBe(0);
    expect(shape.threads.population).toBe(0);
    expect(shape.containerCount).toBe(0);
  });
});

describe("the month histogram", () => {
  it("sums across sources into one bucket per month, oldest first", () => {
    const shape = shapeOf({
      nowIso: "2026-09-06T00:00:00.000Z",
      rows: [
        row({ byteLength: 5, tsIso: "2026-07-02T00:00:00.000Z" }),
        row({ byteLength: 5, source: "linear", sourceId: "ENGX-1", tsIso: "2026-07-20T00:00:00.000Z" }),
        row({ byteLength: 10, sourceId: "C1:3.0", tsIso: "2026-08-02T00:00:00.000Z" }),
      ],
    });
    expect(shape.byMonth.map((entry) => entry.key)).toStrictEqual(["2026-07", "2026-08"]);
    expect(shape.byMonth[0]!.records).toBe(2);
    expect(shape.byMonth[0]!.bytes).toBe(10);
    expect(shape.byMonth[1]!.records).toBe(1);
  });
});

describe("window pricing", () => {
  it("prices every candidate window", () => {
    const shape = shapeOf({ nowIso: "2026-09-06T00:00:00.000Z", rows: [row()] });
    expect(shape.windows.map((entry) => entry.days)).toStrictEqual([...CANDIDATE_WINDOW_DAYS]);
  });

  it("keeps every record when the whole corpus sits inside the window", () => {
    const shape = shapeOf({
      nowIso: "2026-09-06T00:00:00.000Z",
      rows: [
        row({ tsIso: "2026-09-01T00:00:00.000Z" }),
        row({ sourceId: "C1:2.0", tsIso: "2026-09-02T00:00:00.000Z" }),
      ],
    });
    const year = shape.windows.find((entry) => entry.days === 365)!;
    expect(year.records).toBe(2);
    expect(year.recordShare).toBe(1);
  });

  it("keeps none of a corpus that sits entirely before the window", () => {
    const shape = shapeOf({ nowIso: "2026-09-06T00:00:00.000Z", rows: [row({ tsIso: "2023-01-10T00:00:00.000Z" })] });
    const week = shape.windows.find((entry) => entry.days === 7)!;
    expect(week.records).toBe(0);
    expect(week.byteShare).toBe(0);
  });

  it("prices a window exactly rather than prorating a whole month across it", () => {
    // 30 rows, one per day, all in July. A 30-day window back from the clock reaches into August, so it covers
    // none of July, and a month-granularity histogram would have prorated a fifth of them in anyway.
    const rows = Array.from({ length: 30 }, (_unused, at) =>
      row({ sourceId: `C1:${String(at)}.0`, tsIso: `2026-07-${String(at + 1).padStart(2, "0")}T00:00:00.000Z` }),
    );
    const shape = shapeOf({ nowIso: "2026-09-06T00:00:00.000Z", rows });
    expect(shape.windows.find((entry) => entry.days === 30)!.records).toBe(0);
    // 90 days back from the clock is in early June, so every July row survives whole.
    expect(shape.windows.find((entry) => entry.days === 90)!.records).toBe(30);
  });

  it("counts a day that sits wholly inside the window whole, and one wholly outside not at all", () => {
    // One row on each of five consecutive days just before the clock, cut at 7 days back from the clock.
    const rows = Array.from({ length: 5 }, (_unused, at) =>
      row({ sourceId: `C1:${String(at)}.0`, tsIso: `2026-09-0${String(at + 1)}T12:00:00.000Z` }),
    );
    const shape = shapeOf({ nowIso: "2026-09-06T00:00:00.000Z", rows });
    expect(shape.windows.find((entry) => entry.days === 7)!.records).toBe(5);
  });

  it("prices a month whose activity is lopsided by the days it actually holds", () => {
    // 100 rows early in the month and 1 row at its end. A 10-day window back from the clock reaches the end of
    // the month, so it keeps the single late row — a month histogram would have prorated roughly a third of all 101 in.
    const rows = [
      ...Array.from({ length: 100 }, (_unused, at) =>
        row({ sourceId: `C1:e${String(at)}.0`, tsIso: "2026-08-02T00:00:00.000Z" }),
      ),
      row({ sourceId: "C1:late.0", tsIso: "2026-08-30T00:00:00.000Z" }),
    ];
    const shape = shapeOf({ nowIso: "2026-09-06T00:00:00.000Z", rows });
    expect(shape.windows.find((entry) => entry.days === 14)!.records).toBe(1);
  });

  it("stamps each window with the instant it was cut from", () => {
    const shape = shapeOf({ nowIso: "2026-09-06T00:00:00.000Z", rows: [row()] });
    expect(shape.windows.find((entry) => entry.days === 7)!.sinceIso).toBe("2026-08-30T00:00:00.000Z");
  });
});

describe("cap pricing", () => {
  it("prices every candidate cap", () => {
    const shape = shapeOf({ nowIso: "2026-09-06T00:00:00.000Z", rows: [row()] });
    expect(shape.caps.map((entry) => entry.limit)).toStrictEqual([...CANDIDATE_CAPS]);
  });

  it("keeps min(limit, held) per source and sums them", () => {
    const rows = [
      ...Array.from({ length: 5 }, (_unused, at) => row({ sourceId: `C1:${String(at)}.0` })),
      ...Array.from({ length: 2 }, (_unused, at) => row({ source: "github", sourceId: `o/r#${String(at)}` })),
    ];
    const shape = shapeOf({ nowIso: "2026-09-06T00:00:00.000Z", rows });
    const smallest = shape.caps[0]!;
    expect(smallest.limit).toBe(1_000);
    expect(smallest.records).toBe(7);
    expect(smallest.bySource).toStrictEqual([
      { held: 5, kept: 5, source: "slack" },
      { held: 2, kept: 2, source: "github" },
    ]);
    expect(smallest.recordShare).toBe(1);
  });
});

describe("the container tally", () => {
  it("names the top containers and folds the rest into one tail row", () => {
    const rows = [
      ...Array.from({ length: 4 }, (_unused, at) => row({ container: "slack/A", sourceId: `A:${String(at)}.0` })),
      ...Array.from({ length: 2 }, (_unused, at) => row({ container: "slack/B", sourceId: `B:${String(at)}.0` })),
      row({ container: "slack/C", sourceId: "C:1.0" }),
    ];
    const shape = shapeOf({ nowIso: "2026-09-06T00:00:00.000Z", rows, top: 2 });
    expect(shape.containerCount).toBe(3);
    expect(shape.topContainers.map((entry) => entry.key)).toStrictEqual(["slack/A", "slack/B"]);
    expect(shape.containerTail.records).toBe(1);
    expect(shape.containerTail.recordShare).toBeCloseTo(1 / 7, 10);
  });

  it("says how few containers hold each share of the records", () => {
    const rows = [
      ...Array.from({ length: 60 }, (_unused, at) => row({ container: "slack/A", sourceId: `A:${String(at)}.0` })),
      ...Array.from({ length: 30 }, (_unused, at) => row({ container: "slack/B", sourceId: `B:${String(at)}.0` })),
      ...Array.from({ length: 10 }, (_unused, at) => row({ container: "slack/C", sourceId: `C:${String(at)}.0` })),
    ];
    const shape = shapeOf({ nowIso: "2026-09-06T00:00:00.000Z", rows });
    expect(shape.concentration).toStrictEqual([
      { containers: 1, share: 0.5 },
      { containers: 2, share: 0.8 },
      { containers: 3, share: 0.95 },
    ]);
  });

  it("ignores a row whose container is empty rather than tallying a blank key", () => {
    const shape = shapeOf({ nowIso: "2026-09-06T00:00:00.000Z", rows: [row({ container: "" })] });
    expect(shape.containerCount).toBe(0);
  });
});

describe("the thread distribution", () => {
  it("collapses a root and its replies onto one thread", () => {
    const shape = shapeOf({
      nowIso: "2026-09-06T00:00:00.000Z",
      rows: [
        row({ byteLength: 10, sourceId: "C1:100.0" }),
        row({ byteLength: 20, sourceId: "C1:100.0:reply:101.0" }),
        row({ byteLength: 30, sourceId: "C1:100.0:reply:102.0" }),
      ],
    });
    expect(shape.threads.population).toBe(1);
    expect(shape.threads.maxRecords).toBe(3);
    expect(shape.threads.maxBytes).toBe(60);
    expect(shape.threads.meanRecords).toBe(3);
  });

  it("counts no thread for a source whose ids carry none", () => {
    const shape = shapeOf({
      nowIso: "2026-09-06T00:00:00.000Z",
      rows: [row({ container: "o/r", source: "github", sourceId: "o/r#1" })],
    });
    expect(shape.threads.population).toBe(0);
    expect(shape.threads.meanBytes).toBe(0);
  });

  it("reports the percentile a lopsided population actually has", () => {
    const rows = [
      ...Array.from({ length: 9 }, (_unused, at) => row({ byteLength: 1, sourceId: `C1:${String(at)}.0` })),
      row({ byteLength: 1, sourceId: "C1:99.0" }),
      ...Array.from({ length: 9 }, (_unused, at) => row({ byteLength: 1, sourceId: `C1:99.0:reply:${String(at)}.0` })),
    ];
    const shape = shapeOf({ nowIso: "2026-09-06T00:00:00.000Z", rows });
    expect(shape.threads.population).toBe(10);
    expect(shape.threads.recordPercentiles.find((entry) => entry.percentile === 50)!.value).toBe(1);
    expect(shape.threads.recordPercentiles.find((entry) => entry.percentile === 95)!.value).toBe(10);
  });
});
