/*
 * The Fleet page's forecast: the measured pace over the trailing window, the rows it reaches in the board's own order
 * with the ones being worked first, how long the ready rows last at it, and what is parked on the owner. Board rows are
 * driven through `readBoard`, so a reader that stops carrying a field the forecast reads fails here too.
 */
import { describe, expect, it } from "vitest";

import { type BoardRow, readBoard } from "../../components/live/read";
import type { Placed, RankedRow, Reconcile } from "../../components/live/readWorkstreams";
import { type Forecast, type ForecastReconcile, forecastOf, runwayWords } from "../../lib/fleetForecast";

/** The instant every forecast here is drawn at. */
const NOW_MS = Date.parse("2026-11-01T13:00:00.000Z");

/** An instant this many hours before {@link NOW_MS}; a negative number is after it. */
const hoursAgo = ({ hours }: { hours: number }): string => new Date(NOW_MS - hours * 3_600_000).toISOString();

/** A ranked ready row as the reconcile reading prints one. */
const ranked = ({ id, priority = "p1" }: { id: string; priority?: string }) =>
  ({
    groomed: true,
    id,
    kind: "ask",
    label: `do ${id}`,
    openedIso: "2026-10-30T06:00:00.000Z",
    priority,
    ready: true,
    standing: "ready",
    waitingHours: 3,
  }) satisfies RankedRow;

/** A live session placed on a row at a rank. */
const placed = ({ id, rank }: { id: string; rank: number }): Placed => ({
  rank,
  row: ranked({ id }),
  session: `seat-${id}`,
});

/** A read reconcile reading, observed and empty unless a test says otherwise. */
const reconcile = (
  over: Partial<Pick<Reconcile, "aligned" | "fleet" | "misaligned" | "ready" | "unprioritised">>,
): ForecastReconcile => ({
  kind: "ready",
  value: { aligned: [], fleet: "observed", misaligned: [], ready: [], unprioritised: [], ...over },
});

/** Board rows as `handover list --json` publishes them, read back through the console's own reader. */
function boardRows({ rows }: { rows: readonly Record<string, unknown>[] }): readonly BoardRow[] {
  const board = readBoard({
    rows: rows.map((over, index) => ({
      kind: "ask",
      ownerWait: "not-waiting",
      priority: "p1",
      reason: "ready to run",
      section: "RUN NOW",
      slug: `row-${String(index)}`,
      status: "ready",
      ...over,
    })),
    unresolved: 0,
  });
  if (board === undefined) {
    throw new Error("the fixture board did not read");
  }
  return board.rows;
}

/** Settled rows, each moved the given hours before now. */
const settledAt = ({ hours }: { hours: readonly number[] }): Record<string, unknown>[] =>
  hours.map((h) => ({ movedIso: hoursAgo({ hours: h }), reason: "shipped", section: "DONE", status: "done" }));

/** This many hours, spread evenly from `from` in steps of `step`. */
const spread = ({ count, from, step }: { count: number; from: number; step: number }): number[] =>
  Array.from({ length: count }, (_, i) => from + i * step);

/** A forecast drawn at {@link NOW_MS} over twelve hours. */
const forecast = ({ rows, recon }: { rows: readonly BoardRow[]; recon: ForecastReconcile }): Forecast =>
  forecastOf({ hours: 12, nowMs: NOW_MS, reconcile: recon, rows });

/** The ready order half, refusing a test that expected one to read. */
function orderOf({ of }: { of: Forecast }) {
  if (of.order.kind !== "ready") {
    throw new Error(`expected a ready order, got ${of.order.kind}`);
  }
  return of.order;
}

