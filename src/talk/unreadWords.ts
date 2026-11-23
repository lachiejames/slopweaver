/**
 * The owner's words on a call that the chair has not yet read — the pure half of `slopweaver talk unread`.
 *
 * Every word of the owner's transcripts with the conversational voice AI must reach the supervisor: a missed word is
 * to be impossible. The voice relays a SUMMARY of a steer, and once it dropped three whole steers the supervisor found
 * only by reading the call files itself. So the chair reads the call files, not the relays: every owner-side segment
 * appended since its cursor, relayed or not.
 *
 * ## Why the cursor is a byte position, never an instant
 *
 * A segment's `atIso` is the PAGE's clock when the snapshot was taken, and the page persists lines through a
 * retried queue, so a line can land in the file after one stamped later. A cursor of "read
 * through 12:05" would pass a 12:04 line appended at 12:06 as read, forever. The file is append-only, so the one
 * position that cannot be overtaken is how far into it the chair has read: one frontier per call file, anchored to
 * the sha256 of every byte before it, so a file rewritten underneath it is refused rather than read as consumed.
 *
 * ## A relay next to a word is evidence, never attribution
 *
 * A relay line names its turn and carries no segment id, so nothing here can say a relay CONTAINS a word. Each word
 * says which relay the call recorded next after it, or that none was — the truthful half, and the only one.
 *
 * Pure: no filesystem, no clock. The read and the cursor store are `./unreadRead.ts`.
 */
import {
  type CallOrigin,
  isOwnerCallOrigin,
  isOwnerConsoleOrigin,
  markedOrigin,
  originAfterOpen,
  originKey,
} from "./callOrigin.js";
import type { CallQuarantineRow } from "./callQuarantineLedger.js";
import { CALL_TEXT_CHARS, type CallEntry, SEGMENT_ID } from "./callRecord.js";

/** The scheme of a pointer to one stretch of the owner's speech on one call. */
const CALL_POINTER_SCHEME = "talk-call:";

/** A call id: a v4 UUID, the shape a call file is named for (`./callStore.ts`). */
const V4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** How far the chair has read into one call file: the end of the last whole line, and the hash of all it read. */
export interface CallFrontier {
  /** The byte just past the newline that ends the last whole line read — where the next unread line begins. */
  readonly offset: number;
  /** The sha256 of every byte before `offset`, so ANY byte behind the cursor rewritten is refused, not skipped. */
  readonly prefixSha256: string;
  /**
   * How much of the line AT `offset` was marked read in parts, when it is too large for one batch to print whole
   * (`./unreadParts.ts`) — the frontier stays at the line's start until its last part is marked.
   */
  readonly part?: LinePart;
}

/** A line being read in parts: how many were marked, and the hash of the line they were cut from. */
interface LinePart {
  readonly printed: number;
  /** The sha256 of the line's bytes, so a line rewritten between two parts is refused rather than read half-and-half. */
  readonly lineSha256: string;
  /**
   * Where the line the parts are cut from begins, when it is not the line AT the frontier: a later snapshot of the
   * same stretch, printed in place of every earlier one it continues (`./unreadParts.ts`). Absent, the line at the
   * frontier — the only shape a cursor once wrote, so an older reader still reads every cursor that omits it.
   */
  readonly lineOffset?: number;
}

/** One named reader's place in every call file, and when it last recorded one. */
export interface UnreadCursor {
  readonly recordedAtIso: string;
  readonly calls: Readonly<Record<string, CallFrontier>>;
}

/** A whole line past the frontier that is not a call line — possibly the owner's words, so it is shown, never skipped. */
export interface UnparseableLine {
  readonly callId: string;
  readonly byteOffset: number;
  /**
   * The WHOLE line — a mark counts it read, so nothing of it may go unprinted. A line whose bytes are not UTF-8 is
   * given as hex, since decoding would print a replacement character in place of the byte marked read.
   */
  readonly text: string;
}

/**
 * One whole line past a reader's frontier, where the frontier stands once it is read, and the sha256 of its bytes —
 * what a frontier reading it in parts binds to.
 */
