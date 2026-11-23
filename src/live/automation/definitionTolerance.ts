/**
 * How late a due row is, expressed as a band the supervisor can act on — and derived from the row's OWN
 * cadence rather than from any threshold this repository picked.
 *
 * There is no heuristic here and none is wanted: what matters is that a daily alert comes that day, not the
 * hour it comes at. A daily row and an hourly row that are each
 * four hours late are not in the same situation, so the read has to say which — without inventing the
 * number that separates them.
 *
 * ## There is no constant in this file, and that is the design rather than an omission
 *
 * A first draft of this band was a fraction of the period, and a fraction is a number somebody chose. Both
 * boundaries below are comparisons instead, and neither names a threshold:
 *
 * - **`overdue`** is `firingsSinceWatermark > 1` — a firing has actually been MISSED. That is not a judgement
 *   about lateness at all; it is the row's own schedule reporting that a whole slot went by unrun, and
 *   `./definitionDue.ts` already counts it.
 * - **`urgent` versus `comfortable`**, inside the first period, compares the time ELAPSED since the row came
 *   due against the time REMAINING until its next firing. Remaining greater than elapsed is `comfortable`;
 *   remaining at or below elapsed is `urgent`. That is the period's own midpoint, expressed as a comparison
 *   between two measured spans, so it scales to any cadence and there is nothing to tune.
 *
 * A Codex planning pass refused to plan around an invented cutoff and went looking for the authority for
 * one, which is the lead that produced this shape. There was no authority, because there was no number.
 */
import { CronExpressionParser } from "cron-parser";

/**
 * How much slack a due row still has, by its own cadence.
 *
 * `unschedulable` is carried as a band rather than reported elsewhere so a caller rendering the column
 * never has to branch on a second failure channel — a row whose cadence cannot be read has no period to
 * judge against, and saying so in the band is what stops it silently rendering as `comfortable`.
 *
 * @internal — reached through {@link RecipeTolerance}; nothing outside this module names the union.
 */
export type RecipeToleranceBand = "comfortable" | "urgent" | "overdue" | "unschedulable";

/** One row's lateness, in the two spans the band is decided from. */
export interface RecipeTolerance {
  readonly band: RecipeToleranceBand;
  /** Milliseconds since the firing that made this row due, or `null` when it could not be computed. */
  readonly lateByMs: number | null;
  /** Milliseconds until the next firing, or `null` when it could not be computed. */
  readonly nextFiringInMs: number | null;
}

/**
 * The previous and next firing of one cadence around an instant, or the reason it could not be read.
 *
 * TWO iterators rather than one, and that is a correctness fix rather than a style choice. A single
 * iterator shares a cursor between `next()` and `prev()`, so `prev()` after a `next()` walks back from the
 * instant just handed out — which is one firing further back than it reads as. That was written the other
 * way first and put an hourly row's previous firing 65 minutes back instead of 5; two fresh iterators have
 * no cursor to reason about, which is why the comment is short.
 */
function firingsAround({
  cadence,
  nowIso,
}: {
  readonly cadence: string;
  readonly nowIso: string;
}): { readonly previousMs: number; readonly nextMs: number } | { readonly error: string } {
  try {
    const currentDate = new Date(nowIso);
    const nextMs = CronExpressionParser.parse(cadence, { currentDate }).next().getTime();
    const previousMs = CronExpressionParser.parse(cadence, { currentDate }).prev().getTime();
    return { nextMs, previousMs };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "the cadence is not a cron expression" };
  }
}

/**
 * How long one cadence's period is, around an instant — the span between the firing before it and the
 * firing after it.
 *
 * Derived from the row's own schedule rather than parsed out of the cron fields, so a cadence with an
 * irregular shape (`0 9 * * 1-5`, whose Friday-to-Monday gap is three days) answers the span that actually
 * applies around `nowIso` rather than an average nobody would experience. `./silentRows.ts` is the caller,
 * and it needs the period for one question only: does this row fire more often than the surface reporting on
 * it.
 *
 * @param cadence the row's five-field cron expression
 * @param nowIso the instant the period is measured around
 * @returns the span in milliseconds, or `null` when the cadence could not be read
 */
export function recipePeriodMs({
  cadence,
  nowIso,
}: {
  readonly cadence: string;
  readonly nowIso: string;
}): number | null {
  const around = firingsAround({ cadence, nowIso });
  if ("error" in around) {
    return null;
  }
  return around.nextMs - around.previousMs;
}

/**
 * Judge one due row's lateness against its own cadence.
 *
 * Only meaningful for a row that IS due; a current row has no lateness to describe and its caller should
 * not ask. A row with more than one firing since its last run is `overdue` before any span is measured,
 * because a missed slot is a fact rather than a comparison.
 *
 * @param cadence the row's five-field cron expression
 * @param firingsSinceWatermark how many firings went by after the slot the row last covered, from the due verdict
 * @param nowIso the reference instant
 * @returns the band and the two spans it was decided from
 */
export function judgeRecipeTolerance({
  cadence,
  firingsSinceWatermark,
  nowIso,
}: {
  readonly cadence: string;
  readonly firingsSinceWatermark: number;
  readonly nowIso: string;
}): RecipeTolerance {
  const around = firingsAround({ cadence, nowIso });
  if ("error" in around) {
    return { band: "unschedulable", lateByMs: null, nextFiringInMs: null };
  }
  const nowMs = Date.parse(nowIso);
  const lateByMs = nowMs - around.previousMs;
  const nextFiringInMs = around.nextMs - nowMs;
  if (firingsSinceWatermark > 1) {
    return { band: "overdue", lateByMs, nextFiringInMs };
  }
  if (nextFiringInMs > lateByMs) {
    return { band: "comfortable", lateByMs, nextFiringInMs };
  }
  return { band: "urgent", lateByMs, nextFiringInMs };
}
