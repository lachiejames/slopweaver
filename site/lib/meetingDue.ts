/**
 * A meeting of the owner's that is starting now, as the console reads it off `slopweaver talk meeting-due --json` — the
 * strict boundary between that verb's output and the call that tells the owner (`PlanCall.announceMeeting`), and the
 * join pill beside the orb.
 *
 * The voice is the best one to get the owner's attention while they are already talking to it (measured: two minutes
 * late for a meeting while talking to the voice), so it interrupts to
 * say the meeting is starting and to click the button to join. Which meetings qualify is the verb's
 * (`src/talk/meetingDue.ts`); this module only refuses an answer it cannot read, and never trusts a field it did not
 * check — a calendar title is someone else's text, and the join link opens in the owner's browser.
 */
import { isBag } from "./bag";
import { isPageSlug, LOCAL_PAGE_ROUTE } from "./localPageHref";

/** One meeting starting now that the owner can join. */
export interface MeetingNotice {
  /** Stable across polls: the call says a notice once, and the page never asks about it again. */
  readonly noticeId: string;
  /** The calendar the verb read it from; an event id is unique only within one. */
  readonly calendarId: string;
  /** The event INSTANCE, as Google names it: what a skip the owner said names ({@link unskippedNotices}). */
  readonly eventId: string;
  readonly title: string;
  readonly startIso: string;
  /** Its timed end: the verb names no meeting without one. */
  readonly endIso: string;
  /** An `https:` or `http:` link. */
  readonly joinUrl: string;
  /** The published page tagged to this meeting (`page tag --meeting`), in the page slug alphabet; `null` for none. */
  readonly briefingSlug: string | null;
}

/** The longest title taken: the verb caps it at 80, so anything past this is not the verb's answer. */
const TITLE_MAX_CHARS = 200;

/** How long past its start `talk meeting-due` can still name a meeting: the verb's late edge. */
export const MEETING_LATE_EDGE_MS = 10 * 60_000;

/** The longest notice id taken: an iCalUID and an instant, with room. */
export const NOTICE_ID_MAX_CHARS = 1_024;

/**
 * A web link, or `undefined` for anything else.
 *
 * @param value the field as read
 * @returns the link
 */
function webLinkOf({ value }: { value: unknown }): string | undefined {
  if (typeof value !== "string" || !URL.canParse(value)) {
    return undefined;
  }
  const { protocol } = new URL(value);
  if (protocol !== "https:" && protocol !== "http:") {
    return undefined;
  }
  return value;
}

/**
 * A UTC instant exactly as the verb prints one (`toISOString`), or `undefined` for anything else.
 * `Date.parse` alone takes a bare year such as `"9999"`, which is no timed end.
 *
 * @param value the field as read
 * @returns the instant as written
 */
function instantOf({ value }: { value: unknown }): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms) || new Date(ms).toISOString() !== value) {
    return undefined;
  }
  return value;
}

/**
 * One meeting off the verb's answer, or `undefined` when any field is not what the verb prints.
 *
 * @param value one element of the answer's `meetings`
 * @returns the notice
 */
export function meetingNoticeOf({ value }: { value: unknown }): MeetingNotice | undefined {
  if (!isBag(value)) {
    return undefined;
  }
  const { noticeId, calendarId, eventId, title, startIso, endIso, joinUrl } = value;
  const start = instantOf({ value: startIso });
  const link = webLinkOf({ value: joinUrl });
  const end = instantOf({ value: endIso });
  const briefing = briefingSlugOf({ value: value["briefingSlug"] });
  const titleFits = typeof title === "string" && title.trim().length > 0 && title.length <= TITLE_MAX_CHARS;
  const idsFit = isNoticeId(noticeId) && isNoticeId(calendarId) && isNoticeId(eventId);
  // The verb names no meeting without a timed end, so an answer carrying one is not the verb's.
  if (!idsFit || !titleFits || start === undefined || end === undefined || link === undefined) {
    return undefined;
  }
  return {
    briefingSlug: briefing,
    calendarId,
    endIso: end,
    eventId,
    joinUrl: link,
    noticeId,
    startIso: start,
    title: collapsedTitle({ title }),
  };
}

/**
 * Whether a value is an identifier the verb prints: a non-empty string of at most {@link NOTICE_ID_MAX_CHARS}.
 *
 * @param value the field as read
 * @returns true for one
 */
function isNoticeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= NOTICE_ID_MAX_CHARS;
}

/**
 * A title on one line, whitespace collapsed.
 *
 * @param title the title as read
 * @returns the title as the pill and a skip carry it
 */
function collapsedTitle({ title }: { title: string }): string {
  return title.replaceAll(/\s+/gu, " ").trim();
}

