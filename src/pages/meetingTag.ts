/**
 * A local page TAGGED to the one calendar meeting it prepares the owner for — what a tag records, which meeting a
 * tag makes due, and every refusal of an event that cannot be tagged.
 *
 * MEASURED: a prep page was cut the evening before a morning one-on-one, and the owner asked the console
 * voice where it was shortly before the meeting. Nothing on disk tied the page to the meeting, so
 * nothing could put it in front of the owner. A tag is that tie, and `../monitor/meetingPrepDue.ts` is what acts on it.
 *
 * ## Tagged by EVENT, never by attendee
 *
 * A tag naming a person would re-fire the same page before every later meeting with them. A tag names one event
 * instance, so it fires once, for the meeting it was cut for. A recurring series' MASTER id is refused for the same
 * reason: it resolves to the series' first occurrence, which is long past, and the tag would never fire.
 *
 * ## The start is recorded, not re-read
 *
 * Every monitor read is local, so the tag carries the start the live read returned when it was
 * taken. A meeting moved after tagging fires at the old time — re-running `page tag` re-reads it. Stated, not
 * discovered: the residue is the price of a pass that opens no connection.
 *
 * Pure: no I/O. The store is `./meetingTagStore.ts`, the verb `../cli/commands/page/tagRun.ts`.
 */
import { parseIsoMs, parseStrictIsoInstantMs } from "#lib/date.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import type { ParsedCalendarEvent } from "../live/calendar/parse.js";
import { isValidPageSlug } from "./url.js";

/** The schema every tag row is written under. */
const MEETING_TAG_SCHEMA_VERSION = 1;

/** How long before its meeting a tagged page is due: the hour the finding asked for. */
export const MEETING_PREP_LEAD_MS = 60 * 60 * 1000;

/** One page tagged to one meeting, as the ledger records it. */
export interface MeetingTag {
  readonly schemaVersion: typeof MEETING_TAG_SCHEMA_VERSION;
  /** The page's slug — `pages/<slug>/index.html`. */
  readonly slug: string;
  /** The calendar the event was read from; an event id is unique only within one. */
  readonly calendarId: string;
  /** The event INSTANCE the page prepares the owner for. */
  readonly eventId: string;
  /** The meeting's title as Google returned it, or absent when the grant sees none. */
  readonly summary: string | undefined;
  /** The meeting's start, as the instant Google returned it. */
  readonly startIso: string;
  /** The start's wall-clock `HH:MM` in the zone the calendar wrote it in — what the note says. */
  readonly startWall: string;
  /** When the tag was taken. */
  readonly taggedIso: string;
}

/** Why an event could not be tagged. */
export type MeetingTagError =
  | { readonly code: "PAGE_SLUG_INVALID"; readonly message: string; readonly slug: string }
  | { readonly code: "PAGE_MISSING"; readonly message: string; readonly slug: string }
  | { readonly code: "PAGE_UNCHECKED"; readonly message: string; readonly slug: string }
  | { readonly code: "EVENT_ALL_DAY"; readonly message: string; readonly eventId: string }
  | { readonly code: "EVENT_CANCELLED"; readonly message: string; readonly eventId: string }
  | { readonly code: "EVENT_RECURRING_SERIES"; readonly message: string; readonly eventId: string }
  | { readonly code: "EVENT_START_UNREADABLE"; readonly message: string; readonly eventId: string }
  | { readonly code: "CALENDAR_READ_FAILED"; readonly message: string }
  | { readonly code: "TAG_LINE_INVALID"; readonly message: string }
  | { readonly code: "LEDGER_UNWRITABLE"; readonly message: string; readonly path: string }
  | { readonly code: "LEDGER_UNREADABLE"; readonly message: string; readonly path: string };

