/**
 * One console-voice call as it was written down while it ran — the pure half of `./callStore.ts`.
 *
 * A call dropped and the steers the owner had given it were lost. The transcript lived only in
 * the page (`site/components/voice/VoiceProvider.tsx`), so a dropped connection or a reload took it with it, and
 * continuity (`./continuity.ts`) read relays alone, so a call that never relayed left nothing at all. So the page
 * appends every line to a per-call file as it lands, and this module is what one line may say and how a file of
 * them folds back into a call.
 *
 * ## Why a segment may appear more than once
 *
 * The SDK's `TranscriptGrouper` reports a stretch of speech many times as it grows and once more when it closes. The
 * page writes the closed one, and — so a call that drops mid-sentence still keeps the sentence — a snapshot of the
 * open one every few seconds. So a segment's id can repeat, each line carrying the whole text so far; the LAST line
 * for an id wins, and the segments stand in the order they BEGAN — the earliest instant any line of each carries or
 * names as its `beganIso`, then the position the id first appeared. Never file order alone: a `keepalive` post as the page goes can land
 * ahead of a batch still in flight, so a later stretch's line can sit above an earlier one's.
 *
 * Pure: no filesystem, no clock.
 */
import { z } from "zod";

import { CALL_OFFER_FIELDS, type CallOffer, foldOffer } from "./callOffer.js";
import { openedAfter, openedBeforeAny } from "./callOpened.js";
import { type CallOrigin, callOriginSchema } from "./callOrigin.js";
import { type CallReconnect, foldReconnect, reconnectEventSchema } from "./callReconnectRecord.js";
import { foldSegment, notEarlier } from "./callSegmentFold.js";
import { CALL_DETAIL_CHARS, CALL_TOOL_FIELDS, type CallToolNote, foldTool } from "./callToolLine.js";
import { CALL_USAGE_FIELDS, type CallUsage, foldUsage } from "./callUsage.js";
import { ALSO_ANSWERS_MAX, CARD_KEY } from "./cardKey.js";
import { CARD_MOVE_FIELDS } from "./cardMoveLine.js";
import { clip } from "./packText.js";
import { TALK_SURFACES, type TalkSurface } from "./talkSurface.js";

/**
 * The most characters one segment's text may carry. A monologue past this is cut, never refused, and `talk unread`
 * says so. 16,000 because the 4,000 it replaced cut one of the owner's steers mid-sentence — `jq -r
 * 'select(.kind=="segment" and (.text|length)>=4000) | .id' ~/.slopweaver/talk/calls/*.jsonl | sort -u` names it —
 * and at three UTF-8 bytes a unit that is 48 KB, so one line still fits the page's 64 KiB keepalive body alone.
 */
export const CALL_TEXT_CHARS = 16_000;

/** The most lines one append may carry — the page flushes far fewer; a batch past this is refused whole. */
export const CALL_BATCH_MAX = 200;

/** The most code points one segment id may carry. */
export const SEGMENT_ID_MAX_CHARS = 200;

/**
 * A segment id as the grouper mints it (`segment_0_163`) or the typed box does (`typed-owner-<id>`): no whitespace,
 * never the `#` a `talk-call:<callId>#<segmentId>` pointer separates on (`./unreadWords.ts`). The ONE grammar the
 * record admits and the pointer reads, so every stretch a call file holds can be named and read back; a line whose id
 * a pointer could not carry is refused here rather than turning up later as a chair batch line nobody can read.
 */
export const SEGMENT_ID = new RegExp(`^[^\\s#]{1,${String(SEGMENT_ID_MAX_CHARS)}}$`, "u");

/**
 * The `who` a call file stores for the owner's own speech. `site/lib/chatThread.ts` restates it for the console,
 * held equal by `site/__tests__/unit/ownerVocabularyMirror.test.ts`.
 */
export const OWNER_SPEAKER = "owner" as const;

