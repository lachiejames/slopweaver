/**
 * The cadence calculus: which firings of a cron expression went by, and which SLOT a run covers.
 *
 * Split out of `./definitionDue.ts` when owner turn 291-8x's deferral arm pushed that file past its size
 * ratchet. The seam is the one its header already drew twice over: everything here is arithmetic over a
 * cron expression and a pair of instants, with no notion of a verdict, a line a reader sees, or a row being
 * off — and everything left there turns this arithmetic into the sentence a tick prints. A change to the
 * `onMissed` policy touches only this file; a change to what a verdict CARRIES touches only that one.
 *
 * ## The cadence is evaluated by a library, on purpose
 *
 * `cadence` is a five-field cron expression, and a hand-rolled matcher for one is the shape that is wrong
 * in a way nobody notices: it gets `0 * * * *` right and `*&#47;15 9-17 * * 1-5` subtly wrong, and the symptom is a
 * row that silently never fires. `cron-parser` decides it instead, and an expression it refuses makes the
 * row NOT due with the refusal named — never due-by-default, which would run an unschedulable row on every
 * tick.
 *
 * ## Due-ness is "has a firing gone by since the WATERMARK", and the watermark is a slot, not a clock
 *
 * Not "is now a firing instant": a tick every few minutes never lands exactly on `0 * * * *`. The question
 * is the one `refresh --if-stale` asks of a cursor — has the schedule moved past the last slot a run
 * covered. The watermark is that SLOT (`./definitionRunStore.ts`), never the instant the run finished.
 * Judging against the finish instant loses a firing: a row due for 12:00 that starts at 12:59:50 and ends at
 * 13:00:05 would read as having covered 13:00, and that slot would never run. A row that has NEVER run is
 * due at any cadence, exactly as a corpus source with no stored cursor is behind at any threshold.
 *
 * ## Which slot a run covers — `onMissed`, and what the kind can actually do with it
 *
 * When several firings went by, the row's `onMissed` and its kind's `perSlot` flag (`./kinds.ts`) pick the
 * slot, and the choice is the whole of the policy:
 *
 * - **backfill, on a kind that covers one slot per run** — the OLDEST owed slot. The watermark advances one
 *   slot, the row stays due, and the next tick takes the next one. One slot per tick keeps a tick bounded; a
 *   three-day hole in a chart fills in three ticks rather than never.
 * - **skip** — the LATEST slot, and the older ones are named as skipped. This is the default for a Slack
 *   destination, and it is what makes "no retroactive alert posts on resume" true: a row that was down for
 *   three days posts ONE card, for the current slot.
 * - **backfill, on a kind that brings the world current in one run** — also the LATEST slot, because that
 *   one run covers every missed slot. Walking them would re-run the same `--if-stale` verb N times. The line
 *   says so, so a `backfill` row that ran once is never mistaken for one that dropped its slots.
 *
 * ## A firing that is nearer its SUCCESSOR than its own hour is not taken at all
 *
 * The slot accounting above is per-slot correct and was still posting the same card twice in one morning,
 * because a `perSlot: false` kind reports the world AS OF ITS RUN. Measured: `iso-policy-acceptance-daily`
 * ran its Sunday 09:00 firing at Monday 06:39 and its Monday 09:00 firing at 09:20 — two near-identical
 * cards, 2h41m apart, on a daily row (owner turn 291-8x). {@link deferralToSuccessor} is the answer, and it
 * introduces no constant: remaining-to-next at or below elapsed-since-this is the period's own midpoint,
 * the comparison `./definitionTolerance.ts` already derives. It applies only while exactly one firing is
 * owed, so it can never hold a row for more than a period.
 *
 */
import { CronExpressionParser } from "cron-parser";

import type { RecipeDefinition } from "./definition.js";
import { judgeRecipeTolerance } from "./definitionTolerance.js";
import { findRecipeKind } from "./kinds.js";

/** How many missed firings a verdict counts before it stops counting, so a dead row cannot spin the loop. */
const MISSED_FIRING_CAP = 1000;

/** The firings after a watermark and no later than now: how many, the oldest and the latest. */
interface FiringsAfter {
  readonly count: number;
  readonly oldestIso: string | null;
  readonly latestIso: string | null;
}

/**
 * Every firing of one cadence strictly after a point and no later than now, capped.
 *
 * @param afterIso the watermark slot a run last covered, exclusive
 * @param cadence the row's five-field cron expression
 * @param nowIso the reference instant
 * @returns how many firings went by, and the oldest and latest of them
 */