export type TailLine =
  | { readonly kind: "entry"; readonly entry: CallEntry; readonly after: CallFrontier; readonly sha256: string }
  | {
      readonly kind: "unparseable";
      readonly line: UnparseableLine;
      readonly after: CallFrontier;
      readonly sha256: string;
    };

/** Everything one call file holds past a reader's frontier. */
export interface CallTail {
  readonly callId: string;
  /** Where the reader stood in this file before these lines, `undefined` for a call it has never read. */
  readonly start: CallFrontier | undefined;
  /**
   * Every segment finalised before `start`: a snapshot of one past it is a finished stretch, never a live one, since
   * a partial overtaken in flight by its final can land after a mark of that final.
   */
  readonly finalBefore: readonly string[];
  /** Every segment of the owner's with any snapshot before `start` — a stretch the reader has already seen part of. */
  readonly seenBefore: readonly string[];
  /**
   * Whether the call's last `open` or `closed` line before `start` is `closed` — the lines past it say whether it
   * opened again. A call id reused by a later session is open once more, never judged ended by the earlier close.
   */
  readonly endedBefore: boolean;
  /**
   * The origin the call's last `open` line before `start` carries (`./callOrigin.ts`), or `undefined` — none before it,
   * or one that predates the stamp. A segment past the frontier is still the call's after its open line was marked.
   */
  readonly originBefore: CallOrigin | undefined;
  /**
   * The origin each segment in `seenBefore` was FIRST seen under. A stretch belongs to the console it began on, so a
   * later snapshot past the frontier keeps that origin whatever opened in between (a foreign open
   * landing before the owner's stretch's final would otherwise have set the owner's words aside, and a mark passed
   * them unprinted).
   */
  readonly seenOriginBefore: ReadonlyMap<string, CallOrigin | undefined>;
  /**
   * The turn id of every relay line before `start` — a relay whose own call line, carrying the owner's words, the reader has
   * read past, which is what lets the chair be said to hold it (`./chairReceipt.ts`).
   */
  readonly relaysBefore: readonly string[];
  /**
   * Every whole line past it, in file order, each with the frontier it leaves — so a batch can stop after ANY line
   * and record exactly that far (`./unreadBatch.ts`).
   */
  readonly lines: readonly TailLine[];
}

/** What one read of the call files found, for one cursor. */
export interface UnreadRead {
  /** The cursor as it stood, or `undefined` on a home where this reader has never marked. */
  readonly cursor: UnreadCursor | undefined;
  /**
   * With no cursor, the instant before which words are not shown: the first read on a home would otherwise print
   * every call ever made. `undefined` once a cursor exists — from then on every appended line counts.
   */
  readonly bootstrapFloorIso: string | undefined;
  readonly tails: readonly CallTail[];
  /**
   * Every call this read went past because its file is gone and a quarantine row accepts the loss
   * (`./callQuarantineLedger.ts`) — named so a read never goes past one silently.
   */
  readonly quarantined: readonly CallQuarantineRow[];
}

/** One stretch of the owner's speech the reader has not read, as the call last recorded it. */
export interface UnreadWord {
  /** `talk-call:<callId>#<segmentId>` — what an intake mark or a row's anchor names it by. */
  readonly pointer: string;
  readonly callId: string;
  readonly segmentId: string;
  readonly text: string;
  /** When its newest snapshot was taken, on the page's clock. */
  readonly atIso: string;
  /**
   * The latest instant ANY unread snapshot of it carries, whichever is shown — what the first-read floor keeps it by. A
   * final snapshot shown with an old stamp can have a recent revision after it, and judged by the shown one that
   * revision was left out with it, and adopted unprinted.
   */
  readonly latestAtIso: string;
  /** `false` when the call was still in the middle of it at the last snapshot. */
  readonly final: boolean;
  /** Whether its text reached the call store's cap, so words after the cut were never written down. */
  readonly cut: boolean;
  /**
   * Whether it is a stretch the owner was still speaking past a read of it: not final, not cut, its call not ended, and a
   * snapshot of it already behind the cursor — so what is unread is the same turn grown since. `tick-record` judges
   * how recently it grew (`../supervisor/voiceUnreadGate.ts`); nothing here marks it read.
   */
  readonly growingSinceRead: boolean;
  /**
   * The relay line recorded next at or after it AMONG THE UNREAD LINES — evidence, never proof the relay carries it.
   * A relay the cursor already passed is not searched, so none here does not mean the call never relayed it.
   */
  readonly nextRelay: { readonly atIso: string; readonly turnId: string | null; readonly outcome: string } | undefined;
  /**
   * Earlier snapshots of it the transcriber later revised — text `text` does not begin with, printed beside it so a
   * mark never counts one read unseen. Empty in practice: a snapshot is the text so far.
   */
  readonly revisions: readonly string[];
}

