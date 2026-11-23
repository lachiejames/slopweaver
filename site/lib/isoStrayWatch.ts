/**
 * Whether the owner has strayed off ISO in work hours while ISO cards wait on them — the pure half of the page's ISO nudge
 * (`../components/voice/useFrontWindowNotices.ts`). The nudge is a reminder that ISO cards are still waiting on the
 * owner — not a force, and naming one concrete thing, never "ISO" in the abstract.
 *
 * **The cadence is the contract.** One nudge once a work-hours stretch off ISO has run {@link ISO_STRAY_DWELL_MS}, a
 * second only {@link ISO_STRAY_AGAIN_MS} after the first if the same stretch runs on, and never a third. A stretch
 * survives an unreadable sample, and ends on an ISO sample, outside work hours, or a gap of {@link ISO_STRAY_GAP_MS}
 * with no off-ISO sample at all. A new stretch's first nudge also waits out {@link ISO_STRAY_AGAIN_MS} after the last
 * one, so stepping on and off ISO cannot buy a nudge every few minutes.
 *
 * **A sample is judged deterministically, never by a model.** An ISO title word makes any window ISO; Slopweaver itself
 * is judged by the card open in it (`./isoQueueItems.ts`); a window whose title macOS withheld is unknown, never off.
 *
 * Pure: no clock, no I/O, no id minting — the hook hands each in, the time zone included.
 */
import { dateTimeFormatOf } from "./dateTimeFormat";
import { DRIFT_MAX_MINUTES } from "./driftNotice";
import { activityIsSlopweaver, comparable, type FrontWindowActivity, titleHolds } from "./driftWatch";
import type { IsoNudgeNotice } from "./isoNudgeNotice";
import type { IsoQueueSnapshot } from "./isoQueueItems";

/** How long a work-hours stretch off ISO runs before the first nudge: a glance away is not straying. */
export const ISO_STRAY_DWELL_MS = 10 * 60_000;

/** How long with no off-ISO sample ends a stretch: the owner stepped away, and the next one starts fresh. */
export const ISO_STRAY_GAP_MS = 5 * 60_000;

/** How long after one nudge before another may be said: the stretch's second, or the next stretch's first. */
export const ISO_STRAY_AGAIN_MS = 60 * 60_000;

/** How soon a nudge the floor refused, or whose answer was lost, is posted again while it is still owed. */
export const ISO_STRAY_RETRY_MS = 4_000;

/** The first work hour, inclusive, in the owner's own time zone. */
export const ISO_WORK_START_HOUR = 9;

/** The hour work ends, exclusive: 17:00 is outside. */
export const ISO_WORK_END_HOUR = 17;

/** Window-title words that make any window ISO, compared as whole phrases. */
export const ISO_TITLE_KEYWORDS: readonly string[] = ["iso", "iso27001", "27001", "vanta", "isms"];

/** The weekdays that are work days, as `Intl` names them in English. */
const WORK_DAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

/** How one sample reads: on ISO, off it, or unknown. */
export type IsoStrayClass = "iso" | "off" | "unknown";

/** The watch, between samples. */
export interface IsoStrayState {
  /** When the current off-ISO stretch began, `undefined` when none is running. */
  readonly stretchStartMs: number | undefined;
  /** The newest off-ISO sample in the stretch. */
  readonly lastOffMs: number | undefined;
  /** Nudges this stretch has had: two is the last it ever gets. */
  readonly toldInStretch: 0 | 1 | 2;
  /** When the newest nudge was told, across stretches. */
  readonly lastToldMs: number | undefined;
  /** The nudge owed and not yet told, kept through every retry. */
  readonly pending: IsoNudgeNotice | undefined;
}

/** What moves the watch. */
export type IsoStrayInput =
  | {
      readonly kind: "sample";
      readonly nowMs: number;
      /** The owner's IANA time zone, which work hours are read in. */
      readonly timeZone: string;
      readonly activity: FrontWindowActivity | undefined;
      readonly queue: IsoQueueSnapshot;
      /** A fresh id, taken only when this sample is the one that owes a nudge. */
      readonly freshId: string;
    }
  | { readonly kind: "told"; readonly noticeId: string; readonly nowMs: number };

/** A watch that has seen nothing. */
export const IDLE_ISO_STRAY_WATCH: IsoStrayState = {
  lastOffMs: undefined,
  lastToldMs: undefined,
  pending: undefined,
  stretchStartMs: undefined,
  toldInStretch: 0,
};

/**
 * Whether an instant falls in the owner's work hours: Monday to Friday, {@link ISO_WORK_START_HOUR} inclusive to
 * {@link ISO_WORK_END_HOUR} exclusive, in the owner's own time zone.
 *
 * @param nowMs the instant
 * @param timeZone the owner's IANA time zone
 * @returns true inside work hours
 */
export function inIsoWorkHours({ nowMs, timeZone }: { nowMs: number; timeZone: string }): boolean {
  const parts = dateTimeFormatOf({
    locale: "en-US",
    options: { hour: "numeric", hourCycle: "h23", timeZone, weekday: "short" },
  }).formatToParts(new Date(nowMs));
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  if (weekday === undefined || !WORK_DAYS.has(weekday) || !Number.isInteger(hour)) {
    return false;
  }
  return hour >= ISO_WORK_START_HOUR && hour < ISO_WORK_END_HOUR;
}

/**
 * How one sample reads: an ISO title word is ISO in any window, Slopweaver is the card open in it, a withheld title is
 * unknown, and any other window is off.
 *
 * @param activity the sample, `undefined` when the shell gave none
 * @param queue the Queue's ISO half, for the card open in Slopweaver
 * @returns the sample's class
 */
