/**
 * A quiet stretch of the owner's wakes the pinned chair ONCE, two minutes after their last word — the pure half of
 * `slopweaver talk wake-chair` and of the chair's courier (`../cli/commands/talk/courierRun.ts`).
 *
 * ## Two quiet minutes, then one turn
 *
 * The chair needs an interval of at least a couple of minutes before it acts, so the owner can make mid-steer
 * corrections, which happen a lot, and can afford those couple of minutes; what they cannot afford is huge fleet
 * degradations. A wake per finished stretch let the chair act on a steer before the correction the owner spoke a
 * minute later. So nothing is typed while the owner's last word — the newest snapshot of any unread stretch of theirs
 * on any call, final or still growing, and the newest relay the voice registered and holds
 * (`./relayCourierHandoff.ts`) — is younger than {@link QUIET_BEFORE_DELIVERY_MS}; then ONE line names every unread
 * stretch and every held relay, in the order the owner said them (`./chairBatchLine.ts`). A call that closed does not
 * shorten the wait: closing is the transport, not silence.
 *
 * The supervisor reads what the owner says live whether or not the voice relays it, so all of the owner's words must
 * reach the supervisor, and efficiently. The chair already reads every stretch off the call files (`talk unread`,
 * `./unreadWords.ts`), and `tick-record` refuses a pass that has not; what was missing was a WAKE. A relay typed into
 * its chat was the only thing that interrupted a chair asleep between passes, so a stretch the voice never relayed
 * waited for the next scheduled one.
 *
 * ## The line carries a pointer, never the owner's words
 *
 * The chair reads the call file, not a reading of it. So the wake is one fixed sentence naming each stretch and relay
 * by its anchor and the verbs that print the owner's words (`./chairBatchLine.ts`); nothing of what they said is on it,
 * so there is nothing on it to act on but the read, and a forged one costs a chair one `talk unread`.
 * The line before the batch ({@link chairWakeLine}) is still read back, so an older transcript keeps its witness.
 *
 * ## One unread batch costs one wake, judged by BYTES
 *
 * A wake names how far into each call file the words it is for reach — the frontier `talk unread --mark`
 * would leave there (`./unreadWords.ts`'s `advancedCursor`). It stays PENDING while the chair's `supervisor` cursor
 * is short of any of those frontiers, it was typed or queued (or the screen could not say), and it is younger than
 * {@link REWAKE_AFTER_MS}; a stretch spoken then is coalesced into it, because the chair will read past it anyway. A
 * held relay is never coalesced: it is the owner's words the chair has not been shown, so it goes on the next line, and that
 * line names every unread stretch beside it. Bytes, never instants: the cursor's own `recordedAtIso` says when a mark
 * was written, not how far it read.
 *
 * The race, named and closed elsewhere: the chair reads batch A, stretch B is spoken and coalesced, the chair marks
 * only through A. That wake is now spent and B woke nobody — but B is unread, so `tick-record` refuses the
 * chair's pass until it reads B (`../supervisor/voiceUnreadGate.ts`), and the chair's procedure reads once more after
 * every mark (`skills/supervisor/reference/voice-unread.md`). A wake that was skipped, failed or left stranded never
 * holds the next one back; one past the ceiling is sent again. Nor does one left `attempting` by a process no longer
 * running — killed by the route's timeout before it typed — so the next finished stretch wakes the chair at once.
 * The courier asks again every few seconds, so a wake that died is decided again on its next pass; with no courier
 * running, the stretch waits for the chair's next scheduled pass, where `tick-record` refuses until it is read.
 *
 * Pure: the read, the store and the typing are `./chairWakeShell.ts`'s.
 */
import { type BatchAnchor, chairBatch, chairBatchMembers } from "./chairBatchLine.js";
import type { DeliveryKind } from "./deliveryOutcome.js";
import type { HeardEdges } from "./relayHeardCut.js";
import type { LeaseHolder } from "./relayLease.js";
import { unwrapPaste } from "./relayLine.js";
import type { UnreadCursor, UnreadRead, UnreadWord } from "./unreadWords.js";

