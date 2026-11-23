/**
 * Which of the owner's upcoming meetings is owed a prep brief that nobody has registered yet — the half of meeting
 * prep that WRITES a brief, where `../../monitor/meetingPrepDue.ts` only floats one already written and tagged.
 *
 * MEASURED: a weekly external audit session (eight attendees, four from outside the owner's domain) started with no
 * brief, because every brief had been a board row the supervisor registered by hand on request. The owner's
 * standing rule is the criterion this file encodes: a brief for a meeting the owner will
 * TALK in — an external session, a one-on-one, even a platform stand-up — and none for a lunch and learn
 * with no presenting, or a team meeting, produced automatically without being asked.
 *
 * ## Size and audience are the criterion, never a title list
 *
 * Every meeting that qualifies is small: the external session carries eight, a one-on-one two, the platform
 * stand-up seven. Every meeting that does not is large: the town hall carried over a hundred attendees and its
 * drinks dozens. So a meeting qualifies when at most {@link SMALL_MEETING_MAX_PEOPLE} people are on it, an outside
 * attendee included — an outside webinar is still one the owner attends. The reason (external, one-on-one, small)
 * only says which kind it is. A title list would need keeping, and the one meeting it missed would be the one the
 * owner walked into blind. What size cannot tell apart is a small meeting the owner only listens in; measured
 * false positives would earn an opt-out keyed on the recurring series, never a title match.
 *
 * Pure: no I/O, no clock. The verb is `../../cli/commands/calendar/prepDueRun.ts`.
 */
import { parseIsoMs } from "#lib/date.js";

import type { EventAttendee, ParsedCalendarEvent } from "./parse.js";

/**
 * The most people, the owner included, a meeting can carry and still be one the owner talks in.
 *
 * MEASURED on the owner's own calendar (`slopweaver calendar list --days 2`): the platform stand-up that qualifies
 * carries 7, the external session 8; the town hall that does not carries over a hundred and its drinks dozens.
 */
export const SMALL_MEETING_MAX_PEOPLE = 10;

/** Why a meeting qualifies for a brief. */
export type PrepReason = "external" | "one-on-one" | "small";

/** One meeting owed a brief, with what the registration needs to say about it. */
export interface PrepDueMeeting {
  readonly event: ParsedCalendarEvent;
  /** The start instant, UTC. */
  readonly startIso: string;
  /** The start's wall clock, `YYYY-MM-DD HH:MM`, in the offset the calendar wrote it in. */
  readonly startWall: string;
  readonly reason: PrepReason;
  /** Everyone on the invite but the owner and any room. */
  readonly others: readonly EventAttendee[];
  /** The domains of the attendees from outside the owner's own, sorted, deduplicated. */
  readonly externalDomains: readonly string[];
}

/**
 * Why one event in the window was not selected — printed per event so a skip is never silent.
 *
 * @internal — the element type of {@link PrepSelection}'s `skipped`; callers read it through that field.
 */
export interface PrepSkip {
  readonly event: ParsedCalendarEvent;
  readonly why: string;
}

/** What one selection pass decided about every event it was shown. */
export interface PrepSelection {
  readonly due: readonly PrepDueMeeting[];
  readonly skipped: readonly PrepSkip[];
}

/** The `YYYY-MM-DD HH:MM` of an RFC3339 date-time, in the offset it was written in. */
const WALL = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u;

/**
 * The domain part of an address, lower-cased, or `undefined` when it carries none.
 *
 * @param email the address, as Google reported it
 * @returns the domain, or `undefined`
 */
function domainOf({ email }: { email: string | undefined }): string | undefined {
  if (email === undefined) {
    return undefined;
  }
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) {
    return undefined;
  }
  return email.slice(at + 1).toLowerCase();
}

/**
 * The board slug a meeting's brief is registered under — keyed on the event INSTANCE, so a second pass over the
 * same meeting names the same row, and the next week's instance of a series names a fresh one.
 *
 * Google's instance ids are lower-case base32hex plus `_` and a `YYYYMMDDTHHMMSSZ` suffix, every character of
 * which a slug allows; anything else is replaced so the slug stays one a path can be built from.
 *
 * @param eventId the event instance id
 * @returns the slug
 */
