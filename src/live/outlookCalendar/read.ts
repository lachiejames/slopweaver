/**
 * The `outlook-calendar` door's three reads over the seam: which calendars exist, what is on in one window, and
 * one event in full. Each answers what it read AND what it did not, because a diary read in part looks exactly
 * like a quiet one.
 *
 * - **A window is expanded and paged.** `calendarView` answers occurrences, not the series rule, and pages by
 *   `@odata.nextLink`; the walk follows every page up to the caller's limit, and a link still standing at the
 *   limit makes the answer INCOMPLETE and says so, never a clean short list.
 * - **A window reads ONE calendar** — the default one unless `--calendar` names another — so an event on any
 *   other calendar is unread, not absent, and the residue names that.
 */
import { err, ok, type Result } from "#lib/result.js";
import { everyPage } from "../outlook/apiRead.js";
import type { OutlookError } from "../outlook/errors.js";
import type { OutlookCalendarApi } from "./api.js";
import { type OutlookCalendarEvent, parseOutlookEvent } from "./parse.js";
import type { GraphCalendar, GraphEventRead } from "./wire.js";

/** How many calendars one page asks for. Graph's own default is 10. */
const CALENDAR_PAGE_SIZE = 50;

/** How many events one window page asks for. `calendarView` allows 1 to 1,000. */
const VIEW_PAGE_SIZE = 100;

/** The most events one `list` reads, whatever `--limit` asks. */
export const MAX_WINDOW_EVENTS = 1_000;

/** What a window read over the default calendar names as its calendar. */
export const DEFAULT_CALENDAR_LABEL = "default";

/** What a window names the calendar it read: the id asked for, or the default calendar's label. */
function windowLabel({ calendarId }: { calendarId: string | undefined }): string {
  if (calendarId !== undefined) {
    return calendarId;
  }
  return DEFAULT_CALENDAR_LABEL;
}

/** One calendar, as the door reports it. */
export interface OutlookCalendarSummary {
  readonly id: string;
  readonly name: string | undefined;
  readonly color: string | undefined;
  readonly isDefault: boolean;
  readonly canEdit: boolean;
  readonly canViewPrivateItems: boolean;
  /** The owner's display name — a shared calendar's owner is someone else. */
  readonly ownerName: string | undefined;
}

/** One window, read. */
export interface OutlookCalendarWindow {
  /** The calendar read: its id, or {@link DEFAULT_CALENDAR_LABEL}. */
  readonly calendar: string;
  readonly startIso: string;
  readonly endIso: string;
  readonly events: readonly OutlookCalendarEvent[];
  /** Whether every page of the window was read. */
  readonly complete: boolean;
  /** What this read did not cover, each a line a reader would otherwise assume away. */
  readonly residue: readonly string[];
}

/** A Graph string, with null and empty both read as absent. */
function present({ value }: { value: string | null | undefined }): string | undefined {
  if (value == null || value.length === 0) {
    return undefined;
  }
  return value;
}

/** One wire calendar as the door reports it. */
function summariseCalendar({ calendar }: { calendar: GraphCalendar }): OutlookCalendarSummary {
  return {
    canEdit: calendar.canEdit === true,
    canViewPrivateItems: calendar.canViewPrivateItems === true,
    color: present({ value: calendar.color }),
    id: calendar.id,
    isDefault: calendar.isDefaultCalendar === true,
    name: present({ value: calendar.name }),
    ownerName: present({ value: calendar.owner?.name }),
  };
}

/**
 * Every calendar the account holds or was shared, every page of them.
 *
 * @returns the calendars, default first, or why they could not be read in full
 */
export async function listOutlookCalendars({
  api,
}: {
  api: OutlookCalendarApi;
}): Promise<Result<readonly OutlookCalendarSummary[], OutlookError>> {
  const read = await everyPage({
    fetchPage: ({ link }) => api.listCalendars(link === undefined ? { first: { top: CALENDAR_PAGE_SIZE } } : { link }),
    operation: "outlook.calendar.calendars.list",
  });
  if (read.isErr()) {
    return err(read.error);
  }
  const summaries = read.value.map((calendar) => summariseCalendar({ calendar }));
  return ok([...summaries.filter((c) => c.isDefault), ...summaries.filter((c) => !c.isDefault)]);
}