/**
 * How long the owner must have said nothing — on any call, and through the voice — before the chair is typed a turn.
 * The floor is two minutes (at least a couple of minutes): never lower it; a test holds it to exactly that.
 */
export const QUIET_BEFORE_DELIVERY_MS = 2 * 60_000;

/**
 * How long a delivered wake holds the next one back while the chair has not read past it. Long enough that a chair
 * mid-pass is not woken twice for one batch; short enough that a wake typed into a chair that then lost it — a
 * session handed off, a paste swallowed — is sent again within the call it was for.
 */
export const REWAKE_AFTER_MS = 10 * 60_000;

/** A call id as the call store names a file: a v4 UUID. */
const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** The head the wake opens with, and the call id inside it. */
const WAKE_HEAD = /^\[voice call ([0-9a-f-]{36})\] /u;

/** What a wake's line became: every delivery kind but `held`, which only a relay waiting for a batch carries. */
export type ChairWakeDeliveryKind = Exclude<DeliveryKind, "held">;

/** What became of a wake that holds the next one back: it reached the chair, or the screen could not say it did not. */
const HOLDING: ReadonlySet<ChairWakeDeliveryKind> = new Set<ChairWakeDeliveryKind>([
  "typed",
  "queued",
  "unconfirmed",
  "attempting",
]);

/** One wake as the store keeps it: what it was for, and what became of it. */
export interface ChairWakeRecord {
  /** When the wake was decided — the clock {@link REWAKE_AFTER_MS} runs from. */
  readonly atIso: string;
  /** The call the newest stretch was spoken on, or `undefined` for a batch of held relays alone. */
  readonly callId: string | undefined;
  /** Per call file, the byte frontier the chair's cursor must reach for this wake to be spent. */
  readonly notified: Readonly<Record<string, number>>;
  /**
   * The held relays its line named, by turn id — while it is `attempting` and its typist runs, no other batch carries
   * them. Empty for a wake of stretches alone, and for one written before the quiet batch.
   */
  readonly relayTurnIds: readonly string[];
  readonly delivery: ChairWakeDeliveryKind;
  /** One plain sentence: where it went, or why it did not. */
  readonly detail: string;
  /** The process typing it while it is `attempting`; `undefined` once its outcome is recorded. */
  readonly holder: LeaseHolder | undefined;
}

/** A relay the voice registered and the courier holds for the chair's next batch (`./relayCourierHandoff.ts`). */
export interface HeldRelay {
  readonly turnId: string;
  /** Its board row's slug, the anchor the batch line names it by. */
  readonly slug: string;
  /**
   * When it was held — the owner's words reached the voice just before, so it counts as their last word. Always a parseable
   * instant: `heldRelays` (`./relayCourier.ts`) drops, and reports, a turn whose instant is not one.
   */
  readonly heldAtIso: string;
  /**
   * Every word the owner said or typed on its turn (the turn record's `heard`), or empty on a record written before the
   * owner's words were carried — and on an older record marked `heardTruncated`, only their tail. `talk unread` quotes
   * them beside the slug (`./quietBatches.ts`); the typed batch line never does (`./chairBatchLine.ts`).
   */
  readonly heard: string;
  /**
   * Whether the turn record kept each end of {@link heard} (`./relayHeardCut.ts`): a quote of a record that lost its
   * start or end, or never said, is marked so, never printed as the whole steer.
   */
  readonly heardEdges: HeardEdges;
}

/** Whether the process an `attempting` wake names is provably still the one typing it, provably gone, or untellable. */
export type HolderState = "running" | "gone" | "unknown";

/** How a holder is judged: the shell reads the process table. */
export type HolderStateOf = (options: { holder: LeaseHolder }) => HolderState;

/** One thing the owner said, placed in the order they said it. */
type Placed =
  | { readonly kind: "stretch"; readonly atIso: string; readonly word: UnreadWord }
  | { readonly kind: "relay"; readonly atIso: string; readonly relay: HeldRelay };

