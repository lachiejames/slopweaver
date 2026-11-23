/**
 * PURE argument handling for the `calendar` noun. Every verb's tail is parsed here and nowhere else, so a
 * malformed invocation is refused before a credential is read or a socket is opened — which is what lets
 * every `calendar` verb declare `parseRejectIsIoFree`.
 *
 * ## The window is resolved here, and it is resolved against an INJECTED clock
 *
 * `calendar list` defaults to "the next seven days", which is a statement about now. Reading `now` inside
 * the parser would make it effectful and untestable; taking it as a parameter keeps the whole of this file
 * pure while still letting the parser own the one piece of arithmetic a caller should never repeat. The
 * shells pass the real clock; the tests pass a fixed instant and assert exact bounds.
 */
import { parseYyyyMmDdUtcMs } from "../../../lib/date.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { MAX_FREEBUSY_CALENDARS } from "../../../live/calendar/freeApi.js";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, PRIMARY_CALENDAR } from "../../../live/calendar/read.js";
import type { CalendarCapability } from "../../../live/calendar/scopes.js";
import { type DailyHours, parseDailyHours } from "../../../live/calendar/wallClockText.js";
import { collectRepeated, flagValueOr, parseFlagTail, withoutRepeated } from "../../optionParsers.js";
import type { GoogleConnectArgs } from "../google/connectShell.js";
import { type CalendarArgsError, CalendarArgsErrors, type CalendarInvalidFlagValueError } from "./errors.js";

/**
 * How many days forward `calendar list` covers when the caller names no window.
 *
 * @internal — exported so a test asserts the default window against the constant rather than a literal.
 */
export const DEFAULT_WINDOW_DAYS = 7;

/**
 * The widest window `--days` will accept — about three years, more diary than anyone reads at once.
 *
 * @internal — exported so the refusal test asserts the bound against the constant rather than a literal.
 */
export const MAX_WINDOW_DAYS = 1_100;

/** Milliseconds in a day, for turning `--days` into a window bound. */
const DAY_MS = 86_400_000;

/** The capabilities `calendar connect` may be asked to request, by their flag-facing names. */
const GRANT_CHOICES: Readonly<Record<string, readonly CalendarCapability[]>> = {
  // Events only. The narrowest grant that lets `list` and `read` work at all, and it deliberately cannot see
  // WHICH calendars exist — so `calendar calendars` refuses on it by name rather than returning an empty list.
  events: ["events"],
  // Everything `read` holds plus the one write scope, `calendar.events.owned`: the grant a `book`,
  // `respond` or `cancel` needs. Requested as a whole rather than incrementally so the consent screen
  // shows the owner exactly what the door will be able to do, in one place, once.
  meetings: ["events", "calendars", "settings", "ownedEvents"],
  // The default. Adds the calendar list and the account's own time zone, which is what makes an all-day
  // event's day mean something. Read-only: free/busy rides on `calendar.readonly`.
  read: ["events", "calendars", "settings"],
};

/** The `--grant` names, in the order `--help` lists them. */
const GRANT_NAMES: readonly string[] = ["read", "events", "meetings"];

/**
 * A parsed `calendar calendars` invocation.
 *
 * @internal — the declared shape of `parseCalendarCalendarsArgs`'s success value; no caller names it.
 */
