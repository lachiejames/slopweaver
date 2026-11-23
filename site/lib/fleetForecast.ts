/*
 * The Fleet page's forecast: what the owner would wake up to if they left the fleet running now. It says what is
 * expected to land over the next hours or days in the current state of things, and how long until the fleet runs out
 * of work, from capacity and trends; the page is readable at a glance, with progressive disclosure and only elements
 * the owner would want.
 *
 * Every number here is a MEASURED pace carried forward, never an estimate of any one piece of work: how many board
 * rows settled over the trailing window, divided by the window. The rows named are the ones a live seat is on, then
 * the top of the same open order the Next up list draws — the order the supervisor walks — cut at the count that pace
 * gives. A live seat's PLACEMENT is the proof a row is being worked, never an `IN FLIGHT` section, because an open
 * journal can outlive its seat. Pure, and handed its clock, so the unit lane holds it without React.
 */

import type { BoardRow } from "../components/live/read";
import { waitsOnOwner } from "../components/live/readBoardWaits";
import type { Placed, RankedRow } from "../components/live/readWorkstreams";
import { rowLabel } from "./cardPropertiesRelated";
import { type FleetSource, type OrderReconcile, openOrderOf, sourceOf } from "./fleetViews";

/** How far ahead the forecast looks: one night, from when the owner puts the laptop down to when they pick it up. */
export const FORECAST_HOURS = 12;

/**
 * The trailing window the pace is read over. Three days, because the board sweeps a settled row away after about
 * that long — measured with `slopweaver handover list --json --all`: every timed DONE row was under
 * three days old (21, 25 and 45 for each day back), so a longer window would read a sweep as a slowdown.
 */
export const PACE_WINDOW_HOURS = 72;

/** The trailing slice the trend compares against the window's daily average. */
const TREND_WINDOW_HOURS = 24;

/**
 * How far the last day may sit from the window's daily average and still read as flat: within ten percent either
 * way, inclusive. Nobody chose this number; it is stated here so a reader can argue with it.
 */
const TREND_FLAT_FRACTION = 0.1;

/** The board section a settled row stands in. */
const DONE = "DONE";

/** One hour, in milliseconds. */
const HOUR_MS = 3_600_000;

/** Which way the last day ran against the window's daily average. */
export type ForecastTrend = "up" | "flat" | "down";

/** The reconcile reading as the forecast receives it — still loading, not measured, or read. */
export type ForecastReconcile =
  | { readonly kind: "loading" }
  | { readonly kind: "not-measured"; readonly why: string }
  | { readonly kind: "ready"; readonly value: OrderReconcile };

/** The measured pace, or the absence of one said as such — never a zero rate standing in for no measurement. */
export type ForecastPace =
  | {
      readonly kind: "measured";
      /** Rows that settled inside the trailing window. */
      readonly settled: number;
      /** Rows that settled in the last day of it. */
      readonly lastDay: number;
      readonly perHour: number;
      /** How many rows the pace reaches in {@link Forecast.hours}. */
      readonly projected: number;
      readonly trend: ForecastTrend;
    }
  | { readonly kind: "not-measured" };

/** A row the forecast names: one already being worked, or the next in the open order. */
export interface ForecastRow {
  readonly id: string;
  readonly label: string;
  readonly priority: string;
  readonly stage: "being-worked" | "next-up";
  /** Where it came from, joined to the board by exact slug, so the owner's words sit behind the row's fold. */
  readonly source: FleetSource;
}

/** What the forecast can name, or why it cannot. */
export type ForecastOrder =
  | {
      readonly kind: "ready";
      /** The rows the pace reaches: being worked first, in rank order, then the open order's top. */
      readonly expected: readonly ForecastRow[];
      /** Every row being worked or ready with nobody on it — fewer than the projection means the board runs short. */
      readonly candidates: number;
      /** Ready rows nobody is on: the work there is to take. */
      readonly openReady: number;
      /** How many hours {@link ForecastOrder.openReady} lasts at the pace, if nothing new arrives. */
      readonly runwayHours: number;
    }
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable"; readonly why: string }
  | { readonly kind: "no-pace" };

/** A row parked on the owner, which the fleet cannot move until they answer. */
export interface HeldRow {
  readonly id: string;
  readonly label: string;
  readonly source: FleetSource;
}

/** The whole forecast. */
export interface Forecast {
  readonly hours: number;
  readonly pace: ForecastPace;
  readonly order: ForecastOrder;
  readonly held: readonly HeldRow[];
  /** Settled rows the board holds no readable instant for, so the pace could not count them. */
  readonly untimed: number;
}

/** The trailing window's settles, and the settled rows it could not place in time. */
function paceOf({ rows, nowMs, hours }: { rows: readonly BoardRow[]; nowMs: number; hours: number }): {
  pace: ForecastPace;
  untimed: number;
} {
  let settled = 0;
  let lastDay = 0;
  let untimed = 0;
  const start = nowMs - PACE_WINDOW_HOURS * HOUR_MS;
  const dayStart = nowMs - TREND_WINDOW_HOURS * HOUR_MS;
  for (const row of rows) {
    if (row.section !== DONE) {
      continue;
    }
    let at = Number.NaN;
    if (row.movedIso !== undefined) {
      at = Date.parse(row.movedIso);
    }
    if (!Number.isFinite(at)) {
      untimed += 1;
      continue;
    }
    if (at < start || at > nowMs) {
      continue;
    }
    settled += 1;
    if (at >= dayStart) {
      lastDay += 1;
    }
  }
  if (settled === 0) {
    return { pace: { kind: "not-measured" }, untimed };
  }
  // Multiplied before dividing, so a whole-number average stays whole and the band's edges read as flat.
  const dailyAverage = (settled * TREND_WINDOW_HOURS) / PACE_WINDOW_HOURS;
  let trend: ForecastTrend = "flat";
  if (lastDay > dailyAverage * (1 + TREND_FLAT_FRACTION)) {
    trend = "up";
  } else if (lastDay < dailyAverage * (1 - TREND_FLAT_FRACTION)) {
    trend = "down";
  }
  const perHour = settled / PACE_WINDOW_HOURS;
  return {
    pace: { kind: "measured", lastDay, perHour, projected: Math.round(perHour * hours), settled, trend },
    untimed,
  };
}

