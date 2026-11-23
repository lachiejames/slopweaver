/**
 * Whether a summary kept the claims of its source: the pair-level half of `slopweaver talk fidelity`'s claim reading
 * (`./callFidelity.ts` finds the pairs on a call file, `./claimMatch.ts` aligns sentences). Two hops, each read
 * sentence by sentence:
 *
 * - **answer to voice**: what the thinking model wrote, against what the voice said for it. The voice was handed the
 *   whole of it, so a claim it leaves out is DROPPED, one nothing handed holds is ADDED, a number traded for another is
 *   SWAPPED, and a claim negated on one side only is a POLARITY flip.
 * - **source to answer**: the tool answers the turn read, with the owner's words, against what it wrote (typed: what the owner read).
 *   An answer selects from its sources, so a claim left out is never counted here. A number, identifier or quote that
 *   neither the turn's sources nor anything earlier on the call holds is `unsourced-detail` or `misquote`, which means
 *   "not on record", never "invented": a shell, web or sub-agent read leaves no tool line.
 *
 * A summary is only trustworthy if it is faithful to what was said.
 * Every finding is a CANDIDATE: overlap reads no meaning. A capitalised-word "name" detector is not used:
 * sentence starts, product words and Queue labels make it noise. The precision of each kind,
 * graded by hand, is in `docs/console/talk-fidelity-grades.md`.
 */
import { type ClaimSentence, claimSentencesRead, foldedForQuote } from "./claimDetails.js";
import {
  ALIGNED_SHARE,
  alignedOf,
  CLAIM_WORDS,
  type ClaimFinding,
  type ClaimSources,
  holdsWhole,
  misquotes,
  polarityOf,
  shareHeld,
  swapOf,
  unionOf,
} from "./claimMatch.js";

/**
 * The share of a sentence's content words another text must hold for the sentence to count as said there. A fifth:
 * graded on a real call, a reworded sentence ("shall we examine those separately" said as "want to look at those
 * separately") still holds a quarter to a third of its words, while a dropped or added one holds almost none.
 */
const SAID_SHARE = 0.2;

/** The same against a turn's tool answers, where a chance overlap of a few words across many sentences is common. */
const SOURCE_ALIGNED_SHARE = 0.5;

/** Whether a sentence is a claim the other side holds almost none of: said there, it is not. */
function unheld({ sentence, held }: { sentence: ClaimSentence; held: ReadonlySet<string> }): boolean {
  const isClaim = sentence.words.size >= CLAIM_WORDS;
  return isClaim && shareHeld({ held, words: sentence.words }) < SAID_SHARE;
}

/** A swap as a finding, recording its numbers so neither is counted again as dropped or unsourced. */
function swapFinding({
  swap,
  sentence,
  swapped,
}: {
  swap: { readonly lost: readonly string[]; readonly said: readonly string[] };
  sentence: ClaimSentence;
  swapped: Set<string>;
}): readonly ClaimFinding[] {
  if (swap.said.length === 0) {
    return [];
  }
  [...swap.lost, ...swap.said].forEach((value) => swapped.add(value));
  const detail = `${swap.lost.join(", ")} → ${swap.said.join(", ")}`;
  return [{ detail, kind: "swapped-detail", sentence: sentence.text }];
}

/** One spoken sentence against the handed answer: a misquote, an added claim, or a flip or swap of the one it says. */
function spokenSentenceFindings({
  sentence,
  sources,
  handed,
  spokenNumbers,
  swapped,
}: {
  sentence: ClaimSentence;
  sources: readonly ClaimSentence[];
  handed: { readonly words: ReadonlySet<string>; readonly numbers: ReadonlySet<string>; readonly folded: string };
  spokenNumbers: ReadonlySet<string>;
  swapped: Set<string>;
}): readonly ClaimFinding[] {
  const found = [...misquotes({ folded: handed.folded, sentence })];
  const aligned = alignedOf({ sentence, share: ALIGNED_SHARE, sources });
  if (aligned === undefined) {
    if (unheld({ held: handed.words, sentence })) {
      const kind = sentence.question ? "added-question" : "added-claim";
      found.push({ detail: "nothing handed says it", kind, sentence: sentence.text });
    }
    return found;
  }
  found.push(...polarityOf({ sentence, sourceName: "handed text", sources }));
  const swap = swapOf({ aligned, sentence, sourceAll: handed.numbers, summaryAll: spokenNumbers });
  return [...found, ...swapFinding({ sentence, swap, swapped })];
}

/** The numbers a sentence says that a set of values does not hold and no swap already named. */
function unheldNumbers({
  sentence,
  held,
  swapped,
}: {
  sentence: ClaimSentence;
  held: ReadonlySet<string>;
  swapped: ReadonlySet<string>;
}): readonly string[] {
  return [...sentence.numbers].filter((value) => !held.has(value) && !swapped.has(value));
}

