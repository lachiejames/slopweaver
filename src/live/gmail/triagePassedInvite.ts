/**
 * Whether a calendar-invite mail's meeting has already happened — the triage rule about one MESSAGE's meeting.
 *
 * An install that declares the `passed-invite` structural rule (`./triageRules.ts`) treats a meeting-invite mail as
 * junk once its meeting has happened; one that does not cards it like any other mail. An invite comes from whoever
 * organised the meeting, a
 * colleague or an outside person, so it shares a sender group with that person's real mail: no sender row can carry
 * it, and `./triage.ts` holds each passed invite out of its group instead.
 *
 * The triage reads headers only, so the meeting's time is read off the subject Google Calendar writes, measured on the
 * owner's mailbox (`slopweaver gmail list --query "filename:invite.ics newer_than:60d" --limit 100`):
 * `Invitation: <title> @ <weekday> <day> <month> <year> <start> - <end> (<zone>) (<invitee>)`, with `Updated invitation`, `Updated invitation
 * with note`, `Accepted` and `Cancelled event` the other prefixes on the same shape. Every one is mail ABOUT that one
 * meeting, so every one is junk once it is over.
 *
 * **Never a guess.** Only a subject that parses whole is judged: a closed prefix list, then a strict grammar over the
 * text after the LAST ` @ ` — one date, or a date range, each `<weekday> <day> <month> <year>` whose weekday agrees
 * with the date, with optional clock times (an hour with am or pm, minutes optional). A recurring meeting (`@ Weekly
 * from <start> to <end> on Friday`)
 * has no last day, and anything else that does not parse is not passed, so it is carded as before.
 *
 * **No timezone table.** The subject's `(<zone>)` is the owner's calendar's zone, but a day ends last in the westernmost civil
 * zone, UTC-12. So a meeting is over once the reading is past the end of its LAST day there — that day plus one,
 * noon UTC. It never archives before the meeting ended anywhere, at the cost of carding a just-finished meeting's mail
 * for up to a day longer than its own zone needs.
 *
 * A subject is the sender's text, so a person could title a mail like an invite. `./triage.ts` therefore judges only a
 * message Gmail's own `filename:invite.ics` search names; what bounds the rest is that the act is an archive, and
 * archived mail stays searchable. Pure, and no pattern runs over sender text but anchored single-token ones, which the
 * `redos-check` gate admits.
 */

/** The subject prefixes Google Calendar writes on mail about one meeting, each followed by `: `. */
const INVITE_PREFIXES: ReadonlySet<string> = new Set([
  "Invitation",
  "Updated invitation",
  "Updated invitation with note",
  "Accepted",
  "Tentatively accepted",
  "Declined",
  "Cancelled event",
  "Cancelled event with note",
]);

/** Weekday abbreviations, Sunday first, as `Date#getUTCDay` numbers them. */
const WEEKDAYS: readonly string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Month abbreviations to their zero-based index; Google writes September as `Sept`. */
const MONTHS: Readonly<Record<string, number>> = {
  Apr: 3,
  Aug: 7,
  Dec: 11,
  Feb: 1,
  Jan: 0,
  Jul: 6,
  Jun: 5,
  Mar: 2,
  May: 4,
  Nov: 10,
  Oct: 9,
  Sep: 8,
  Sept: 8,
};

/** A clock time as Google writes it in a subject: an hour with am or pm, minutes optional. */
const TIME_TOKEN = /^(?:1[0-2]|[1-9])(?::[0-5]\d)?(?:am|pm)$/u;

/** A day of the month, without a leading zero. */
const DAY_TOKEN = /^(?:[1-9]|[12]\d|3[01])$/u;

/** A four-digit year. */
const YEAR_TOKEN = /^\d{4}$/u;

/** One calendar date read off a subject, as UTC midnight of that day. */
interface SubjectDate {
  readonly utcMidnightMs: number;
}

