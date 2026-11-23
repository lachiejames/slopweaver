/**
 * Whether one surface — a live call, or the typed messenger — gave a FAITHFUL account of one console card: the pure
 * judge of `desktop e2e`'s card scenarios. `./e2eCallCardRead.ts` proves the ordered events happened (read, answer,
 * challenge, re-read, answer); this reads what was said against what the model was handed.
 *
 * The requirement: the voice and the typed messenger are tested against every Queue and Alignment card, so a failure
 * is found by the test and never by the owner. The fixes it holds to account
 * (`src/talk/cardFidelityLines.ts`): re-read when challenged, quote the card, say what the card does not say and what
 * has not been checked, keep each claim as handed. Per call it records whether the card and its attached briefing were
 * read, which of the card's claims the account dropped, which figures it added, which handed words the surface moved,
 * and whether a challenge was re-read or agreed around — every failure anchored `talk-call:<call>#<segment>`.
 *
 * The source is the read's own `answer` (`./cardFidelitySource.ts`): never the card as it stands later. An answer not
 * kept is `not-measured`, never clean. Each word-level finding is a CANDIDATE (`./cardFidelityText.ts`); the structural
 * ones — card read, briefing read, re-read before answering — are exact.
 */
import type { CallEntry } from "../talk/callRecord.js";
import { divergence, sentenceDivergence } from "../talk/wordDivergence.js";
import { type BriefingRead, briefingOf } from "./cardFidelityBriefing.js";
import {
  type AnchoredSegment,
  type CardAnswerReading,
  type CardFidelityFailure,
  type ChallengeDisposition,
  challengeFailures,
  firstAnswerFailures,
} from "./cardFidelityFailures.js";
import {
  absenceSegment,
  type FoldedSegment,
  movedBySegment,
  segmentBeganAfter,
  segmentsOf,
} from "./cardFidelitySegments.js";
import { type CardSource, cardSourceOf } from "./cardFidelitySource.js";
import { challengeWords, droppedClaims, questionQuoted, unsourcedFigures } from "./cardFidelityText.js";
import { isCardReadWitness } from "./e2eCallCardRead.js";
import { cardReadRequest } from "./e2eCardReadPlan.js";

/** Which surface was asked. */
export type CardFidelitySurface = "spoken" | "typed";

/** One call's judgement of one card. */
export interface CardFidelityObservation {
  readonly callId: string;
  readonly cardKey: string;
  readonly surface: CardFidelitySurface;
  readonly cardRead: boolean;
  /** sha256 of the card text the surface read, so two surfaces are compared only over the same card. */
  readonly sourceDigest: string | undefined;
  readonly briefing: BriefingRead;
  readonly first: CardAnswerReading | undefined;
  readonly challenge: ChallengeDisposition;
  readonly challenged: CardAnswerReading | undefined;
  readonly concessions: readonly string[];
  readonly failures: readonly CardFidelityFailure[];
}

/** What a judgement says before anything was read: nothing measured, nothing challenged. */
type UnreadFields = Omit<CardFidelityObservation, "cardRead" | "failures">;

/**
 * Judge one call file's account of one card.
 *
 * @param entries the call's lines, in file order
 * @param cardKey the card asked about, `<kind>:<id>`
 * @param challenge the exact typed challenge, which a final line of the owner's carries
 * @returns the judgement
 */