export function isoStrayClassOf({
  activity,
  queue,
}: {
  activity: FrontWindowActivity | undefined;
  queue: IsoQueueSnapshot;
}): IsoStrayClass {
  if (activity === undefined) {
    return "unknown";
  }
  if (activityIsSlopweaver({ activity })) {
    return queue.openCard;
  }
  if (activity.title === null) {
    return "unknown";
  }
  const title = comparable({ text: activity.title });
  if (ISO_TITLE_KEYWORDS.some((keyword) => titleHolds({ keyword, title }))) {
    return "iso";
  }
  return "off";
}

/**
 * The state once a stretch ends: nothing running, and a nudge still pending counted as told, since a post whose
 * answer was lost may have been said.
 *
 * @param state the state before
 * @param nowMs when it ended
 * @returns the state after
 */
function endStretch({ state, nowMs }: { state: IsoStrayState; nowMs: number }): IsoStrayState {
  let lastToldMs = state.lastToldMs;
  if (state.pending !== undefined) {
    lastToldMs = nowMs;
  }
  return { lastOffMs: undefined, lastToldMs, pending: undefined, stretchStartMs: undefined, toldInStretch: 0 };
}

/**
 * The stretch's next slot spent: told, or consumed because the card it named stopped waiting.
 *
 * @param state the state before
 * @param nowMs when it was spent
 * @returns the state after
 */
function spendSlot({ state, nowMs }: { state: IsoStrayState; nowMs: number }): IsoStrayState {
  let toldInStretch: 0 | 1 | 2 = 2;
  if (state.toldInStretch === 0) {
    toldInStretch = 1;
  }
  return { ...state, lastToldMs: nowMs, pending: undefined, toldInStretch };
}

/**
 * Whether the stretch owes its next nudge at this instant: the first after the dwell and the cross-stretch wait, the
 * second after the wait since the first, never a third.
 *
 * @param state the state, stretch already advanced by this sample
 * @param nowMs the instant
 * @returns whether this is the second, or `undefined` when nothing is owed
 */
function slotDue({ state, nowMs }: { state: IsoStrayState; nowMs: number }): { readonly again: boolean } | undefined {
  if (state.stretchStartMs === undefined || nowMs - state.stretchStartMs < ISO_STRAY_DWELL_MS) {
    return undefined;
  }
  const waited = state.lastToldMs === undefined || nowMs - state.lastToldMs >= ISO_STRAY_AGAIN_MS;
  if (!waited || state.toldInStretch === 2) {
    return undefined;
  }
  return { again: state.toldInStretch === 1 };
}

/**
 * One sample folded in: the stretch advanced or ended, a pending nudge whose card stopped waiting, or no longer reads
 * by the subject it would speak, spent unsaid, and a nudge minted when one is owed now.
 *
 * @param state the state before
 * @param input the sample
 * @returns the state after
 */
function foldSample({
  state,
  input,
}: {
  state: IsoStrayState;
  input: Extract<IsoStrayInput, { kind: "sample" }>;
}): IsoStrayState {
  const { nowMs, queue } = input;
  const sampleClass = isoStrayClassOf({ activity: input.activity, queue });
  if (sampleClass === "iso" || !inIsoWorkHours({ nowMs, timeZone: input.timeZone })) {
    return endStretch({ nowMs, state });
  }
  let next = state;
  if (next.lastOffMs !== undefined && nowMs - next.lastOffMs >= ISO_STRAY_GAP_MS) {
    next = endStretch({ nowMs, state: next });
  }
  if (sampleClass === "off") {
    let stretchStartMs = nowMs;
    if (next.stretchStartMs !== undefined) {
      stretchStartMs = next.stretchStartMs;
    }
    next = { ...next, lastOffMs: nowMs, stretchStartMs };
  }
  // A pending nudge whose card stopped waiting spends its slot rather than re-minting for the next card. The cadence's
  // ceiling outranks its floor: a retried post may already have been said with its answer lost, and the nudge is never asked for
  // more than one then one more, so a stretch that churns its cards while the floor refuses can end with none said.
  const { pending } = next;
  if (pending !== undefined) {
    if (queue.waiting.some((item) => item.key === pending.item.key && item.subject === pending.item.subject)) {
      return next;
    }
    return spendSlot({ nowMs, state: next });
  }
  // Minted only on a sample that reads off-ISO, so an unknown one landing on the dwell waits for the next known sample.
  // Work hours are judged at the sample, never at speech: one minted just before five can be said just after it.
  const due = slotDue({ nowMs, state: next });
  const item = queue.waiting.at(0);
  if (sampleClass !== "off" || due === undefined || item === undefined || next.stretchStartMs === undefined) {
    return next;
  }
  const minutes = Math.min(DRIFT_MAX_MINUTES, Math.floor((nowMs - next.stretchStartMs) / 60_000));
  return { ...next, pending: { again: due.again, item, minutes, noticeId: input.freshId } };
}

/**
 * The watch, one input later.
 *
 * @param state the state before
 * @param input a sample, or a nudge told
 * @returns the state after
 */
export function foldIsoStrayWatch({ state, input }: { state: IsoStrayState; input: IsoStrayInput }): IsoStrayState {
  if (input.kind === "sample") {
    return foldSample({ input, state });
  }
  if (state.pending?.noticeId !== input.noticeId) {
    return state;
  }
  return spendSlot({ nowMs: input.nowMs, state });
}

/**
 * The nudge to post now, kept through every retry until it is told.
 *
 * @param state the watch
 * @returns the notice, or `undefined` when none is owed
 */
export function isoNudgeOwed({ state }: { state: IsoStrayState }): IsoNudgeNotice | undefined {
  return state.pending;
}