/**
 * A meeting the owner said they have already had, or will not go to, held by the page for the provider's life (`meeting_skip`,
 * `../components/voice/meetingSkipRun.ts`). Keyed by the calendar instance, never the title: two meetings can share a
 * title inside a day, and the owner may rule out only one of them.
 */
export interface MeetingSkip {
  readonly calendarId: string;
  readonly eventId: string;
  /** The title the thinking model read off the owner's calendar, kept for the log and the answer — never the key. */
  readonly title: string;
  /** When the page took the skip: its receipt of the owner's just-finished words, not the instant they said them. */
  readonly saidAtMs: number;
}

/**
 * How far either side of the owner's word a skip reaches: the meeting the owner means is today's, so a page that lives overnight
 * never carries the word onto a provider id reused for a later meeting.
 */
export const MEETING_SKIP_HORIZON_MS = 12 * 60 * 60_000;

/**
 * The most skips a page holds, or posts: a day holds a handful of meetings, never hundreds. A page at the cap refuses
 * another rather than dropping one, since a dropped skip brings back a heads-up the owner ruled out.
 */
export const MEETING_SKIPS_MAX = 64;

/**
 * One skip off a page's post, or `undefined` when any field is not what the page holds.
 *
 * @param value one element of the post's `skipped`
 * @returns the skip
 */
export function meetingSkipOf({ value }: { value: unknown }): MeetingSkip | undefined {
  if (!isBag(value)) {
    return undefined;
  }
  const { calendarId, eventId, title, saidAtMs } = value;
  const titleFits = typeof title === "string" && title.trim().length > 0 && title.length <= TITLE_MAX_CHARS;
  const saidFits = typeof saidAtMs === "number" && Number.isSafeInteger(saidAtMs) && saidAtMs >= 0;
  if (!isNoticeId(calendarId) || !isNoticeId(eventId) || !titleFits || !saidFits) {
    return undefined;
  }
  return { calendarId, eventId, saidAtMs, title: collapsedTitle({ title }) };
}

/**
 * The skips a page's post says the owner has made, or `undefined` when the field is not a short list of them — one unreadable
 * skip refuses the whole post, since dropping it would bring back a heads-up the owner ruled out. An absent or null field is a page
 * from before skips existed, still open across a server update, so it holds none: refusing it would hide every meeting
 * from that tab.
 *
 * @param value the post's `skipped` field
 * @returns the skips
 */
export function skippedMeetingsOf({ value }: { value: unknown }): readonly MeetingSkip[] | undefined {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MEETING_SKIPS_MAX) {
    return undefined;
  }
  const skips = value.map((one: unknown) => meetingSkipOf({ value: one }));
  if (skips.some((skip) => skip === undefined)) {
    return undefined;
  }
  return skips.filter((skip): skip is MeetingSkip => skip !== undefined);
}

/**
 * Whether a skip the owner said covers a meeting: the same instance on the same calendar, starting within
 * {@link MEETING_SKIP_HORIZON_MS} of the owner's word, either side, edges included.
 *
 * @param notice the meeting
 * @param skip what the owner said
 * @returns true when the owner ruled this meeting out
 */
export function skipCovers({ notice, skip }: { notice: MeetingNotice; skip: MeetingSkip }): boolean {
  return (
    notice.calendarId === skip.calendarId &&
    notice.eventId === skip.eventId &&
    Math.abs(Date.parse(notice.startIso) - skip.saidAtMs) <= MEETING_SKIP_HORIZON_MS
  );
}

/**
 * The meetings the owner has not ruled out, in their order. The owner is assumed to be going to every meeting unless
 * they have said otherwise, and a skip they said must take effect.
 *
 * @param notices the meetings read
 * @param skips the meetings the owner said they have had or will not go to
 * @returns every notice no skip covers
 */
export function unskippedNotices({
  notices,
  skips,
}: {
  notices: readonly MeetingNotice[];
  skips: readonly MeetingSkip[];
}): readonly MeetingNotice[] {
  return notices.filter((notice) => !skips.some((skip) => skipCovers({ notice, skip })));
}

/**
 * The briefing a meeting carries: a page slug, or `null` for none. Absent reads as none, which is what a CLI built
 * before the field existed prints. Anything that is not a slug reads as none as well, never as a refused meeting: the
 * join link is what gets the owner in, and a briefing the console cannot trust must not take the pill down with it.
 *
 * @param value the field as read
 * @returns the slug, or `null`
 */
function briefingSlugOf({ value }: { value: unknown }): string | null {
  if (typeof value !== "string" || !isPageSlug({ slug: value })) {
    return null;
  }
  return value;
}

