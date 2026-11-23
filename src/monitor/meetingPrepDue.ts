/**
 * `meeting-prep-due` — a page tagged to a meeting (`slopweaver page tag`) floats in front of the owner in the hour before
 * it starts, its Open button the page itself.
 *
 * The reason: a prep page cut the day before is not found when the meeting is minutes away, and nothing else puts it
 * in front of the owner. This is that putting.
 *
 * ## A notice at the top level, one meeting at a time
 *
 * Nothing waits on the owner, so the card is a NOTICE (on no queue) whose `url` is the page. Its note floats at the
 * `meeting-prep` level, above every other note stacked on screen (`../hand/note/panel.ts`), since the meeting is the
 * one thing that cannot wait. Exactly one subject, the soonest due meeting (`../pages/meetingTag.ts`'s
 * `dueMeetingTag`): the one the owner walks into next.
 *
 * ## The owner's Done holds until the meeting starts
 *
 * A card the owner settled is not posted again for the same meeting: the meeting still reads due after the owner's Done, so without
 * the hold the next tick re-posts it and floats it again — the class the same hold ended for
 * `fleet-unhealthy` (`skills/monitor/reference/fleet-unhealthy.md`). A later meeting in the same hour is
 * still shown.
 *
 * ## It settles when the meeting starts
 *
 * The meeting starting takes it out of the window, so a complete read departs the card and the pass takes its note
 * down. The key carries the start too, so {@link meetingPrepKeyLapsesAt} settles it on a pass that could not read
 * the ledger at all, or read only part of it (`./pass.ts`).
 *
 * Pure: the ledger read is `./meetingPrepDueSource.ts`.
 */
import { createHash } from "node:crypto";

import { fitLine } from "../hand/push/notice.js";
import { UNBLOCKS_CAP, WHAT_CAP } from "../hand/step.js";
import { dueMeetingTag, MEETING_PREP_LEAD_MS, type MeetingTag } from "../pages/meetingTag.js";

import type { MonitorDefinition } from "./registry.js";
import type { MonitorReading, MonitorSubject } from "./types.js";

/** The monitor's id, named once. */
const MONITOR_ID = "meeting-prep-due";

/** How many hex characters of the event's digest a key carries — enough to tell one day's meetings apart. */
const EVENT_DIGEST_CHARS = 8;

/** A key's shape: the event's digest, then its start as `yyyymmddhhmm` in UTC. */
const KEY_SHAPE = /^[0-9a-f]{8}-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/u;

/**
 * The card key one tagged meeting is posted under: stable for the meeting, and carrying its start so the card can be
 * settled from its id alone. 21 characters, so `mon-prep-<key>` stays well inside the register's id cap.
 *
 * @param tag the due meeting's tag
 * @returns the key
 */
export function meetingPrepKey({ tag }: { tag: MeetingTag }): string {
  const digest = createHash("sha256")
    .update(`${tag.calendarId}/${tag.eventId}`)
    .digest("hex")
    .slice(0, EVENT_DIGEST_CHARS);
  const start = tag.startIso.slice(0, 16).replaceAll(/[-T:]/gu, "");
  return `${digest}-${start}`;
}

/**
 * The instant a `meeting-prep-due` key's meeting starts — past which its card names a meeting already under way.
 *
 * @param key the key half of a step id
 * @returns the start as ISO-8601, or `undefined` for a key not of this shape
 */
export function meetingPrepKeyLapsesAt({ key }: { key: string }): string | undefined {
  const match = KEY_SHAPE.exec(key);
  if (match === null) {
    return undefined;
  }
  const [, year, month, day, hour, minute] = match;
  return `${year!}-${month!}-${day!}T${hour!}:${minute!}:00.000Z`;
}

/**
 * The one meeting a pass would fire over: the soonest due among those still open. The evaluator judges with it, and
 * the source asks it first so it checks the store for that one page and no other.
 *
 * @param tags each page's current tag
 * @param nowMs the instant judged at
 * @param dismissed the keys the owner closed, held off until their meeting starts
 * @returns the due tag, or undefined when no open meeting is due
 */
export function dueMeetingPrepTag({
  tags,
  nowMs,
  dismissed,
}: {
  tags: readonly MeetingTag[];
  nowMs: number;
  dismissed: ReadonlySet<string>;
}): MeetingTag | undefined {
  const undismissed = tags.filter((tag) => !dismissed.has(meetingPrepKey({ tag })));
  return dueMeetingTag({ leadMs: MEETING_PREP_LEAD_MS, nowMs, tags: undismissed });
}

/**
 * Judge the ledger: firing over the one due meeting, clear when none is due and every line was read.
 *
 * @param tags each page's current tag
 * @param unparsed the ledger lines that were not tags
 * @param nowMs the instant judged at
 * @param pageAddress the viewer address of a published page, or `undefined` when no page is published under it
 * @param dismissed the keys the owner closed ({@link dismissedKeys}), held off until their meeting starts
 * @returns the reading — a line that was not a tag makes a quiet read `unmeasurable`, never `clear`
 */