/** What to do about the chair now. */
export type ChairWakeDecision =
  | { readonly kind: "nothing-unread" }
  | {
      readonly kind: "holding";
      /** The owner's last word: the newest instant among the unread stretches and the held relays. */
      readonly lastWordIso: string;
      /** When the quiet interval ends and the batch is typed. */
      readonly untilIso: string;
    }
  | { readonly kind: "coalesced"; readonly pending: ChairWakeRecord }
  | {
      readonly kind: "wake";
      readonly callId: string | undefined;
      readonly notified: Readonly<Record<string, number>>;
      /** Every unread stretch and every relay the batch carries, in the order the owner said them. */
      readonly anchors: readonly BatchAnchor[];
      /**
       * The held relays the batch carries, in order — only those its line names; one the bound left off stays held for
       * the next batch.
       */
      readonly relays: readonly HeldRelay[];
      readonly line: string;
    };

/**
 * The one line a wake was typed as before the quiet batch — still read back, so a transcript from before
 * keeps its witness.
 *
 * @param callId the call the newest finished stretch was spoken on
 * @returns the line
 */
export function chairWakeLine({ callId }: { callId: string }): string {
  return (
    `[voice call ${callId}] the owner finished a stretch on a console call — read it with slopweaver talk unread, ` +
    "rule it and mark it; this line carries none of the owner's words."
  );
}

/**
 * The call a chair turn's wake line names, when the turn is exactly a wake — bare or inside a paste wrapper, and
 * nothing before or after it. A turn that opens like one and goes on in anyone's words is not one.
 *
 * @param text the turn's text
 * @returns the call id, or `undefined` when the turn is not a wake line
 */
export function chairWakeCallId({ text }: { text: string }): string | undefined {
  const opened = unwrapPaste({ text })
    .replace(/<\/pasted_content>\s*$/u, "")
    .trimEnd();
  const callId = WAKE_HEAD.exec(opened)?.[1];
  if (callId === undefined || !CALL_ID.test(callId) || opened !== chairWakeLine({ callId })) {
    return undefined;
  }
  return callId;
}

/**
 * Whether a chair turn is exactly a line the console typed to point the chair at the owner's words — a quiet batch
 * (`./chairBatchLine.ts`) or the wake line before it — and so carries none of them.
 *
 * @param text the turn's text
 * @returns true for either line, bare or inside a paste wrapper
 */
export function isChairPointerLine({ text }: { text: string }): boolean {
  return chairBatchMembers({ text }) !== undefined || chairWakeCallId({ text }) !== undefined;
}

/**
 * Where the chair's cursor stands in one call file: its frontier, or the file's start for a call it has never read.
 *
 * @param cursor the `supervisor` cursor, `undefined` before its first mark
 * @param callId the call file
 * @returns the byte offset
 */
function cursorOffset({ cursor, callId }: { cursor: UnreadCursor | undefined; callId: string }): number {
  const frontier = cursor?.calls[callId];
  if (frontier === undefined) {
    return 0;
  }
  return frontier.offset;
}

/**
 * Whether the last wake still holds the next one back.
 *
 * @param last the last wake the store holds
 * @param cursor the chair's cursor now
 * @param nowIso the instant judged at
 * @param holderState whether the process an `attempting` wake names is PROVABLY still the one typing it, provably
 *   gone, or unknown because a start stamp, then or now, could not be read
 * @returns whether it is pending
 */
function wakePending({
  last,
  cursor,
  nowIso,
  holderState,
}: {
  last: ChairWakeRecord;
  cursor: UnreadCursor | undefined;
  nowIso: string;
  holderState: HolderStateOf;
}): boolean {
  if (!HOLDING.has(last.delivery)) {
    return false;
  }
  // Only a writer provably still running holds: one wake too many is the cheaper mistake.
  const holder = last.holder;
  const typing = holder !== undefined && holderState({ holder }) === "running";
  if (last.delivery === "attempting" && !typing) {
    return false;
  }
  if (Date.parse(nowIso) - Date.parse(last.atIso) >= REWAKE_AFTER_MS) {
    return false;
  }
  return Object.entries(last.notified).some(([callId, offset]) => cursorOffset({ callId, cursor }) < offset);
}

