/**
 * The conversation the orb's messenger and the stage open on: what the owner and the console voice said to each other
 * on every earlier call and typed conversation, read off the call files by `talk thread --json`
 * (`src/talk/chatThread.ts`), drawn above the conversation going on now.
 *
 * Opening the chat shows the last message either side sent, however many days ago, and nothing that happened sooner.
 * Supervisor chatter (the owner's turns into the supervisor's chat and the chair's prose after each) is not part of
 * it, so the history holds only the two of them, spoken or typed. A typed turn carries a very small, subtle mark, and
 * Messenger-style dividers put a human-readable date at the top of each stretch after a long quiet, never an ISO
 * timestamp; a tapped bubble opens a line saying when it was said, in the same words (`saidAtLabel`).
 *
 * Pure, so every edge is a unit test. A malformed turn refuses the whole read rather than dropping the one turn, as
 * every reader of a verb here does (`../components/live/read.ts`).
 */
import { type Bag, bags, bool, instant, isBag, str, strings } from "./bag";
import { dateTimeFormatOf } from "./dateTimeFormat";
import type { StalenessFact } from "./stalenessLabel";

/**
 * The `who` a call stores for the owner's own speech — `src/talk/callRecord.ts`'s `OWNER_SPEAKER`, restated because
 * `site/` never imports `src/` and held equal by `site/__tests__/unit/ownerVocabularyMirror.test.ts`.
 */
export const OWNER_SPEAKER = "owner" as const;

/** One turn of an earlier conversation. */
export interface EarlierTurn {
  /** `<callId>:<segmentId>`, the id the same turn carried while its call was live (`shownSegmentOf`). */
  readonly id: string;
  readonly who: typeof OWNER_SPEAKER | "voice";
  readonly text: string;
  readonly atIso: string;
  /** When it began: the order the history is in, which a carried turn is set among the read's by. */
  readonly beganIso: string;
  readonly medium: "voice" | "typed";
  /** Whether it was finished; a call that dropped mid-sentence keeps the words it had. */
  readonly final: boolean;
}

/** The earlier conversation as read. */
export interface ChatThread {
  /** Oldest first. */
  readonly turns: readonly EarlierTurn[];
  /** Call files the verb could not read, each with why. */
  readonly unreadable: readonly string[];
  /** Whether the verb left out anything older than its first turn (`threadCutOf`). */
  readonly cut: boolean;
}

/** The live verb the thread is read through (`./liveVerbs.ts`). */
export const CHAT_THREAD_SLUG = "talk-thread";

/**
 * One turn off the wire.
 *
 * @param turn the turn's bag
 * @returns the turn, or `undefined` when a field is missing or is not its shape
 */
function turnOf({ turn }: { turn: Bag }): EarlierTurn | undefined {
  const id = str({ bag: turn, key: "id" });
  const who = str({ bag: turn, key: "who" });
  const text = str({ bag: turn, key: "text" });
  const atIso = instant({ bag: turn, key: "atIso" });
  const beganIso = instant({ bag: turn, key: "beganIso" });
  const medium = str({ bag: turn, key: "medium" });
  const final = bool({ bag: turn, key: "final" });
  if (id === undefined || text === undefined || atIso === undefined || beganIso === undefined || final === undefined) {
    return undefined;
  }
  if ((who !== OWNER_SPEAKER && who !== "voice") || (medium !== "voice" && medium !== "typed")) {
    return undefined;
  }
  return { atIso, beganIso, final, id, medium, text, who };
}

/**
 * Project `talk thread --json`.
 *
 * @returns the thread, in the verb's own order, or `undefined` when any turn is unreadable
 */
export function readChatThread(payload: unknown): ChatThread | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const wire = bags({ bag: payload, key: "turns" });
  const unreadable = strings({ bag: payload, key: "unreadable" });
  const cut = bool({ bag: payload, key: "cut" });
  if (wire === undefined || unreadable === undefined || cut === undefined) {
    return undefined;
  }
  const turns: EarlierTurn[] = [];
  for (const turn of wire) {
    const read = turnOf({ turn });
    if (read === undefined) {
      return undefined;
    }
    turns.push(read);
  }
  return { cut, turns, unreadable };
}