export interface CalendarCalendarsArgs {
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * A parsed `calendar list` invocation, with its window already resolved to two instants.
 *
 * @internal — the declared shape of `parseCalendarListArgs`'s success value; no caller names it.
 */
export interface CalendarListArgs {
  readonly home: string | undefined;
  readonly calendarIds: readonly string[];
  readonly timeMinIso: string;
  readonly timeMaxIso: string;
  readonly limit: number;
  readonly json: boolean;
}

/**
 * A parsed `calendar read` invocation.
 *
 * @internal — the declared shape of `parseCalendarReadArgs`'s success value; no caller names it.
 */
export interface CalendarReadArgs {
  readonly home: string | undefined;
  readonly calendarId: string;
  readonly eventId: string;
  readonly json: boolean;
}

/**
 * A parsed `calendar free` invocation, with its window already resolved to two instants.
 *
 * @internal — the declared shape of `parseCalendarFreeArgs`'s success value; no caller names it.
 */
export interface CalendarFreeArgs {
  readonly home: string | undefined;
  /** The owner's own calendar first, then every `--with` address, deduplicated in order. */
  readonly calendarIds: readonly string[];
  readonly timeMinIso: string;
  readonly timeMaxIso: string;
  readonly minutes: number;
  readonly between: DailyHours | undefined;
  /** A `--zone` override, or undefined to use the account's own. */
  readonly zone: string | undefined;
  readonly json: boolean;
}

/** The longest meeting `--minutes` accepts — a working day. */
const MAX_FREE_MINUTES = 480;

/** `calendar connect` usage. */
const CONNECT_USAGE =
  "usage: slopweaver calendar connect [--grant <read|events|meetings>] [--status] [--revoke] [--json]\n" +
  "       [--home <dir>]\n" +
  "  Opens Google's consent screen in your browser and stores the resulting grant, owner-only\n" +
  "  --grant   which capabilities to request (default read: events + the calendar list + the time zone;\n" +
  "            meetings adds calendar.events.owned, the one write scope, for booking on your own diary)\n" +
  "  --status  report the stored grant's account and scopes and stop — no browser, no socket\n" +
  "  --revoke  withdraw the stored grant at Google and delete it — Google revokes the whole\n" +
  "            (client, account) grant at once, so every door sharing this OAuth client goes with it\n" +
  "  --json    emit the token-free grant status as one machine-readable document";

/** `calendar calendars` usage. */
const CALENDARS_USAGE =
  "usage: slopweaver calendar calendars [--json] [--home <dir>]\n" +
  "  Lists every calendar this grant can see, with the id the API takes and what the grant can do with it\n" +
  "  --json    emit one machine-readable document with freshness, coverage and residue";

/** `calendar list` usage. */
const LIST_USAGE =
  "usage: slopweaver calendar list [--calendar <id>]... [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>] " +
  "[--days <1..1100>] [--limit <1..500>] [--json] [--home <dir>]\n" +
  "  Lists the events in one window, recurring events expanded into instances, ordered by start\n" +
  "  --calendar a calendar id (repeatable); defaults to `primary`, the account's own\n" +
  "  --from     the window's first day, inclusive (default today)\n" +
  "  --to       the window's last day, inclusive; overrides --days\n" +
  "  --days     how many days forward from --from (default 7)\n" +
  "  --limit    how many events to gather in total (default 50, maximum 500)";

/** `calendar free` usage. */
const FREE_USAGE =
  "usage: slopweaver calendar free --minutes <1..480> [--with <email>]... [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>] " +
  "[--days <1..1100>] [--between <HH:MM-HH:MM>] [--zone <IANA>] [--json] [--home <dir>]\n" +
  "  Finds the open stretches of at least --minutes across your calendar and the people named\n" +
  "  --minutes  the meeting length a slot must fit (required)\n" +
  "  --with     a colleague's address (repeatable); your own primary calendar is always consulted\n" +
  "  --from     the window's first day, inclusive (default today)\n" +
  "  --to       the window's last day, inclusive; overrides --days\n" +
  "  --days     how many days forward from --from (default 7)\n" +
  "  --between  clip slots to these hours on each local day, e.g. 09:00-17:00 (default: whole day)\n" +
  "  --zone     the IANA zone --between and the rendering use (default: the account's own)";

/** `calendar read` usage. */
const READ_USAGE =
  "usage: slopweaver calendar read <event-id> [--calendar <id>] [--json] [--home <dir>]\n" +
  "  Reads one event in full — attendees, recurrence, conferencing — and states what it did not establish\n" +
  "  --calendar which calendar holds it (default `primary`); an event id is only unique within one\n" +
  "  --json     emit one machine-readable document with freshness, coverage and residue";

/**
 * Every flag each `calendar` verb ACCEPTS, by verb.
 *
 * The `--calendar` on `list` never reaches `parseFlagTail` — it is pulled off the raw tail by
 * {@link collectRepeated} first, precisely because it repeats. It IS accepted, so the help-truth contract
 * has to say so: a flag the parser takes and the usage hides is the same defect as the reverse.
 *
 * @internal — the help-truth sweep's input; nothing at runtime reads it.
 */
export const CALENDAR_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = {
  calendars: ["--home", "--json"],
  connect: ["--grant", "--home", "--json", "--revoke", "--status"],
  free: ["--between", "--days", "--from", "--home", "--json", "--minutes", "--to", "--with", "--zone"],
  list: ["--calendar", "--days", "--from", "--home", "--json", "--limit", "--to"],
  "prep-due": ["--dry-run", "--home", "--hours", "--json"],
  read: ["--calendar", "--home", "--json"],
};

/** The factory every whole-tail refusal in this file ends in: the refusal, and its verb's usage after it. */
const refused = CalendarArgsErrors.withUsage;

/** The `--home` value, or undefined. */
function homeOf({ values }: { values: Readonly<Record<string, string>> }): string | undefined {
  return values["home"];
}

/**
 * Parse the `calendar connect` tail.
 *
 * @param rest the argv tail after `calendar connect`
 * @returns the validated request, or every reason it was refused
 */
export function parseCalendarConnectArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GoogleConnectArgs<CalendarCapability>, CalendarArgsError> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json", "revoke", "status"], value: ["grant", "home"] } });
  if (parsed.isErr()) {
    return err(refused({ error: CalendarArgsErrors.flagsInvalid({ reasons: parsed.error }), usage: CONNECT_USAGE }));
  }
  const grant = flagValueOr({ fallback: "read", name: "grant", parsed: parsed.value });
  const capabilities = GRANT_CHOICES[grant];
  if (capabilities === undefined) {
    return err(
      refused({ error: CalendarArgsErrors.grantUnknown({ choices: GRANT_NAMES, got: grant }), usage: CONNECT_USAGE }),
    );
  }
  return ok({
    capabilities,
    home: homeOf({ values: parsed.value.values }),
    json: parsed.value.flags.has("json"),
    revoke: parsed.value.flags.has("revoke"),
    statusOnly: parsed.value.flags.has("status"),
  });
}