/**
 * Where the pill's "Open briefing" link goes: the console's own route to the tagged page, which the desktop shell opens
 * in its in-app viewer (`desktop/src/surface.ts`'s `inAppViewPath`), as a third option beside joining and skipping.
 *
 * @param notice the meeting on the pill
 * @returns `/api/page/<slug>/index.html`, or `undefined` when the meeting has no briefing
 */
export function meetingBriefingHref({ notice }: { notice: MeetingNotice }): string | undefined {
  if (notice.briefingSlug === null) {
    return undefined;
  }
  return `${LOCAL_PAGE_ROUTE}/${notice.briefingSlug}/index.html`;
}

/**
 * Every meeting in the verb's whole answer, or `undefined` when the answer is not one the verb prints — a single
 * unreadable meeting refuses the whole answer, since a meeting skipped is exactly the one the owner would be late for.
 *
 * @param value the parsed stdout of `talk meeting-due --json`
 * @returns the meetings, in the verb's order
 */
export function meetingDueAnswerOf({ value }: { value: unknown }): readonly MeetingNotice[] | undefined {
  if (!isBag(value)) {
    return undefined;
  }
  const { meetings } = value;
  if (!Array.isArray(meetings)) {
    return undefined;
  }
  const notices = meetings.map((one: unknown) => meetingNoticeOf({ value: one }));
  if (notices.some((notice) => notice === undefined)) {
    return undefined;
  }
  return notices.filter((notice): notice is MeetingNotice => notice !== undefined);
}

/**
 * The route's fresh read of meetings the page has already shown: every one it can read, never a refusal, since this
 * only updates a pill already up. `null` when there was no fresh read — the calendar read failed, or a route older
 * than the field — which vouches for no briefing.
 *
 * @param value the answer's `refreshed` field
 * @returns the meetings read, or `null` for no read
 */
export function refreshedNoticesOf({ value }: { value: unknown }): readonly MeetingNotice[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value
    .map((one: unknown) => meetingNoticeOf({ value: one }))
    .filter((notice): notice is MeetingNotice => notice !== undefined);
}

/**
 * The same meeting with no briefing: what a pill shows once no fresh read vouches for its briefing.
 *
 * @param notice the meeting
 * @returns the meeting itself when it has no briefing already, else a copy without one
 */
export function withoutBriefing({ notice }: { notice: MeetingNotice }): MeetingNotice {
  if (notice.briefingSlug === null) {
    return notice;
  }
  return { ...notice, briefingSlug: null };
}

/**
 * The pill after a fresh read. A briefing shows only while the latest read names the meeting: the read's copy replaces
 * the pill when it differs, so a page re-tagged away or tagged late follows the ledger. A
 * meeting the read no longer names — past the verb's late edge, or gone off the calendar — keeps its Join link but loses
 * its briefing, since nothing can say the page is still tagged to it. A failed read vouches for
 * nothing either, so it drops the briefing too; the next good read brings it back.
 *
 * @param pill the meeting on the pill, if any
 * @param refreshed the route's fresh read of meetings already shown, `null` when the read failed
 * @returns the pill to show — the very same object when nothing changed, so the page does not re-render
 */
export function refreshedPill({
  pill,
  refreshed,
}: {
  pill: MeetingNotice | undefined;
  refreshed: readonly MeetingNotice[] | null;
}): MeetingNotice | undefined {
  if (pill === undefined) {
    return undefined;
  }
  const fresh = refreshed?.find((notice) => notice.noticeId === pill.noticeId);
  if (fresh === undefined) {
    return withoutBriefing({ notice: pill });
  }
  const same =
    fresh.briefingSlug === pill.briefingSlug &&
    fresh.endIso === pill.endIso &&
    fresh.joinUrl === pill.joinUrl &&
    fresh.startIso === pill.startIso &&
    fresh.title === pill.title;
  return same ? pill : fresh;
}

/** The most notice ids a page may say it has shown: a call sees a handful of meetings, never hundreds. */
export const SHOWN_MAX = 64;

/**
 * The page's shown ids once it has shown `noticeId`: added once, the newest {@link SHOWN_MAX} kept, so every post fits
 * what {@link shownNoticeIdsOf} and {@link MEETING_DUE_BODY_MAX} take — unkept, the 65th meeting of a provider's life
 * has every later ask refused. An id 64 meetings old is long past its heads-up; the most its
 * loss can do is put a still-running meeting's pill back, answered `already` and never said again.
 *
 * @param shown the ids already shown, oldest first
 * @param noticeId the one just shown
 * @returns the ids to post from now on
 */