const iso = z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "not an ISO instant" });
const text = ({ max }: { max: number }) => z.string().transform((value) => value.slice(0, max));

/** A lowercase v4 UUID — a call id, and a line's write id. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * The id the page mints for one line before it is first posted, and keeps on every retry of it — what lets
 * `./callStore.ts` append a line once however often a batch that got no answer is posted again. A v4 UUID. Absent
 * on a line written before the page minted one, and on a batch a caller hands the verb by hand.
 */
const writeId = z.string().regex(UUID_V4).optional();

/**
 * Every line a call file may hold. `closed.why` is `null` when the owner hung up, else what ended the call. `usage` is the
 * delegated plan thread's tokens after one turn (`callUsage.ts`). `reconnect` is a step of the console re-opening a
 * call that dropped, written onto the DROPPED call after its `closed` line — so `closed` need not be a file's last
 * line, and a reconnect line is never evidence the call itself was still running ({@link callActivity}).
 */
const callEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    atIso: iso,
    kind: z.literal("open"),
    model: text({ max: 200 }),
    // Which console served the call, stamped by the server (`./callOrigin.ts`). Absent on every open line written
    // before the stamp existed, each trusted as the owner's; a present one that fails the shape fails the LINE, never reads absent.
    origin: callOriginSchema.optional(),
    sessionId: text({ max: 200 }),
    // Absent on every open line written before the typed box existed, each of which was a voice call.
    surface: z.enum(TALK_SURFACES).optional(),
    voice: text({ max: 100 }),
    writeId,
  }),
  z.object({
    atIso: iso,
    // When the stretch began, as the page first stamped it: every line of it carries that instant, so it survives a
    // refused first batch. Absent on every line written before; one that fails the shape is dropped.
    beganIso: iso.optional().catch(undefined),
    final: z.boolean(),
    id: z.string().regex(SEGMENT_ID),
    kind: z.literal("segment"),
    // The card open when the speech began. A key that fails the shape is dropped, never the line: the owner's words stay.
    open: z.string().regex(CARD_KEY).optional().catch(undefined),
    // `voice` when the voice's `open_card` put that card in front of the owner, so `talk transcript` lands nothing said
    // over it (`./cardUtterance.ts` `transcriptCardUtterances`). Any other value is dropped, never the line.
    openBy: z.literal("voice").optional().catch(undefined),
    // When the store appended the line, stamped by `appendCallEntries` and never by the page: beside the page's own
    // `atIso` it says how long the line spent between the page and the file (`./callLag.ts`). Absent on a line written before the store stamped it.
    storedIso: iso.optional().catch(undefined),
    text: text({ max: CALL_TEXT_CHARS }),
    who: z.enum([OWNER_SPEAKER, "voice"]),
    writeId,
  }),
  // A tool the voice ran, and what the model was handed, secrets masked (`./callToolLine.ts`).
  z.object({ atIso: iso, ...CALL_TOOL_FIELDS, writeId }),
  z.object({
    about: text({ max: 300 }),
    // `true` when the voice judged the owner's words answer the card `about` names (`relay_steer`'s `answers_open_card`), and
    // the only thing that lets `talk transcript` land them on it (`./cardUtterance.ts`). Absent on a line written
    // before the field existed, when `about` was merely the card open as the owner began, so it is never read as that judgement.
    answersCard: z.boolean().exactOptional(),
    // The other Queue cards the voice judged the owner's words answer (`relay_steer`'s `also_answers`), which `talk relay`
    // lands itself, so `talk transcript` lands nothing on them a second way. A malformed list makes this one line
    // unreadable, as a malformed `answersCard` does, rather than dropping the field and landing those cards twice.
    alsoAnswers: z.array(z.string().regex(CARD_KEY)).max(ALSO_ANSWERS_MAX).exactOptional(),
    atIso: iso,
    detail: text({ max: CALL_DETAIL_CHARS }),
    heard: text({ max: CALL_TEXT_CHARS }),
    kind: z.literal("relay"),
    outcome: text({ max: 40 }),
    say: text({ max: CALL_TEXT_CHARS }),
    turnId: z.string().max(200).nullable(),
    writeId,
  }),
  // A message the thinking model completed, which the voice then speaks: absent on a file written when only what the
  // voice SAID was kept, so "where did fourteen come from" could not tell its words from the voice's.
  z.object({
    atIso: iso,
    itemId: z.string().min(1).max(200),
    kind: z.literal("wrote"),
    text: text({ max: CALL_TEXT_CHARS }),
    turnId: z.string().min(1).max(200),
    writeId,
  }),
  // A message the voice offered the owner during the call, whole (`./callOffer.ts`): absent on a file written when the
  // page alone kept it and the file said only "copy offered". One past the list's bound fails the line, never cut.
  z.object({ atIso: iso, ...CALL_OFFER_FIELDS, writeId }),
  z.object({ atIso: iso, ...CALL_USAGE_FIELDS, writeId }),
  z.object({ atIso: iso, kind: z.literal("closed"), why: text({ max: CALL_DETAIL_CHARS }).nullable(), writeId }),
  z.object({ atIso: iso, event: reconnectEventSchema, kind: z.literal("reconnect"), writeId }),
  // The walk moved from one Queue card to the next (`./cardMoveLine.ts`); `./cardMove.ts` folds it, never the call.
  z.object({ atIso: iso, ...CARD_MOVE_FIELDS, writeId }),
]);