/**
 * Parse the `calendar calendars` tail.
 *
 * @param rest the argv tail after `calendar calendars`
 * @returns the validated request, or every reason it was refused
 */
export function parseCalendarCalendarsArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<CalendarCalendarsArgs, CalendarArgsError> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(refused({ error: CalendarArgsErrors.flagsInvalid({ reasons: parsed.error }), usage: CALENDARS_USAGE }));
  }
  return ok({ home: homeOf({ values: parsed.value.values }), json: parsed.value.flags.has("json") });
}

/**
 * Resolve `--from`/`--to`/`--days` into the two instants the API takes.
 *
 * @internal — exported so the inclusive/exclusive boundary is asserted directly rather than through argv.
 *
 * `--to` is INCLUSIVE to a reader and EXCLUSIVE to Google, so the upper bound is the day after the one
 * named. Getting that wrong is invisible in every test that does not put an event on the last day, and is
 * exactly the kind of silent one-day truncation the data-integrity ruling is about.
 *
 * @param from the `--from` value, or undefined for today
 * @param to the `--to` value, or undefined to use `days`
 * @param days the `--days` value, or undefined for the default window
 * @param now the clock, injected so this stays pure
 * @returns the resolved window, or the reason the flags could not be read
 */
export function resolveWindow({
  from,
  to,
  days,
  now,
}: {
  from: string | undefined;
  to: string | undefined;
  days: string | undefined;
  now: Date;
}): Result<{ timeMinIso: string; timeMaxIso: string }, CalendarInvalidFlagValueError> {
  const startMs = from === undefined ? startOfUtcDay({ now }) : parseYyyyMmDdUtcMs({ date: from });
  if (startMs === undefined) {
    return err(CalendarArgsErrors.notADate({ flag: "--from", got: String(from) }));
  }
  if (to !== undefined) {
    const endMs = parseYyyyMmDdUtcMs({ date: to });
    if (endMs === undefined) {
      return err(CalendarArgsErrors.notADate({ flag: "--to", got: to }));
    }
    if (endMs < startMs) {
      return err(CalendarArgsErrors.toBeforeFrom({ got: to }));
    }
    return ok({ timeMaxIso: new Date(endMs + DAY_MS).toISOString(), timeMinIso: new Date(startMs).toISOString() });
  }
  const span = days === undefined ? DEFAULT_WINDOW_DAYS : Number(days);
  if (!Number.isInteger(span) || span < 1 || span > MAX_WINDOW_DAYS) {
    return err(CalendarArgsErrors.daysOutOfRange({ got: String(days), max: MAX_WINDOW_DAYS }));
  }
  return ok({
    timeMaxIso: new Date(startMs + span * DAY_MS).toISOString(),
    timeMinIso: new Date(startMs).toISOString(),
  });
}

