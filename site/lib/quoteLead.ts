/**
 * The line of the owner's words a folded quote leads with: the stretch of their turn that names what the card acts
 * on, with the speech noise taken out, rather than whatever they happened to say first. A prominent quote is chosen so
 * the owner can understand at a glance what they were thinking about when they decided whatever led to the card.
 *
 * The fold would otherwise show the turn's OPENING sentences (`./queueCard.ts` `foldedText`), and a spoken turn opens on
 * filler: every `...` a transcript writes for a pause ended a "sentence", so the four it showed were usually noise.
 *
 * ## What the lead is, and what it is not
 *
 * It is a READING AID, never the record. The quote a row stores stays verbatim (`src/handover/hisWords.ts`) and is
 * drawn whole one click away, under a toggle that says so (`../components/console/SourceBlock.tsx`). The lead only
 * ever DROPS: a transcript annotation (`[breath]`, `[Image #3]`), and in a SPOKEN record a filler (`uh`, `um`), a
 * stutter or false start (`o-our`, `dependen- if`), a pause, a doubled word, a discourse opener (`so`, `yeah`,
 * `anyway`) — never a real word that looks like one (`re-record`, `ER`, `do you know`, `didn't-`). It never adds a word, never changes a letter's case, and every word it keeps is one the owner said, in their
 * order. A typed record is the owner's writing, so only its annotations go.
 *
 * ## How the stretch is picked
 *
 * A turn is cut into sentences at a real terminator only — an ellipsis is a pause, not an end — and each sentence
 * into clauses at its pauses. Every run of whole clauses inside one sentence, of {@link LEAD_MIN_WORDS} to
 * {@link LEAD_MAX_WORDS} words once cleaned and holding at least {@link LEAD_MIN_CONTENT} content words, is a
 * candidate. It scores two for each content word it shares with what the card is ABOUT (its row's summary, question
 * and slug), three for decision phrasing (`I want`, `I'd like`, `let's`, `we should`), and one each for starting and
 * ending where the owner's sentence does. The highest wins; a tie goes to the earliest, then the longest.
 *
 * Four things are never a lead, because each would put words in the owner's mouth: a stretch the owner is READING aloud or quoting
 * (after "it says", "the card said" or "Auditco said", or inside quote marks, until a sentence opens on the owner's own stance
 * — "I think", "I'm not sure" — since the card's own text read back matches the card best of all, and says "I'll",
 * "I'd" and "we should" itself; and in any turn where the owner reads aloud at all — "continuing reading", "let me see", "is
 * it saying", "you're saying", a bare "says,", a typed `>` line — every stretch but ONE clause of their stance opening
 * its sentence, because read-back and reaction then interleave across pauses with no cue between them, and the text
 * read aloud says "And I think" too); a stretch that leaves a condition or turn behind ANYWHERE
 * around it — a later clause
 * of its sentence (`once CI is green`, `but`), an earlier one opening a condition it sits inside (`If nobody objects...
 * and staging is healthy...`), the next sentence (`Unless …`, `Not tonight though.`, `No.`), the one before (`If the
 * auditor signs off.`), or a bare condition of its own whose answer comes after; a stretch running through a thought
 * the owner broke off and restarted (`by... if we... Like, I think`); and a stretch taken back by the next sentence that
 * carries a thought (`Wait a second. Actually no.`), or by a later one naming it. No candidate means no lead, and the
 * fold shows its opening exactly as before.
 *
 * Pure: strings in, a value out.
 */
import type { HisWordsCut, HisWordsWhere } from "../components/live/readHisWords";
import {
  ANSWERED_CONDITION,
  ANTECEDENT,
  type Clause,
  CONDITION,
  CORRECTION,
  contentStems,
  DANGLING,
  DECISION,
  HANGING,
  LEADING_CONJUNCTION,
  NARROWING,
  OPENER,
  OWN_STANCE,
  READING_TURN,
  REVERSAL,
  SPOKEN,
  speechSentences,
  TURN,
  tokens,
} from "./quoteLeadSpeech";

/** The fewest words a lead carries — under this a stretch is an interjection, not a thought. */
export const LEAD_MIN_WORDS = 5;