/** One line of a call file. */
export type CallEntry = z.infer<typeof callEntrySchema>;

/**
 * The lines that are the call itself running — every line but a reconnect step. A step is written onto the dropped
 * call AFTER it ended, often after the next call opened, so counting it would make an ended call look active later
 * than it was: in when it was last heard, and in whether a later call opened after its last line.
 *
 * @param entries the call's lines
 * @returns the lines of the call's own activity, in the same order
 */
export function callActivity({ entries }: { entries: readonly CallEntry[] }): readonly CallEntry[] {
  return entries.filter((entry) => entry.kind !== "reconnect");
}

/** One stretch of speech, as the call last recorded it. */
export interface CallSegment {
  readonly id: string;
  readonly who: typeof OWNER_SPEAKER | "voice";
  readonly text: string;
  /** When its last recorded snapshot was taken. */
  readonly atIso: string;
  /** When it began: the earliest instant any of its lines carries or names, which orders it against every other. */
  readonly beganIso: string;
  /** Whether the grouper closed it; `false` is a snapshot of speech the call dropped in the middle of. */
  readonly final: boolean;
  /** The console card open when it began, or `undefined` — none was, or the call predates the page recording it. */
  readonly open: string | undefined;
}

/**
 * A message the thinking model completed on the call, which the voice was handed to speak.
 *
 * @internal The element type of `CallRecord.written`; a reader names it through the record.
 */
export interface CallWritten {
  readonly atIso: string;
  /** The Codex turn that wrote it. */
  readonly turnId: string;
  readonly itemId: string;
  readonly text: string;
}

/** A tool line or a relay, as the call recorded it. */
type CallNote =
  | CallToolNote
  | {
      readonly kind: "relay";
      readonly atIso: string;
      readonly turnId: string | null;
      readonly outcome: string;
      readonly heard: string;
      readonly say: string;
      readonly about: string;
      readonly detail: string;
    };