/**
 * UTC midnight of the day `now` falls in — the default window's own start. Whole-day arithmetic on the epoch
 * rather than a round trip through its ISO string: UTC has no leap seconds in epoch time, so flooring to a
 * day is exact, and there is no parse that could fail and need a substitute.
 */
function startOfUtcDay({ now }: { now: Date }): number {
  return Math.floor(now.getTime() / DAY_MS) * DAY_MS;
}

/**
 * Parse the `calendar list` tail. `--calendar` repeats, so it is read from the raw tail rather than from
 * the single-value bag — `parseFlagTail` keeps the LAST occurrence of a repeated value flag, which would
 * silently narrow a two-calendar listing to one.
 *
 * @param rest the argv tail after `calendar list`
 * @param now the clock the default window is resolved against
 * @returns the validated request, or every reason it was refused
 */
export function parseCalendarListArgs({
  rest,
  now,
}: {
  rest: readonly string[];
  now: Date;
}): Result<CalendarListArgs, CalendarArgsError> {
  const calendarIds = collectRepeated({ name: "--calendar", rest });
  const parsed = parseFlagTail({
    rest: withoutRepeated({ name: "--calendar", rest }),
    spec: { boolean: ["json"], value: ["days", "from", "home", "limit", "to"] },
  });
  if (parsed.isErr()) {
    return err(refused({ error: CalendarArgsErrors.flagsInvalid({ reasons: parsed.error }), usage: LIST_USAGE }));
  }
  const window = resolveWindow({
    days: parsed.value.values["days"],
    from: parsed.value.values["from"],
    now,
    to: parsed.value.values["to"],
  });
  if (window.isErr()) {
    return err(refused({ error: window.error, usage: LIST_USAGE }));
  }
  const rawLimit = parsed.value.values["limit"];
  const limit = rawLimit === undefined ? DEFAULT_LIST_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    const error = CalendarArgsErrors.limitOutOfRange({ got: String(rawLimit), max: MAX_LIST_LIMIT });
    return err(refused({ error, usage: LIST_USAGE }));
  }
  return ok({
    calendarIds: calendarIds.length > 0 ? calendarIds : [PRIMARY_CALENDAR],
    home: homeOf({ values: parsed.value.values }),
    json: parsed.value.flags.has("json"),
    limit,
    timeMaxIso: window.value.timeMaxIso,
    timeMinIso: window.value.timeMinIso,
  });
}

/**
 * Parse the `calendar read` tail.
 *
 * @param rest the argv tail after `calendar read`
 * @returns the validated request, or every reason it was refused
 */