/**
 * The turns a new read leaves the history holding. A read that could not open every call file is missing whatever
 * those files held, so it never takes a turn the last read had away: each such turn stays, in time order among the
 * new read's. Only a read that opened every file stands alone — the files are append-only, so a turn it lacks is
 * one that is gone from disk.
 *
 * @param held the turns the history holds now, oldest first, `undefined` before the first read
 * @param read the read that just came back
 * @returns the turns to hold, oldest first
 */
export function heldTurnsOf({
  held,
  read,
}: {
  held: readonly EarlierTurn[] | undefined;
  read: ChatThread;
}): readonly EarlierTurn[] {
  if (read.unreadable.length === 0 || held === undefined) {
    return read.turns;
  }
  const readIds = new Set(read.turns.map((turn) => turn.id));
  const kept = held.filter((turn) => !readIds.has(turn.id));
  // Never re-sorted: a read's order is when each turn began, which a turn's last-snapshot instant does not repeat.
  return carriedAmong({ carried: held, kept, read: read.turns, readIds });
}

/**
 * What the history marks after its earlier turns when the last read could not open every call file. What a file that
 * cannot be read said cannot be drawn, so the history marks one missing rather than end on an older line as though it
 * were the last — as a staleness mark whose hover names each file and why, never a sentence where the
 * turns would go.
 *
 * @param unreadable the files the last read could not open, each with why
 * @returns one fact per file, or `undefined` when every file was read
 */
export function unreadFacts({ unreadable }: { unreadable: readonly string[] }): readonly StalenessFact[] | undefined {
  if (unreadable.length === 0) {
    return undefined;
  }
  return unreadable.map((why) => ({ subject: "what was said on a call", why }));
}

/**
 * The earlier turns the history draws: the thread as read, then any carried turn the read does not have yet — both
 * oldest first — less every turn the conversation going on now already shows, so none is drawn twice.
 *
 * Every carried turn the read lacks stays, in the order it was said, among the read's own, whose order stands
 * (`carriedAmong`): a batch can land after a later one, so lacking a turn is no proof it is gone, and a
 * read that missed a file decides nothing about what that file held. The one exception is a read that
 * opened every file but left older history out: a carried turn that falls ahead of every turn it holds was aged out
 * by that cut, and is never drawn back in — unless the sink lost it before it reached the file, so it
 * was never on disk to age out.
 *
 * @param read the thread off disk, `undefined` while it has not been read
 * @param complete whether that read opened every call file
 * @param cut whether that read left out anything older than its first turn
 * @param carried the turns of conversations that ended on this page
 * @param live the ids of the speech drawn live now, only those the stage's window holds (`liveWindowOf`)
 * @param unwritten the turns whose speech the sink lost a batch of before it reached the file
 * @returns the turns, oldest first
 */
export function earlierTurnsOf({
  read,
  complete,
  cut,
  carried,
  live,
  unwritten,
}: {
  read: readonly EarlierTurn[] | undefined;
  complete: boolean;
  cut: boolean;
  carried: readonly EarlierTurn[];
  live: readonly string[];
  unwritten: ReadonlySet<string>;
}): readonly EarlierTurn[] {
  const shown = new Set(live);
  if (read === undefined) {
    return carried.filter((turn) => !shown.has(turn.id));
  }
  const readIds = new Set(read.map((turn) => turn.id));
  // The disk's copy wins wherever the read holds the turn — the carried one may be the words before the last batch
  // — unless the sink lost a batch of it (`lostSnapshotsKept`), and the read is never re-sorted: its
  // order is the order each turn BEGAN, which a turn's own instant, its last snapshot's, does not repeat.
  const kept = carried.filter((turn) => !readIds.has(turn.id));
  const placed = carriedAmong({ carried, kept, read: lostSnapshotsKept({ carried, read, unwritten }), readIds });
  const oldestRead = read.at(0);
  if (!complete || !cut || oldestRead === undefined) {
    return placed.filter((turn) => !shown.has(turn.id));
  }
  const cutAt = placed.findIndex((turn) => turn.id === oldestRead.id);
  return placed.filter((turn, at) => !shown.has(turn.id) && (at >= cutAt || unwritten.has(turn.id)));
}