export function cardFidelityObservation({
  callId,
  entries,
  cardKey,
  challenge,
  surface,
}: {
  callId: string;
  entries: readonly CallEntry[];
  cardKey: string;
  challenge: string;
  surface: CardFidelitySurface;
}): CardFidelityObservation {
  const ordered = entries.toSorted((a, b) => Date.parse(a.atIso) - Date.parse(b.atIso));
  const segments = segmentsOf({ lines: entries });
  const anchorOf = ({ segment }: { segment: FoldedSegment | undefined }): string =>
    segment === undefined ? `talk-call:${callId}` : `talk-call:${callId}#${segment.id}`;
  const { firstRead, reads, reread } = readsAround({ cardKey, challenge, entries, ordered });
  const challengeSegment = segments.find((segment) => segment.who === "owner" && segment.text.includes(challenge));
  const challengeMs = challengeSegment === undefined ? Number.POSITIVE_INFINITY : challengeSegment.startMs;
  const empty = unreadFields({ callId, cardKey, surface });
  const absent = absenceSegment({ challenge: challengeSegment, request: cardReadRequest({ cardKey }), segments });
  const noAnchor = anchorOf({ segment: absent });
  if (firstRead === undefined) {
    const detail = reads.length === 0 ? `${cardKey} never read` : `${cardKey} first read only after the challenge`;
    return { ...empty, cardRead: false, failures: [{ anchor: noAnchor, code: "CARD_NOT_READ", detail }] };
  }
  const readMs = Date.parse(firstRead.atIso);
  const readAt = { atMs: readMs, line: entries.indexOf(firstRead) };
  const source = firstRead.kind === "tool" ? sourceOf({ answer: firstRead.answer, cardKey }) : undefined;
  const challengeAt = challengeSegment === undefined ? segments.length : segments.indexOf(challengeSegment);
  const firstSegments = turnOf({ from: readAt, fromAt: 0, segments, toAt: challengeAt });
  const briefingEndMs = Math.min(challengeMs, nextOwnerMs({ after: firstSegments, segments }));
  const briefing = briefingOf({ fromMs: readMs, ordered, source, toMs: briefingEndMs });
  const read = ({ said, endMs }: { said: readonly FoldedSegment[]; endMs: number }): CardAnswerReading | undefined =>
    readingOf({ anchors: said.map((segment) => anchorOf({ segment })), endMs, ordered, said, source, startMs: readMs });
  const first = read({ endMs: challengeMs, said: firstSegments });
  const failures = firstAnswerFailures({
    briefing,
    cardKey,
    first,
    firstAnchor: anchorOf({ segment: firstSegments.length === 0 ? absent : firstSegments[0] }),
    noAnchor,
    source,
  });
  const judged = { ...empty, briefing, cardRead: true, first, sourceDigest: source?.digest };
  if (challengeSegment === undefined) {
    return { ...judged, failures };
  }
  const after = turnOf({ from: readAt, fromAt: challengeAt + 1, segments, toAt: segments.length });
  const met = challengeMet({
    after,
    lineOf: (entry) => entries.indexOf(entry),
    read,
    replies: after.map((segment) => ({ anchor: anchorOf({ segment }), text: segment.text })),
    reread,
    unansweredAnchor: anchorOf({ segment: challengeSegment }),
  });
  return { ...judged, ...met.fields, failures: [...failures, ...met.failures] };
}

/**
 * The card's reads either side of the owner's challenge. A read is the FIRST read only before it, and the RE-READ only
 * after it, so one line is never both. Both are judged against the FILE LINE that first carries the
 * challenge, never the folded segment's start: a segment begun earlier can take the challenge in a later snapshot.
 * File order and instant must AGREE: a delayed line can land after the challenge yet carry an
 * earlier instant, so a read whose two orders disagree is neither, and the challenge it would have
 * answered fails.
 *
 * @param entries the call's lines, in file order
 * @param ordered the same lines by instant, which picks the earliest read either side
 * @returns every read of the card by instant, the first before the challenge, and the first after it
 */
function readsAround({
  cardKey,
  challenge,
  entries,
  ordered,
}: {
  cardKey: string;
  challenge: string;
  entries: readonly CallEntry[];
  ordered: readonly CallEntry[];
}): {
  readonly reads: readonly CallEntry[];
  readonly firstRead: CallEntry | undefined;
  readonly reread: CallEntry | undefined;
} {
  const reads = ordered.filter((entry) => isCardReadWitness({ cardKey, entry }));
  const challengeLine = entries.findIndex(
    (entry) => entry.kind === "segment" && entry.who === "owner" && entry.text.includes(challenge),
  );
  const challengeLineMs = challengeLine < 0 ? Number.POSITIVE_INFINITY : Date.parse(entries[challengeLine]!.atIso);
  const beforeChallenge = (entry: CallEntry): boolean =>
    challengeLine < 0 || (entries.indexOf(entry) < challengeLine && Date.parse(entry.atIso) <= challengeLineMs);
  const afterChallenge = (entry: CallEntry): boolean =>
    challengeLine >= 0 && entries.indexOf(entry) > challengeLine && Date.parse(entry.atIso) >= challengeLineMs;
  return { firstRead: reads.find(beforeChallenge), reads, reread: reads.find(afterChallenge) };
}