export function firingsBetween({
  cadence,
  afterIso,
  nowIso,
}: {
  cadence: string;
  afterIso: string;
  nowIso: string;
}): FiringsAfter | { readonly error: string } {
  let iterator;
  try {
    iterator = CronExpressionParser.parse(cadence, { currentDate: new Date(afterIso) });
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "the cadence is not a cron expression" };
  }
  const nowMs = Date.parse(nowIso);
  let count = 0;
  let oldestIso: string | null = null;
  let latestIso: string | null = null;
  while (count < MISSED_FIRING_CAP) {
    const next = iterator.next().getTime();
    if (next > nowMs) {
      break;
    }
    latestIso = new Date(next).toISOString();
    if (count === 0) {
      oldestIso = latestIso;
    }
    count += 1;
  }
  // A row that hit the cap stopped counting, not missing: the iterator's last firing is far behind now, and a
  // skip row covering it would stay due and post again on the very next tick. So the latest slot is asked of
  // the cadence directly rather than read off a walk that gave up.
  if (count === MISSED_FIRING_CAP) {
    const latest = latestFiringAtOrBefore({ cadence, nowIso });
    if (typeof latest === "string") {
      latestIso = latest;
    }
  }
  return { count, latestIso, oldestIso };
}

/**
 * The latest firing of a cadence at or before an instant — the slot a never-run row covers.
 *
 * The parser's `prev()` is strictly-before, so it is asked from one millisecond past `nowIso`: a tick that
 * lands exactly on a firing covers that firing rather than the one before it.
 *
 * @param cadence the row's five-field cron expression
 * @param nowIso the reference instant
 * @returns the slot as an ISO instant, or the reason the cadence could not be read
 */
export function latestFiringAtOrBefore({
  cadence,
  nowIso,
}: {
  readonly cadence: string;
  readonly nowIso: string;
}): string | { readonly error: string } {
  try {
    const currentDate = new Date(Date.parse(nowIso) + 1);
    return new Date(CronExpressionParser.parse(cadence, { currentDate }).prev().getTime()).toISOString();
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "the cadence is not a cron expression" };
  }
}

/**
 * The first firing of a cadence strictly after an instant — when a row next fires on its own schedule.
 *
 * @param cadence the row's five-field cron expression
 * @param nowIso the reference instant
 * @returns the firing as an ISO instant, or the reason the cadence could not be read
 */
export function nextFiringAfter({
  cadence,
  nowIso,
}: {
  readonly cadence: string;
  readonly nowIso: string;
}): string | { readonly error: string } {
  try {
    const currentDate = new Date(Date.parse(nowIso));
    return new Date(CronExpressionParser.parse(cadence, { currentDate }).next().getTime()).toISOString();
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "the cadence is not a cron expression" };
  }
}

/** What {@link chooseSlot} picked, and whether that slot is the cadence's LATEST firing rather than a backfilled one. */
interface ChosenSlot {
  readonly slotIso: string;
  readonly slotsOwedAfterThis: number;
  readonly tail: string;
  /**
   * True when this run covers the world AS OF NOW rather than one historical slot's own scope.
   *
   * Every arm below except the per-slot backfill answers the LATEST firing precisely because one run of
   * such a kind brings the world current, and that is what {@link deferralToSuccessor} needs to know: a
   * run whose output is "the world now" is one the next firing would repeat, while a backfilled
   * datapoint is not.
   */
  readonly coversLatest: boolean;
}

/**
 * The slot a due row covers and the tail its line carries, chosen by `onMissed` and the kind's `perSlot`.
 *
 * @param definition the parsed row, for its `onMissed` and its kind
 * @param firings what went by since the watermark
 * @returns the slot, what stays owed behind it, and the tail the line carries
 */