/** The {@link MeetingTagError} factory. */
export const MeetingTagErrors = {
  allDay: ({ eventId }: { eventId: string }): MeetingTagError => ({
    code: "EVENT_ALL_DAY",
    eventId,
    message: `event ${eventId} is all-day, so it has no start a page could be due before — tag a timed meeting`,
  }),
  calendarRead: ({ message }: { message: string }): MeetingTagError => ({
    code: "CALENDAR_READ_FAILED",
    message: `the meeting could not be read from the calendar: ${message}`,
  }),
  cancelled: ({ eventId }: { eventId: string }): MeetingTagError => ({
    code: "EVENT_CANCELLED",
    eventId,
    message: `event ${eventId} is cancelled, so no meeting is coming for the page to prepare the owner for`,
  }),
  ledgerUnreadable: ({ path, cause }: { path: string; cause: string }): MeetingTagError => ({
    code: "LEDGER_UNREADABLE",
    message: `could not read ${path}: ${cause}`,
    path,
  }),
  ledgerUnwritable: ({ path, cause }: { path: string; cause: string }): MeetingTagError => ({
    code: "LEDGER_UNWRITABLE",
    message: `could not append to ${path}: ${cause}`,
    path,
  }),
  lineInvalid: ({ why }: { why: string }): MeetingTagError => ({ code: "TAG_LINE_INVALID", message: why }),
  pageMissing: ({ slug }: { slug: string }): MeetingTagError => ({
    code: "PAGE_MISSING",
    message: `no page is published as ${slug} in the store — publish it with \`slopweaver page publish\` first`,
    slug,
  }),
  pageUnchecked: ({ slug, message }: { slug: string; message: string }): MeetingTagError => ({
    code: "PAGE_UNCHECKED",
    message: `could not check that ${slug} is published, so nothing was tagged: ${message}`,
    slug,
  }),
  recurringSeries: ({ eventId }: { eventId: string }): MeetingTagError => ({
    code: "EVENT_RECURRING_SERIES",
    eventId,
    message:
      `event ${eventId} is a recurring series, whose start is its FIRST occurrence — tag the one meeting instead, ` +
      "using the instance id `slopweaver calendar list` prints for that day",
  }),
  slugInvalid: ({ slug }: { slug: string }): MeetingTagError => ({
    code: "PAGE_SLUG_INVALID",
    message: `"${slug}" cannot be a page slug — it must start with a letter or digit and carry only letters, digits, dot, dash or underscore`,
    slug,
  }),
  startUnreadable: ({ eventId }: { eventId: string }): MeetingTagError => ({
    code: "EVENT_START_UNREADABLE",
    eventId,
    message: `event ${eventId} carries no start this could read as an instant`,
  }),
} as const;

/**
 * The tag one live event read makes, or why the event cannot be tagged.
 *
 * @param slug the page being tagged
 * @param event the event as `calendar read` parsed it
 * @param taggedIso the instant the tag is taken at
 * @returns the tag, or the refusal naming what is wrong with the event
 */
export function meetingTagFromEvent({
  slug,
  event,
  taggedIso,
}: {
  slug: string;
  event: ParsedCalendarEvent;
  taggedIso: string;
}): Result<MeetingTag, MeetingTagError> {
  if (!isValidPageSlug({ slug })) {
    return err(MeetingTagErrors.slugInvalid({ slug }));
  }
  if (event.status === "cancelled") {
    return err(MeetingTagErrors.cancelled({ eventId: event.id }));
  }
  if (event.recurrence.length > 0) {
    return err(MeetingTagErrors.recurringSeries({ eventId: event.id }));
  }
  const { start } = event;
  if (start === undefined) {
    return err(MeetingTagErrors.startUnreadable({ eventId: event.id }));
  }
  if (start.kind === "all-day") {
    return err(MeetingTagErrors.allDay({ eventId: event.id }));
  }
  const startMs = parseIsoMs({ tsIso: start.dateTime });
  const wall = WALL_CLOCK.exec(start.dateTime);
  if (startMs === undefined || wall === null) {
    return err(MeetingTagErrors.startUnreadable({ eventId: event.id }));
  }
  return ok({
    calendarId: event.calendarId,
    eventId: event.id,
    schemaVersion: MEETING_TAG_SCHEMA_VERSION,
    slug,
    startIso: new Date(startMs).toISOString(),
    startWall: wall[1]!,
    summary: event.summary,
    taggedIso,
  });
}