/** Read `<weekday> <day> <month> <year>` off four tokens, or undefined when they are not one real, agreeing date. */
function readDate({ tokens }: { tokens: readonly string[] }): SubjectDate | undefined {
  const [weekday, day, month, year] = tokens;
  if (weekday === undefined || day === undefined || month === undefined || year === undefined) {
    return undefined;
  }
  const monthIndex = MONTHS[month];
  if (!DAY_TOKEN.test(day) || !YEAR_TOKEN.test(year) || monthIndex === undefined) {
    return undefined;
  }
  const ms = Date.UTC(Number(year), monthIndex, Number(day));
  const date = new Date(ms);
  // `Date.UTC` rolls a day past a month's end into the next month and maps years 0-99 onto 1900-1999; a rolled date is not the one written.
  const writtenWhole =
    date.getUTCFullYear() === Number(year) && date.getUTCMonth() === monthIndex && date.getUTCDate() === Number(day);
  if (!writtenWhole || WEEKDAYS[date.getUTCDay()] !== weekday) {
    return undefined;
  }
  return { utcMidnightMs: ms };
}

/** Minutes past midnight of a token {@link TIME_TOKEN} already admitted: midnight is 0, half past noon is 750. */
function minutesOf({ token }: { token: string }): number {
  const [hours, minutes] = token.slice(0, -2).split(":");
  const pm = token.endsWith("pm") ? 12 : 0;
  const hourMinutes = ((Number(hours) % 12) + pm) * 60;
  if (minutes === undefined) {
    return hourMinutes;
  }
  return hourMinutes + Number(minutes);
}

/** One side of the meeting's span: a date with an optional time, or a bare time on the other side's date. */
interface SpanSide {
  readonly date: SubjectDate | undefined;
  /** Minutes past midnight, or undefined on an all-day side. */
  readonly minutes: number | undefined;
}

/** Read one side of the span, or undefined when its tokens are not one of the shapes above. */
function readSide({ text }: { text: string }): SpanSide | undefined {
  const tokens = text.split(" ");
  if (tokens.length === 1 && TIME_TOKEN.test(tokens[0]!)) {
    return { date: undefined, minutes: minutesOf({ token: tokens[0]! }) };
  }
  if (tokens.length !== 4 && tokens.length !== 5) {
    return undefined;
  }
  const date = readDate({ tokens: tokens.slice(0, 4) });
  const time = tokens[4];
  if (date === undefined) {
    return undefined;
  }
  if (time === undefined) {
    return { date, minutes: undefined };
  }
  return TIME_TOKEN.test(time) ? { date, minutes: minutesOf({ token: time }) } : undefined;
}

/**
 * Whether the text after the span is exactly Google's trailing groups — ` (AEDT) (Ada Owner)`, or the invitee
 * alone on an all-day meeting: one or two ` (<text>)` groups, each non-empty with no parenthesis inside, and nothing
 * after them. Read by index, never a pattern over sender text.
 */
function isZoneAndInvitee({ suffix }: { suffix: string }): boolean {
  let at = 0;
  let groups = 0;
  while (at < suffix.length) {
    if (!suffix.startsWith(" (", at)) {
      return false;
    }
    const close = suffix.indexOf(")", at + 2);
    const inner = close === -1 ? "" : suffix.slice(at + 2, close);
    if (inner.length === 0 || inner.includes("(")) {
      return false;
    }
    groups += 1;
    at = close + 1;
  }
  return groups >= 1 && groups <= 2;
}

/** The text of a Google Calendar notification subject after its prefix, or undefined when it carries none. */
function afterInvitePrefix({ subject }: { subject: string }): string | undefined {
  const colon = subject.indexOf(": ");
  if (colon === -1 || !INVITE_PREFIXES.has(subject.slice(0, colon))) {
    return undefined;
  }
  return subject.slice(colon + 2);
}