export function evaluateMeetingPrepDue({
  tags,
  unparsed,
  nowMs,
  pageAddress,
  dismissed,
}: {
  tags: readonly MeetingTag[];
  unparsed: readonly string[];
  nowMs: number;
  pageAddress: (options: { slug: string }) => string | undefined;
  dismissed: ReadonlySet<string>;
}): MonitorReading {
  const blindSpot =
    unparsed.length === 0 ? undefined : `the tag ledger has lines that are not tags: ${unparsed.join("; ")}`;
  const due = dueMeetingPrepTag({ dismissed, nowMs, tags });
  if (due === undefined) {
    if (blindSpot !== undefined) {
      return { because: blindSpot, monitorId: MONITOR_ID, state: "unmeasurable" };
    }
    return { monitorId: MONITOR_ID, state: "clear" };
  }
  const address = pageAddress({ slug: due.slug });
  if (address === undefined) {
    return {
      because: `${due.slug} is tagged to a meeting starting ${due.startIso}, and no page is published under it`,
      monitorId: MONITOR_ID,
      state: "unmeasurable",
    };
  }
  const subject: MonitorSubject = {
    address,
    id: due.slug,
    key: meetingPrepKey({ tag: due }),
    label: `${titleOf({ tag: due })} at ${due.startWall} (${due.startIso})`,
    meeting: { startWall: due.startWall, title: titleOf({ tag: due }) },
  };
  return { blindSpot, monitorId: MONITOR_ID, state: "firing", subjects: [subject] };
}

/**
 * The meetings the owner closed: every key with no card open whose last settle was not the pass departing it.
 *
 * The owner's Done holds until the meeting starts, or the next tick re-posts the card the owner just closed. The pass settles a
 * card too, and a card it departed because a SOONER meeting fell due must come back once that one starts. The
 * settled row says which it was: a departure records the monitor's "still fires" line (`./card.ts`'s
 * `departedWhileFiring`), and nothing else does. The instants cannot tell them apart, because a fired check stamps
 * the owner's Done and posts the sooner card on the same clock, often in the same millisecond. The tags as they stand now
 * cannot either: a re-tag rewrites them, and a meeting the owner already closed still reads due.
 *
 * The LAST settle is the last one the register wrote, never the latest instant: the owner's Done is stamped on the hand
 * clock and a departure on the pass's, which a `--now` sets apart, so a Done on a card's second occurrence can carry
 * an earlier instant than the departure of its first.
 *
 * Any other settle also reads as closed. That is a lapse, whose meeting has already started, a tag moved off the
 * meeting, which stays held only if that same meeting is tagged again before it starts, or a departure of a card the owner
 * had snoozed, which `./passSettle.ts` opens with the owner's snooze so it is held like the owner's Done.
 *
 * @param settles every settle of this monitor's cards in the order the register wrote them: its key, and whether
 *   the pass departed it
 * @param open the keys with a card still open, which nothing holds
 * @returns the keys held off the reading
 */
export function dismissedKeys({
  settles,
  open,
}: {
  settles: readonly { key: string; departed: boolean }[];
  open: ReadonlySet<string>;
}): ReadonlySet<string> {
  const last = new Map(settles.map((settle) => [settle.key, settle.departed]));
  const closed = [...last].filter(([key, departed]) => !open.has(key) && !departed);
  return new Set(closed.map(([key]) => key));
}

/** A meeting's title as the card names it. */
function titleOf({ tag }: { tag: MeetingTag }): string {
  if (tag.summary === undefined || tag.summary.trim().length === 0) {
    return "your next meeting";
  }
  // A terminator followed by a space would read as a second sentence the register refuses.
  return tag.summary
    .replaceAll(/([.?!])\s+/gu, "$1")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

/** What the card says either side of the meeting's title. */
const PREP_WHAT_OPEN = "Prep page for ";
const PREP_WHAT_MID = " at ";
const PREP_WHAT_CLOSE = " — Open shows it";

/**
 * The card's sentence: the meeting's title fitted to the room the cap leaves it, and its start.
 *
 * @param subject the due meeting, whose `meeting` the evaluator always sets
 * @returns the one sentence, never longer than the cap
 */
function prepWhat({ subject }: { subject: MonitorSubject }): string {
  const { meeting } = subject;
  if (meeting === undefined) {
    return PREP_PLAIN_WHAT;
  }
  const room =
    WHAT_CAP - PREP_WHAT_OPEN.length - PREP_WHAT_MID.length - meeting.startWall.length - PREP_WHAT_CLOSE.length;
  const title = fitLine({ cap: room, text: meeting.title });
  return `${PREP_WHAT_OPEN}${title}${PREP_WHAT_MID}${meeting.startWall}${PREP_WHAT_CLOSE}`;
}

/** The sentence a card falls back to when the register refuses one carrying the meeting's own title. */
const PREP_PLAIN_WHAT = "Prep page for a meeting starting within the hour — Open shows it";

/** `meeting-prep-due`: the prep page of the meeting starting within the hour, floated as a notice. */
export const MEETING_PREP_DUE: MonitorDefinition = {
  blurb:
    "A page tagged to a meeting (`page tag`) floats as a note in the hour before it starts, its Open button the page.",
  floats: true,
  id: MONITOR_ID,
  lapsesAt: ({ key }) => meetingPrepKeyLapsesAt({ key }),
  noteLevel: "meeting-prep",
  notice: {
    unaddressed: "nothing waits on you — the page is the prep for a meeting starting within the hour",
  },
  plainWhat: PREP_PLAIN_WHAT,
  prefix: "prep",
  resolves: "the meeting starts, or its page is re-tagged to another meeting",
  source:
    "$SLOPWEAVER_HOME/page-meetings.jsonl (the tags `page tag` wrote) against the pages under $SLOPWEAVER_HOME/pages",
  unblocks: ({ subject }) =>
    fitLine({
      cap: UNBLOCKS_CAP,
      text: `nothing waits on you — ${subject.id} was tagged to ${subject.label}`.replaceAll(/\s+/gu, " "),
    }),
  what: ({ subject }) => prepWhat({ subject }),
};
