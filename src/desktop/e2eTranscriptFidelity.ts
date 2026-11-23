/**
 * How faithfully a call's input transcript carried a KNOWN script — pure, so the scoring is a unit test and the live
 * call only supplies the words. The reason it exists:
 * the owner's words reach the voice wrong, worst at the start or end of a turn, on a short turn, and when the owner
 * talks over the voice — and the owner cannot say how often, because the transcript is the only record and it carries
 * the same error. A script spoken into the call's microphone is the one ground truth that does not.
 *
 * The script and the transcript are aligned as WORD SEQUENCES across the whole call, never utterance by utterance:
 * the realtime server decides where the owner's turns begin and end, so one scripted line can arrive split across two
 * segments, or two lines merged into one, and a per-line pairing would read the seam as an error. Every alignment
 * operation is charged to the scripted utterance it falls in, an insertion to the word before it.
 *
 * The primary measure is CRITICAL: each line declares, before any result is seen, the words that carry its meaning
 * ("keep" against "delete", "today" against "not today", a name), and an utterance is misheard when any of them is
 * substituted or dropped. Normalisation is only case, punctuation, sound tags and fillers; a known mis-hearing is never
 * normalised into the word it stands for, or the measure would hide the very error it counts.
 */

/** One scripted utterance: what the microphone says, and the words in it that carry its meaning. */
export interface ScriptedUtterance {
  readonly id: string;
  readonly words: string;
  /** The words, as {@link fidelityWords} renders them, whose loss or substitution changes what the owner meant. */
  readonly critical: readonly string[];
}

/** What became of one scripted word. */
type WordFate = "kept" | "sub" | "del";

/** One utterance's score. */
interface UtteranceFidelity {
  readonly id: string;
  /** The scripted words, normalised. */
  readonly expected: readonly string[];
  /** The transcript's words charged to this utterance, normalised. */
  readonly heard: readonly string[];
  readonly substitutions: number;
  readonly deletions: number;
  readonly insertions: number;
  /** The critical words substituted or dropped, in script order. */
  readonly criticalLost: readonly string[];
  /** Whether a word in its first {@link EDGE_WORDS} was substituted or dropped, or one heard before it. */
  readonly startWrong: boolean;
  /** Whether a word in its last {@link EDGE_WORDS} was substituted or dropped, or one heard after it. */
  readonly endWrong: boolean;
  /** Whether no scripted word of it was heard at all. */
  readonly missing: boolean;
}

/** The whole call's score. */
export interface TranscriptFidelity {
  readonly utterances: readonly UtteranceFidelity[];
  /** Utterances with a critical word lost, over all of them: THE mis-hearing rate's numerator. */
  readonly misheard: number;
  readonly total: number;
  /** Word error rate over every scripted word: (substitutions + deletions + insertions) / scripted words. */
  readonly wer: number;
}

/** How many words at each end of an utterance count as its start or its end. */
const EDGE_WORDS = 2;

/** Hesitations the transcript writes and the script never says; neither side is charged for them. */
const FILLERS: ReadonlySet<string> = new Set(["um", "uh", "er", "erm", "mm", "hmm", "mhm", "ah"]);

/**
 * A line's words, compared case- and punctuation-blind, with the transcript's bracketed sound tags (`[lip smack]`) and
 * fillers removed. An apostrophe stays inside a word, so "it's" never matches "its".
 *
 * @param text a scripted line or a transcript segment
 * @returns its words
 */
export function fidelityWords({ text }: { text: string }): readonly string[] {
  return text
    .replace(/\[[^\]]*\]/g, " ")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(" ")
    .map((word) => word.replace(/^'+|'+$/g, ""))
    .filter((word) => word.length > 0 && !FILLERS.has(word));
}

/** One step of a word alignment. `at` is the scripted word's index; an insertion's is the word before it, or -1. */
type AlignOp =
  | { readonly op: "kept" | "sub"; readonly at: number; readonly heard: string }
  | { readonly op: "del"; readonly at: number }
  | { readonly op: "ins"; readonly at: number; readonly heard: string };

/**
 * A minimum-edit alignment of the heard words against the scripted ones, ties broken toward a match or substitution,
 * then a deletion, so an error is charged where the words actually differ.
 *
 * @param expected the scripted words, in order
 * @param heard the transcript's words, in order
 * @returns the operations, in order
 */
function align({ expected, heard }: { expected: readonly string[]; heard: readonly string[] }): readonly AlignOp[] {
  const cost = editCosts({ expected, heard });
  const ops: AlignOp[] = [];
  let i = expected.length;
  let j = heard.length;
  while (i > 0 || j > 0) {
    const op = backStep({ cost, expected, heard, i, j });
    ops.push(op);
    if (op.op !== "ins") {
      i -= 1;
    }
    if (op.op !== "del") {
      j -= 1;
    }
  }
  return ops.toReversed();
}