/**
 * The most words a lead carries. A spoken sentence can run a paragraph with no full stop in it, so the lead is a run
 * of clauses within it bounded here; the cut edges are marked, and the whole turn is one click away. Fifty holds the
 * test tidy turn's whole "appends that package to the ignore list in the tidy dot yaml" thought, and stays under
 * the sixty words the fold's opening was allowed (`./queueCard.ts` `WHAT_MAX_WORDS`).
 */
export const LEAD_MAX_WORDS = 50;

/** The fewest distinct content words a lead carries, so "hold on a sec, hold on" is never one. */
export const LEAD_MIN_CONTENT = 3;

/** The stretch a folded quote leads with, and whether more of the owner's words stand either side of it. */
export interface QuoteLead {
  readonly text: string;
  /** `true` when the record holds more of the owner's words before the lead — the block draws its cut mark there. */
  readonly moreBefore: boolean;
  /** `true` when the record holds more of the owner's words after the lead. */
  readonly moreAfter: boolean;
}

/** A scored candidate, placed so ties resolve to the earliest, then the longest. */
interface Candidate {
  readonly text: string;
  /** Whether the owner's sentence began before the stretch does. */
  readonly opensWithin: boolean;
  /** Whether the owner's sentence runs on after the stretch, or a word left hanging was dropped from its end. */
  readonly endsWithin: boolean;
  readonly score: number;
  readonly sentence: number;
  readonly start: number;
  readonly words: number;
  readonly stems: ReadonlySet<string>;
  /** How many of the owner's clauses the stretch runs across — more than one means it crosses a pause. */
  readonly clauses: number;
  /** Its first clause as the owner said it, before any opener is dropped — so a stretch opening behind "And" can tell. */
  readonly head: string;
}

/** A run of clauses as one line — joined, its opener and any word left hanging dropped — and whether that cut it. */
function asLine({ clauses }: { clauses: readonly Clause[] }): { readonly line: string; readonly trimmed: boolean } {
  const joined = clauses
    .map((clause) => clause.text)
    .join(" ")
    .replace(/\s+([,.!?;:])/gu, "$1")
    .replace(OPENER, "")
    .replace(/^[\s,.;:!?-]+/u, "");
  const line = joined.replace(DANGLING, "");
  return { line, trimmed: line.length < joined.length };
}

/**
 * Whether the owner broke a clause off and started afresh: it ends hanging, and the next opens on a capital that is not "I"
 * (always a capital, so never the sign alone) or the clause ends on a subject and the next opens on another ("if
 * we... I think").
 */
