/**
 * What a Queue tool answers from: the RECORD, read fresh at the call (`../components/voice/freshVoiceRecord.ts`), and
 * checked against the Queue on SCREEN, so the voice never names a count, or opens a card, the screen does not show.
 *
 * Read the record and never the page's copy. The page's channels are held quiet through a call and `board` is not
 * polled at all, so its copy can be hours old, and a card the voice could not open because the loaded queue was out of
 * sync is the failure. The record is the answer; the screen is only what it is checked against, three ways:
 *
 * - **The screen did not reach the voice**: the items are still the record's, but the counts and the Queue's drawn
 *   order are unread, and the answer says so as an unread source.
 * - **The screen draws other than the record** — a card on one and not the other, or a card at another tier: the
 *   counts the page prints and its drawn order describe a different Queue, so both are unread and the answer names
 *   the difference, never sets the record's rows beside the screen's figures.
 * - **A card the record holds and the screen does not draw** is read, never opened: moving the console to it would
 *   open a panel on nothing (`undrawnWhyOf`).
 *
 * Not one instant: the record's verbs answer across the read, as the page's own polls do. Pure.
 */
import { queueFocuses } from "./queueFocus";
import type { QueueRow } from "./queueRows";
import { type QueueScreenSnapshot, SCREEN_QUEUE_SOURCE, unreadShown } from "./queueScreenVoice";
import type { QueueShownCounts } from "./queueShownCounts";
import {
  type ActionItemReadings,
  type ActionItemsAnswer,
  actionItemProjection,
  actionItemsAnswer,
  type UnreadSource,
} from "./talkActionItems";
import { fitUnread, UNREAD_MAX_BYTES } from "./unreadFit";
import { otherWorkContext, type WorkContext } from "./workContext";
import type { WorkspacePlacer } from "./workspacePlacement";

/** The cards `read_card`, `open_card` and `triage_next` resolve against. */
export type HeldCards = QueueScreenSnapshot["cards"];

/** The Queue on screen, as one Queue tool saw it, or why it did not reach the voice. */
export type ScreenSeen =
  | {
      readonly kind: "seen";
      /** The cards the screen draws. */
      readonly cards: HeldCards;
      /** On the Queue, every key it drew, in its order; `undefined` off it. */
      readonly drawn: readonly string[] | undefined;
      /** The counts it prints. */
      readonly shown: QueueShownCounts;
    }
  | { readonly kind: "unreached"; readonly why: string };

/**
 * The cards one set of readings projects to — the record's, or a page's own.
 *
 * @param readings the registers and the overlays
 * @param nowIso the end of the departure window
 * @param placer the organisation's address readers
 * @returns the rows, acts, focuses and recently-left cards
 */
export function heldCardsOf({
  readings,
  nowIso,
  placer,
}: {
  readings: ActionItemReadings;
  nowIso: string;
  placer: WorkspacePlacer;
}): HeldCards {
  const projected = actionItemProjection({ nowIso, placer, readings });
  return {
    acts: projected.alignment,
    focuses: queueFocuses({ workstreams: readings.workstreams }),
    recentlyLeft: projected.recentlyLeft,
    rows: projected.live,
  };
}

/**
 * Why the screen and the record are not the same Queue, by card key and tier.
 *
 * @param record the rows the record projects to
 * @param screen the rows the screen draws from
 * @returns the sentence naming each side's extra cards, or `undefined` when they hold the same cards at the same tiers
 */
export function screenBehindWhy({
  record,
  screen,
}: {
  record: readonly QueueRow[];
  screen: readonly QueueRow[];
}): string | undefined {
  const marks = (rows: readonly QueueRow[]): Set<string> => new Set(rows.map((row) => `${row.key} (${row.tier})`));
  const onRecord = marks(record);
  const onScreen = marks(screen);
  const onlyRecord = [...onRecord].filter((mark) => !onScreen.has(mark));
  const onlyScreen = [...onScreen].filter((mark) => !onRecord.has(mark));
  if (onlyRecord.length === 0 && onlyScreen.length === 0) {
    return undefined;
  }
  const parts: string[] = [];
  if (onlyRecord.length > 0) {
    parts.push(`the record holds ${onlyRecord.join(", ")} and the screen does not`);
  }
  if (onlyScreen.length > 0) {
    parts.push(`the screen still draws ${onlyScreen.join(", ")} and the record does not`);
  }
  return `the Queue on screen is not the record read just now, so its counts and order are unread: ${parts.join("; ")}`;
}

/**
 * Why a card the record holds is not one the console can open, `undefined` when the screen draws it.
 *
 * @param key the card's key, as the record's row carries it
 * @param screen what the screen showed
 * @returns the reason, said as the opening's skip
 */