/**
 * A judgement's fields before the card was read.
 *
 * @returns nothing measured, nothing challenged
 */
function unreadFields({
  callId,
  cardKey,
  surface,
}: {
  callId: string;
  cardKey: string;
  surface: CardFidelitySurface;
}): UnreadFields {
  return {
    briefing: { expected: [], read: [], state: "not-measured" },
    callId,
    cardKey,
    challenge: "not-challenged",
    challenged: undefined,
    concessions: [],
    first: undefined,
    sourceDigest: undefined,
    surface,
  };
}

/**
 * How a challenge was met: re-read or not, what the answer after it said, and what failed.
 *
 * @param after the voice's turn after the owner's challenge
 * @param lineOf a call entry's index in the call file, which orders a re-read against a segment of its instant
 * @param read reads one answer against the card
 * @param reread the card's read after the challenge, when there was one
 * @param replies the turn's segments with their anchors: the first is where a failure of the whole answer is anchored
 * @param unansweredAnchor the owner's challenge line, where an unanswered challenge is anchored
 * @returns the challenge fields and the failures
 */
function challengeMet({
  after,
  lineOf,
  read,
  replies,
  reread,
  unansweredAnchor,
}: {
  after: readonly FoldedSegment[];
  lineOf: (entry: CallEntry) => number;
  read: (input: { said: readonly FoldedSegment[]; endMs: number }) => CardAnswerReading | undefined;
  replies: readonly AnchoredSegment[];
  reread: CallEntry | undefined;
  unansweredAnchor: string;
}): {
  fields: Pick<CardFidelityObservation, "challenge" | "challenged" | "concessions">;
  failures: readonly CardFidelityFailure[];
} {
  let answered = after;
  if (reread !== undefined) {
    const rereadAt = { atMs: Date.parse(reread.atIso), line: lineOf(reread) };
    answered = after.filter((segment) => segmentBeganAfter({ segment, ...rereadAt }));
  }
  const opening = replies[0];
  const challengeAnchor = opening === undefined ? unansweredAnchor : opening.anchor;
  const disposition = dispositionOf({ answered, reread: reread !== undefined });
  const words = challengeWords({ answer: after.map((segment) => segment.text).join(" ") });
  const challenged = read({ endMs: Number.POSITIVE_INFINITY, said: answered });
  return {
    failures: challengeFailures({ challengeAnchor, challenged, disposition, replies, unansweredAnchor, words }),
    fields: { challenge: disposition, challenged, concessions: words.concessions },
  };
}

/**
 * The voice segments of one turn: from the first voice segment at or after `fromAt` that began by the read, up to the owner's
 * next segment after it or `toAt`. Bounded by segment ORDER, never by instant: two segments in the same millisecond
 * keep the order the call file gave them, so a voice answer tied with the owner's challenge stays in the turn before
 * it, and one tied with the card read counts only when the file wrote it after the read.
 *
 * @param segments every folded segment, earliest first
 * @param fromAt the first segment index the turn may start at
 * @param from the card read's instant and call file line, which the turn must begin after
 * @param toAt the segment index the turn closes at regardless
 * @returns the turn's voice segments, in order
 */
function turnOf({
  segments,
  fromAt,
  from,
  toAt,
}: {
  segments: readonly FoldedSegment[];
  fromAt: number;
  from: { atMs: number; line: number };
  toAt: number;
}): readonly FoldedSegment[] {
  const firstAt = segments.findIndex(
    (segment, index) =>
      index >= fromAt && index < toAt && segment.who === "voice" && segmentBeganAfter({ segment, ...from }),
  );
  if (firstAt < 0) {
    return [];
  }
  const ownerAt = ownerNextAt({ firstAt, segments });
  const endAt = Math.min(toAt, ownerAt);
  // Every segment of the turn, not only its first, must follow the read by both orders.
  return segments.filter(
    (segment, index) =>
      index >= firstAt && index < endAt && segment.who === "voice" && segmentBeganAfter({ segment, ...from }),
  );
}

/**
 * The index of the owner's next segment after one voice segment: where that turn ends.
 *
 * @param firstAt the voice segment's index
 * @param segments every folded segment, earliest first
 * @returns the index, or the segment count when the owner said nothing after it
 */