function restartsAfter({ clause, next }: { clause: Clause; next: Clause }): boolean {
  if (!HANGING.test(clause.text)) {
    return false;
  }
  const twoSubjects =
    /(?:^|\s)(?:we|i|you|they|it)$/iu.test(clause.text) && /^(?:i|we|you|they|it)\b/iu.test(next.text);
  return twoSubjects || /^(?!I\b|I')\p{Lu}/u.test(next.text);
}

/** How many of one set's stems another holds. */
function sharedCount({ stems, about }: { stems: ReadonlySet<string>; about: ReadonlySet<string> }): number {
  let shared = 0;
  for (const stem of stems) {
    if (about.has(stem)) {
      shared += 1;
    }
  }
  return shared;
}

/**
 * Every stretch of one sentence a lead could be, scored. A sentence the record cut keeps its cut clause out of every
 * stretch — it may end mid-word — and never scores as starting or ending where the owner did.
 */
function candidatesOf({
  clauses,
  sentence,
  headCut,
  tailCut,
  about,
}: {
  clauses: readonly Clause[];
  sentence: number;
  headCut: boolean;
  tailCut: boolean;
  about: ReadonlySet<string>;
}): readonly Candidate[] {
  const out: Candidate[] = [];
  let first = 0;
  if (headCut) {
    first = 1;
  }
  let last = clauses.length - 1;
  if (tailCut) {
    last -= 1;
  }
  const openings = clauses.map((clause) => clause.text.replace(OPENER, ""));
  // A short clause left hanging before a fresh capitalised start is a thought the owner dropped and restarted ("by... if
  // we... Like, I think that if we have"): no stretch runs through it, ends on it, or is governed by it.
  const dropped = clauses.map((clause, index) => {
    const hasNext = index + 1 < clauses.length;
    const answered = ANSWERED_CONDITION.test(openings[index]);
    return hasNext && clause.words <= 3 && !answered && restartsAfter({ clause, next: clauses[index + 1] });
  });
  // The last clause of the sentence that turns or conditions what precedes it: no stretch ends before it.
  const lastTurn = openings.findLastIndex((opening) => TURN.test(opening) || CONDITION.test(opening));
  for (let start = first; start <= last; start += 1) {
    // A stretch inside a condition the owner opened earlier in the sentence states as fact what they made conditional.
    const governed = openings
      .slice(0, start)
      .some((opening, index) => !dropped[index] && ANTECEDENT.test(opening.replace(LEADING_CONJUNCTION, "")));
    if (governed) {
      continue;
    }
    let count = 0;
    for (let end = start; end <= last; end += 1) {
      const clause = clauses[end];
      count += clause.words;
      if (!clause.ownVoice || count > LEAD_MAX_WORDS || dropped[end]) {
        break;
      }
      if (end < lastTurn) {
        continue;
      }
      const { line, trimmed } = asLine({ clauses: clauses.slice(start, end + 1) });
      const opensWithin = start > 0 || headCut;
      const endsWithin = end + 1 < clauses.length || trimmed || tailCut;
      const words = tokens({ text: line }).length;
      const stems = contentStems({ text: line });
      if (words < LEAD_MIN_WORDS || stems.size < LEAD_MIN_CONTENT) {
        continue;
      }
      let score = sharedCount({ about, stems }) * 2;
      if (DECISION.test(line)) {
        score += 3;
      }
      if (!opensWithin) {
        score += 1;
      }
      if (!endsWithin) {
        score += 1;
      }
      out.push({
        clauses: end - start + 1,
        endsWithin,
        head: clauses[start].text,
        opensWithin,
        score,
        sentence,
        start,
        stems,
        text: line,
        words,
      });
    }
  }
  return out;
}

/**
 * The stretch of the owner's words a folded quote leads with: the one that best names what the card is about, cleaned
 * of speech noise.
 *
 * @param words the owner's words, verbatim as the record holds them
 * @param subject what the card acts on — its row's summary, question and slug — or `undefined` when nothing names
 *   it, which leaves decision phrasing and sentence shape to pick
 * @param where which kind of record the words were read off; only speech has its disfluencies dropped
 * @param cut where the record is known short of what the owner said — its first or last sentence is then a fragment
 * @returns the lead, or `undefined` when no stretch carries enough of a thought to lead with
 */
export function quoteLead({
  words,
  subject,
  where,
  cut,
}: {
  words: string;
  subject: string | undefined;
  where: HisWordsWhere;
  cut: HisWordsCut;
}): QuoteLead | undefined {
  let about: ReadonlySet<string> = new Set<string>();
  if (subject !== undefined) {
    about = contentStems({ text: subject });
  }
  const spoken = SPOKEN.has(where);
  const sentences = speechSentences({ spoken, text: words });
  // A transcript capitalises a sentence's start, so one that opens on a lower-case letter or a stray mark began
  // mid-sentence — a call stretch cut where the segment was — and its first clause is a fragment ("ngs... I just
  // built"), exactly as a record that says it kept only the tail. Typed words are exempt: they are typed lower case.
  const headCut = cut === "start" || (spoken && !/^\s*(?:["'“(]?[\p{Lu}\p{N}]|\[|<)/u.test(words));
  const candidates = sentences.flatMap((clauses, sentence) =>
    candidatesOf({
      about,
      clauses,
      headCut: headCut && sentence === 0,
      sentence,
      tailCut: cut === "end" && sentence === sentences.length - 1,
    }),
  );
  const ranked = candidates.toSorted(
    (one, other) =>
      other.score - one.score || one.sentence - other.sentence || one.start - other.start || other.words - one.words,
  );
  const readingTurn = READING_TURN.test(words);
  const taken = ranked.find((candidate) => {
    // A turn where the owner reads aloud admits one clause of their stance opening its sentence and nothing more: read text
    // and reaction run together across a pause, and text read aloud says "And I think" too.
    const reaction =
      OWN_STANCE.test(candidate.text) &&
      !/^and\b/iu.test(candidate.head) &&
      !candidate.opensWithin &&
      candidate.clauses === 1;
    const admitted = !readingTurn || reaction;
    return admitted && !takenBack({ candidate, sentences }) && !conditioned({ candidate, sentences });
  });
  if (taken === undefined) {
    return undefined;
  }
  return {
    moreAfter: taken.endsWithin || taken.sentence < sentences.length - 1,
    moreBefore: taken.opensWithin || taken.sentence > 0,
    text: taken.text,
  };
}

/**
 * Whether a later sentence takes a candidate back: the next one with a word of content saying so ("Never mind. Leave
 * it.", "Wait. Actually no, keep it."), or any later one saying so about two of its content words.
 */
function takenBack({
  candidate,
  sentences,
}: {
  candidate: Candidate;
  sentences: readonly (readonly Clause[])[];
}): boolean {
  let between = 0;
  for (const clauses of sentences.slice(candidate.sentence + 1)) {
    const text = clauses.map((clause) => clause.text).join(" ");
    if (REVERSAL.test(text) || CORRECTION.test(text)) {
      if (between <= 2 || sharedCount({ about: contentStems({ text }), stems: candidate.stems }) >= 2) {
        return true;
      }
    }
    // Only a sentence that could carry a thought of its own stands between — "Wait a second." does not — and one such
    // sentence is still close enough for a retraction to reach back over ("Nobody reads it. Actually no, keep it.").
    if (contentStems({ text }).size >= LEAD_MIN_CONTENT) {
      between += 1;
    }
  }
  return false;
}

/** The nearest sentence before or after one that carries any content word — "Okay." and "Hmm." are passed over. */
function neighbour({
  sentences,
  from,
  step,
}: {
  sentences: readonly (readonly Clause[])[];
  from: number;
  step: 1 | -1;
}): readonly Clause[] | undefined {
  for (let index = from + step; index >= 0 && index < sentences.length; index += step) {
    const clauses = sentences[index];
    if (contentStems({ text: clauses.map((clause) => clause.text).join(" ") }).size > 0) {
      return clauses;
    }
  }
  return undefined;
}

/**
 * Whether the sentences either side condition the candidate's: the next opening on a condition or turn of it
 * ("Unless …", "Not tonight though."), or the one before being a bare condition it answers ("If the auditor signs
 * off.").
 */
function conditioned({
  candidate,
  sentences,
}: {
  candidate: Candidate;
  sentences: readonly (readonly Clause[])[];
}): boolean {
  const next = neighbour({ from: candidate.sentence, sentences, step: 1 });
  const previous = neighbour({ from: candidate.sentence, sentences, step: -1 });
  // The very next sentence turns it even with no content of its own ("No."); a condition may sit past an "Okay.".
  const turning = [sentences[candidate.sentence + 1], next].map((clauses) => clauses?.[0]!.text.replace(OPENER, ""));
  const nextTurns = turning.some(
    (opening) => opening !== undefined && (CONDITION.test(opening) || TURN.test(opening) || NARROWING.test(opening)),
  );
  const previousOpening = previous?.[0]!.text.replace(OPENER, "").replace(LEADING_CONJUNCTION, "");
  const previousConditions = previousOpening !== undefined && ANTECEDENT.test(previousOpening);
  // A stretch opening on a condition, with a sentence of substance after it, may be a bare condition whose answer is
  // that next sentence ("If the auditor signs off. Merge it.").
  const opening = candidate.text.replace(LEADING_CONJUNCTION, "");
  const bareCondition = ANTECEDENT.test(opening) && (candidate.endsWithin || next !== undefined);
  // "If so" answers a question before it, which the stretch leaves behind.
  const answersBack = /^(?:if|unless) (?:so|not|yes|no)\b/iu.test(opening);
  return nextTurns || previousConditions || bareCondition || answersBack;
}