export function undrawnWhyOf({ key, screen }: { key: string; screen: ScreenSeen }): string | undefined {
  if (screen.kind === "unreached") {
    return `the Queue on screen did not reach the voice, so the console was not moved: ${screen.why}`;
  }
  const { cards } = screen;
  if ([...cards.rows, ...cards.acts].some((row) => row.key === key)) {
    return undefined;
  }
  return `${key} is on the record, read just now, but the console on screen has not drawn it yet, so it was not moved`;
}

/**
 * The record, then the screen asked AFTER it arrived. The record read can take its whole 17 s, and a screen asked at
 * its start could have moved to another page, context or filter by the time the answer combines the two.
 *
 * @param record the fresh record read
 * @param screen the ask for the Queue on screen
 * @returns the record, and the screen as it stood once the record had arrived
 */
export async function recordThenScreen<R>({
  record,
  screen,
}: {
  record: () => Promise<R>;
  screen: () => Promise<ScreenSeen>;
}): Promise<{ readonly record: R; readonly screen: ScreenSeen }> {
  const read = await record();
  return { record: read, screen: await screen() };
}

/**
 * What of a Queue tool's one deadline the screen asks keep: the record read ends this long before the deadline
 * (`../components/voice/freshVoiceRecord.ts` `RECORD_READ_DEADLINE_MS`), so the screen asked after it, and asked again
 * before `open_card` moves the console, still answer inside the tool's twenty seconds. The shell
 * mostly answers inside milliseconds; one asking the console tab twice under its 2000 ms deadline
 * (`desktop/src/voiceQueueWire.ts`) is cut here and named unreached. A judgement over that arithmetic.
 */
export const QUEUE_SCREEN_RESERVE_MS = 3000;

/** A timer a deadline race waits on, cancelled once the race is decided. */
export interface DeadlineTimer {
  readonly done: Promise<void>;
  readonly cancel: () => void;
}

/**
 * The screen, asked inside what is left of a Queue tool's deadline: an ask queued behind another, or a shell slow to
 * answer, cannot carry the tool's answer, or `open_card`'s move of the console, past it. Out of
 * time, the screen is unreached and named so, which leaves the console where it was.
 *
 * @param ask the ask for the Queue on screen
 * @param deadlineAtMs the instant the tool's answer is due by
 * @param nowMs the monotonic clock, read immediately before the ask starts (`byDeadline`)
 * @param after a timer of a given length, the race's other side
 * @returns the screen, or why it did not answer in time
 */
export async function screenBy({
  ask,
  deadlineAtMs,
  nowMs,
  after,
}: {
  ask: () => Promise<ScreenSeen>;
  deadlineAtMs: number;
  nowMs: () => number;
  after: (input: { readonly ms: number }) => DeadlineTimer;
}): Promise<ScreenSeen> {
  const late: ScreenSeen = {
    kind: "unreached",
    why: "the Queue tool's time ran out before the Queue on screen answered",
  };
  return byDeadline({ after, ask, deadlineAtMs, late, nowMs });
}

/**
 * The record read to hold: the one begun later, so an older call's slow read that lands last never replaces a newer
 * one under a call still answering from it. A tie goes to the read landing
 * now, since two calls sharing one read hold the same record.
 *
 * @param held the read held now, `undefined` before any
 * @param read the read that just landed
 * @returns whichever was begun later
 */
export function newerRead<T extends { readonly startedAtMs: number }>({
  held,
  read,
}: {
  held: T | undefined;
  read: T;
}): T {
  if (held !== undefined && held.startedAtMs > read.startedAtMs) {
    return held;
  }
  return read;
}

/**
 * Any read a Queue tool makes after the record, inside what is left of its one deadline: a card's linked briefings and
 * an act's pull-request lookup run after the record and the screen, so unbounded they carried `read_card` and
 * `open_card` past the tool's twenty seconds. Out of time, the read comes to `late`, which each caller words as a read that did not arrive.
 *
 * @param ask the read
 * @param late what the read comes to once the time is up
 * @param deadlineAtMs the instant the tool's answer is due by, `undefined` before any Queue tool has read the record
 * @param nowMs the monotonic clock (`performance.now()`), read once to size the timer and again immediately before the
 * read starts, so the time a timer's setup takes can never start a read past the deadline
 * @param after a timer of a given length, the race's other side
 * @returns the read, or `late`
 */