/**
 * The read's turns, each the sink lost a batch of drawn from the page's carried copy instead, where the read holds
 * it: the disk's copy may be a partial whose final was refused. The disk's stands only when it is
 * finished and the carried one is not — then the batch it lacks was one before its last.
 *
 * @param read the thread off disk, oldest first
 * @param carried the turns of conversations that ended on this page
 * @param unwritten the turns whose speech the sink lost a batch of
 * @returns the read's turns, in its order
 */
function lostSnapshotsKept({
  read,
  carried,
  unwritten,
}: {
  read: readonly EarlierTurn[];
  carried: readonly EarlierTurn[];
  unwritten: ReadonlySet<string>;
}): readonly EarlierTurn[] {
  const carriedById = new Map(carried.map((turn) => [turn.id, turn]));
  return read.map((turn) => {
    const copy = carriedById.get(turn.id);
    if (copy === undefined || !unwritten.has(turn.id) || (turn.final && !copy.final)) {
      return turn;
    }
    return { ...copy, beganIso: turn.beganIso };
  });
}

/**
 * Carried turns the read lacks, set among the read's without moving any of them. Each goes ahead of whichever comes
 * first: the first read turn that began after it, or the next carried turn the read does hold, so
 * carried turns keep the order they were said in.
 *
 * @param read the thread off disk, oldest first
 * @param readIds the ids it holds
 * @param carried every carried turn, oldest first
 * @param kept the carried turns to set among the read's, none of which it holds
 * @returns every turn, oldest first
 */
function carriedAmong({
  read,
  readIds,
  carried,
  kept,
}: {
  read: readonly EarlierTurn[];
  readIds: ReadonlySet<string>;
  carried: readonly EarlierTurn[];
  kept: readonly EarlierTurn[];
}): readonly EarlierTurn[] {
  const keptIds = new Set(kept.map((turn) => turn.id));
  const placed = [...read];
  let from = 0;
  carried.forEach((turn, index) => {
    if (!keptIds.has(turn.id)) {
      return;
    }
    const beganMs = Date.parse(turn.beganIso);
    const later = placed.findIndex((held, at) => at >= from && Date.parse(held.beganIso) > beganMs);
    const nextOnDisk = carried.slice(index + 1).find((after) => readIds.has(after.id));
    let anchor = -1;
    if (nextOnDisk !== undefined) {
      anchor = placed.findIndex((held) => held.id === nextOnDisk.id);
    }
    const bounds = [later, anchor].filter((at) => at !== -1);
    let at = placed.length;
    if (bounds.length > 0) {
      at = Math.max(from, Math.min(...bounds));
    }
    placed.splice(at, 0, turn);
    from = at + 1;
  });
  return placed;
}

/**
 * Whether two earlier histories hold the same turns, field for field — what lets the history keep the array it drew
 * when a transcript delta derived an identical one, so nothing below it words its dates again.
 *
 * @param left one history, oldest first
 * @param right the other
 * @returns true when every turn matches in order
 */
export function sameEarlierTurns({
  left,
  right,
}: {
  left: readonly EarlierTurn[];
  right: readonly EarlierTurn[];
}): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((turn, index) => {
    const other = right[index];
    return (
      turn.id === other.id &&
      turn.who === other.who &&
      turn.text === other.text &&
      turn.atIso === other.atIso &&
      turn.beganIso === other.beganIso &&
      turn.medium === other.medium &&
      turn.final === other.final
    );
  });
}

/** How long a quiet must last for the next turn to open under its own date: Messenger's own hour. */
export const DIVIDER_GAP_MS = 60 * 60 * 1000;

/**
 * One row of the earlier history: a date over the stretch below it, or a turn with the words a tap on it opens, worded
 * here once rather than by every render of its bubble.
 */
