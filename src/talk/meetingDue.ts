/**
 * Which of the owner's meetings is starting now with a link to join it — the pure half of `slopweaver talk
 * meeting-due`, which the console reads while the owner is on a call so the voice can tell them once and put the join
 * link in front of them.
 *
 * An owner already talking to the voice can be late for a meeting, and the voice is the best one to get their
 * attention and tell them to click the button to get in the meeting.
 *
 * **Joinable is the criterion, never size.** `../live/calendar/prepDue.ts` picks the meetings the owner will TALK in
 * for a brief, and skips a solo or a large one; here a town hall the owner has not declined is still one they may be
 * late for. So a meeting qualifies when it has a timed start, a join link, has not ended, is not cancelled and the
 * owner has not declined it — and its start is at most {@link MEETING_EARLY_MS} ahead or {@link MEETING_LATE_MS} behind.
 *
 * Pure: no I/O, no clock. The verb is `../cli/commands/talk/meetingDueRun.ts`.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";

import type { ParsedCalendarEvent } from "../live/calendar/parse.js";
import { currentTags, type MeetingTag } from "../pages/meetingTag.js";

/** How long before a meeting starts the voice may tell the owner: about to start, not a reminder. */
export const MEETING_EARLY_MS = 2 * 60_000;

/** How long after a meeting started the voice still tells the owner: past this they have joined, or chosen not to. */
export const MEETING_LATE_MS = 10 * 60_000;

/** The longest title the voice says, in characters: a title is spoken, so it is one short line. */
export const MEETING_TITLE_MAX_CHARS = 80;

/** What a meeting with no title is called. */
export const UNTITLED_MEETING = "your meeting";

/** One meeting starting now that the owner can join. */
export interface JoinableMeeting {
  /** Stable across polls and across calendars holding the same invite; distinct per instance of a series. */
  readonly noticeId: string;
  readonly eventId: string;
  readonly calendarId: string;
  /** One line, at most {@link MEETING_TITLE_MAX_CHARS} characters. */
  readonly title: string;
  readonly startIso: string;
  /** In UTC. */
  readonly endIso: string;
  /** An `https:` or `http:` link, as the event carries it. */
  readonly joinUrl: string;
  /** The published page tagged to this meeting ({@link withBriefings}), or `null` when it has none. */
  readonly briefingSlug: string | null;
}

/** The whole answer `talk meeting-due --json` prints. */
export interface MeetingDueAnswer {
  readonly readAtIso: string;
  readonly meetings: readonly JoinableMeeting[];
}

/**
 * The event's join link when it is a web address, else `undefined`.
 *
 * @param url the event's conference link
 * @returns the link, or `undefined` for a missing or non-web one
 */
function webLinkOf({ url }: { url: string | undefined }): string | undefined {
  if (url === undefined || !URL.canParse(url)) {
    return undefined;
  }
  const { protocol } = new URL(url);
  if (protocol !== "https:" && protocol !== "http:") {
    return undefined;
  }
  return url;
}

/**
 * A title as the voice says it: one line, whitespace collapsed, capped.
 *
 * @param summary the event's own title
 * @returns the title, or {@link UNTITLED_MEETING} for none
 */
export function spokenTitle({ summary }: { summary: string | undefined }): string {
  if (summary === undefined) {
    return UNTITLED_MEETING;
  }
  const line = summary.replaceAll(/\s+/gu, " ").trim();
  if (line === "") {
    return UNTITLED_MEETING;
  }
  if (line.length <= MEETING_TITLE_MAX_CHARS) {
    return line;
  }
  return `${line.slice(0, MEETING_TITLE_MAX_CHARS - 1).trimEnd()}…`;
}

/**
 * Whether the owner declined it: their own attendee row, or the row whose address is their grant's.
 *
 * @param event the event
 * @param account the address the owner's calendar grant is bound to
 * @returns true when the owner declined
 */
function declinedByOwner({ event, account }: { event: ParsedCalendarEvent; account: string }): boolean {
  return event.attendees.some(
    (attendee) =>
      (attendee.self || attendee.email?.toLowerCase() === account.toLowerCase()) &&
      attendee.responseStatus === "declined",
  );
}

/**
 * One event as a joinable meeting now, or `undefined` when it is not one.
 *
 * @param event the event, as `calendar list` parsed it
 * @param account the address the owner's calendar grant is bound to
 * @param nowMs the instant judged at
 * @returns the meeting, or `undefined`
 */
function joinableAt({
  event,
  account,
  nowMs,
}: {
  event: ParsedCalendarEvent;
  account: string;
  nowMs: number;
}): JoinableMeeting | undefined {
  if (event.status === "cancelled" || event.start?.kind !== "timed" || declinedByOwner({ account, event })) {
    return undefined;
  }
  const joinUrl = webLinkOf({ url: event.conferenceUrl });
  // Strict: `Date.parse` reads a bare calendar date as UTC midnight, an instant the event never named.
  const startMs = parseStrictIsoInstantMs({ text: event.start.dateTime });
  if (joinUrl === undefined || startMs === undefined) {
    return undefined;
  }
  if (nowMs < startMs - MEETING_EARLY_MS || nowMs > startMs + MEETING_LATE_MS) {
    return undefined;
  }
  // The end must be a timed instant still ahead: a missing, all-day or unreadable end beside a timed start cannot say
  // the meeting is still on.
  if (event.end?.kind !== "timed") {
    return undefined;
  }
  const endMs = parseStrictIsoInstantMs({ text: event.end.dateTime });
  if (endMs === undefined || endMs <= nowMs) {
    return undefined;
  }
  const endIso = new Date(endMs).toISOString();
  const startIso = new Date(startMs).toISOString();
  // One meeting on two of the owner's calendars shares an iCalUID, so it is said once; an event without one is its own id.
  let identity = `${event.calendarId}/${event.id}`;
  if (event.iCalUID !== undefined) {
    identity = event.iCalUID;
  }
  return {
    briefingSlug: null,
    calendarId: event.calendarId,
    endIso,
    eventId: event.id,
    joinUrl,
    noticeId: `${identity}@${startIso}`,
    startIso,
    title: spokenTitle({ summary: event.summary }),
  };
}