function ownerNextAt({ firstAt, segments }: { firstAt: number; segments: readonly FoldedSegment[] }): number {
  const ownerAt = segments.findIndex((segment, index) => index > firstAt && segment.who === "owner");
  if (ownerAt < 0) {
    return segments.length;
  }
  return ownerAt;
}

/**
 * When the owner's next segment after the first of some voice segments began: where the briefing window closes.
 *
 * @param after the turn so far — only its first segment is read
 * @param segments every folded segment, earliest first
 * @returns epoch milliseconds, or positive infinity when the owner said nothing after it, or there is no turn
 */
function nextOwnerMs({
  after,
  segments,
}: {
  after: readonly FoldedSegment[];
  segments: readonly FoldedSegment[];
}): number {
  const first = after[0];
  if (first === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const ownerTurn = segments[ownerNextAt({ firstAt: segments.indexOf(first), segments })];
  if (ownerTurn === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  return ownerTurn.startMs;
}

/**
 * The card source a read's answer carries, when it was kept.
 *
 * @returns the source, or `undefined`
 */
function sourceOf({ answer, cardKey }: { answer: string | undefined; cardKey: string }): CardSource | undefined {
  return answer === undefined ? undefined : cardSourceOf({ answer, cardKey });
}

/**
 * How a challenge was met.
 *
 * @param answered the answer segments after the challenge (after the re-read, when there was one)
 * @param reread whether the card was read again after the challenge
 * @returns the disposition
 */
function dispositionOf({
  answered,
  reread,
}: {
  answered: readonly FoldedSegment[];
  reread: boolean;
}): ChallengeDisposition {
  if (answered.length === 0) {
    return "no-challenged-answer";
  }
  return reread ? "reread-before-answer" : "answered-without-reread";
}

/**
 * Read one answer against the card and everything read before it.
 *
 * @param said the answer's segments, in order
 * @param startMs when the card was first read: the thinking model's messages from then are what it was handed
 * @param endMs where the answer's window closes
 * @returns the reading, `undefined` when nothing was said
 */
function readingOf({
  anchors,
  said,
  source,
  ordered,
  startMs,
  endMs,
}: {
  anchors: readonly string[];
  said: readonly FoldedSegment[];
  source: CardSource | undefined;
  ordered: readonly CallEntry[];
  startMs: number;
  endMs: number;
}): CardAnswerReading | undefined {
  if (said.length === 0) {
    return undefined;
  }
  const text = said.map((segment) => segment.text).join(" ");
  const lastMs = said.at(-1)!.startMs;
  const before = ordered.filter((entry) => Date.parse(entry.atIso) <= lastMs);
  const sources = before.flatMap((entry) => {
    if (entry.kind === "tool" && entry.answer !== undefined) {
      return [entry.answer];
    }
    return entry.kind === "segment" && entry.who === "owner" ? [entry.text] : [];
  });
  const handed = ordered
    .filter((entry) => entry.kind === "wrote" && Date.parse(entry.atIso) >= startMs)
    .filter((entry) => Date.parse(entry.atIso) < Math.min(endMs, lastMs + 1))
    .map((entry) => (entry.kind === "wrote" ? entry.text : ""))
    .join("\n");
  const unhanded = handed.trim() === "";
  const drift = unhanded ? { added: [], relocated: [] } : divergence({ handed, spoken: text });
  const texts = said.map((segment) => segment.text);
  const sentences = unhanded ? [] : sentenceDivergence({ handed, spoken: text });
  const moved = movedBySegment({ sentences, texts });
  return {
    added: drift.added,
    anchor: anchors[0]!,
    dropped: source === undefined ? [] : droppedClaims({ answer: text, claims: source.claims }),
    moved: drift.relocated,
    quoted: source === undefined ? undefined : questionQuoted({ answer: text, question: source.question }),
    segments: said.map((segment, index) => ({
      anchor: anchors[index]!,
      moved: moved[index]!,
      text: segment.text,
    })),
    text,
    // With the card's answer not kept, what it held is unknown, so no figure can be called unsourced.
    unsourced: source === undefined ? [] : unsourcedFigures({ answer: text, sources }),
  };
}