export function chooseSlot({
  definition,
  firings,
}: {
  definition: RecipeDefinition;
  firings: { readonly count: number; readonly oldestIso: string; readonly latestIso: string };
}): ChosenSlot {
  const older = firings.count - 1;
  const perSlot = findRecipeKind({ kind: definition.kind })?.perSlot === true;
  if (definition.onMissed === "backfill" && perSlot) {
    const owed = older === 0 ? "" : `, ${String(older)} more owed`;
    return {
      coversLatest: false,
      slotIso: firings.oldestIso,
      slotsOwedAfterThis: older,
      tail: `backfills slot ${firings.oldestIso}${owed}`,
    };
  }
  if (older === 0) {
    return {
      coversLatest: true,
      slotIso: firings.latestIso,
      slotsOwedAfterThis: 0,
      tail: `covers slot ${firings.latestIso}`,
    };
  }
  if (definition.onMissed === "skip") {
    return {
      coversLatest: true,
      slotIso: firings.latestIso,
      slotsOwedAfterThis: 0,
      tail: `covers slot ${firings.latestIso}, ${String(older)} older skipped (onMissed skip)`,
    };
  }
  return {
    coversLatest: true,
    slotIso: firings.latestIso,
    slotsOwedAfterThis: 0,
    tail:
      `covers slot ${firings.latestIso}, ${String(older)} missed caught up in the same run ` +
      `(kind '${definition.kind}' brings the world current)`,
  };
}

/**
 * Whether a firing is so late that its own successor is nearer than it is — in which case the successor
 * covers it and this run is NOT taken.
 *
 * ## The incident, measured on this install's own slot-attempt ledger
 *
 * `iso-policy-acceptance-daily`, cadence `0 9 * * *` local, kind `verb-run` (`perSlot: false`), destination
 * slack. Its Sunday 09:00 firing was run at **Monday 06:39** local — 21h39m late — and its Monday 09:00
 * firing at **09:20**, 2h41m after it. Both posted, and the two cards were near-identical, because a
 * `perSlot: false` kind reports THE WORLD AS OF ITS RUN rather than the slot it nominally covers. Owner
 * turn 291-8x ruled that pair, among others, spam: a post nobody asked for.
 *
 * Per-slot accounting was correct throughout. What was wrong is that nothing asked whether a firing was
 * still worth taking.
 *
 * ## The comparison, and why there is no constant in it
 *
 * Remaining-to-the-next-firing at or below elapsed-since-this-one is the row's own period's MIDPOINT,
 * expressed as two measured spans — exactly the boundary `./definitionTolerance.ts` already derives for its
 * `urgent` band, and for the same reason: a fraction of a period is a number somebody chose, and there is
 * no authority for one.
 *
 * ## It never holds a row past one period, and the guard that makes that true
 *
 * The deferral only ever applies while `firingsSinceWatermark === 1` — one firing owed. The moment a second
 * firing goes by unrun the row is genuinely overdue and runs whatever its lateness, so a deferral can never
 * hold for more than one period. Written as `> 0` instead, an install whose passes all land at the same late
 * hour would defer the same row forever; `unit/live/automation/definitionDue.test.ts` carries that case as the
 * mutation killer.
 *
 * A deferred firing is still a firing that went by unrun, and the verdict names it (`deferredSlotIso`) so the
 * silence measure counts it as missed. Without the name, a daily row whose one slot no tick took within half a period
 * read HEALTHY on its previous run until the successor came. Repro: `unit/live/automation/silentRowReader.test.ts`'s
 * handed-on case.
 *
 * A backfilled per-slot datapoint is excluded by `coversLatest`: each of those slots is a distinct day's
 * value, so deferring one leaves a permanent hole rather than removing a repeat.
 *
 * @param cadence the row's five-field cron expression
 * @param coversLatest whether the chosen slot is the cadence's latest firing rather than a backfilled one
 * @param firingsSinceWatermark how many firings went by after the slot the row last covered
 * @param nowIso the reference instant
 * @returns the two spans when this firing defers, or `null` when the row should run
 */
export function deferralToSuccessor({
  cadence,
  coversLatest,
  firingsSinceWatermark,
  nowIso,
}: {
  readonly cadence: string;
  readonly coversLatest: boolean;
  readonly firingsSinceWatermark: number;
  readonly nowIso: string;
}): { readonly lateByMs: number; readonly nextFiringInMs: number } | null {
  if (!coversLatest || firingsSinceWatermark !== 1) {
    return null;
  }
  const tolerance = judgeRecipeTolerance({ cadence, firingsSinceWatermark, nowIso });
  if (tolerance.band !== "urgent" || tolerance.lateByMs === null || tolerance.nextFiringInMs === null) {
    return null;
  }
  return { lateByMs: tolerance.lateByMs, nextFiringInMs: tolerance.nextFiringInMs };
}

/**
 * A span in whole minutes, for a line a person reads.
 *
 * @returns the span, rounded, with a trailing `m`
 */
export function minutesOf({ ms }: { readonly ms: number }): string {
  return `${String(Math.round(ms / 60000))}m`;
}
