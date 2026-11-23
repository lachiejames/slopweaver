/**
 * What `draft-read-back` reads off the live rows: the owner's dictated turn and the voice's answer, on THIS call only.
 *
 * A live voice window opens over carried conversation history. That history is never a row here, however late it
 * renders: the page draws it as `earlier:` rows and the leg reads only `./e2eCallRows.ts`'s `E2E_LIVE_ROWS`, the `live:` ones.
 * Any live row already on screen when the call goes live is the baseline, and only rows past
 * it count, so an owner turn and a voice row after it standing at go-live never pass the scenario before the dictated
 * prompt is heard. The owner's turn must carry {@link DRAFT_TURN_WORD}, which the prompt says
 * twice.
 *
 * The voice's answer must carry the draft itself, never merely follow the owner's turn. MEASURED: a call that heard
 * the prompt only from "And, and, yeah, there's no rush" on passed the leg with no draft ever written, because the
 * thinking model wrote "There's no draft open … Which draft do you mean?" and the voice said "Yep,
 * I'll match your voice." then "Quick check, which draft are we editing?", a voice row after a turn carrying "draft".
 * Repro: the `segment` and `wrote` lines of `$SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
 *
 * So the read-back is judged on ONE exchange and on the draft's own words: the voice's
 * rows after the owner's LAST turn, which must be the dictated one, and inside them only a quoted draft body
 * ({@link quotedDraftBodies}), one of which must be draft-sized and carry every one of {@link DRAFT_READ_BACK_WORDS}
 * ({@link readsBackTheDraft}). A clarification naming those words ("is there any rush on the test?") quotes no draft,
 * and words spread over two exchanges are never joined. Never the thinking model's `wrote` answer: the voice may draft
 * two lines itself, a correct read-back with no `wrote` line at all.
 */
import type { E2eRow } from "./e2eCallRows.js";

/** The `who` an owner row carries: the stored value the live rows still spell, read here in one place. */
export const OWNER_SPEAKER: E2eRow["who"] = "owner";

/** The word the owner's dictated turn must carry: `DRAFT_READ_BACK_PROMPT` says it twice. */
export const DRAFT_TURN_WORD = "draft";

/**
 * The words the read-back's quoted draft must carry: `DRAFT_READ_BACK_PROMPT` asks for them by name, so a faithful
 * draft says both, never a paraphrase of them. "test" is said only in the prompt's
 * opening, before ", and, yeah,", so a hearing that lost the opening cannot carry it.
 */
export const DRAFT_READ_BACK_WORDS: readonly string[] = ["test", "rush"];

/**
 * What continues a word: a letter, digit, combining mark, invisible format character (a U+200D zero-width joiner
 * inside "testing") or underscore, of any script. `\b` alone is ASCII.
 */
const WORD_PART = String.raw`[\p{L}\p{N}\p{M}\p{Cf}_]`;

/**
 * `phrase` as whole words, nothing that continues a word either side.
 *
 * @param phrase the pattern source to bound
 * @returns the bounded pattern source
 */
function bounded({ phrase }: { phrase: string }): string {
  return `(?<!${WORD_PART})${phrase}(?!${WORD_PART})`;
}

/**
 * The frame the thinking model is told to put round a draft read aloud ("The draft says: … That's the draft.",
 * `src/talk/quotedDraftLines.ts`'s `QUOTED_DRAFT_BACKEND_LINES`): what lies between its opening and its close is the
 * body. Only that protocol opens one: "The draft says:" starting a sentence, colon and all, and closed by "That's the
 * draft", so "tell me what the draft says, and I'll make sure the test …" is no frame,
 * "Bathe draft says" opens none, and the close ends its own sentence, so
 * neither "That's the drafter's" nor "That's the draft's requirement"
 * closes one. Two cheap checks, an opening then the first close after it, never one pattern spanning both: a lazy
 * body between two runs of spaces backtracks polynomially (`redos-check`).
 */
const DRAFT_SAYS_OPEN = /(?<=^|[.!:]\s*)the draft says:/giu;