/** The edit-distance table: `cost[i][j]` is the fewest edits turning the first `i` scripted words into the first `j` heard. */
function editCosts({ expected, heard }: { expected: readonly string[]; heard: readonly string[] }): number[][] {
  // Row 0 and column 0 are the cost of inserting or dropping everything so far; the rest is overwritten below.
  const cost: number[][] = Array.from({ length: expected.length + 1 }, (_row, i) =>
    Array.from({ length: heard.length + 1 }, (_column, j) => i + j),
  );
  for (let i = 1; i <= expected.length; i += 1) {
    for (let j = 1; j <= heard.length; j += 1) {
      const same = expected[i - 1] === heard[j - 1] ? 0 : 1;
      cost[i]![j] = Math.min(cost[i - 1]![j - 1]! + same, cost[i - 1]![j]! + 1, cost[i]![j - 1]! + 1);
    }
  }
  return cost;
}

/** The one alignment step that reached cell `(i, j)`, preferring a match or substitution, then a deletion. */
function backStep({
  cost,
  expected,
  heard,
  i,
  j,
}: {
  cost: readonly (readonly number[])[];
  expected: readonly string[];
  heard: readonly string[];
  i: number;
  j: number;
}): AlignOp {
  const here = cost[i]![j]!;
  const both = i > 0 && j > 0;
  const same = both && expected[i - 1] === heard[j - 1];
  if (both && here === cost[i - 1]![j - 1]! + (same ? 0 : 1)) {
    return { at: i - 1, heard: heard[j - 1]!, op: same ? "kept" : "sub" };
  }
  if (i > 0 && here === cost[i - 1]![j]! + 1) {
    return { at: i - 1, op: "del" };
  }
  return { at: i - 1, heard: heard[j - 1]!, op: "ins" };
}

/** One utterance's running tally while the alignment is charged. */
interface Tally {
  readonly fates: WordFate[];
  readonly heard: string[];
  insertions: number;
  insertedBefore: boolean;
  insertedAfter: boolean;
}

/**
 * Score a call's transcript against the script its microphone spoke.
 *
 * @param script the utterances, in the order spoken
 * @param heard the owner's transcript's texts, in the order they began — final segments, or the raw fragments a relay carries
 * @returns each utterance's score and the call's rate
 */
export function scoreTranscriptFidelity({
  script,
  heard,
}: {
  script: readonly ScriptedUtterance[];
  heard: readonly string[];
}): TranscriptFidelity {
  const lines = script.map((line) => ({ line, words: fidelityWords({ text: line.words }) }));
  const owner: { readonly index: number; readonly position: number }[] = lines.flatMap(({ words }, index) =>
    words.map((_, position) => ({ index, position })),
  );
  const expected = lines.flatMap(({ words }) => words);
  const tallies: Tally[] = lines.map(() => ({
    fates: [],
    heard: [],
    insertedAfter: false,
    insertedBefore: false,
    insertions: 0,
  }));
  for (const step of align({ expected, heard: heardWordsOf({ heard }) })) {
    chargeStep({ lines, owner, step, tallies });
  }
  const utterances = lines.map(({ line, words }, index) => utteranceOf({ line, tally: tallies[index]!, words }));
  const errors = utterances.reduce((sum, one) => sum + one.substitutions + one.deletions + one.insertions, 0);
  return {
    misheard: utterances.filter((one) => one.criticalLost.length > 0).length,
    total: utterances.length,
    utterances,
    wer: expected.length === 0 ? 0 : errors / expected.length,
  };
}

/** Every heard text's words, in order. */
function heardWordsOf({ heard }: { heard: readonly string[] }): readonly string[] {
  return heard.flatMap((text) => fidelityWords({ text }));
}

/** Charge one alignment step to the utterance it falls in. An insertion before any scripted word is the first's. */
function chargeStep({
  lines,
  owner,
  step,
  tallies,
}: {
  lines: readonly { readonly words: readonly string[] }[];
  owner: readonly { readonly index: number; readonly position: number }[];
  step: AlignOp;
  tallies: Tally[];
}): void {
  const place = owner[Math.max(step.at, 0)];
  if (place === undefined) {
    return;
  }
  const tally = tallies[place.index]!;
  if (step.op === "del") {
    tally.fates.push("del");
    return;
  }
  tally.heard.push(step.heard);
  if (step.op !== "ins") {
    tally.fates.push(step.op);
    return;
  }
  tally.insertions += 1;
  if (step.at < 0) {
    tally.insertedBefore = true;
  } else if (place.position === lines[place.index]!.words.length - 1) {
    tally.insertedAfter = true;
  }
}

/** One utterance's score from its tally. */
function utteranceOf({
  line,
  words,
  tally,
}: {
  line: ScriptedUtterance;
  words: readonly string[];
  tally: Tally;
}): UtteranceFidelity {
  const lost = ({ position }: { position: number }): boolean => tally.fates[position] !== "kept";
  const positions = words.map((_, position) => position);
  const criticalLost = positions
    .filter((position) => lost({ position }) && line.critical.includes(words[position]!))
    .map((position) => words[position]!);
  return {
    criticalLost,
    deletions: tally.fates.filter((fate) => fate === "del").length,
    endWrong:
      tally.insertedAfter || positions.some((position) => position >= words.length - EDGE_WORDS && lost({ position })),
    expected: words,
    heard: tally.heard,
    id: line.id,
    insertions: tally.insertions,
    missing: words.length > 0 && tally.fates.every((fate) => fate === "del") && tally.heard.length === 0,
    startWrong: tally.insertedBefore || positions.some((position) => position < EDGE_WORDS && lost({ position })),
    substitutions: tally.fates.filter((fate) => fate === "sub").length,
  };
}
