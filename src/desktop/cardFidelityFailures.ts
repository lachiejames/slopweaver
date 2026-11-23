/**
 * What a card answer failed, by name: the first answer's own failures, and the reply to the owner's typed challenge's —
 * split from the judgement (`./cardFidelity.ts`) that finds the answers, so each stays one reviewable size.
 */
import { contentWords } from "../talk/wordDivergence.js";
import type { BriefingRead } from "./cardFidelityBriefing.js";
import type { CardSource } from "./cardFidelitySource.js";
import { challengeWords, figuresOf } from "./cardFidelityText.js";

/** How a challenge was met: the card read again before the answer, an answer with no re-read, or no answer. */
export type ChallengeDisposition =
  "reread-before-answer" | "answered-without-reread" | "no-challenged-answer" | "not-challenged";

/** Every failure a judgement can name. */
type CardFidelityFailureCode =
  | "CARD_NOT_READ"
  | "SOURCE_NOT_KEPT"
  | "BRIEFING_NOT_READ"
  | "NO_ANSWER"
  | "CLAIM_DROPPED"
  | "QUESTION_NOT_QUOTED"
  | "FIGURE_UNSOURCED"
  | "HANDED_WORD_MOVED"
  | "CHALLENGE_NOT_REREAD"
  | "CHALLENGE_UNANSWERED"
  | "CHALLENGE_CONCEDED"
  | "CARD_LIMIT_UNSAID"
  | "UNCHECKED_UNSAID";

/** One failure, with the transcript line that shows it and what it found. */
export interface CardFidelityFailure {
  readonly code: CardFidelityFailureCode;
  /** `talk-call:<call>#<segment>`, or `talk-call:<call>` when no segment shows it. */
  readonly anchor: string;
  readonly detail: string;
}

/** One transcript segment of an answer: where it is, and what it said. */
export interface AnchoredSegment {
  readonly anchor: string;
  readonly text: string;
}

/** One segment of an answer, with the handed words IT moved, so a move is anchored where it happened (r3-rail-v12). */
interface AnswerSegment extends AnchoredSegment {
  readonly moved: readonly string[];
}

/** One answer's reading. */
export interface CardAnswerReading {
  /** Where the answer opens: an absence — a claim dropped, the question unquoted — is anchored here. */
  readonly anchor: string;
  readonly text: string;
  /** The answer's segments, each with its own anchor, so a word it said is anchored where it was said. */
  readonly segments: readonly AnswerSegment[];
  readonly dropped: readonly string[];
  readonly quoted: boolean | undefined;
  readonly unsourced: readonly string[];
  /** Content words the surface said that no message the thinking model wrote in that turn holds. */
  readonly added: readonly string[];
  /** Handed words the surface said in a sentence other than the one that holds them. */
  readonly moved: readonly string[];
}

/**
 * What the first answer, before any challenge, failed: a source the read did not keep, a briefing not read whole, and
 * the answer's own claims and question — or that no answer came at all.
 *
 * @param firstAnchor where the first answer opens in the transcript
 * @param noAnchor where an answer that never came is anchored: the voice's reply to the card ask, else the ask
 * @returns the failures, in that order
 */
export function firstAnswerFailures({
  briefing,
  cardKey,
  first,
  firstAnchor,
  noAnchor,
  source,
}: {
  briefing: BriefingRead;
  cardKey: string;
  first: CardAnswerReading | undefined;
  firstAnchor: string;
  noAnchor: string;
  source: CardSource | undefined;
}): readonly CardFidelityFailure[] {
  const failures: CardFidelityFailure[] = [];
  if (source === undefined) {
    failures.push({ anchor: firstAnchor, code: "SOURCE_NOT_KEPT", detail: cardKey });
  }
  if (briefing.state === "not-read" || briefing.state === "partial") {
    const missing = briefing.expected.filter((path) => !briefing.read.includes(path));
    failures.push({
      anchor: firstAnchor,
      code: "BRIEFING_NOT_READ",
      detail: `${briefing.state}: ${missing.join(", ")}`,
    });
  }
  if (first === undefined) {
    failures.push({ anchor: noAnchor, code: "NO_ANSWER", detail: "no answer after the read" });
    return failures;
  }
  return [...failures, ...answerFailures({ reading: first })];
}

/**
 * What the answer to the owner's typed challenge failed: no second read, no answer, a concession, a limit left unsaid, and
 * the challenged answer's own claims — a dropped claim or an unquoted question stays the first answer's to carry.
 *
 * @param challengeAnchor where the voice's reply to the challenge opens
 * @param replies the reply's segments, so a concession is anchored on the one that said it * @param unansweredAnchor the owner's challenge itself, for a reply that never came
 * @param words what the reply conceded and which limits it named
 * @returns the failures, in that order
 */