/**
 * Everything unread and held, in the order the owner said it: a stretch at its newest snapshot, a relay when it was held. The
 * sort is stable, so a stretch and the relay of it at one instant keep the stretch first.
 *
 * @param words the owner's unread stretches, oldest first
 * @param relays the held relays
 * @returns both, merged by instant
 */
function inOrder({ words, relays }: { words: readonly UnreadWord[]; relays: readonly HeldRelay[] }): readonly Placed[] {
  const placed: Placed[] = [
    ...words.map((word): Placed => ({ atIso: word.atIso, kind: "stretch", word })),
    ...relays.map((relay): Placed => ({ atIso: relay.heldAtIso, kind: "relay", relay })),
  ];
  return placed.toSorted((a, b) => Date.parse(a.atIso) - Date.parse(b.atIso));
}

/**
 * The owner's last word: the newest instant any unread stretch was snapshotted at, or any held relay held at. Read to
 * the millisecond, the precision every writer stamps (`toISOString`); a hand-written instant finer than that is cut to
 * it, so the floor can read up to a millisecond short there (judged residue).
 *
 * @param words the owner's unread stretches
 * @param relays the held relays
 * @returns the instant in milliseconds, or `undefined` when there is neither
 */
function lastWordMs({
  words,
  relays,
}: {
  words: readonly UnreadWord[];
  relays: readonly HeldRelay[];
}): number | undefined {
  const instants = [
    ...words.map((word) => Date.parse(word.latestAtIso)),
    ...relays.map((relay) => Date.parse(relay.heldAtIso)),
  ];
  if (instants.length === 0) {
    return undefined;
  }
  return Math.max(...instants);
}

/**
 * Whether the last wake may be a line still being typed: then the relays it names are its, never another batch's, and
 * no batch is staged over its record while one of them is still held. The
 * opposite bias to {@link wakePending}'s — a relay named in two lines is the costlier mistake here, so a typist is
 * reserved unless provably gone (`ps` failing at the wrong moment let a second pass name the same relay),
 * and only for {@link REWAKE_AFTER_MS}, past which a held relay is free again. A typist provably alive but stopped
 * between its paste and its settle for that long — suspended, or wedged — loses its relays to the next batch, which
 * names them again: bounded on purpose, since reserving for a live typist without limit would let one wedged
 * process hold a relay the owner said forever (judged residue).
 */
function mayStillBeTyping({
  last,
  nowIso,
  holderState,
}: {
  last: ChairWakeRecord | undefined;
  nowIso: string;
  holderState: HolderStateOf;
}): boolean {
  const holder = last?.holder;
  if (last?.delivery !== "attempting" || holder === undefined) {
    return false;
  }
  if (Date.parse(nowIso) - Date.parse(last.atIso) >= REWAKE_AFTER_MS) {
    return false;
  }
  return holderState({ holder }) !== "gone";
}

/**
 * The last wake a batch due now coalesces into, or `undefined` when one is to be staged. The last wake's record is the
 * one reservation of the relays it names, so while its typist may still be typing one still held, nothing new is
 * staged over it — a wake staged now would erase that record, and the pass after would read the relay as free and name
 * it again; what arrived meanwhile rides the batch after it settles. With no relay held, a wake still
 * pending that already points at every unread stretch is the one.
 */
function pendingInto({
  read,
  relays,
  last,
  nowIso,
  holderState,
}: {
  read: UnreadRead;
  relays: readonly HeldRelay[];
  last: ChairWakeRecord | undefined;
  nowIso: string;
  holderState: HolderStateOf;
}): ChairWakeRecord | undefined {
  if (last === undefined) {
    return undefined;
  }
  if (mayStillBeTyping({ holderState, last, nowIso })) {
    const inFlight = new Set(last.relayTurnIds);
    if (relays.some((relay) => inFlight.has(relay.turnId))) {
      return last;
    }
  }
  if (relays.length === 0 && wakePending({ cursor: read.cursor, holderState, last, nowIso })) {
    return last;
  }
  return undefined;
}

