/**
 * THE OWNER'S "NOT NOW", AS AN ANSWER — the specific choices a floating note offers in place of a bare dismiss, and
 * the one instant each choice means.
 *
 * The owner does not press a generic dismiss; they press a button more specific than that, one that already
 * answers the question. A snooze says WHEN to come back, so pressing one already answers what
 * the fleet would otherwise have to ask. The note writes `<id>.snooze-<choice>` carrying the press instant;
 * `./reconcile.ts` turns it into a record (`./snoozeStore.ts`); `hand wake` raises the note again once the instant
 * passes. This module is the pure half: no file, no clock but the ones passed in.
 */
import { err, ok, type Result } from "../lib/result.js";
import { localMinuteToMs } from "../live/calendar/zoneClock.js";

import { type HandStepError, HandStepErrors } from "./errors.js";

/** Every answer the note's "Not now…" band offers, in the order it draws them. */
export const SNOOZE_CHOICES = ["1h", "3h", "tomorrow"] as const;

/** One of the owner's snooze answers. */
export type SnoozeChoice = (typeof SNOOZE_CHOICES)[number];

/** The zone "tomorrow morning" is read in: the owner's own, the one the briefing day is cut in. */
const SNOOZE_ZONE = "Australia/Melbourne";

/** "Tomorrow" is this local minute of the next calendar day: 09:00. */
const SNOOZE_MORNING_MINUTE = 9 * 60;

const HOUR_MS = 3_600_000;

/** How far each relative choice puts the wake, in milliseconds. */
const RELATIVE_MS: Readonly<Record<Exclude<SnoozeChoice, "tomorrow">, number>> = {
  "1h": HOUR_MS,
  "3h": 3 * HOUR_MS,
};

/**
 * The words each choice is shown as on every surface — the note's band, the console. Short enough for
 * one 84pt note button; "Tomorrow" means 09:00, which `hand list` prints as the wake time beside it.
 */
const CHOICE_LABEL: Readonly<Record<SnoozeChoice, string>> = {
  "1h": "1 hour",
  "3h": "3 hours",
  tomorrow: "Tomorrow",
};

/**
 * Whether a string is one of the snooze answers.
 *
 * @param value a flag value, a marker's suffix tail or a stored field
 * @returns true when it names a choice
 */
export function isSnoozeChoice(value: string): value is SnoozeChoice {
  return (SNOOZE_CHOICES as readonly string[]).includes(value);
}

/**
 * The marker suffix a choice is written under: `snooze-1h`, `snooze-3h`, `snooze-tomorrow`.
 *
 * @param choice the answer the owner pressed
 * @returns the suffix after the step id's dot
 */
export function snoozeMarkerSuffix({ choice }: { choice: SnoozeChoice }): string {
  return `snooze-${choice}`;
}

/** Every snooze marker suffix, the set a reader of `hand-steps/dismiss/` recognises. */
export const SNOOZE_MARKER_SUFFIXES: readonly string[] = SNOOZE_CHOICES.map((choice) => snoozeMarkerSuffix({ choice }));

/**
 * The choice a marker suffix carries.
 *
 * @param suffix the text after the step id's last dot
 * @returns the choice, or undefined when the suffix is not a snooze
 */
export function snoozeChoiceOfSuffix({ suffix }: { suffix: string }): SnoozeChoice | undefined {
  const prefix = "snooze-";
  if (!suffix.startsWith(prefix)) {
    return undefined;
  }
  const tail = suffix.slice(prefix.length);
  if (!isSnoozeChoice(tail)) {
    return undefined;
  }
  return tail;
}

/**
 * How a choice reads to the owner.
 *
 * @param choice the answer
 * @returns the label every surface draws on its button
 */
export function snoozeChoiceLabel({ choice }: { choice: SnoozeChoice }): string {
  return CHOICE_LABEL[choice];
}

/**
 * The instant a snooze lapses. A relative choice counts from the press; "tomorrow" is 09:00 in the owner's zone on the
 * calendar day after the press's own local day, so a press at 00:30 still means the NEXT morning, never eight
 * hours later the same day.
 *
 * @param id the step snoozed, named in any refusal
 * @param choice the answer the owner pressed
 * @param pressedIso when the owner pressed it, ISO 8601
 * @returns the wake instant as ISO 8601, or why no instant could be trusted
 */
export function snoozeUntil({
  id,
  choice,
  pressedIso,
}: {
  id: string;
  choice: SnoozeChoice;
  pressedIso: string;
}): Result<string, HandStepError> {
  const zone = SNOOZE_ZONE;
  const pressedMs = Date.parse(pressedIso);
  if (Number.isNaN(pressedMs)) {
    return err(HandStepErrors.invalidSnooze({ id, why: `press instant "${pressedIso}" is not a date` }));
  }
  if (choice !== "tomorrow") {
    return ok(new Date(pressedMs + RELATIVE_MS[choice]).toISOString());
  }
  const midnight = localMinuteToMs({ dayMs: pressedMs, minute: 0, zone });
  if (midnight === undefined) {
    return err(HandStepErrors.invalidSnooze({ id, why: `zone "${zone}" is not one this runtime knows` }));
  }
  // Midnight plus a day and a half is always inside the next local day, whatever a DST shift did to its length.
  const nextDayMs = midnight + 36 * HOUR_MS;
  const morning = localMinuteToMs({ dayMs: nextDayMs, minute: SNOOZE_MORNING_MINUTE, zone });
  if (morning === undefined) {
    return err(HandStepErrors.invalidSnooze({ id, why: `zone "${zone}" is not one this runtime knows` }));
  }
  return ok(new Date(morning).toISOString());
}

/**
 * A wake instant as the owner reads it: the weekday and the 24-hour time in their zone, `Sat 16:01`.
 *
 * @param untilIso the wake instant
 * @returns the label every surface prints after "snoozed until"
 */
export function snoozeWakeLabel({ untilIso }: { untilIso: string }): string {
  return new Intl.DateTimeFormat("en-AU", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: SNOOZE_ZONE,
    weekday: "short",
  }).format(new Date(Date.parse(untilIso)));
}

/**
 * Whether a snooze still holds the step off the owner's screen.
 *
 * @param untilIso the wake instant
 * @param nowIso the instant judged
 * @returns true until the wake instant is reached
 */
export function snoozeActive({ untilIso, nowIso }: { untilIso: string; nowIso: string }): boolean {
  return Date.parse(nowIso) < Date.parse(untilIso);
}