/**
 * A call whose unread owner-side speech a console that is NOT the owner's recorded — a branch console's witness run,
 * say — set aside from {@link UnreadSelection.words} and named instead, so it is seen and never taken as the owner's.
 */
export interface ForeignCallWords {
  readonly callId: string;
  readonly origin: CallOrigin;
  /** How many stretches it set aside. */
  readonly stretches: number;
}

/** What a reader has not read, oldest first. */
export interface UnreadSelection {
  /** The owner's words: speech on a call with no origin (every call before origins were stamped) or one the owner's own console served. */
  readonly words: readonly UnreadWord[];
  /** Calls a console that is not the owner's recorded, each named with its origin; a mark passes them as read. */
  readonly foreign: readonly ForeignCallWords[];
  readonly unparseable: readonly UnparseableLine[];
  /**
   * How many stretches the bootstrap floor left out — words a reader with no cursor has not seen. A first mark with
   * any is refused unless it adopts them on purpose (`talk unread --mark --adopt`); `--all` prints them instead.
   */
  readonly beforeFloor: number;
}

/**
 * The pointer one stretch of the owner's speech is named by.
 *
 * @param callId the call it was spoken on
 * @param segmentId the grouper's id for it
 * @returns `talk-call:<callId>#<segmentId>`
 */
export function formatCallPointer({ callId, segmentId }: { callId: string; segmentId: string }): string {
  return `${CALL_POINTER_SCHEME}${callId}#${segmentId}`;
}

/**
 * Read a `talk-call:<callId>#<segmentId>` pointer, or say it is not one.
 *
 * @param text the candidate
 * @returns the pointer in its one written form, or `undefined`
 */
export function parseCallPointer({ text }: { text: string }): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith(CALL_POINTER_SCHEME)) {
    return undefined;
  }
  const body = trimmed.slice(CALL_POINTER_SCHEME.length);
  const hash = body.indexOf("#");
  if (hash === -1) {
    return undefined;
  }
  const callId = body.slice(0, hash).toLowerCase();
  const segmentId = body.slice(hash + 1);
  if (!V4_UUID.test(callId) || !SEGMENT_ID.test(segmentId)) {
    return undefined;
  }
  return formatCallPointer({ callId, segmentId });
}

/**
 * Text with every run of whitespace collapsed to one space and the ends trimmed — how two snapshots are compared.
 *
 * @param text a snapshot's text
 * @returns the compared form
 */