/** The rows a live seat is on, each once, in the ranked board's order. */
function seatedOf({ placed }: { placed: readonly Placed[] }): readonly RankedRow[] {
  const seen = new Set<string>();
  const rows: RankedRow[] = [];
  for (const one of placed.toSorted((left, right) => left.rank - right.rank)) {
    if (seen.has(one.row.id)) {
      continue;
    }
    seen.add(one.row.id);
    rows.push(one.row);
  }
  return rows;
}

/** The order half: the rows the pace reaches and how long the open ones last — or why that cannot be said. */
function orderOf({
  reconcile,
  pace,
  rows,
}: {
  reconcile: ForecastReconcile;
  pace: ForecastPace;
  rows: readonly BoardRow[];
}): ForecastOrder {
  if (pace.kind === "not-measured") {
    return { kind: "no-pace" };
  }
  if (reconcile.kind === "loading") {
    return { kind: "loading" };
  }
  if (reconcile.kind === "not-measured") {
    return { kind: "unavailable", why: reconcile.why };
  }
  const order = openOrderOf({ reconcile: reconcile.value });
  if (order.kind === "unavailable") {
    return order;
  }
  const value = reconcile.value;
  const board = { kind: "ready", rows } as const;
  // The board and the reconcile are read apart, so a row the board already shows settled may still be seated or
  // ready in an older reconcile reading: it is behind the owner, never ahead.
  const settled = new Set(rows.filter((row) => row.section === DONE).map((row) => row.slug));
  const ahead = ({ row }: { row: RankedRow }): boolean => !settled.has(row.id);
  const open = order.open.filter((row) => ahead({ row }));
  const named = ({ row, stage }: { row: RankedRow; stage: ForecastRow["stage"] }): ForecastRow => ({
    id: row.id,
    label: row.label,
    priority: row.priority,
    source: sourceOf({ board, id: row.id }),
    stage,
  });
  const candidates = [
    ...seatedOf({ placed: [...value.aligned, ...value.misaligned, ...value.unprioritised] })
      .filter((row) => ahead({ row }))
      .map((row) => named({ row, stage: "being-worked" })),
    ...open.map((row) => named({ row, stage: "next-up" })),
  ];
  return {
    candidates: candidates.length,
    expected: candidates.slice(0, pace.projected),
    kind: "ready",
    openReady: open.length,
    runwayHours: open.length / pace.perHour,
  };
}

/**
 * The open rows parked on the owner, read off the board's own `ownerWait` — the field every "waiting on your word"
 * surface reads (`../components/live/read.ts`), so a row the owner has already ruled on is not counted against them.
 */
function heldOf({ rows }: { rows: readonly BoardRow[] }): readonly HeldRow[] {
  const board = { kind: "ready", rows } as const;
  return rows
    .filter((row) => row.section !== DONE && waitsOnOwner({ ownerWait: row.ownerWait }))
    .map((row) => ({ id: row.slug, label: rowLabel({ row }), source: sourceOf({ board, id: row.slug }) }));
}

/**
 * What the owner would wake up to: the measured pace carried forward, the rows it reaches, how long the ready work
 * lasts at it, and what is parked on them. The pace and the held rows stand on the board alone, so a reconcile reading that is
 * loading or refused costs only the order half.
 *
 * @param rows every board row — the settled ones give the pace, the parked ones the held list
 * @param reconcile the supervisor tick's last reconcile reading, for the seats and the open order
 * @param nowMs the instant the forecast is drawn at, handed in so nothing here reads a clock
 * @param hours how far ahead it looks
 * @returns the forecast
 */
export function forecastOf({
  rows,
  reconcile,
  nowMs,
  hours,
}: {
  rows: readonly BoardRow[];
  reconcile: ForecastReconcile;
  nowMs: number;
  hours: number;
}): Forecast {
  if (!Number.isFinite(nowMs) || !Number.isFinite(hours) || hours <= 0) {
    throw new Error(
      `forecastOf needs a finite instant and a positive horizon, got ${String(nowMs)} and ${String(hours)}`,
    );
  }
  const { pace, untimed } = paceOf({ hours, nowMs, rows });
  return { held: heldOf({ rows }), hours, order: orderOf({ pace, reconcile, rows }), pace, untimed };
}

/**
 * How long the ready rows last, as words the owner reads without converting: under an hour, hours under two days, whole
 * days past it.
 *
 * @returns the phrase
 */
export function runwayWords({ hours }: { hours: number }): string {
  if (hours < 0.5) {
    return "under an hour";
  }
  if (hours < 1.5) {
    return "about 1 hour";
  }
  if (hours < 48) {
    return `about ${String(Math.round(hours))} hours`;
  }
  return `about ${String(Math.round(hours / 24))} days`;
}