export function parseCalendarReadArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<CalendarReadArgs, CalendarArgsError> {
  const eventId = rest[0];
  if (eventId === undefined || eventId.startsWith("-")) {
    return err(refused({ error: CalendarArgsErrors.argumentMissing({ name: "<event-id>" }), usage: READ_USAGE }));
  }
  const parsed = parseFlagTail({
    rest: rest.slice(1),
    spec: { boolean: ["json"], value: ["calendar", "home"] },
  });
  if (parsed.isErr()) {
    return err(refused({ error: CalendarArgsErrors.flagsInvalid({ reasons: parsed.error }), usage: READ_USAGE }));
  }
  return ok({
    calendarId: flagValueOr({ fallback: PRIMARY_CALENDAR, name: "calendar", parsed: parsed.value }),
    eventId,
    home: homeOf({ values: parsed.value.values }),
    json: parsed.value.flags.has("json"),
  });
}

/**
 * Parse the `calendar free` tail. `--with` repeats, so it is read from the raw tail the way `list`'s
 * `--calendar` is; the owner's own `primary` is always the first calendar consulted.
 *
 * @param rest the argv tail after `calendar free`
 * @param now the clock the default window is resolved against
 * @returns the validated request, or every reason it was refused
 */
export function parseCalendarFreeArgs({
  rest,
  now,
}: {
  rest: readonly string[];
  now: Date;
}): Result<CalendarFreeArgs, CalendarArgsError> {
  const withIds = collectRepeated({ name: "--with", rest });
  const parsed = parseFlagTail({
    rest: withoutRepeated({ name: "--with", rest }),
    spec: { boolean: ["json"], value: ["between", "days", "from", "home", "minutes", "to", "zone"] },
  });
  if (parsed.isErr()) {
    return err(refused({ error: CalendarArgsErrors.flagsInvalid({ reasons: parsed.error }), usage: FREE_USAGE }));
  }
  const problems: string[] = [];
  const minutesText = parsed.value.values["minutes"];
  const minutes = minutesText === undefined ? undefined : Number(minutesText);
  if (minutes === undefined || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_FREE_MINUTES) {
    problems.push(`--minutes is required and must be an integer between 1 and ${String(MAX_FREE_MINUTES)}`);
  }
  const betweenText = parsed.value.values["between"];
  const between = betweenText === undefined ? undefined : parseDailyHours({ text: betweenText });
  if (betweenText !== undefined && between === undefined) {
    problems.push(`--between must be HH:MM-HH:MM with the end after the start: ${betweenText}`);
  }
  const window = resolveWindow({
    days: parsed.value.values["days"],
    from: parsed.value.values["from"],
    now,
    to: parsed.value.values["to"],
  });
  if (window.isErr()) {
    problems.push(window.error.message);
  }
  const calendarIds = [PRIMARY_CALENDAR, ...withIds.filter((id) => id !== PRIMARY_CALENDAR)].filter(
    (id, index, all) => all.indexOf(id) === index,
  );
  if (calendarIds.length > MAX_FREEBUSY_CALENDARS) {
    problems.push(`--with names too many people: at most ${String(MAX_FREEBUSY_CALENDARS - 1)} besides you`);
  }
  for (const id of withIds) {
    if (id.trim().length === 0 || !id.includes("@")) {
      problems.push(`--with must be an email address: ${id}`);
    }
  }
  if (problems.length > 0 || window.isErr() || minutes === undefined) {
    return err(refused({ error: CalendarArgsErrors.argumentsRefused({ reasons: problems }), usage: FREE_USAGE }));
  }
  return ok({
    between,
    calendarIds,
    home: homeOf({ values: parsed.value.values }),
    json: parsed.value.flags.has("json"),
    minutes,
    timeMaxIso: window.value.timeMaxIso,
    timeMinIso: window.value.timeMinIso,
    zone: parsed.value.values["zone"],
  });
}
