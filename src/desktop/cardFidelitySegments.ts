/**
 * A call file's segments folded to one row each, for the card-fidelity judge (`./cardFidelity.ts`). A segment's lines
 * repeat — snapshots while it grows, then its final line (`src/talk/callRecord.ts`) — so each id keeps its LAST final
 * text, or its last snapshot when a dropped call never finalised it, and the earliest start any of its lines proves,
 * the same start rule `./e2eCallCardRead.ts` holds an answer to. A segment with no letter or digit — blank, or only
 * punctuation — is no row. Pure.
 */
import type { CallEntry } from "../talk/callRecord.js";
import { contentWords } from "../talk/wordDivergence.js";

/** One segment, folded. */
export interface FoldedSegment {
  readonly id: string;
  readonly who: "owner" | "voice";
  /** The earliest instant any of its lines proves it had begun by, epoch milliseconds. */
  readonly startMs: number;
  /** The call file index of its first line: what orders it against a tool line stamped the same instant. */
  readonly firstLine: number;
  /** Its last final text, else its last snapshot's. */
  readonly text: string;
}

/**
 * Whether a segment began after a line of the call file: by instant AND by file order, so a voice answer written
 * before a card read in the same millisecond is never taken as an answer to it, nor one written
 * before it but stamped later. Where the two orders disagree the segment is not after, so the verdict
 * that needed it fails rather than passes.
 *
 * @param segment the folded segment
 * @param atMs the line's instant, epoch milliseconds
 * @param line the line's index in the call file
 * @returns true when the segment began after it
 */
export function segmentBeganAfter({
  segment,
  atMs,
  line,
}: {
  segment: FoldedSegment;
  atMs: number;
  line: number;
}): boolean {
  return segment.firstLine > line && segment.startMs >= atMs;
}

/**
 * Fold the call's segment lines to one row per id, ordered by start, and by the call file's own order where two start
 * at one instant: a line's `atIso` is when it was written, which a repeated or final line can leave out of file order,
 * so sorting by it first would reorder a tie. Order is SPOKEN order, never file order: a delayed
 * batch can write a segment after one it began before, and a failure is anchored to the words the owner heard first.
 *
 * @param lines the call's lines, in the call file's order
 * @returns the rows that ended with words, earliest start first
 */
export function segmentsOf({ lines }: { lines: readonly CallEntry[] }): readonly FoldedSegment[] {
  const starts = new Map<string, number>();
  const firstLines = new Map<string, number>();
  // A segment's final text, else its last snapshot: a call dropped mid-sentence never finalises its last line, and
  // the call store keeps those words as said. Folded per SPEAKER and id, so a line of the owner's reusing
  // a voice segment's id never inherits that segment's position.
  const finals = new Map<string, { final: boolean; id: string; who: "owner" | "voice"; text: string }>();
  for (const [index, entry] of lines.entries()) {
    if (entry.kind !== "segment") {
      continue;
    }
    const key = `${entry.who}:${entry.id}`;
    if (!firstLines.has(key)) {
      firstLines.set(key, index);
    }
    const atMs = Date.parse(entry.atIso);
    const startMs = entry.beganIso === undefined ? atMs : Math.min(atMs, Date.parse(entry.beganIso));
    const earlier = starts.get(key);
    starts.set(key, earlier === undefined ? startMs : Math.min(earlier, startMs));
    if (entry.final || finals.get(key)?.final !== true) {
      finals.set(key, { final: entry.final, id: entry.id, text: entry.text, who: entry.who });
    }
  }
  return (
    [...finals.entries()]
      // A row needs a letter or digit: blank or punctuation-only text is no words to anchor to.
      .filter(([, final]) => /[\p{L}\p{N}]/u.test(final.text))
      .map(([key, final]) => ({
        firstLine: firstLines.get(key)!,
        id: final.id,
        startMs: starts.get(key)!,
        text: final.text.trim(),
        who: final.who,
      }))
      .toSorted((a, b) => a.startMs - b.startMs)
  );
}