export async function byDeadline<T>({
  ask,
  late,
  deadlineAtMs,
  nowMs,
  after,
}: {
  ask: () => Promise<T>;
  late: T;
  deadlineAtMs: number | undefined;
  nowMs: () => number;
  after: (input: { readonly ms: number }) => DeadlineTimer;
}): Promise<T> {
  if (deadlineAtMs === undefined) {
    return ask();
  }
  const firstMs = nowMs();
  if (firstMs >= deadlineAtMs) {
    return late;
  }
  let timer = after({ ms: deadlineAtMs - firstMs });
  const lastMs = nowMs();
  if (lastMs >= deadlineAtMs) {
    timer.cancel();
    return late;
  }
  // The first timer was sized off the first reading, so time lost before it was armed would carry the wait past the
  // deadline; it is re-armed off the last reading, leaving only the arming itself before the start.
  if (lastMs > firstMs) {
    timer.cancel();
    timer = after({ ms: deadlineAtMs - lastMs });
  }
  try {
    return await Promise.race([ask(), timer.done.then(() => late)]);
  } finally {
    timer.cancel();
  }
}

/**
 * Why the console cannot be moved to a card, judged against the screen asked at the moment of the move — never the
 * one the record read was checked against, which a page change since may have left behind.
 *
 * @param key the card's key, as the record's row carries it
 * @param screen the ask for the Queue on screen, made now
 * @returns the reason, said as the opening's skip, `undefined` when the screen draws the card now
 */
export async function undrawnNowWhy({
  key,
  screen,
}: {
  key: string;
  screen: () => Promise<ScreenSeen>;
}): Promise<string | undefined> {
  return undrawnWhyOf({ key, screen: await screen() });
}

/**
 * The `action_items` answer from the record, checked against the screen.
 *
 * @param readings the record's readings
 * @param screen what the screen showed
 * @param view the view the page has open, under which every count reads unread when the screen cannot vouch for one
 * @returns the answer — the record's items, the screen's counts and order only where the screen is the record's Queue
 */
export function recordQueueAnswer({
  readings,
  screen,
  view,
  nowIso,
  placer,
  context,
  shows,
}: {
  readings: ActionItemReadings;
  screen: ScreenSeen;
  view: QueueShownCounts["view"];
  nowIso: string;
  placer: WorkspacePlacer;
  context: WorkContext;
  shows: (row: { readonly placement: QueueRow["placement"] }) => boolean;
}): ActionItemsAnswer {
  let behind: string;
  if (screen.kind === "unreached") {
    behind = `the Queue on screen did not reach the voice, so its counts and order are unread: ${screen.why}`;
  } else {
    const record = actionItemProjection({ nowIso, placer, readings }).live;
    const differs = screenBehindWhy({ record, screen: screen.cards.rows });
    if (differs === undefined) {
      return actionItemsAnswer({
        ...readings,
        context,
        drawn: screen.drawn,
        nowIso,
        placer,
        shown: screen.shown,
        shows,
      });
    }
    behind = differs;
  }
  const shown = unreadShown({ otherContext: otherWorkContext({ context }), view });
  const answer = actionItemsAnswer({ ...readings, context, nowIso, placer, shown, shows });
  // Added past the answer's fit, so the whole list is held to its own budget, the screen's difference included
  // the 20 KiB fit plus it stays under the page's 24 KiB cap.
  const unread = fitUnread({ unread: [...answer.unread, { source: SCREEN_QUEUE_SOURCE, why: behind }] });
  return { ...answer, complete: false, unread };
}

/**
 * The record sources only the card tools stand on, unread: the autonomy ledger's acts are the Alignment page's cards,
 * never an action item, so `action_items` rightly leaves them out of its own unread list while `read_card` and
 * `open_card` resolve an act against them.
 *
 * The row is held to `fitUnread`'s budget here, at its source: a failed verb's reason is its stderr, of any length,
 * and every answer it reaches reserves only that budget.
 *
 * @param acts the autonomy ledger as the record read it
 * @returns the unread row, or none when it arrived
 */
export function cardOnlyUnreadOf({ acts }: { acts: ActionItemReadings["acts"] }): readonly UnreadSource[] {
  if (acts.phase === "ready") {
    return [];
  }
  const why = acts.phase === "loading" ? "still loading" : acts.why;
  return fitUnread({ unread: [{ source: "autonomy acts", why }] });
}

/**
 * A card tool's reads of the cards, remembering every source unread at any of them. The tool reads the cards once it
 * has a key, again after an act lookup and as it ends, and another Queue call may replace the record between any two, so
 * the answer names whatever any read could not read, rather than a chosen pair of snapshots.
 * Each read carries every source unread at it or any read before it, so a refusal the tool words from its latest read
 * names them too.
 *
 * @param cards reads the cards now
 * @returns the reads to hand the tool, and every source unread at any read so far, a read taken now included
 */