/** The `HH:MM` of an RFC3339 date-time, in the offset it was written in. */
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/u;

/** One minute, the precision a tag's start is read at. */
const MINUTE_MS = 60_000;

/**
 * Read one ledger line back into a tag, or say why it is not one.
 *
 * @param line one line of the tag ledger, already known non-blank
 * @returns the tag, or the problem naming what was wrong with it
 */
export function parseMeetingTagLine({ line }: { line: string }): Result<MeetingTag, MeetingTagError> {
  const invalid = ({ why }: { why: string }): Result<MeetingTag, MeetingTagError> =>
    err(MeetingTagErrors.lineInvalid({ why }));
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return invalid({ why: "a tag line is not JSON" });
  }
  if (!isRecord(parsed) || parsed["schemaVersion"] !== MEETING_TAG_SCHEMA_VERSION) {
    return invalid({ why: `a tag line is not a schema ${String(MEETING_TAG_SCHEMA_VERSION)} meeting tag` });
  }
  const { slug, calendarId, eventId, summary, startIso, startWall, taggedIso } = parsed;
  if (
    typeof slug !== "string" ||
    typeof calendarId !== "string" ||
    typeof eventId !== "string" ||
    typeof startIso !== "string" ||
    typeof startWall !== "string" ||
    typeof taggedIso !== "string"
  ) {
    return invalid({ why: "a tag line is missing its slug, calendar, event, start or tagged instant" });
  }
  if (summary !== undefined && typeof summary !== "string") {
    return invalid({ why: `the tag for ${slug} carries a summary that is not text` });
  }
  const startMs = parseIsoMs({ tsIso: startIso });
  if (!isValidPageSlug({ slug }) || startMs === undefined) {
    return invalid({ why: `the tag for ${slug} carries a slug or a start that does not parse` });
  }
  // Read as an instant because it ranks two pages tagged to one meeting (`../talk/meetingDue.ts`'s `withBriefings`).
  if (parseStrictIsoInstantMs({ text: taggedIso }) === undefined) {
    return invalid({ why: `the tag for ${slug} carries a tagged instant that does not parse` });
  }
  return ok({
    calendarId,
    eventId,
    schemaVersion: MEETING_TAG_SCHEMA_VERSION,
    slug,
    // In UTC and floored to its minute, because the card's key carries the start to the minute: a meeting stops
    // being due at the instant its card lapses, never seconds after, when a pass would post the card again.
    startIso: new Date(startMs - (startMs % MINUTE_MS)).toISOString(),
    startWall,
    summary,
    taggedIso,
  });
}

/**
 * Every page's CURRENT tag: the ledger is append-only, so a re-tag is a later row and the last one per slug wins.
 *
 * @param tags every row, in the order the ledger holds them
 * @returns one tag per slug
 */
export function currentTags({ tags }: { tags: readonly MeetingTag[] }): readonly MeetingTag[] {
  const bySlug = new Map<string, MeetingTag>();
  for (const tag of tags) {
    bySlug.set(tag.slug, tag);
  }
  return [...bySlug.values()];
}

/**
 * The ONE tagged meeting that is due now: the soonest whose start is inside the lead and still ahead.
 *
 * One, never every one: the due note is the meeting the owner walks into next, floated above every other note. A second
 * meeting inside the same hour is due the moment the first one starts.
 *
 * @param tags each page's current tag
 * @param nowMs the instant judged at
 * @param leadMs how long before its start a meeting is due
 * @returns the due tag, or `undefined` when none is
 */
export function dueMeetingTag({
  tags,
  nowMs,
  leadMs,
}: {
  tags: readonly MeetingTag[];
  nowMs: number;
  leadMs: number;
}): MeetingTag | undefined {
  const due = tags.filter((tag) => {
    const startMs = Date.parse(tag.startIso);
    return startMs - leadMs <= nowMs && nowMs < startMs;
  });
  return due.toSorted((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso) || a.slug.localeCompare(b.slug))[0];
}