export type EarlierRow =
  | { readonly kind: "divider"; readonly key: string; readonly label: string }
  | { readonly kind: "turn"; readonly turn: EarlierTurn; readonly saidAt: string };

/**
 * The earlier turns as rows, each stretch after a long quiet or on a new day opened by its date — the first turn
 * always is. Each turn carries when it began in {@link saidAtLabel}'s words, so the stage words its history once per
 * change of history or day, never once per render (`./dateTimeFormat.ts` says why that cost a call).
 *
 * @param turns the earlier turns, oldest first
 * @param nowIso the instant the history is drawn at, which "Today" and "Yesterday" are read against
 * @param timeZone the reader's time zone, the one days are counted in
 * @returns the rows, oldest first
 */
export function earlierRowsOf({
  turns,
  nowIso,
  timeZone,
}: {
  turns: readonly EarlierTurn[];
  nowIso: string;
  timeZone: string;
}): readonly EarlierRow[] {
  const rows: EarlierRow[] = [];
  let last: { atMs: number; day: string } | undefined;
  for (const turn of turns) {
    const atMs = Date.parse(turn.atIso);
    const day = dayOf({ atMs, timeZone });
    if (last === undefined || atMs - last.atMs >= DIVIDER_GAP_MS || day !== last.day) {
      rows.push({
        key: `divider-${turn.id}`,
        kind: "divider",
        label: saidAtLabel({ atIso: turn.atIso, nowIso, timeZone }),
      });
    }
    rows.push({ kind: "turn", saidAt: saidAtLabel({ atIso: turn.beganIso, nowIso, timeZone }), turn });
    last = { atMs, day };
  }
  return rows;
}

/**
 * The calendar day an instant falls on in a time zone, as `YYYY-MM-DD` — what the stage keys its worded history on, so
 * the words move at midnight and at no other render.
 *
 * @param atMs the instant, epoch milliseconds
 * @param timeZone an IANA name, such as the reader's own resolved one
 * @returns the day
 */
export function dayOf({ atMs, timeZone }: { atMs: number; timeZone: string }): string {
  return dateTimeFormatOf({
    locale: "en-CA",
    options: { day: "2-digit", month: "2-digit", timeZone, year: "numeric" },
  }).format(atMs);
}

/**
 * The calendar day before a `YYYY-MM-DD` day, counted on the calendar rather than 24 hours back, so a 23- or 25-hour
 * day at a daylight-saving change still has the right yesterday.
 *
 * @param day the day, `YYYY-MM-DD`
 * @returns the day before it, `YYYY-MM-DD`
 */
function dayBefore({ day }: { day: string }): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10);
}

/**
 * When something was said, in the words a person uses: the day — "Today", "Yesterday", else the weekday and date, with
 * the year only when it is not this one — and the time of day. One label for both places the history says a time: the
 * divider over a stretch, and the line a tapped bubble opens.
 *
 * @param atIso the instant it was said
 * @param nowIso the instant the history is drawn at
 * @param timeZone the reader's time zone
 * @returns the label, e.g. "Yesterday, h:mm pm" or "Wed D Mon, h:mm am"
 */
export function saidAtLabel({ atIso, nowIso, timeZone }: { atIso: string; nowIso: string; timeZone: string }): string {
  const atMs = Date.parse(atIso);
  const nowMs = Date.parse(nowIso);
  const time = dateTimeFormatOf({ locale: "en-AU", options: { hour: "numeric", minute: "2-digit", timeZone } })
    .format(atMs)
    .replace(/\s/gu, " ");
  const day = dayOf({ atMs, timeZone });
  const today = dayOf({ atMs: nowMs, timeZone });
  if (day === today) {
    return `Today, ${time}`;
  }
  if (day === dayBefore({ day: today })) {
    return `Yesterday, ${time}`;
  }
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  const date = dateTimeFormatOf({
    locale: "en-AU",
    options: { day: "numeric", month: "short", timeZone, weekday: "short", ...(sameYear ? {} : { year: "numeric" }) },
  })
    .format(atMs)
    .replace(",", "");
  return `${date}, ${time}`;
}