/**
 * What a window read leaves out, as lines. Pure.
 *
 * @param calendar the calendar read
 * @param complete whether every page was read
 * @param limit the cap the caller applied
 * @returns the residue lines
 */
export function windowResidue({
  calendar,
  complete,
  limit,
}: {
  calendar: string;
  complete: boolean;
  limit: number;
}): readonly string[] {
  return [
    ...(complete
      ? []
      : [`INCOMPLETE: more events matched than the ${String(limit)} read — narrow the window or raise --limit`]),
    calendar === DEFAULT_CALENDAR_LABEL
      ? "only the default calendar was read; an event on any other calendar is unread, not absent (`outlook-calendar calendars` lists them)"
      : `only calendar ${calendar} was read`,
    "recurring events are shown as the occurrences Microsoft computed for this window; `outlook-calendar read <series id>` shows the rule",
    "an event with no subject is busy time with no detail, never an empty hour",
  ];
}

/**
 * What is on in one window, expanded into occurrences, start order.
 *
 * @param calendarId the calendar to read, or undefined for the default one
 * @param startIso the window's start, an ISO instant
 * @param endIso the window's end, an ISO instant
 * @param limit the most events to read, at most {@link MAX_WINDOW_EVENTS}
 * @returns the window, with its residue, or why it could not be read
 */
export async function listOutlookCalendarWindow({
  api,
  calendarId,
  startIso,
  endIso,
  limit,
}: {
  api: OutlookCalendarApi;
  calendarId: string | undefined;
  startIso: string;
  endIso: string;
  limit: number;
}): Promise<Result<OutlookCalendarWindow, OutlookError>> {
  const cap = Math.min(limit, MAX_WINDOW_EVENTS);
  const label = windowLabel({ calendarId });
  const events: OutlookCalendarEvent[] = [];
  let link: string | undefined;
  let complete = false;
  while (events.length < cap) {
    const top = Math.min(VIEW_PAGE_SIZE, cap - events.length);
    const page = await api.listCalendarView(
      link === undefined ? { first: { calendarId, endIso, startIso, top } } : { link },
    );
    if (page.isErr()) {
      return err(page.error);
    }
    events.push(...page.value.items.map((event) => parseOutlookEvent({ calendarId: label, event })));
    if (page.value.nextLink === undefined) {
      complete = true;
      break;
    }
    link = page.value.nextLink;
  }
  const kept = events.slice(0, cap);
  const whole = complete && kept.length === events.length;
  return ok({
    calendar: label,
    complete: whole,
    endIso,
    events: kept,
    residue: windowResidue({ calendar: label, complete: whole, limit: cap }),
    startIso,
  });
}

/** What a read by event id names as its calendar when Graph's answer does not say which one holds it. */
export const UNRESOLVED_CALENDAR_LABEL = "unresolved";

/**
 * The id of the calendar holding an event read by its own id, out of the expanded `calendar` — an id
 * `list --calendar` accepts, though spelled differently from the one `calendars` prints (`./wire.ts`). Pure.
 *
 * @param event the boundary-checked single-event answer
 * @returns the calendar id, or {@link UNRESOLVED_CALENDAR_LABEL} when Graph expanded no calendar
 */
export function holdingCalendarId({ event }: { event: GraphEventRead }): string {
  if (event.calendar === undefined) {
    return UNRESOLVED_CALENDAR_LABEL;
  }
  return event.calendar.id;
}

/**
 * One event in full: body, attendees with their replies, and the rule when it is a series master.
 *
 * @param eventId the event's id, as `list` printed it
 * @returns the event, labelled with the calendar Graph says holds it, or why it could not be read
 */
export async function readOutlookCalendarEvent({
  api,
  eventId,
}: {
  api: OutlookCalendarApi;
  eventId: string;
}): Promise<Result<OutlookCalendarEvent, OutlookError>> {
  const read = await api.getEvent({ eventId });
  if (read.isErr()) {
    return err(read.error);
  }
  return ok(parseOutlookEvent({ calendarId: holdingCalendarId({ event: read.value }), event: read.value }));
}