export function shownAfter({ shown, noticeId }: { shown: readonly string[]; noticeId: string }): readonly string[] {
  if (shown.includes(noticeId)) {
    return shown.slice(-SHOWN_MAX);
  }
  return [...shown, noticeId].slice(-SHOWN_MAX);
}

/** The most a JSON text can spend on one character of a string: a control character's `\u0000` escape. */
const JSON_CHAR_MAX = 6;

/** One skip's frame past its three strings: its keys, quotes, commas and a `saidAtMs` of up to 16 digits — 70, with room. */
const SKIP_FRAME_MAX = 96;

/**
 * The longest `meeting-due` body a page can post, in the `length` the route measures: `{ shown, skipped }` with every
 * list full and every string at its cap, each character at its widest escape. Derived from the caps, never written
 * down, so a page holding every skip it may never posts a body the route refuses — a refused post would hide every
 * meeting, not only the skipped ones (a fixed 80 000 cap is overrun by 64 full skips).
 */
export const MEETING_DUE_BODY_MAX =
  SHOWN_MAX * (NOTICE_ID_MAX_CHARS * JSON_CHAR_MAX + 3) +
  MEETING_SKIPS_MAX * ((2 * NOTICE_ID_MAX_CHARS + TITLE_MAX_CHARS) * JSON_CHAR_MAX + SKIP_FRAME_MAX) +
  64;

/**
 * The notice ids a page's post says it has already shown, or `undefined` when the field is not a short list of them.
 *
 * @param value the post's `shown` field
 * @returns the ids
 */
export function shownNoticeIdsOf({ value }: { value: unknown }): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > SHOWN_MAX) {
    return undefined;
  }
  const ids = value.filter(
    (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= NOTICE_ID_MAX_CHARS,
  );
  return ids.length === value.length ? ids : undefined;
}

/**
 * The first meeting the page has not shown yet, in the verb's order: the soonest start.
 *
 * @param notices the meetings the server read
 * @param shown the notice ids the page has already put in front of the owner
 * @returns the meeting, or `undefined` when every one is shown or none is due
 */
export function nextMeetingNotice({
  notices,
  shown,
}: {
  notices: readonly MeetingNotice[];
  shown: readonly string[];
}): MeetingNotice | undefined {
  return notices.find((notice) => !shown.includes(notice.noticeId));
}

/**
 * The meeting a page's ask is answered with: first one already said that the page never showed — its answer lost —
 * even past the verb's window, since the voice told the owner the link is by the orb and it is answered at once as
 * `already`; else the first fresh one not shown yet, which the next poll reaches. Each is judged again at `nowMs`, so
 * a meeting that ended while the verb ran is never named.
 *
 * @param due the meetings `talk meeting-due` just read, soonest first
 * @param claimed the meetings any call of this server was told to say (`./meetingLedger.ts`)
 * @param shown the notice ids the page has already put in front of the owner
 * @param nowMs the instant judged at
 * @returns the meeting, or `undefined` for none
 */
export function meetingToTell({
  due,
  claimed,
  shown,
  nowMs,
}: {
  due: readonly MeetingNotice[];
  claimed: readonly MeetingNotice[];
  shown: readonly string[];
  nowMs: number;
}): MeetingNotice | undefined {
  const live = [...claimed, ...due].filter((notice) => meetingPillLive({ notice, nowMs }));
  return nextMeetingNotice({ notices: live, shown });
}

/**
 * Whether the meeting has started at `nowMs`: from then on, telling the owner outranks a clear floor.
 *
 * @param notice the meeting
 * @param nowMs the instant judged at
 * @returns true at or after its start
 */
export function meetingStarted({ notice, nowMs }: { notice: MeetingNotice; nowMs: number }): boolean {
  return nowMs >= Date.parse(notice.startIso);
}

/**
 * Whether the pill for a meeting should still show at `nowMs`: until it ends.
 *
 * @param notice the meeting
 * @param nowMs the instant judged at
 * @returns true while the pill should show
 */
export function meetingPillLive({ notice, nowMs }: { notice: MeetingNotice; nowMs: number }): boolean {
  return nowMs < Date.parse(notice.endIso);
}

/**
 * The pill once the owner has said which meetings they have had or will not go to: gone at once when their word covers it, the
 * same pill otherwise, never waiting for the next poll.
 *
 * @param pill the meeting whose join pill is up, `undefined` with none
 * @param skips every skip held now, the one just said included
 * @returns the pill to keep showing, `undefined` for none
 */
export function pillAfterSkips({
  pill,
  skips,
}: {
  pill: MeetingNotice | undefined;
  skips: readonly MeetingSkip[];
}): MeetingNotice | undefined {
  if (pill === undefined) {
    return undefined;
  }
  return unskippedNotices({ notices: [pill], skips }).at(0);
}