export function prepRowSlug({ eventId }: { eventId: string }): string {
  return `meeting-brief-${eventId.toLowerCase().replaceAll(/[^a-z0-9._-]/gu, "-")}`;
}

/**
 * Whether one event is a meeting the owner is owed a brief for, and why — or why not.
 *
 * @param event the event, as `calendar list` parsed it
 * @param account the address the owner's calendar grant is bound to; its domain is the owner's own
 * @returns the qualifying reason with the people on it, or the reason it was skipped
 */
export function prepVerdict({
  event,
  account,
}: {
  event: ParsedCalendarEvent;
  account: string;
}):
  | { readonly kind: "brief"; readonly reason: PrepReason; readonly others: readonly EventAttendee[] }
  | { readonly kind: "skip"; readonly why: string } {
  if (event.status === "cancelled") {
    return { kind: "skip", why: "cancelled" };
  }
  if (event.start === undefined || event.start.kind === "all-day") {
    return { kind: "skip", why: "all-day, so no start a brief could be due before" };
  }
  const isOwner = (attendee: EventAttendee): boolean =>
    attendee.self || attendee.email?.toLowerCase() === account.toLowerCase();
  if (event.attendees.some((attendee) => isOwner(attendee) && attendee.responseStatus === "declined")) {
    return { kind: "skip", why: "the owner declined it" };
  }
  const others = event.attendees.filter((attendee) => !isOwner(attendee) && !attendee.resource);
  if (others.length === 0) {
    return { kind: "skip", why: "nobody else is on it" };
  }
  const ownDomain = domainOf({ email: account });
  const external = others.some((attendee) => {
    const domain = domainOf({ email: attendee.email });
    return domain !== undefined && domain !== ownDomain;
  });
  const people = others.length + 1;
  if (people > SMALL_MEETING_MAX_PEOPLE) {
    const audience = external ? "some from outside the owner's domain" : "all from the owner's own domain";
    return {
      kind: "skip",
      why: `${String(people)} people, ${audience} — a meeting that size is one the owner attends, not one they talk in`,
    };
  }
  if (external) {
    return { kind: "brief", others, reason: "external" };
  }
  if (others.length === 1) {
    return { kind: "brief", others, reason: "one-on-one" };
  }
  return { kind: "brief", others, reason: "small" };
}

/**
 * Every meeting starting inside the look-ahead that is owed a brief and has none registered or tagged yet.
 *
 * @param events the window's events, as `calendar list` returned them
 * @param account the address the owner's calendar grant is bound to
 * @param nowMs the instant judged at
 * @param horizonMs how far ahead a meeting is looked for; one already started is never selected
 * @param briefed whether a meeting already has a brief row or a tagged page, by event instance id
 * @returns the meetings owed a brief, soonest first, and why every other event was skipped
 */
export function selectPrepDue({
  events,
  account,
  nowMs,
  horizonMs,
  briefed,
}: {
  events: readonly ParsedCalendarEvent[];
  account: string;
  nowMs: number;
  horizonMs: number;
  briefed: (args: { eventId: string }) => boolean;
}): PrepSelection {
  const due: PrepDueMeeting[] = [];
  const skipped: PrepSkip[] = [];
  for (const event of events) {
    const verdict = prepVerdict({ account, event });
    if (verdict.kind === "skip") {
      skipped.push({ event, why: verdict.why });
      continue;
    }
    const timing = timingOf({ event, horizonMs, nowMs });
    if (timing.kind === "skip") {
      skipped.push({ event, why: timing.why });
      continue;
    }
    if (briefed({ eventId: event.id })) {
      skipped.push({ event, why: "a brief is already registered or tagged" });
      continue;
    }
    due.push({
      event,
      externalDomains: externalDomainsOf({ account, others: verdict.others }),
      others: verdict.others,
      reason: verdict.reason,
      startIso: new Date(timing.startMs).toISOString(),
      startWall: timing.startWall,
    });
  }
  return { due: due.toSorted((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso)), skipped };
}