/**
 * Every meeting the owner can join that starts now, soonest first, one per invite.
 *
 * @param events the events read over a window covering now
 * @param account the address the owner's calendar grant is bound to
 * @param nowMs the instant judged at
 * @returns the meetings, earliest start first, then by notice id
 */
export function joinableMeetings({
  events,
  account,
  nowMs,
}: {
  events: readonly ParsedCalendarEvent[];
  account: string;
  nowMs: number;
}): readonly JoinableMeeting[] {
  const byNotice = new Map<string, JoinableMeeting>();
  for (const event of events) {
    const meeting = joinableAt({ account, event, nowMs });
    if (meeting !== undefined && !byNotice.has(meeting.noticeId)) {
      byNotice.set(meeting.noticeId, meeting);
    }
  }
  return [...byNotice.values()].toSorted(
    (left, right) =>
      Date.parse(left.startIso) - Date.parse(right.startIso) || left.noticeId.localeCompare(right.noticeId),
  );
}

/**
 * Each meeting with the briefing page tagged to it (`slopweaver page tag <slug> --meeting <event-id>`), so the pill
 * beside the orb can open it: a third option, open the briefing for this meeting, since many of the owner's meetings
 * have a briefing associated with them.
 *
 * A tag names one event INSTANCE on one calendar (`../pages/meetingTag.ts`), so it matches on `calendarId` and
 * `eventId` and never on the start: a moved meeting keeps its instance id, and the page is still its briefing. Only
 * each page's CURRENT tag counts, so a page re-tagged to another meeting no longer opens from this one. Of two
 * published pages tagged to one meeting, the later-tagged wins. Matching after {@link joinableMeetings} has collapsed
 * one invite to one calendar's copy is sound because `talk meeting-due` lists only the owner's primary calendar — the one
 * `page tag` defaults to; listing more would mean matching before that collapse.
 *
 * @param meetings the meetings starting now
 * @param tags every tag row the ledger holds, in ledger order
 * @param published whether a page is published under a slug — a tagged page since deleted is no briefing
 * @returns the meetings in the same order, each carrying its briefing's slug or `null`
 */
export function withBriefings({
  meetings,
  tags,
  published,
}: {
  meetings: readonly JoinableMeeting[];
  tags: readonly MeetingTag[];
  published: (input: { slug: string }) => boolean;
}): readonly JoinableMeeting[] {
  const current = currentTags({ tags });
  return meetings.map((meeting) => {
    const candidates = current.filter(
      (tag) =>
        tag.calendarId === meeting.calendarId && tag.eventId === meeting.eventId && published({ slug: tag.slug }),
    );
    const latest = candidates.toSorted(
      (left, right) => Date.parse(right.taggedIso) - Date.parse(left.taggedIso) || left.slug.localeCompare(right.slug),
    )[0];
    if (latest === undefined) {
      return meeting;
    }
    return { ...meeting, briefingSlug: latest.slug };
  });
}

/**
 * Every slug {@link withBriefings} may ask `published` about for these meetings: each page whose current tag names one
 * of them. The verb asks the store about exactly these before it attaches briefings, so the pure match never waits on
 * the store and never asks about a page the store was not asked about.
 *
 * @param meetings the meetings starting now
 * @param tags every tag row the ledger holds, in ledger order
 * @returns the candidate slugs, each once, in the order each first appears in the ledger
 */
export function briefingCandidates({
  meetings,
  tags,
}: {
  meetings: readonly JoinableMeeting[];
  tags: readonly MeetingTag[];
}): readonly string[] {
  const tagged = currentTags({ tags }).filter((tag) =>
    meetings.some((meeting) => meeting.calendarId === tag.calendarId && meeting.eventId === tag.eventId),
  );
  return [...new Set(tagged.map((tag) => tag.slug))];
}

/**
 * The calendar window that holds every event {@link joinableMeetings} could pick at `nowMs`: Google lists an event
 * that ENDS after the window opens and STARTS before it closes, so a meeting already running is listed, and one
 * starting inside {@link MEETING_EARLY_MS} is too.
 *
 * @param nowMs the instant judged at
 * @returns the window's bounds
 */
export function meetingDueWindow({ nowMs }: { nowMs: number }): { timeMinIso: string; timeMaxIso: string } {
  return {
    timeMaxIso: new Date(nowMs + MEETING_EARLY_MS + 1).toISOString(),
    timeMinIso: new Date(nowMs).toISOString(),
  };
}