/** The close of {@link DRAFT_SAYS_OPEN}'s frame: "That's the draft", ending its own sentence. */
const DRAFT_SAYS_CLOSE = /that['’]s the draft(?=\s*(?:[.!]|$))/iu;

/**
 * The body of the first "The draft says: … That's the draft" frame in `text`, trimmed: what lies between an opening
 * and the first close after it.
 *
 * @param text the voice's words with every quoted span cut out
 * @returns the body, or `undefined` when no opening is closed
 */
function framedDraftBody({ text }: { text: string }): string | undefined {
  for (const open of text.matchAll(DRAFT_SAYS_OPEN)) {
    const rest = text.slice(open.index + open[0].length);
    const close = DRAFT_SAYS_CLOSE.exec(rest);
    if (close !== null) {
      return rest.slice(0, close.index).trim();
    }
  }
  return undefined;
}

/** A span in straight or curly double quotes: the voice quoting a draft it wrote itself ("here's a two-liner: "…""). */
const QUOTED_SPAN = /["“]([^"“”]+)["”]/gu;

/**
 * What a quoted span is cut to before the frame is read: U+FFFC, neither a space nor a word part, so a cut never
 * spells the frame's own spaces ("The"junk"draft says" opens no frame) nor joins two
 * words. Built from its code point, never typed, so no editor can swap it.
 */
const QUOTE_CUT = String.fromCodePoint(0xfffc);

/**
 * The fewest words a read-back body holds to be a draft rather than the ask's own phrase quoted back. The asked
 * message is two lines; "you want the phrase "test and no rush" included" quotes four words and no draft. A real
 * read-back holds fifteen.
 */
export const MIN_DRAFT_WORDS = 8;

/** A word for {@link MIN_DRAFT_WORDS}: letters or digits of any script, an inner apostrophe kept ("there's"). */
const COUNTED_WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/**
 * A question mark of any script (ASCII, full-width, Arabic, Greek, reversed) anywhere in a body: a question put to the
 * owner, never the asked draft, which says the test ran, even with a sentence after it. Escaped, because U+037E is a
 * canonical equivalent of the ASCII semicolon and an editor's normalisation can silently swap them; a semicolon is no
 * question.
 */
const HOLDS_A_QUESTION = /[?\u{FF1F}\u{061F}\u{037E}\u{2E2E}]/u;

/** A body closing its own sentence: its last mark a full stop or an exclamation, of any script. */
const ENDS_ITS_SENTENCE = /[.!\u{3002}\u{FF01}]\s*$/u;

/**
 * Text after a quote that starts a new sentence: nothing, a capital or another quote. Anything else continues the
 * sentence round the quote, so the quote's own full stop ends nothing ("do you want me to say "The test completed
 * successfully and there is no rush." in the message?").
 */
const STARTS_A_NEW_SENTENCE = /^\s*(?:$|[\p{Lu}\p{Lt}"“])/u;

/**
 * A sentence break: a full stop or exclamation followed by a new sentence ({@link STARTS_A_NEW_SENTENCE}), so the stop
 * in an abbreviation ("e.g. for the team?") breaks nothing.
 */
const SENTENCE_BREAK = String.raw`[.!\u{3002}\u{FF01}](?:\s+[\p{Lu}\p{Lt}"“]|\s*$)`;

/**
 * Text after a quote whose sentence ends on a question before any sentence break: the quote sits inside a question
 * ("you asked me to "draft a two line Slack message with the words test and no rush in it"; is that right?").
 */
const QUESTION_ENDS_THE_SENTENCE = new RegExp(
  String.raw`^(?:(?!${SENTENCE_BREAK}).)*?[?\u{FF1F}\u{061F}\u{037E}\u{2E2E}]`,
  "su",
);

/**
 * A question mark straight after a closing quote: it closes the sentence round the quote, whatever the quote ends on
 * ("Did you mean, "The test is complete and there is no rush on review."?").
 */
const QUESTION_RIGHT_AFTER = /^\s*[?\u{FF1F}\u{061F}\u{037E}\u{2E2E}]/u;

/**
 * The draft bodies a voice answer quotes: every double-quoted span, then what follows a "the draft says" frame in the
 * words OUTSIDE those spans, less any holding a question or quoted inside one. A quoted clarification ("please clarify:
 * "Is there no rush on the test?"") is no draft. Beyond that the leg reads the SHAPE of
 * a quoted draft, never its meaning, so three shapes pass on words that are no draft: a quoted sentence of
 * {@link MIN_DRAFT_WORDS} or more words carrying both words and no question, whatever its mood;
 * such words inside the "The draft says: … That's the draft." frame; and
 * such a quote closing its own sentence before a question of its own ("Which wording did you mean: "…". Or something
 * else?"), which by punctuation is the real read-back "Here's a draft: "…". Want it
 * tweaked?", an abbreviation's stop read as that close included ("…in the U.S." Or Australia?"). Whether it is the
 * draft the owner asked for is read off the call file afterwards.
 *
 * Every rule here leans to a red leg over a green one, because a red leg is seen and run again while a false green is
 * a witness nobody re-reads. So three genuine read-backs fail, stated rather than fixed: a draft holding a question,
 * a draft under {@link MIN_DRAFT_WORDS} words, and a framed draft quoting one of its own words.
 *
 * @param text the voice's words in one exchange
 * @returns each body, in order; none when it quotes no draft
 */
export function quotedDraftBodies({ text }: { text: string }): readonly string[] {
  // A quote not closing its own sentence belongs to the sentence round it, so a question there is the quote's too.
  const quoted = [...text.matchAll(QUOTED_SPAN)]
    .filter((match) => {
      const after = text.slice(match.index + match[0].length);
      const closesItsOwnSentence = ENDS_ITS_SENTENCE.test(match[1]!) && STARTS_A_NEW_SENTENCE.test(after);
      return !QUESTION_RIGHT_AFTER.test(after) && (closesItsOwnSentence || !QUESTION_ENDS_THE_SENTENCE.test(after));
    })
    .map((match) => match[1]!);
  // The frame is read with every quoted span cut out: so a quoted word elsewhere never hides a framed draft, a frame
  // never joins two quoted words, and a frame inside a quoted question stays that question.
  const framed = framedDraftBody({ text: text.replace(QUOTED_SPAN, QUOTE_CUT) });
  const bodies = framed === undefined ? quoted : [...quoted, framed];
  return bodies.filter((body) => !HOLDS_A_QUESTION.test(body));
}

/**
 * A word as a whole word in any case, nothing that continues a word either side ({@link WORD_PART}), so neither
 * "redrafting" nor "drafté" is "draft".
 *
 * @param word the word to match
 * @returns the pattern
 */
function wholeWord({ word }: { word: string }): RegExp {
  return new RegExp(bounded({ phrase: word }), "iu");
}

const DRAFT_TURN_PATTERN = wholeWord({ word: DRAFT_TURN_WORD });

const READ_BACK_PATTERNS = DRAFT_READ_BACK_WORDS.map((word) => wholeWord({ word }));

/**
 * Whether one body is a draft read back: at least {@link MIN_DRAFT_WORDS} words, carrying every one of
 * {@link DRAFT_READ_BACK_WORDS}.
 *
 * @param body one body {@link quotedDraftBodies} returned
 * @returns whether it reads back the asked draft
 */
export function readsBackTheDraft({ body }: { body: string }): boolean {
  const words = body.match(COUNTED_WORD);
  return words !== null && words.length >= MIN_DRAFT_WORDS && READ_BACK_PATTERNS.every((pattern) => pattern.test(body));
}

/**
 * The rows on screen now that arrived after go-live. The page keeps a rolling window of its last rows
 * (`site/lib/voiceTranscript.ts`'s `SHOWN_SEGMENTS`), so a new row may push the oldest baseline rows off the top and a
 * count of the baseline would slice the new rows away. What still stands of the
 * baseline is the longest tail of it that the rows now open with; everything past that tail arrived after go-live.
 * Taking the LONGEST tail counts the fewest rows new, so a standing row is never new, and new rows repeating the
 * baseline's tail at exactly that seam, even a whole baseline's worth that rolled the baseline off, are taken as
 * standing: that fails the leg rather than passing it. Only the page's row ids could
 * tell them apart, and the rows read carry none.
 *
 * @param baseline the live rows on screen when the call went live
 * @param rows the rows on screen now
 * @returns the rows past what still stands of the baseline
 */
export function rowsAfterBaseline({
  baseline,
  rows,
}: {
  baseline: readonly E2eRow[];
  rows: readonly E2eRow[];
}): readonly E2eRow[] {
  for (let kept = Math.min(baseline.length, rows.length); kept > 0; kept -= 1) {
    const tail = baseline.slice(baseline.length - kept);
    if (tail.every((row, at) => row.who === rows[at]!.who && row.text === rows[at]!.text)) {
      return rows.slice(kept);
    }
  }
  return rows;
}

/**
 * The owner's dictated turn and the voice's read-back after it, among the rows that arrived after go-live: the voice's
 * rows after the owner's LAST turn, that turn the dictated one, quoting ONE draft body {@link readsBackTheDraft}
 * accepts. A later owner turn starts a new exchange, so the read-back is never assembled from
 * two.
 *
 * @param baseline the live rows on screen when the call went live
 * @param rows the rows on screen now
 * @returns the owner's turn, and whether the voice read the draft back after it
 */
export function draftTurnAndAnswer({ baseline, rows }: { baseline: readonly E2eRow[]; rows: readonly E2eRow[] }): {
  readonly ownerTurn: boolean;
  readonly voiceAnswer: boolean;
} {
  const fresh = rowsAfterBaseline({ baseline, rows });
  const ownerTurn = fresh.some((row) => row.who === OWNER_SPEAKER && DRAFT_TURN_PATTERN.test(row.text));
  const last = fresh.findLastIndex((row) => row.who === OWNER_SPEAKER);
  if (!ownerTurn || !DRAFT_TURN_PATTERN.test(fresh[last]!.text)) {
    return { ownerTurn, voiceAnswer: false };
  }
  const exchange = fresh
    .slice(last + 1)
    .map((row) => row.text)
    .join(" ");
  // One body carries both: two quoted words, "test" and "rush", are not a draft.
  const readBack = quotedDraftBodies({ text: exchange }).some((body) => readsBackTheDraft({ body }));
  return { ownerTurn, voiceAnswer: readBack };
}