describe("forecastOf — the pace", () => {
  it("reads the pace off the rows settled in the last three days, and carries it twelve hours forward", () => {
    // 36 settles over 72h is half a row an hour, so twelve hours reaches 6.
    const rows = boardRows({ rows: settledAt({ hours: spread({ count: 36, from: 1, step: 2 }) }) });
    const of = forecast({ recon: reconcile({}), rows });
    expect(of.pace).toEqual({ kind: "measured", lastDay: 12, perHour: 0.5, projected: 6, settled: 36, trend: "flat" });
    expect(of.hours).toBe(12);
  });

  it("leaves out a row settled before the window, in the future, or not settled, and counts the untimed", () => {
    const rows = boardRows({
      rows: [
        ...settledAt({ hours: [1, 80, -2] }),
        { reason: "shipped", section: "DONE", status: "done" },
        { movedIso: "not a date", reason: "shipped", section: "DONE", status: "done" },
        { movedIso: hoursAgo({ hours: 1 }), section: "IN FLIGHT", status: "active" },
      ],
    });
    const of = forecast({ recon: reconcile({}), rows });
    expect(of.pace).toEqual({ kind: "measured", lastDay: 1, perHour: 1 / 72, projected: 0, settled: 1, trend: "up" });
    expect(of.untimed).toBe(2);
  });

  it("calls the last day flat within ten percent of the daily average, edges included, and up or down past it", () => {
    // 30 settles over three days is 10 a day; 11 and 9 in the last day are the band's edges.
    const at = ({ lastDay }: { lastDay: number }) =>
      forecast({
        recon: reconcile({}),
        rows: boardRows({
          rows: settledAt({
            hours: [
              ...spread({ count: lastDay, from: 1, step: 1 }),
              ...spread({ count: 30 - lastDay, from: 25, step: 1 }),
            ],
          }),
        }),
      }).pace;
    expect(at({ lastDay: 11 })).toEqual({
      kind: "measured",
      lastDay: 11,
      perHour: 30 / 72,
      projected: 5,
      settled: 30,
      trend: "flat",
    });
    expect(at({ lastDay: 9 })).toEqual({
      kind: "measured",
      lastDay: 9,
      perHour: 30 / 72,
      projected: 5,
      settled: 30,
      trend: "flat",
    });
    expect(at({ lastDay: 12 })).toEqual({
      kind: "measured",
      lastDay: 12,
      perHour: 30 / 72,
      projected: 5,
      settled: 30,
      trend: "up",
    });
    expect(at({ lastDay: 8 })).toEqual({
      kind: "measured",
      lastDay: 8,
      perHour: 30 / 72,
      projected: 5,
      settled: 30,
      trend: "down",
    });
  });

  it("says there is no pace when nothing settled in the window, rather than a measured zero", () => {
    const of = forecast({
      recon: reconcile({ ready: [ranked({ id: "a" })] }),
      rows: boardRows({ rows: settledAt({ hours: [100] }) }),
    });
    expect(of.pace).toEqual({ kind: "not-measured" });
    expect(of.order).toEqual({ kind: "no-pace" });
  });

  it("refuses a clock or a horizon it cannot carry a pace across", () => {
    expect(() => forecastOf({ hours: 0, nowMs: NOW_MS, reconcile: reconcile({}), rows: [] })).toThrow(
      "forecastOf needs a finite instant and a positive horizon, got 1793538000000 and 0",
    );
    expect(() => forecastOf({ hours: 12, nowMs: Number.NaN, reconcile: reconcile({}), rows: [] })).toThrow(
      "forecastOf needs a finite instant and a positive horizon, got NaN and 12",
    );
  });
});