export function challengeFailures({
  challengeAnchor,
  challenged,
  disposition,
  replies,
  unansweredAnchor,
  words,
}: {
  challengeAnchor: string;
  challenged: CardAnswerReading | undefined;
  disposition: ChallengeDisposition;
  replies: readonly AnchoredSegment[];
  unansweredAnchor: string;
  words: ReturnType<typeof challengeWords>;
}): readonly CardFidelityFailure[] {
  const failures: CardFidelityFailure[] = [];
  if (disposition === "answered-without-reread") {
    failures.push({ anchor: challengeAnchor, code: "CHALLENGE_NOT_REREAD", detail: "answered with no second read" });
  }
  if (disposition === "no-challenged-answer") {
    failures.push({ anchor: unansweredAnchor, code: "CHALLENGE_UNANSWERED", detail: "" });
  }
  const conceded = ({ segment }: { segment: AnchoredSegment }): readonly string[] =>
    challengeWords({ answer: segment.text }).concessions;
  failures.push(
    ...wordFailures({
      code: "CHALLENGE_CONCEDED",
      fallback: challengeAnchor,
      segments: replies,
      tokens: [conceded],
      words: words.concessions,
    }),
  );
  if (challenged === undefined) {
    return failures;
  }
  if (!words.namesCardLimit) {
    failures.push({ anchor: challenged.anchor, code: "CARD_LIMIT_UNSAID", detail: "" });
  }
  if (!words.namesUnchecked) {
    failures.push({ anchor: challenged.anchor, code: "UNCHECKED_UNSAID", detail: "" });
  }
  const repeated = new Set<CardFidelityFailureCode>(["CLAIM_DROPPED", "QUESTION_NOT_QUOTED"]);
  return [...failures, ...answerFailures({ reading: challenged }).filter((failure) => !repeated.has(failure.code))];
}

/**
 * The failures one answer's reading shows.
 *
 * @returns them, in a fixed order
 */
function answerFailures({ reading }: { reading: CardAnswerReading }): readonly CardFidelityFailure[] {
  const { anchor } = reading;
  const failures: CardFidelityFailure[] = reading.dropped.map((label) => ({
    anchor,
    code: "CLAIM_DROPPED",
    detail: label,
  }));
  if (reading.quoted === false) {
    failures.push({ anchor, code: "QUESTION_NOT_QUOTED", detail: "" });
  }
  const said = { fallback: anchor, segments: reading.segments };
  const figures = ({ segment }: { segment: AnswerSegment }): readonly string[] => figuresOf({ text: segment.text });
  const moved = ({ segment }: { segment: AnswerSegment }): readonly string[] => segment.moved;
  // A sentence the answer ran across two segments moves a word no one segment moves alone.
  const content = ({ segment }: { segment: AnswerSegment }): readonly string[] => contentWords({ text: segment.text });
  failures.push(...wordFailures({ ...said, code: "FIGURE_UNSOURCED", tokens: [figures], words: reading.unsourced }));
  failures.push(
    ...wordFailures({ ...said, code: "HANDED_WORD_MOVED", tokens: [moved, content], words: reading.moved }),
  );
  return failures;
}

/**
 * One failure per segment that said any of some words, so each is anchored on the line that said it (Codex
 * r2-rail-v5); a word no one segment holds whole stays on the fallback line, where the answer opens.
 *
 * @param segments the answer's segments, each with its anchor
 * @param tokens what the check finds in one segment, tried in order, so a segment holds a word exactly as the check found
 *   it (`1,200` is `1200`) and a moved word goes first to the segment that moved it
 * @param words what one check found across the whole answer, every segment joined
 * @returns the failures in their segments' spoken order, the fallback line's first — never the order a check listed
 *   its words in, which for a concession is its pattern list */
function wordFailures<Segment extends AnchoredSegment>({
  code,
  fallback,
  segments,
  tokens,
  words,
}: {
  code: CardFidelityFailureCode;
  fallback: string;
  segments: readonly Segment[];
  tokens: readonly ((input: { segment: Segment }) => readonly string[])[];
  words: readonly string[];
}): readonly CardFidelityFailure[] {
  const byAnchor = new Map<string, string[]>();
  for (const word of words) {
    const holding = tokens.map((tokensOf) => segments.find((segment) => tokensOf({ segment }).includes(word)));
    const at = holding.find((segment) => segment !== undefined);
    const anchor = at === undefined ? fallback : at.anchor;
    const held = byAnchor.get(anchor);
    if (held === undefined) {
      byAnchor.set(anchor, [word]);
    } else {
      held.push(word);
    }
  }
  const spoken = segments.map((segment) => segment.anchor);
  return [...byAnchor]
    .toSorted(([a], [b]) => spoken.indexOf(a) - spoken.indexOf(b))
    .map(([anchor, said]) => ({ anchor, code, detail: said.join(", ") }));
}