/**
 * When a qualifying meeting starts, or why its start puts it outside this pass.
 *
 * @param event the meeting
 * @param nowMs the instant judged at; a start at or before it has already happened
 * @param horizonMs how far past `nowMs` a start may fall
 * @returns the start instant and its wall clock, or why the meeting is not in the window
 */
function timingOf({
  event,
  nowMs,
  horizonMs,
}: {
  event: ParsedCalendarEvent;
  nowMs: number;
  horizonMs: number;
}):
  | { readonly kind: "in-window"; readonly startMs: number; readonly startWall: string }
  | { readonly kind: "skip"; readonly why: string } {
  const start = event.start;
  const startMs = start?.kind === "timed" ? parseIsoMs({ tsIso: start.dateTime }) : undefined;
  const wall = start?.kind === "timed" ? WALL.exec(start.dateTime) : null;
  if (startMs === undefined || wall === null) {
    return { kind: "skip", why: "its start does not read as an instant" };
  }
  if (startMs <= nowMs) {
    return { kind: "skip", why: "already started" };
  }
  if (startMs > nowMs + horizonMs) {
    return { kind: "skip", why: "starts beyond the look-ahead" };
  }
  return { kind: "in-window", startMs, startWall: `${wall[1]!} ${wall[2]!}` };
}

/**
 * The domains of the attendees from outside the owner's own, sorted and deduplicated.
 *
 * @param account the address whose domain is the owner's own
 * @param others everyone on the invite but the owner and any room
 * @returns the outside domains
 */
function externalDomainsOf({
  account,
  others,
}: {
  account: string;
  others: readonly EventAttendee[];
}): readonly string[] {
  const ownDomain = domainOf({ email: account });
  return [
    ...new Set(
      others
        .map((attendee) => domainOf({ email: attendee.email }))
        .filter((domain): domain is string => domain !== undefined && domain !== ownDomain),
    ),
  ].toSorted();
}

/** How each reason reads in a brief's registration. */
const REASON_TEXT: Readonly<Record<PrepReason, string>> = {
  external: "it has attendees from outside the owner's domain",
  "one-on-one": "it is a one-on-one",
  small: "it is small enough that the owner talks in it",
};

/**
 * The `--ask` a seat reads: which meeting, why it qualifies, and the exact verbs that brief it and put it on the
 * owner's screen. One line, every identifier a verb argument, so the register's unrooted-path gate has nothing to refuse.
 *
 * @param meeting the meeting owed a brief
 * @returns the ask text
 */
export function prepAsk({ meeting }: { meeting: PrepDueMeeting }): string {
  const { event } = meeting;
  const title = event.summary === undefined ? "(untitled meeting)" : `"${event.summary}"`;
  const outside = meeting.externalDomains.length === 0 ? "" : `, from outside: ${meeting.externalDomains.join(", ")}`;
  const people = `${String(meeting.others.length + 1)} people${outside}`;
  return (
    `Meeting brief, unasked: ${title} at ${meeting.startWall} (calendar time) — ${people}; it qualifies because ` +
    `${REASON_TEXT[meeting.reason]}. The owner's standing rule: a brief ` +
    "for every meeting the owner will talk in, without being asked, aligned with reality " +
    "before the owner walks in. Read the " +
    `event with \`slopweaver calendar read ${event.id} --calendar ${event.calendarId}\`; find earlier briefs for ` +
    "the same people with `slopweaver page find`; brief it from the corpus and live sources — what the last " +
    "sessions settled and left owed either way, open threads, the numbers that matter, what the owner should push for " +
    "— following skills/page/SKILL.md. Review ONE page (`slopweaver page review-prepare`, then the Codex pass it prints) and publish it with " +
    "`slopweaver page publish --review <id>`, then tag it with " +
    `\`slopweaver page tag <page-slug> --meeting ${event.id} --calendar ${event.calendarId}\` so the ` +
    "meeting-prep-due monitor floats it before the meeting, and settle answered with the page as witness only " +
    "once the tag succeeded. Read-only across every integration: no send, no calendar write. If the meeting has " +
    "started, been cancelled or declined, no longer qualifies, or already has a page tagged to it when you pick this " +
    "up, settle declined naming that."
  );
}