/** The handed sentences the voice left out whole, or whose numbers it left unsaid. */
function droppedFindings({
  sources,
  spokenWords,
  spokenNumbers,
  swapped,
}: {
  sources: readonly ClaimSentence[];
  spokenWords: ReadonlySet<string>;
  spokenNumbers: ReadonlySet<string>;
  swapped: ReadonlySet<string>;
}): readonly ClaimFinding[] {
  return sources.flatMap((source): readonly ClaimFinding[] => {
    if (unheld({ held: spokenWords, sentence: source })) {
      const detail = source.negated ? "a negated claim, unsaid" : "unsaid";
      return [{ detail, kind: "dropped-claim", sentence: source.text }];
    }
    return unheldNumbers({ held: spokenNumbers, sentence: source, swapped }).map((value) => ({
      detail: `${value}, unsaid`,
      kind: "dropped-detail",
      sentence: source.text,
    }));
  });
}

/**
 * What the voice changed in the claims of the answer it was handed. Identifiers are not compared: speech keeps them
 * out on purpose (`SPOKEN_LENGTH_BACKEND_LINES`' "keep ids out").
 *
 * @param handed what the thinking model wrote
 * @param spoken what the voice said for it
 * @returns every candidate finding: the spoken sentences' first, then the handed sentences left out
 */
export function answerToVoiceFindings({ handed, spoken }: { handed: string; spoken: string }): readonly ClaimFinding[] {
  const sources = claimSentencesRead({ text: handed });
  const said = claimSentencesRead({ text: spoken });
  const handedRead = {
    folded: foldedForQuote({ text: handed }),
    numbers: unionOf({ pick: (sentence) => sentence.numbers, sentences: sources }),
    words: unionOf({ pick: (sentence) => sentence.words, sentences: sources }),
  };
  const spokenNumbers = unionOf({ pick: (sentence) => sentence.numbers, sentences: said });
  const swapped = new Set<string>();
  const findings = said.flatMap((sentence) =>
    spokenSentenceFindings({ handed: handedRead, sentence, sources, spokenNumbers, swapped }),
  );
  for (const sentence of said) {
    unheldNumbers({ held: handedRead.numbers, sentence, swapped }).forEach((value) => {
      findings.push({
        detail: `${value}, which nothing handed says`,
        kind: "unsourced-detail",
        sentence: sentence.text,
      });
    });
  }
  const spokenWords = unionOf({ pick: (sentence) => sentence.words, sentences: said });
  return [...findings, ...droppedFindings({ sources, spokenNumbers, spokenWords, swapped })];
}

/** One answer sentence against its sources: a misquote, a flip or swap of what it restates, a detail on no record. */
function answerSentenceFindings({
  sentence,
  turn,
  record,
  answerNumbers,
}: {
  sentence: ClaimSentence;
  turn: ClaimSources;
  record: ClaimSources;
  answerNumbers: ReadonlySet<string>;
}): readonly ClaimFinding[] {
  const found = [...misquotes({ folded: record.folded, sentence })];
  const swapped = new Set<string>();
  const aligned = alignedOf({ sentence, share: SOURCE_ALIGNED_SHARE, sources: turn.sentences });
  const isClaim = sentence.words.size >= CLAIM_WORDS;
  if (aligned !== undefined && isClaim) {
    found.push(...polarityOf({ sentence, sourceName: "source", sources: turn.sentences }));
    const swap = swapOf({ aligned, sentence, sourceAll: record.numbers, summaryAll: answerNumbers });
    found.push(...swapFinding({ sentence, swap, swapped }));
  }
  const unrecorded = [
    ...unheldNumbers({ held: record.numbers, sentence, swapped }),
    ...[...sentence.identifiers].filter((identifier) => !holdsWhole({ folded: record.folded, phrase: identifier })),
  ];
  return [
    ...found,
    ...unrecorded.map((value) => ({
      detail: `${value}, on no record`,
      kind: "unsourced-detail" as const,
      sentence: sentence.text,
    })),
  ];
}

/**
 * What the thinking model's answer changed from, or claims beyond, its sources on record.
 *
 * @param answer what it wrote, or typed, what the owner read
 * @param turn what this turn read: its tool answers and the owner's words, which a sentence is aligned to
 * @param record everything on the call up to the answer, the turn's sources included: what "on record" means
 * @returns every candidate finding, in the order the answer's sentences stand
 */
export function sourceToAnswerFindings({
  answer,
  turn,
  record,
}: {
  answer: string;
  turn: ClaimSources;
  record: ClaimSources;
}): readonly ClaimFinding[] {
  const said = claimSentencesRead({ text: answer });
  const answerNumbers = unionOf({ pick: (sentence) => sentence.numbers, sentences: said });
  return said.flatMap((sentence) => answerSentenceFindings({ answerNumbers, record, sentence, turn }));
}