/** One call, folded from its file. */
export interface CallRecord {
  readonly callId: string;
  /** The first line's instant. */
  readonly openedIso: string;
  /** The newest line's instant: when the call was last heard from. */
  readonly lastIso: string;
  readonly sessionId: string | undefined;
  readonly voice: string | undefined;
  /** A voice call, or a conversation typed into the messenger: the owner's segments of a typed one are what the owner typed. */
  readonly surface: TalkSurface;
  /** Which console served it, or `undefined` when its open line predates the stamp (`./callOrigin.ts`). */
  readonly origin: CallOrigin | undefined;
  /** How it ended, or `undefined` when no end was ever written — it dropped, or the page went away. */
  readonly ended: { readonly atIso: string; readonly why: string | null } | undefined;
  readonly segments: readonly CallSegment[];
  /** What the thinking model wrote for the voice to speak, once per message; empty on a call file written before it was kept. */
  readonly written: readonly CallWritten[];
  /**
   * Every message the voice offered the owner this call, once each, in the order they landed; empty on a call file
   * written before offers were kept. The call's own audit and the relay's evidence: the running list
   * (`./runningList.ts`) is where the owner reads them.
   */
  readonly offers: readonly CallOffer[];
  readonly notes: readonly CallNote[];
  /** The plan thread's tokens per turn, one per turn in the order the turns first reported; empty on a call file written before usage was kept. */
  readonly usages: readonly CallUsage[];
  /** The console's attempts to re-open this call after it dropped, in the order they happened; empty on a call file written before reconnects were kept. */
  readonly reconnects: readonly CallReconnect[];
  /** Lines that did not parse — a torn last line, say — skipped and counted rather than failing the call. */
  readonly skipped: number;
}

/**
 * Parse one line of a call file.
 *
 * @param value the decoded JSON of the line
 * @returns the entry, or `undefined` when it is not one
 */
