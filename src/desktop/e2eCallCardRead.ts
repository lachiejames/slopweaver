/**
 * Whether one call file holds `card-read`'s ordered witness: the named card read or opened, a first answer, the typed
 * challenge, the same card read or opened again, and a second answer — in that order, in ONE call. Pure; the read off
 * disk is `src/cli/commands/desktop/e2eCallEvidenceRead.ts`, the drive
 * `src/cli/commands/desktop/e2eCallCardReadScenario.ts`.
 *
 * It judges structure, never prose. The card is named by its Queue KEY, `<kind>:<id>` exactly as the Queue names it
 * (`src/talk/cardKey.ts`) — an `ask:`, a `hand:` note, any card a register holds. The tool lines' details are the
 * console's own (`site/components/voice/openCardRun.ts`): `open_card` writes `<key>, card <outcome>, page <outcome>,
 * thread <outcome>`, and `read_card` writes `<key>, read`, or `<key>, read (off the owner's Queue)` for a card they
 * already took off it. BOTH reads are EITHER tool, because both hand the model the card's text (`runReadCard`,
 * `runOpenCard`): a hand note's call re-opened it with `open_card`, and a card the owner has ruled on is read with
 * `read_card` by design (`src/talk/sessionConfig.ts`), since `open_card` writes `<key>, off the owner's Queue, nothing
 * opened` for one — a line this witness deliberately never takes. So a different card, an opening skipped or
 * refused, a refused tool line, or the right events in the wrong order never complete it. Whether either answer was FAITHFUL to the card is not judged here: that is read after the leg,
 * and `talk fidelity --call <id>` is a candidate report of added or moved voice words, not a verdict on it.
 *
 * **Instant order, with one guard.** A segment's lines can repeat — snapshots while it grows, then its final line — so an
 * answer counts only through a segment id NOT already seen on a voice line before the tool it answers, and, where the
 * segment names its `beganIso`, one that began no earlier than that tool's line. A retried batch re-writing the first
 * answer's final line after the re-read can therefore never stand for the second answer, nor can a reply already under
 * way when the card was read or opened again whose first line happens to land after it.
 * A final line of the owner's own words need not precede the first read: the realtime model may call it from a partial
 * utterance before the final transcript batch lands, and the exact tool result is the stronger witness.
 */
import type { CallEntry } from "../talk/callRecord.js";

/** How far one call has come through the witness, each state waiting on the next event. */
export type E2eCardReadProgress =
  | "waiting-for-open"
  | "waiting-for-first-answer"
  | "ready-for-challenge"
  | "waiting-for-reread"
  | "waiting-for-challenged-answer"
  | "complete";

/** Every progress state, in order: a later one is further through the witness. */
export const CARD_READ_PROGRESS: readonly E2eCardReadProgress[] = [
  "waiting-for-open",
  "waiting-for-first-answer",
  "ready-for-challenge",
  "waiting-for-reread",
  "waiting-for-challenged-answer",
  "complete",
];

/** A tool line of a call file. */
type ToolEntry = Extract<CallEntry, { kind: "tool" }>;

/** A segment line of a call file. */
type SegmentEntry = Extract<CallEntry, { kind: "segment" }>;

/**
 * Whether a line is a tool line. Positional because a type predicate cannot name a destructured binding (TS1230).
 *
 * @returns whether it is
 */
function isTool(entry: CallEntry): entry is ToolEntry {
  return entry.kind === "tool";
}

/**
 * The detail of a tool line of the named tool that was not refused.
 *
 * @returns its detail, or `undefined` when the line is no such tool line
 */
function ranToolDetail({ entry, name }: { entry: CallEntry; name: string }): string | undefined {
  if (!isTool(entry) || entry.name !== name || entry.refused) {
    return undefined;
  }
  return entry.detail;
}

/**
 * Whether a line is the named card OPENED: a non-refused `open_card` whose card outcome was `opened`, never `skipped`
 * or `refused`.
 *
 * @param entry the line
 * @param cardKey the Queue card key, `<kind>:<id>`
 * @returns whether it is
 */