export function trackedCardReads<C extends { readonly unread: readonly UnreadSource[] }>({
  cards,
}: {
  cards: () => C;
}): { readonly cards: () => C; readonly unreadSeen: () => readonly UnreadSource[] } {
  let seen: readonly UnreadSource[] = [];
  const read = (): C => {
    const now = cards();
    seen = unreadAtEither({ after: now.unread, before: seen });
    return { ...now, unread: seen };
  };
  return {
    cards: read,
    unreadSeen: () => {
      read();
      return seen;
    },
  };
}

/**
 * A card answer, carrying the record sources its reads could not read once it found the card: a refusal names them
 * itself already, a not-found one in its sentence and a settled one beside it (`../components/voice/openCardRun.ts`),
 * and a card found beside an unread overlay may be one that overlay withdraws.
 *
 * The unread list is asked for only once the tool found its card: a refusal before any card read (a blank key) reads
 * no cards at all.
 *
 * @param ran what the card tool came to
 * @param unreadSeen every source unread at any of the tool's card reads, a read taken now included (`trackedCardReads`)
 * @param capBytes the UTF-8 bytes the whole answer stays under (`withRecordUnread`)
 * @returns the same outcome, its answer carrying `unread` when any source is
 */
export function withCardsUnread<R extends { readonly refused: boolean; readonly answer: unknown }>({
  ran,
  unreadSeen,
  capBytes,
}: {
  ran: R;
  unreadSeen: () => readonly UnreadSource[];
  capBytes: number;
}): R {
  if (ran.refused) {
    return ran;
  }
  return { ...ran, answer: withRecordUnread({ answer: ran.answer, capBytes, unread: unreadSeen() }) };
}

/**
 * The sources unread at either of two card reads, each named once, `before`'s first: another Queue call can replace
 * the record between them, and what a card tool answers may stand on either.
 *
 * @param before the sources unread at the earlier read
 * @param after the sources unread at the later one
 * @returns every source unread at either
 */
export function unreadAtEither({
  before,
  after,
}: {
  before: readonly UnreadSource[];
  after: readonly UnreadSource[];
}): readonly UnreadSource[] {
  const seen = new Set(before.map((one) => `${one.source}\u0000${one.why}`));
  return [...before, ...after.filter((one) => !seen.has(`${one.source}\u0000${one.why}`))];
}

/**
 * A card tool's answer, carrying the record sources its read could not read. A card resolved against a reading that
 * never arrived is not a card that is not there, and a triage pass's summary over a failed read is not the Queue's,
 * so the answer names what it stands on. Untouched when every source arrived.
 *
 * The list is added after the card was fitted, so it is held to the room the answer actually
 * leaves under `capBytes`, never more than `fitUnread`'s own budget, which the card's cap reserves. A card whose own
 * fields are near the cap leaves less than that reserve, and the list is shortened into what is left. An answer leaving no room even for the one entry folding every source is not carried; a short answer
 * saying so names the sources instead, rather than the page refusing the whole of it. A `unread` the answer already
 * carries is replaced, never counted as room taken.
 *
 * @param answer what the card tool answered
 * @param unread the record sources the read before it could not read (`../components/voice/useOpenCardSeams.ts` `cards`)
 * @param capBytes the UTF-8 bytes the whole answer stays under: the page's tool cap, less any wrapper still to come
 * @returns the answer, with `unread` beside its own fields when any source is unread
 */
export function withRecordUnread({
  answer,
  unread,
  capBytes,
}: {
  answer: unknown;
  unread: readonly UnreadSource[];
  capBytes: number;
}): unknown {
  if (unread.length === 0) {
    return answer;
  }
  let own: Readonly<Record<string, unknown>> = { answer };
  if (typeof answer === "object" && answer !== null && !Array.isArray(answer)) {
    own = Object.fromEntries(Object.entries(answer).filter(([key]) => key !== "unread"));
  }
  const room = Math.min(UNREAD_MAX_BYTES, capBytes - answerBytes({ value: own }));
  const composed = { ...own, unread: fitUnread({ maxBytes: room, unread }) };
  if (answerBytes({ value: composed }) <= capBytes) {
    return composed;
  }
  return { notCarried: NOT_CARRIED, unread: fitUnread({ unread }) };
}

/** What stands in for an answer too near the cap to carry its unread sources beside it. */
export const NOT_CARRIED =
  "this answer came too near the page's size cap to carry beside it the sources its read missed, so it is not carried here; those sources are named instead";

/** A value's weight as the page sends it, in the UTF-8 bytes of its JSON. */
function answerBytes({ value }: { value: unknown }): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