/** The span text of an invite subject — after its LAST ` @ `, before Google's trailing groups — or undefined. */
function spanOf({ subject }: { subject: string }): string | undefined {
  const rest = afterInvitePrefix({ subject });
  if (rest === undefined) {
    return undefined;
  }
  const at = rest.lastIndexOf(" @ ");
  if (at === -1) {
    return undefined;
  }
  const when = rest.slice(at + 3);
  // The span ends where Google's parenthesised zone and invitee begin; an all-day meeting carries the invitee alone.
  const paren = when.indexOf(" (");
  if (paren === -1 || !isZoneAndInvitee({ suffix: when.slice(paren) })) {
    return undefined;
  }
  return when.slice(0, paren);
}

/** The instant one side of the span names on a day: that day's midnight, plus its time when it carries one. */
function sideMs({ day, side }: { day: SubjectDate; side: SpanSide }): number {
  if (side.minutes === undefined) {
    return day.utcMidnightMs;
  }
  return day.utcMidnightMs + side.minutes * 60 * 1000;
}

/** The last day of a two-sided span, or undefined when its sides disagree in shape or the end precedes the start. */
function rangeLastDay({
  start,
  startDay,
  endText,
}: {
  start: SpanSide;
  startDay: SubjectDate;
  endText: string;
}): SubjectDate | undefined {
  const end = readSide({ text: endText });
  // Both sides timed, or both all-day: `<start> - <end>` clock times, or two full dates.
  if (end === undefined || (end.minutes === undefined) !== (start.minutes === undefined)) {
    return undefined;
  }
  // A bare end time is on the start's day.
  let endDay = startDay;
  if (end.date !== undefined) {
    endDay = end.date;
  }
  // An end before the start is no meeting Google wrote.
  if (sideMs({ day: endDay, side: end }) < sideMs({ day: startDay, side: start })) {
    return undefined;
  }
  return endDay;
}

/**
 * The instant after which the meeting a calendar-invite subject names is over everywhere on Earth: the day after its
 * last day, noon UTC. Pure.
 *
 * @param subject the mail's `Subject` header, as Google Calendar wrote it
 * @returns that instant as ISO, or undefined when the subject is not one meeting's invite mail that parses whole —
 *   a recurring meeting among them
 */
export function invitedMeetingOverAfterIso({ subject }: { subject: string }): string | undefined {
  const span = spanOf({ subject });
  if (span === undefined) {
    return undefined;
  }
  const sides = span.split(" - ");
  if (sides.length > 2) {
    return undefined;
  }
  const start = readSide({ text: sides[0]! });
  if (start?.date === undefined) {
    return undefined;
  }
  const endText = sides[1];
  const lastDay = endText === undefined ? start.date : rangeLastDay({ endText, start, startDay: start.date });
  if (lastDay === undefined) {
    return undefined;
  }
  const dayMs = 24 * 60 * 60 * 1000;
  return new Date(lastDay.utcMidnightMs + dayMs + dayMs / 2).toISOString();
}

/**
 * The instant a calendar-invite mail's meeting was over by, when it is one and the reading is at or past that
 * instant — at it, the next day has begun even at UTC-12. Pure.
 *
 * @param subject the mail's `Subject` header, when it carried one
 * @param readAtIso when the triage read the inbox
 * @returns the instant the meeting was over by, or undefined when the subject does not parse whole, the meeting is
 *   not yet over everywhere, or the reading's instant is unreadable
 */
export function passedMeetingInviteOverIso({
  subject,
  readAtIso,
}: {
  subject: string | undefined;
  readAtIso: string;
}): string | undefined {
  if (subject === undefined) {
    return undefined;
  }
  const overAfter = invitedMeetingOverAfterIso({ subject });
  const readAt = Date.parse(readAtIso);
  if (overAfter === undefined || !Number.isFinite(readAt) || readAt < Date.parse(overAfter)) {
    return undefined;
  }
  return overAfter;
}