export function isCardOpened({ entry, cardKey }: { entry: CallEntry; cardKey: string }): boolean {
  return ranToolDetail({ entry, name: "open_card" })?.startsWith(`${cardKey}, card opened, `) === true;
}

/**
 * Whether a line is the named card READ: a non-refused `read_card` of exactly that card, on the owner's Queue or off it.
 * Two exact details, never a prefix, so a key the named one merely begins is a different card.
 *
 * @param entry the line
 * @param cardKey the Queue card key, `<kind>:<id>`
 * @returns whether it is
 */
export function isCardRead({ entry, cardKey }: { entry: CallEntry; cardKey: string }): boolean {
  const detail = ranToolDetail({ entry, name: "read_card" });
  return detail === `${cardKey}, read` || detail === `${cardKey}, read (off the owner's Queue)`;
}

/**
 * Whether a line is one of the witness's two card reads, before the first answer or after the challenge: the card
 * read, or opened.
 *
 * @param entry the line
 * @param cardKey the Queue card key, `<kind>:<id>`
 * @returns whether it is
 */
export function isCardReadWitness({ entry, cardKey }: { entry: CallEntry; cardKey: string }): boolean {
  return isCardRead({ cardKey, entry }) || isCardOpened({ cardKey, entry });
}

/**
 * Whether a line is a segment of the voice's. Positional for the reason {@link isTool} is.
 *
 * @returns whether it is
 */
function isVoiceSegment(entry: CallEntry): entry is SegmentEntry {
  return entry.kind === "segment" && entry.who === "voice";
}

/**
 * Whether a line is a segment of the owner's. Positional for the reason {@link isTool} is.
 *
 * @returns whether it is
 */
function isOwnerSegment(entry: CallEntry): entry is SegmentEntry {
  return entry.kind === "segment" && entry.who === "owner";
}

/**
 * The latest instant one line proves its segment had begun by: its own `atIso` bounds the start from above even where
 * `beganIso` is absent (lines written before segments carried one), and an earlier `beganIso` wins.
 *
 * @returns epoch milliseconds
 */
function segmentStartMs({ entry }: { entry: SegmentEntry }): number {
  const atMs = Date.parse(entry.atIso);
  if (entry.beganIso === undefined) {
    return atMs;
  }
  return Math.min(atMs, Date.parse(entry.beganIso));
}

/**
 * How far one call's file came through `card-read`'s witness, scanning its lines in the order their instants give.
 *
 * @param entries the call's lines, in file order, which a late-landing batch can make differ from when they happened
 * @param cardKey the Queue card key `--call-card` named
 * @param challenge the whole typed challenge, which a final line of the owner's must carry: its run marker alone is not it,
 * since a turn cut short at the marker never challenged the voice
 * @returns the furthest state reached
 */
export function cardReadProgress({
  entries,
  cardKey,
  challenge,
}: {
  entries: readonly CallEntry[];
  cardKey: string;
  challenge: string;
}): E2eCardReadProgress {
  // The sink stamps every line strictly after the one queued before it, while a batch can land ahead of an earlier
  // one (site/lib/transcriptSink.ts), so the instants give the order things happened in and the file does not: a
  // re-read and answer from before the challenge could otherwise sit after it in the file. A stable sort keeps file
  // order for a tie.
  const ordered = entries.toSorted((a, b) => Date.parse(a.atIso) - Date.parse(b.atIso));
  const voiceStartMs = voiceStartsOf({ ordered });
  let progress: E2eCardReadProgress = "waiting-for-open";
  // Every voice segment id seen so far, final or not.
  const voiceSeen = new Set<string>();
  let window: AnswerWindow = { toolAtMs: Number.NEGATIVE_INFINITY, voiceBeforeTool: new Set() };
  for (const entry of ordered) {
    if (isVoiceSegment(entry)) {
      voiceSeen.add(entry.id);
    }
    const fresh = isFreshAnswer({ entry, voiceStartMs, window });
    const next = nextProgress({ cardKey, challenge, entry, fresh, progress });
    // Entering a state that awaits an answer means this line is the tool the answer must follow.
    const awaitsAnswer = next === "waiting-for-first-answer" || next === "waiting-for-challenged-answer";
    if (next !== progress && awaitsAnswer) {
      window = { toolAtMs: Date.parse(entry.atIso), voiceBeforeTool: new Set(voiceSeen) };
    }
    progress = next;
  }
  return progress;
}