/**
 * Where an absence — a card never read, or read with no answer to it — is anchored: the voice's first line after the
 * card ask and before the owner speaks again, which it answered without the card or without answering, else that ask. With no
 * line of the owner's, the call's first.
 *
 * Everything is read in segment ORDER, never by instant alone: a request and the typed challenge stamped the same
 * millisecond still stand in the order said.
 *
 * @param segments every folded segment, earliest first
 * @param challenge the owner's typed challenge's segment, `undefined` when it never came
 * @param request the words the run asked the card with (`./e2eCardReadPlan.ts` `cardReadRequest`)
 * @returns the segment, `undefined` only for a call with none
 */
export function absenceSegment({
  segments,
  challenge,
  request,
}: {
  segments: readonly FoldedSegment[];
  challenge: FoldedSegment | undefined;
  request: string;
}): FoldedSegment | undefined {
  const before = challenge === undefined ? segments : segments.slice(0, segments.indexOf(challenge));
  const ask = cardAskSegment({ request, segments: before });
  if (ask === undefined) {
    return segments[0];
  }
  const askAt = before.indexOf(ask);
  const nextAt = before.findIndex((segment, index) => index > askAt && segment.who === "owner");
  const untilAt = nextAt < 0 ? before.length : nextAt;
  // Segment order, never the instant: a reply stamped the ask's millisecond is still its reply, and
  // a line before the ask at that millisecond is not.
  const answered = before.find((segment, index) => segment.who === "voice" && index > askAt && index < untilAt);
  if (answered === undefined) {
    return ask;
  }
  return answered;
}

/**
 * How many content words a line of the owner's must share with the run's request to be read as that request: a judgement
 * value. The request carries about fifteen (`./e2eCardReadPlan.ts`), a greeting or a farewell none.
 */
const ASK_SHARED_WORDS = 3;

/**
 * The owner's line that asked for the card: the one sharing the most content words with the run's request, the latest
 * on a tie, so neither a greeting, an earlier exchange nor a later farewell takes it; the owner's last line when none
 * shares enough, a transcript too far from the words to tell.
 *
 * @param segments the segments before the typed challenge, earliest first
 * @param request the words the run asked the card with
 * @returns the ask, `undefined` when the owner said nothing
 */
function cardAskSegment({
  segments,
  request,
}: {
  segments: readonly FoldedSegment[];
  request: string;
}): FoldedSegment | undefined {
  const asked = new Set(contentWords({ text: request }));
  const owners = segments.filter((segment) => segment.who === "owner");
  const shared = owners.map(
    (segment) => new Set(contentWords({ text: segment.text }).filter((w) => asked.has(w))).size,
  );
  const most = Math.max(0, ...shared);
  if (most < ASK_SHARED_WORDS) {
    return owners.at(-1);
  }
  return owners[shared.lastIndexOf(most)];
}

/**
 * The words each segment MOVED: a spoken sentence's relocated words, given to the segments that sentence spans and only
 * where that segment's own share of the sentence says the word. The answer is the segments joined by one space, so a
 * sentence the voice ran across two segments is judged whole, and an earlier segment keeping the word in place never
 * takes the anchor from the one that moved it.
 *
 * @param texts each segment's text, in the order said
 * @param sentences the joined answer's sentences in order, each with the handed words it relocated
 * @returns per segment, aligned with `texts`, the relocated words its part of a moving sentence says
 */
export function movedBySegment({
  texts,
  sentences,
}: {
  texts: readonly string[];
  sentences: readonly { readonly relocated: readonly string[]; readonly sentence: string }[];
}): readonly (readonly string[])[] {
  const joined = texts.join(" ");
  const starts = texts.map((_, index) => texts.slice(0, index).reduce((sum, text) => sum + text.length + 1, 0));
  const moved = texts.map((): string[] => []);
  let cursor = 0;
  for (const { relocated, sentence } of sentences) {
    const from = joined.indexOf(sentence, cursor);
    if (from < 0) {
      continue;
    }
    const to = from + sentence.length;
    cursor = to;
    texts.forEach((text, index) => {
      const share = joined.slice(Math.max(starts[index]!, from), Math.min(starts[index]! + text.length, to));
      const said = contentWords({ text: share });
      moved[index]!.push(...relocated.filter((word) => said.includes(word) && !moved[index]!.includes(word)));
    });
  }
  return moved;
}
