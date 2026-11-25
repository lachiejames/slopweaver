/**
 * PURE argument handling for the `outlook-calendar` verbs. A malformed invocation is refused here, before a
 * credential is read, so every verb declares `parseRejectIsIoFree`. The clock is an argument, never read here:
 * `list`'s default window starts at the instant the shell passes in.
 *
 * The refusals are the `outlook` noun's own (`../outlook/errors.ts`): the same Microsoft door, the same command
 * line mistakes, so one union names them rather than two that would drift.
 */
import { parseIsoMs, parseYyyyMmDdUtcMs } from "#lib/date.js";
import { err, ok } from "#lib/result.js";
import { flagTail, leadingId, type OutlookCommonArgs, type Parsed } from "../outlook/core.js";
import { OutlookArgsErrors } from "../outlook/errors.js";
import {
  OUTLOOK_CALENDAR_CALENDARS_USAGE,
  OUTLOOK_CALENDAR_LIST_USAGE,
  OUTLOOK_CALENDAR_READ_USAGE,
} from "./outlookCalendarUsage.js";

/** How many days `list` reads when `--days` is not given. */
export const DEFAULT_WINDOW_DAYS = 7;

/** The longest window one `list` reads. */
const MAX_WINDOW_DAYS = 90;

/** How many events `list` reads when `--limit` is not given. */
export const DEFAULT_EVENT_LIMIT = 50;

/** The most events one `list` reads. */
const MAX_EVENT_LIMIT = 1_000;

/** One day, in milliseconds. */
const DAY_MS = 86_400_000;

/** Every flag each verb's parser accepts — what the help-truth contract compares each usage line to. */
export const OUTLOOK_CALENDAR_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = {
  calendars: ["--home", "--json"],
  connect: ["--disconnect", "--home", "--json", "--status"],
  list: ["--calendar", "--days", "--from", "--home", "--json", "--limit"],
  read: ["--home", "--json"],
};

/** A parsed `outlook-calendar list`. */
export interface OutlookCalendarListArgs extends OutlookCommonArgs {
  readonly calendarId: string | undefined;
  readonly startIso: string;
  readonly endIso: string;
  readonly limit: number;
}

/** A parsed `outlook-calendar read`. */
export interface OutlookCalendarReadArgs extends OutlookCommonArgs {
  readonly eventId: string;
}

/** A whole number in `[min, max]`, or the default when absent. */
function boundedWhole({
  raw,
  flag,
  min,
  max,
  fallback,
  usage,
}: {
  raw: string | undefined;
  flag: string;
  min: number;
  max: number;
  fallback: number;
  usage: string;
}): Parsed<number> {
  if (raw === undefined) {
    return ok(fallback);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    const message = `${flag} must be a whole number from ${String(min)} to ${String(max)} (got ${raw})`;
    return err(OutlookArgsErrors.invalidValue({ flag, got: raw, message, usage }));
  }
  return ok(value);
}

/**
 * `--from` as epoch milliseconds: a bare `YYYY-MM-DD` is that day's UTC midnight, an ISO instant is itself, and
 * absent is the clock the shell passed.
 */
function windowStartMs({
  raw,
  nowIso,
  usage,
}: {
  raw: string | undefined;
  nowIso: string;
  usage: string;
}): Parsed<number> {
  if (raw === undefined) {
    const now = parseIsoMs({ tsIso: nowIso });
    if (now === undefined) {
      throw new Error(`outlook-calendar list was handed a clock that is not an ISO instant: ${nowIso}`);
    }
    return ok(now);
  }
  const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? parseYyyyMmDdUtcMs({ date: raw }) : parseIsoMs({ tsIso: raw });
  if (day === undefined) {
    const message = `--from must be a YYYY-MM-DD day or an ISO instant (got ${raw})`;
    return err(OutlookArgsErrors.invalidValue({ flag: "--from", got: raw, message, usage }));
  }
  return ok(day);
}

/**
 * Parse the `outlook-calendar calendars` tail.
 *
 * @returns the request, or why it was refused
 */
export function parseOutlookCalendarCalendarsArgs({ rest }: { rest: readonly string[] }): Parsed<OutlookCommonArgs> {
  const tail = flagTail({ boolean: [], rest, usage: OUTLOOK_CALENDAR_CALENDARS_USAGE, value: [] });
  if (tail.isErr()) {
    return err(tail.error);
  }
  return ok({ home: tail.value.values["home"], json: tail.value.flags.has("json") });
}

/**
 * Parse the `outlook-calendar list` tail.
 *
 * @param nowIso the instant an unflagged window starts at
 * @returns the request, or why it was refused
 */
export function parseOutlookCalendarListArgs({
  rest,
  nowIso,
}: {
  rest: readonly string[];
  nowIso: string;
}): Parsed<OutlookCalendarListArgs> {
  const usage = OUTLOOK_CALENDAR_LIST_USAGE;
  const tail = flagTail({ boolean: [], rest, usage, value: ["calendar", "days", "from", "limit"] });
  if (tail.isErr()) {
    return err(tail.error);
  }
  const { flags, values } = tail.value;
  const days = boundedWhole({
    fallback: DEFAULT_WINDOW_DAYS,
    flag: "--days",
    max: MAX_WINDOW_DAYS,
    min: 1,
    raw: values["days"],
    usage,
  });
  if (days.isErr()) {
    return err(days.error);
  }
  const limit = boundedWhole({
    fallback: DEFAULT_EVENT_LIMIT,
    flag: "--limit",
    max: MAX_EVENT_LIMIT,
    min: 1,
    raw: values["limit"],
    usage,
  });
  if (limit.isErr()) {
    return err(limit.error);
  }
  const start = windowStartMs({ nowIso, raw: values["from"], usage });
  if (start.isErr()) {
    return err(start.error);
  }
  return ok({
    calendarId: values["calendar"],
    endIso: new Date(start.value + days.value * DAY_MS).toISOString(),
    home: values["home"],
    json: flags.has("json"),
    limit: limit.value,
    startIso: new Date(start.value).toISOString(),
  });
}

/**
 * Parse the `outlook-calendar read` tail: one event id, then flags.
 *
 * @returns the request, or why it was refused
 */
export function parseOutlookCalendarReadArgs({ rest }: { rest: readonly string[] }): Parsed<OutlookCalendarReadArgs> {
  const usage = OUTLOOK_CALENDAR_READ_USAGE;
  const id = leadingId({ name: "<event-id>", rest, usage });
  if (id.isErr()) {
    return err(id.error);
  }
  const tail = flagTail({ boolean: [], rest: rest.slice(1), usage, value: [] });
  if (tail.isErr()) {
    return err(tail.error);
  }
  return ok({ eventId: id.value, home: tail.value.values["home"], json: tail.value.flags.has("json") });
}