/**
 * Each voice segment's earliest start any of its lines proves, over the WHOLE file: an answer must be a segment that
 * began after the tool it answers and a segment id repeats, so one early snapshot of it is enough to say it did not.
 *
 * @param ordered the call's lines in instant order
 * @returns epoch milliseconds by voice segment id
 */
function voiceStartsOf({ ordered }: { ordered: readonly CallEntry[] }): ReadonlyMap<string, number> {
  const starts = new Map<string, number>();
  for (const entry of ordered.filter(isVoiceSegment)) {
    const startMs = segmentStartMs({ entry });
    const earlier = starts.get(entry.id);
    starts.set(entry.id, earlier === undefined ? startMs : Math.min(earlier, startMs));
  }
  return starts;
}

/** What an answer must postdate: the voice ids seen when the awaited tool landed, and the instant it landed. */
interface AnswerWindow {
  readonly voiceBeforeTool: ReadonlySet<string>;
  readonly toolAtMs: number;
}

/**
 * Whether a line is a fresh answer to the awaited tool: a final voice line with words, of a segment neither seen
 * before that tool nor proven to have begun before it, whatever line of it came first.
 *
 * A final voice line with no words is no answer: the call record allows an empty segment. "No words" is what `trim()`
 * strips, so a segment of only a character it keeps (U+0085, say) would count; a transcription never produces one, and
 * a Unicode White_Space test is what would close it.
 *
 * @returns whether it is
 */
function isFreshAnswer({
  entry,
  voiceStartMs,
  window,
}: {
  entry: CallEntry;
  voiceStartMs: ReadonlyMap<string, number>;
  window: AnswerWindow;
}): boolean {
  return (
    isVoiceSegment(entry) &&
    entry.final &&
    entry.text.trim() !== "" &&
    !window.voiceBeforeTool.has(entry.id) &&
    voiceStartMs.get(entry.id)! >= window.toolAtMs
  );
}

/**
 * The state one line moves the witness to: each state advances one step on its own event and otherwise stays.
 *
 * @param fresh whether the line is a fresh answer to the awaited tool
 * @returns the next state
 */
function nextProgress({
  progress,
  entry,
  cardKey,
  challenge,
  fresh,
}: {
  progress: E2eCardReadProgress;
  entry: CallEntry;
  cardKey: string;
  challenge: string;
  fresh: boolean;
}): E2eCardReadProgress {
  const advances: Record<E2eCardReadProgress, boolean> = {
    complete: false,
    "ready-for-challenge": isOwnerSegment(entry) && entry.final && entry.text.includes(challenge),
    "waiting-for-challenged-answer": fresh,
    "waiting-for-first-answer": fresh,
    "waiting-for-open": isCardReadWitness({ cardKey, entry }),
    "waiting-for-reread": isCardReadWitness({ cardKey, entry }),
  };
  if (!advances[progress]) {
    return progress;
  }
  return CARD_READ_PROGRESS[CARD_READ_PROGRESS.indexOf(progress) + 1]!;
}

/**
 * The further of two progress states.
 *
 * @returns whichever comes later in {@link CARD_READ_PROGRESS}
 */
export function furtherProgress({ a, b }: { a: E2eCardReadProgress; b: E2eCardReadProgress }): E2eCardReadProgress {
  return CARD_READ_PROGRESS.indexOf(b) > CARD_READ_PROGRESS.indexOf(a) ? b : a;
}