function collapsed({ text }: { text: string }): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** A character that belongs to a word: a letter, a digit, a combining mark, an apostrophe or an underscore. */
const WORD_CHAR = /[\p{L}\p{N}\p{M}'’_]/u;

/** Splits a text into what a reader sees as one character each. */
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * A text's graphemes, in order.
 *
 * @returns each grapheme
 */
function graphemesOf({ text }: { text: string }): readonly string[] {
  return Array.from(GRAPHEMES.segment(text), (part) => part.segment);
}

/**
 * Whether a later text prints an earlier snapshot of the same segment: it continues it, whitespace collapsed, without
 * extending its last word — "do not" is not printed by "do nothing", while "okay" is by
 * "okay, so" and an empty snapshot, holding no word, by anything.
 *
 * @param kept the later text, collapsed
 * @param earlier the earlier snapshot, collapsed
 * @returns whether printing the later text prints the earlier one
 */
function continues({ kept, earlier }: { kept: string; earlier: string }): boolean {
  if (!kept.startsWith(earlier)) {
    return false;
  }
  // By grapheme, never UTF-16 unit: a letter past the BMP is two surrogates, neither a word character alone
  // ("𐐀" then "𐐀𐐁" read as continued). A split inside a grapheme — a lone surrogate the later
  // text pairs up, a letter it adds a mark to — is not a continuation either: the earlier bytes are never printed.
  const earlierGraphemes = graphemesOf({ text: earlier });
  const keptGraphemes = graphemesOf({ text: kept });
  if (keptGraphemes.slice(0, earlierGraphemes.length).join("") !== earlier) {
    return false;
  }
  const last = earlierGraphemes.at(-1);
  const next = keptGraphemes.at(earlierGraphemes.length);
  if (last === undefined || next === undefined) {
    return true;
  }
  return !(WORD_CHAR.test(last) && WORD_CHAR.test(next));
}

/**
 * Whether printing one snapshot's text prints another snapshot of the same segment — the rule a folded word's
 * revisions are judged by, so a stretch read in parts passes exactly the snapshots a whole batch would.
 *
 * @param shown the text printed
 * @param snapshot the other snapshot's text
 * @returns whether `snapshot` is printed by printing `shown`
 */
export function printsSnapshot({ shown, snapshot }: { shown: string; snapshot: string }): boolean {
  return continues({ earlier: collapsed({ text: snapshot }), kept: collapsed({ text: shown }) });
}

/**
 * The earlier snapshots of one segment the shown text does not print — what the transcriber READ and later revised,
 * or a word it heard and then heard longer. A snapshot is the whole text so far, so one the shown text continues is
 * printed by printing it; one it does not ("please delete" read, then "please create") would
 * be marked read unprinted. MEASURED over every call file, read-only — `yarn tsx` over
 * `selectUnreadWords({ read: readUnread({ all: true, home, name }) })`, summing `revisions.length`: 14 of 303 of the
 * owner's segments, 20 revision lines, each a word the next snapshot extended (646 had the break been a space alone).
 *
 * @param shown the text the word is printed with
 * @param snapshots every snapshot text of the segment, in file order
 * @returns each distinct revised snapshot, in file order
 */
function revisionsOf({ shown, snapshots }: { shown: string; snapshots: readonly string[] }): readonly string[] {
  const kept = collapsed({ text: shown });
  return [...new Set(snapshots)].filter((text) => !continues({ earlier: collapsed({ text }), kept }));
}

/**
 * The relay the call recorded next at or after an instant, with its turn's newest outcome.
 *
 * @param relays every relay line in the tail, in file order
 * @param atIso the word's instant
 * @returns the relay, or `undefined` when none was recorded after it
 */
function nextRelayOf({
  relays,
  atIso,
}: {
  relays: readonly Extract<CallEntry, { kind: "relay" }>[];
  atIso: string;
}): UnreadWord["nextRelay"] {
  const next = relays.find((relay) => Date.parse(relay.atIso) >= Date.parse(atIso));
  if (next === undefined) {
    return undefined;
  }
  // A relay writes a line per state (`sending`, then `relayed`); the outcome is its turn's newest line.
  const latest = next.turnId === null ? next : relays.findLast((relay) => relay.turnId === next.turnId)!;
  return { atIso: next.atIso, outcome: latest.outcome, turnId: next.turnId };
}

/**
 * The lines of a tail that parsed, in file order.
 *
 * @param tail one call file past the frontier
 * @returns its call lines
 */
function entriesOf({ tail }: { tail: CallTail }): readonly CallEntry[] {
  return tail.lines.flatMap((line) => (line.kind === "entry" ? [line.entry] : []));
}

/**
 * Fold one call's unread segment lines into the words they say: the newest snapshot of each id wins, and a
 * partial landing after the final never undoes it — the same rule `./callRecord.ts`'s fold keeps. Every other
 * snapshot's text is either a prefix of what is shown or carried as a revision, so none is marked read unprinted.
 *
 * @param tail one call file past the frontier
 * @returns the owner's words on it, in the order each first appeared, each with the origin of the open line it followed
 */
function wordsOfTail({
  tail,
}: {
  tail: CallTail;
}): readonly { readonly word: UnreadWord; readonly origin: CallOrigin | undefined }[] {
  const entries = entriesOf({ tail });
  const relays = entries.filter((entry) => entry.kind === "relay");
  const { byId, ended, latestAt, originOf, snapshots } = foldTail({ entries, tail });
  // A segment of blank text is still shown: a mark counts it read, so it is printed rather than judged empty here.
  return [...byId.values()].map((segment) => {
    const cut = segment.text.length >= CALL_TEXT_CHARS;
    const final = segment.final || tail.finalBefore.includes(segment.id);
    const word: UnreadWord = {
      atIso: segment.atIso,
      callId: tail.callId,
      cut,
      final,
      growingSinceRead: !final && !cut && !ended && tail.seenBefore.includes(segment.id),
      latestAtIso: latestAt.get(segment.id)!,
      nextRelay: nextRelayOf({ atIso: segment.atIso, relays }),
      pointer: formatCallPointer({ callId: tail.callId, segmentId: segment.id }),
      revisions: revisionsOf({ shown: segment.text, snapshots: snapshots.get(segment.id)! }),
      segmentId: segment.id,
      text: segment.text,
    };
    return { origin: originOf.get(segment.id), word };
  });
}

/** What folding one tail's lines leaves: each id's winning snapshot, every text it had, its newest instant, the origin it
 * began under, and whether the call had ended. */
interface TailFold {
  readonly byId: Map<string, Extract<CallEntry, { kind: "segment" }>>;
  readonly snapshots: Map<string, string[]>;
  readonly latestAt: Map<string, string>;
  readonly originOf: Map<string, CallOrigin | undefined>;
  ended: boolean;
}

/**
 * Fold one tail's lines: track the open each line follows and whether the call ended, and note every segment of the owner's.
 *
 * @param entries the tail's lines, in file order
 * @param tail the tail, for what the frontier already saw
 * @returns the fold
 */
function foldTail({ entries, tail }: { entries: readonly CallEntry[]; tail: CallTail }): TailFold {
  // A stretch belongs to the console it began on, before the frontier included: a call id reused by a later open is a
  // new origin for new stretches only.
  const fold: TailFold = {
    byId: new Map(),
    ended: tail.endedBefore,
    latestAt: new Map(),
    originOf: new Map<string, CallOrigin | undefined>(tail.seenOriginBefore),
    snapshots: new Map(),
  };
  let origin = tail.originBefore;
  for (const entry of entries) {
    if (entry.kind === "open" || entry.kind === "closed") {
      fold.ended = entry.kind === "closed";
    }
    if (entry.kind === "open") {
      origin = originAfterOpen({ opened: entry.origin, previous: origin });
    }
    if (entry.kind === "segment" && entry.who === "owner") {
      noteSegment({ entry, fold, origin });
    }
  }
  // Once any open of the call carries the test instance's mark, every segment of the tail is read under it, speech
  // begun before the marked open included (`./callOrigin.ts`'s `markedOrigin`).
  const marked = markedOrigin({ before: tail.originBefore, entries });
  if (marked !== undefined) {
    for (const id of fold.byId.keys()) {
      fold.originOf.set(id, marked);
    }
  }
  return fold;
}

/**
 * Note one segment snapshot of the owner's: the origin its id began under, its text, its newest instant, and whether it is now
 * the snapshot shown.
 *
 * @param entry the snapshot
 * @param fold what the tail has folded so far
 * @param origin the origin of the open line it follows
 */
function noteSegment({
  entry,
  fold,
  origin,
}: {
  entry: Extract<CallEntry, { kind: "segment" }>;
  fold: TailFold;
  origin: CallOrigin | undefined;
}): void {
  if (!fold.originOf.has(entry.id)) {
    fold.originOf.set(entry.id, origin);
  }
  const texts = fold.snapshots.get(entry.id);
  if (texts === undefined) {
    fold.snapshots.set(entry.id, [entry.text]);
  } else {
    texts.push(entry.text);
  }
  const latest = fold.latestAt.get(entry.id);
  if (latest === undefined || Date.parse(entry.atIso) > Date.parse(latest)) {
    fold.latestAt.set(entry.id, entry.atIso);
  }
  const held = fold.byId.get(entry.id);
  if (held === undefined || takesOver({ entry, held })) {
    fold.byId.set(entry.id, entry);
  }
}

/**
 * The calls a console that is not the owner's recorded, one row per call and origin, each counting the stretches set aside.
 *
 * @param spoken every unread stretch of owner-side speech, with the origin it followed
 * @returns one row per call and origin, in the order each first appeared
 */
function foreignCalls({
  spoken,
}: {
  spoken: readonly { readonly word: UnreadWord; readonly origin: CallOrigin | undefined }[];
}): readonly ForeignCallWords[] {
  const rows = new Map<string, { callId: string; origin: CallOrigin; stretches: number }>();
  for (const { word, origin } of spoken) {
    if (origin === undefined || isOwnerConsoleOrigin({ origin })) {
      continue;
    }
    const key = `${word.callId}\n${originKey({ origin })}`;
    const row = rows.get(key);
    if (row === undefined) {
      rows.set(key, { callId: word.callId, origin, stretches: 1 });
    } else {
      row.stretches += 1;
    }
  }
  return [...rows.values()];
}

/**
 * Every word of the owner's past the reader's frontier, across every call, oldest first — and every line past it that did
 * not parse. With no cursor yet, words older than the bootstrap floor are left out and COUNTED, never dropped unsaid.
 * Speech a console that is not the owner's recorded is never among the owner's words: it is named per call in
 * `foreign`, whatever its age, so a leak is seen rather than either relayed as the owner's or dropped unsaid.
 *
 * @param read what the files held past the frontier
 * @returns the unread words and lines
 */
export function selectUnreadWords({ read }: { read: UnreadRead }): UnreadSelection {
  const floor = read.bootstrapFloorIso;
  const spoken = read.tails.flatMap((tail) => wordsOfTail({ tail }));
  const ownerWords = spoken.filter(({ origin }) => isOwnerCallOrigin({ origin })).map(({ word }) => word);
  const words = ownerWords
    .filter((word) => floor === undefined || Date.parse(word.latestAtIso) >= Date.parse(floor))
    .toSorted((a, b) => Date.parse(a.atIso) - Date.parse(b.atIso));
  return {
    beforeFloor: ownerWords.length - words.length,
    foreign: foreignCalls({ spoken }),
    unparseable: read.tails.flatMap((tail) =>
      tail.lines.flatMap((line) => (line.kind === "unparseable" ? [line.line] : [])),
    ),
    words,
  };
}

/**
 * The cursor a mark writes: every file's frontier as this read left it, and every call it did not see kept as it
 * was — a file deleted since is not a reason to forget where the reader was in it.
 *
 * @param read the read the mark printed
 * @param recordedAtIso when the mark is written
 * @returns the cursor to store
 */
export function advancedCursor({ read, recordedAtIso }: { read: UnreadRead; recordedAtIso: string }): UnreadCursor {
  const calls: Record<string, CallFrontier> = { ...read.cursor?.calls };
  for (const tail of read.tails) {
    const last = tail.lines.at(-1);
    if (last !== undefined) {
      calls[tail.callId] = last.after;
    }
  }
  return { calls, recordedAtIso };
}

/**
 * Whether a newer snapshot of a segment takes over from the one held: always, unless the held one is final and the
 * newer is not — a partial landing after the final never undoes it, the rule `./callRecord.ts`'s fold keeps.
 *
 * @param entry the snapshot just read
 * @param held the snapshot the fold shows so far
 * @returns whether `entry` is shown from now on
 */
function takesOver({
  entry,
  held,
}: {
  entry: Extract<CallEntry, { kind: "segment" }>;
  held: Extract<CallEntry, { kind: "segment" }>;
}): boolean {
  return !held.final || entry.final;
}