describe("forecastOf — the rows it reaches", () => {
  it("names the rows being worked first, in rank order and each once, then the open order's top, cut at the pace", () => {
    // 24 settles over 72h is a third of a row an hour, so twelve hours reaches 4.
    const rows = boardRows({
      rows: [...settledAt({ hours: spread({ count: 24, from: 1, step: 3 }) }), { slug: "first" }],
    });
    const of = forecast({
      recon: reconcile({
        aligned: [placed({ id: "seated-b", rank: 2 })],
        misaligned: [placed({ id: "seated-a", rank: 1 }), placed({ id: "seated-b", rank: 2 })],
        ready: [ranked({ id: "seated-a" }), ranked({ id: "first" }), ranked({ id: "second" }), ranked({ id: "third" })],
      }),
      rows,
    });
    const order = orderOf({ of });
    expect(order.expected.map((row) => `${row.stage}:${row.id}`)).toEqual([
      "being-worked:seated-a",
      "being-worked:seated-b",
      "next-up:first",
      "next-up:second",
    ]);
    expect(order.expected[2].source.kind).toBe("read");
    expect(order.expected[3].source).toEqual({ kind: "missing-row" });
    expect(order.candidates).toBe(5);
    expect(order.openReady).toBe(3);
  });

  it("never names a row the board already settled, however an older reconcile reading still places it", () => {
    // 72 settles over 72h is one an hour, so twelve hours reaches past every candidate.
    const rows = boardRows({
      rows: [
        ...settledAt({ hours: spread({ count: 70, from: 0.5, step: 1 }) }),
        {
          movedIso: hoursAgo({ hours: 70.5 }),
          reason: "shipped",
          section: "DONE",
          slug: "gone-seated",
          status: "done",
        },
        { movedIso: hoursAgo({ hours: 71.5 }), reason: "shipped", section: "DONE", slug: "gone-ready", status: "done" },
      ],
    });
    const of = forecast({
      recon: reconcile({
        aligned: [placed({ id: "gone-seated", rank: 1 }), placed({ id: "live", rank: 2 })],
        ready: [ranked({ id: "gone-ready" }), ranked({ id: "next" })],
      }),
      rows,
    });
    const order = orderOf({ of });
    expect(order.expected.map((row) => `${row.stage}:${row.id}`)).toEqual(["being-worked:live", "next-up:next"]);
    expect(order.candidates).toBe(2);
    expect(order.openReady).toBe(1);
    expect(order.runwayHours).toBe(1);
  });

  it("names every candidate when the pace reaches past them, so the board running short shows", () => {
    const rows = boardRows({ rows: settledAt({ hours: spread({ count: 72, from: 0.5, step: 1 }) }) });
    const of = forecast({
      recon: reconcile({ aligned: [placed({ id: "x", rank: 1 })], ready: [ranked({ id: "y" })] }),
      rows,
    });
    const order = orderOf({ of });
    expect(of.pace).toEqual({ kind: "measured", lastDay: 24, perHour: 1, projected: 12, settled: 72, trend: "flat" });
    expect(order.expected.map((row) => row.id)).toEqual(["x", "y"]);
    expect(order.candidates).toBe(2);
  });

  it("says how many hours the open ready rows last at the pace, zero when none are open", () => {
    // 72 settles over 72h is one an hour; 30 open rows last 30 hours.
    const rows = boardRows({ rows: settledAt({ hours: spread({ count: 72, from: 0.5, step: 1 }) }) });
    const thirty = forecast({
      recon: reconcile({ ready: spread({ count: 30, from: 0, step: 1 }).map((i) => ranked({ id: `r${String(i)}` })) }),
      rows,
    });
    const none = forecast({ recon: reconcile({}), rows });
    expect(orderOf({ of: thirty }).runwayHours).toBe(30);
    expect(orderOf({ of: none }).runwayHours).toBe(0);
  });

  it("keeps the pace and the held rows while the reconcile reading is loading, unmeasured or refused", () => {
    const rows = boardRows({
      rows: [...settledAt({ hours: [1] }), { ownerWait: "owner", section: "WAITING ON OWNER", slug: "ask" }],
    });
    const loading = forecast({ recon: { kind: "loading" }, rows });
    const unmeasured = forecast({ recon: { kind: "not-measured", why: "the reading is stale" }, rows });
    const unobserved = forecast({ recon: reconcile({ fleet: "unavailable" }), rows });
    const duplicated = forecast({ recon: reconcile({ ready: [ranked({ id: "d" }), ranked({ id: "d" })] }), rows });
    expect(loading.order).toEqual({ kind: "loading" });
    expect(unmeasured.order).toEqual({ kind: "unavailable", why: "the reading is stale" });
    expect(unobserved.order).toEqual({
      kind: "unavailable",
      why: "the reconcile reading could not observe the fleet, so which rows already have a seat cannot be told",
    });
    expect(duplicated.order).toEqual({
      kind: "unavailable",
      why: "the board carries d on more than one ready row, so the order cannot be drawn without guessing which",
    });
    expect([loading, unmeasured, unobserved, duplicated].map((of) => [of.pace.kind, of.held.length])).toEqual([
      ["measured", 1],
      ["measured", 1],
      ["measured", 1],
      ["measured", 1],
    ]);
  });

  it("leaves the reading it was handed as it was", () => {
    const ready = [ranked({ id: "b" }), ranked({ id: "a" })];
    const aligned = [placed({ id: "s2", rank: 2 }), placed({ id: "s1", rank: 1 })];
    const rows = boardRows({ rows: settledAt({ hours: [1, 2] }) });
    forecast({ recon: reconcile({ aligned, ready }), rows });
    expect(ready.map((row) => row.id)).toEqual(["b", "a"]);
    expect(aligned.map((one) => one.row.id)).toEqual(["s2", "s1"]);
  });
});

describe("forecastOf — what is parked on the owner", () => {
  it("lists the open rows waiting on the owner's word in their own words, never a settled or already-ruled one", () => {
    const rows = boardRows({
      rows: [
        { ownerWait: "owner", question: "which plan?", section: "WAITING ON OWNER", slug: "ask-plan" },
        {
          ownerWait: "owner",
          reason: "waiting",
          section: "WAITING ON OWNER",
          slug: "ask-copy",
          summary: "Pick the copy.",
        },
        { ownerWait: "already-ruled", section: "WAITING ON OWNER", slug: "ruled" },
        { ownerWait: "owner", reason: "shipped", section: "DONE", slug: "gone", status: "done" },
        { slug: "busy" },
      ],
    });
    const of = forecast({ recon: reconcile({}), rows });
    expect(of.held.map((row) => [row.id, row.label, row.source.kind])).toEqual([
      ["ask-plan", "which plan?", "read"],
      ["ask-copy", "Pick the copy.", "read"],
    ]);
  });
});

describe("runwayWords", () => {
  it("says under an hour, hours under two days and whole days past it", () => {
    expect(runwayWords({ hours: 0 })).toBe("under an hour");
    expect(runwayWords({ hours: 0.49 })).toBe("under an hour");
    expect(runwayWords({ hours: 0.5 })).toBe("about 1 hour");
    expect(runwayWords({ hours: 1.5 })).toBe("about 2 hours");
    expect(runwayWords({ hours: 30.4 })).toBe("about 30 hours");
    expect(runwayWords({ hours: 47.9 })).toBe("about 48 hours");
    expect(runwayWords({ hours: 61 })).toBe("about 3 days");
  });
});