export function callEntryOf({ value }: { value: unknown }): CallEntry | undefined {
  const parsed = callEntrySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Fold one relay line in: the latest line per turn wins at the turn's first position.
 *
 * @param notes the call's tool lines and relays so far, updated in place
 */
function foldRelay({ notes, entry }: { notes: CallNote[]; entry: Extract<CallEntry, { kind: "relay" }> }): void {
  const relay: CallNote = {
    about: entry.about,
    atIso: entry.atIso,
    detail: entry.detail,
    heard: entry.heard,
    kind: "relay",
    outcome: entry.outcome,
    say: entry.say,
    turnId: entry.turnId,
  };
  // With no turn, the same instant and words is the one line a retried batch wrote twice.
  const index = notes.findIndex(
    (note) =>
      note.kind === "relay" &&
      note.turnId === entry.turnId &&
      (entry.turnId !== null || (note.atIso === entry.atIso && note.heard === entry.heard)),
  );
  if (index === -1) {
    notes.push(relay);
  } else if (notEarlier({ held: notes[index]!.atIso, next: entry.atIso })) {
    notes[index] = relay;
  }
}

/**
 * Fold one written message in, once per message: a batch posted again writes it twice, and the copy taken no earlier
 * wins at the message's first position.
 *
 * @param written the call's written messages so far, updated in place
 */
function foldWritten({
  written,
  entry,
}: {
  written: CallWritten[];
  entry: Extract<CallEntry, { kind: "wrote" }>;
}): void {
  const next: CallWritten = { atIso: entry.atIso, itemId: entry.itemId, text: entry.text, turnId: entry.turnId };
  const index = written.findIndex((held) => held.itemId === entry.itemId);
  if (index === -1) {
    written.push(next);
  } else if (notEarlier({ held: written[index]!.atIso, next: entry.atIso })) {
    written[index] = next;
  }
}

/**
 * The newest of a call's own lines' instants: when it was last heard from.
 *
 * @param dated the call's own lines, never empty
 * @param first the first of them
 * @returns the newest instant
 */
function lastHeard({ dated, first }: { dated: readonly CallEntry[]; first: CallEntry }): string {
  let lastIso = first.atIso;
  for (const entry of dated) {
    if (Date.parse(entry.atIso) > Date.parse(lastIso)) {
      lastIso = entry.atIso;
    }
  }
  return lastIso;
}

/** The lists a call's lines fold into, each updated in place. */
interface CallLists {
  readonly segments: CallSegment[];
  readonly written: CallWritten[];
  readonly offers: CallOffer[];
  readonly notes: CallNote[];
  readonly usages: CallUsage[];
  readonly reconnects: CallReconnect[];
}

/**
 * Fold one line that adds to a list — every kind but the `open` and `closed` that date the call, and a `card-move`,
 * which `./cardMove.ts` reads from the lines themselves.
 *
 * @param lists the call's lists so far, updated in place
 */
function foldListed({
  lists,
  entry,
}: {
  lists: CallLists;
  entry: Exclude<CallEntry, { kind: "open" } | { kind: "closed" }>;
}): void {
  if (entry.kind === "reconnect") {
    foldReconnect({ entry, reconnects: lists.reconnects });
  } else if (entry.kind === "segment") {
    foldSegment({ entry, segments: lists.segments });
  } else if (entry.kind === "tool") {
    foldTool({ entry, notes: lists.notes });
  } else if (entry.kind === "relay") {
    foldRelay({ entry, notes: lists.notes });
  } else if (entry.kind === "wrote") {
    foldWritten({ entry, written: lists.written });
  } else if (entry.kind === "offered") {
    foldOffer({ entry, offers: lists.offers });
  } else if (entry.kind === "usage") {
    foldUsage({ entry, usages: lists.usages });
  }
}

/**
 * Fold a call file's lines into the call — a segment's latest snapshot wins, in the order the segments began, a
 * relay's latest line wins per turn, a tool line or a copy-tray offer written twice is kept once, the `open` line's
 * instant is when it opened, and the last `closed` is how it ended — whatever reconnect steps follow it, which are
 * kept in the order they happened and never move when the call was last heard.
 *
 * @param callId the call the file belongs to
 * @param entries the lines that parsed, in file order
 * @param skipped how many lines did not
 * @returns the call, or `undefined` when no line but a reconnect step parsed
 */
export function foldCall({
  callId,
  entries,
  skipped,
}: {
  callId: string;
  entries: readonly CallEntry[];
  skipped: number;
}): CallRecord | undefined {
  // A file holding only reconnect steps is no call: a step never makes one show, nor dates it.
  const dated = callActivity({ entries });
  const first = dated[0];
  if (first === undefined) {
    return undefined;
  }
  const lists: CallLists = { notes: [], offers: [], reconnects: [], segments: [], usages: [], written: [] };
  const { notes, offers, reconnects, segments, usages, written } = lists;
  let opened = openedBeforeAny({ openedIso: first.atIso });
  let ended: CallRecord["ended"];
  for (const entry of entries) {
    if (entry.kind === "open") {
      opened = openedAfter({ entry, opened });
    } else if (entry.kind === "closed") {
      ended = { atIso: entry.atIso, why: entry.why };
    } else {
      foldListed({ entry, lists });
    }
  }
  const { openedIso, origin, sessionId, surface, voice } = opened;
  return {
    callId,
    ended,
    lastIso: lastHeard({ dated, first }),
    notes,
    offers,
    openedIso,
    origin,
    reconnects: reconnects.toSorted((a, b) => Date.parse(a.atIso) - Date.parse(b.atIso)),
    // Stable, so two stretches begun in the same millisecond keep the order their ids first appeared in.
    segments: segments.toSorted((a, b) => Date.parse(a.beganIso) - Date.parse(b.beganIso)),
    sessionId,
    skipped,
    surface,
    usages,
    voice,
    written,
  };
}

/**
 * How a call ended, as one phrase — never an end the file does not record.
 *
 * @returns the phrase
 */
export function callEndPhrase({ call }: { call: Pick<CallRecord, "ended" | "lastIso"> }): string {
  if (call.ended === undefined) {
    return `no end recorded — it dropped or the page went away; last heard ${call.lastIso}`;
  }
  if (call.ended.why === null) {
    return `the owner hung up at ${call.ended.atIso}`;
  }
  return `it ended at ${call.ended.atIso} — ${clip({ max: CALL_DETAIL_CHARS, text: call.ended.why })}`;
}