/**
 * Decide what to type into the chair: nothing while the owner has said anything in the last {@link QUIET_BEFORE_DELIVERY_MS};
 * then one batch naming every unread stretch and every held relay — unless all it would carry is stretches a wake
 * still pending already points at. While a line that may still be being typed names a relay still held, nothing new is
 * staged: that line's record is the relay's one reservation, and is never overwritten.
 *
 * @param read what the call files held past the chair's cursor
 * @param words the unread words selected from it (`selectUnreadWords`), the first-read floor applied — final or still
 *   growing: a stretch whose snapshots stopped two minutes ago is said, whether or not the transcriber closed it
 * @param relays the relays held for the chair, oldest first
 * @param last the last wake the store holds, or `undefined` for none — or for a store that could not be read, which
 *   must never hold a wake back
 * @param nowIso the instant judged at
 * @param holderState whether the process an `attempting` wake names is still the one typing it, gone, or unknown
 * @returns nothing to do, holding for quiet, coalesced into a pending wake, or the batch to type
 */
export function decideChairWake({
  read,
  words,
  relays,
  last,
  nowIso,
  holderState,
}: {
  read: UnreadRead;
  words: readonly UnreadWord[];
  relays: readonly HeldRelay[];
  last: ChairWakeRecord | undefined;
  nowIso: string;
  holderState: HolderStateOf;
}): ChairWakeDecision {
  // Every relay held counts toward the owner's quiet, a line's own included: the floor is about them, not about who types.
  const lastMs = lastWordMs({ relays, words });
  if (lastMs === undefined) {
    return { kind: "nothing-unread" };
  }
  if (Date.parse(nowIso) - lastMs < QUIET_BEFORE_DELIVERY_MS) {
    return {
      kind: "holding",
      lastWordIso: new Date(lastMs).toISOString(),
      untilIso: new Date(lastMs + QUIET_BEFORE_DELIVERY_MS).toISOString(),
    };
  }
  const pending = pendingInto({ holderState, last, nowIso, read, relays });
  if (pending !== undefined) {
    return { kind: "coalesced", pending };
  }
  const { anchors, carried, line } = namedBatch({ relays, words });
  return {
    anchors,
    callId: words.at(-1)?.callId,
    kind: "wake",
    line,
    notified: notifiedOffsets({ read, words }),
    relays: carried,
  };
}

/** How far each call file the batch's words came from had been read when it was decided, keyed by call. */
function notifiedOffsets({ read, words }: { read: UnreadRead; words: readonly UnreadWord[] }): Record<string, number> {
  const calls = new Set(words.map((word) => word.callId));
  const notified: Record<string, number> = {};
  for (const tail of read.tails) {
    const end = tail.lines.at(-1);
    if (calls.has(tail.callId) && end !== undefined) {
      notified[tail.callId] = end.after.offset;
    }
  }
  return notified;
}

/** Every stretch and the given relays, in the order the owner said them, as the anchors a batch line lists. */
function anchorsOf({ relays, words }: { relays: readonly HeldRelay[]; words: readonly UnreadWord[] }): BatchAnchor[] {
  return inOrder({ relays, words }).map((item): BatchAnchor => {
    if (item.kind === "stretch") {
      return { kind: "stretch", pointer: item.word.pointer };
    }
    return { kind: "relay", slug: item.relay.slug };
  });
}

/**
 * The batch line and the relays it carries. A batch carries only the relays its line names: one counted `+N more` was
 * never in the chat by name, so it stays held and rides the next batch rather than being settled unseen.
 * Each pass drops at least one relay, so the loop ends.
 */
function namedBatch({ relays, words }: { relays: readonly HeldRelay[]; words: readonly UnreadWord[] }): {
  anchors: BatchAnchor[];
  carried: readonly HeldRelay[];
  line: string;
} {
  let carried = relays;
  let anchors = anchorsOf({ relays: carried, words });
  let batch = chairBatch({ anchors });
  for (;;) {
    const named = new Set(batch.listed.flatMap((anchor) => (anchor.kind === "relay" ? [anchor.slug] : [])));
    const listed = carried.filter((relay) => named.has(relay.slug));
    if (listed.length === carried.length) {
      return { anchors, carried, line: batch.line };
    }
    carried = listed;
    anchors = anchorsOf({ relays: carried, words });
    batch = chairBatch({ anchors });
  }
}
