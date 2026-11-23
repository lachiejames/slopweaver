/**
 * The paragraph that asks ends on its ask: the `trailing` rule of the earns-its-place gate (`./draftEarnsItsPlace.ts`).
 *
 * A draft to a colleague put one more sentence after "Are you already chasing any of these up?" when the owner
 * wanted the message to end on that question. A draft that runs a little too long at the end is a separate defect,
 * and the word cap already refuses it.
 *
 * **The criterion, falsifiable on purpose.** An ASK is a sentence ending in `?` that addresses the reader: it carries
 * a second-person word (`you`, `your`, `yours`, `yourself`, `yourselves`, contractions included) or a mention of a
 * person, a group or the room. Once a paragraph has asked, any later sentence in that SAME paragraph carrying a word
 * is a trailing restatement. Two tails are not: "no rush", the close wanted on a one-person ask, and bare emoji
 * shortcodes.
 *
 * **What it deliberately does not do.** A later PARAGRAPH is never a tail: the cut the owner kept
 * asks in its second paragraph and gives the key's provenance in a third. A question that does not address the
 * reader is not an ask: the cut the owner approved of the growth-ops reply poses
 * "would they have pinged when needed …?" as the check to run, then says what follows it. An impersonal ask ("can the
 * team take this?") with no mention is missed rather than guessed at: a miss is the state before this rule, a false
 * read costs a reword.
 *
 * Sentences split at `.`, `!` or `?`, past any closing quote, bracket or emphasis mark, followed by whitespace; and a
 * `?` or `!` ends its sentence whatever follows it, so `1.5` never splits and `this?2 issues remain.` always does. The
 * one `?` that continues its word is a bare URL's query (`https://example.com/a?b=1`); a `?` in a link's target or a
 * code run never reaches here, because a link, a code run and somebody else's quoted words are one opaque word each:
 * they can trail an ask, and they can never make one.
 *
 * Pure: no network, no clock, no filesystem.
 */
import type { DripInlineRun } from "../artifact/types.js";

/** A mention of a person, a group or the room, as one token a sentence can carry. */
const ADDRESS = "\u0001";

/** A link, a code run or quoted words: one word nobody authored here, never punctuation. */
const OPAQUE = "\u0002";

/** A sentence that ends on a question mark, past any closing quote, bracket or mrkdwn emphasis. */
const ENDS_ON_QUESTION = /\?+["'”’)\]*_~]*$/u;

/**
 * Where one sentence ends and the next begins with a space: whitespace after `.`, `!` or `?` and any closing quote,
 * bracket or mrkdwn emphasis, so `"Can you review this?" I added context.` is two sentences, as ENDS_ON_QUESTION reads
 * them. A `.` always needs the whitespace (`1.5`, `file.ts`).
 */
const SENTENCE_BREAK = /(?<=[.!?]["'”’)\]*_~]*)\s+/u;

/**
 * Where a `?` or `!` ends its sentence with no space: past the marks and any closing quote, bracket or emphasis
 * mark, before whatever comes next — a letter, a digit, an emoji, a shortcode, an opening bracket (every
 * glued case is one class) — unless the word it sits in is a bare URL, whose query it is ({@link gluedSentencesOf}).
 */
const GLUED = /(?<=[!?]["'”’)\]*_~]*)(?=[^\s!?"'”’)\]*_~])/u;

/** A word that is a bare URL: a scheme's `://`, or a leading `www.`. */
const BARE_URL = /:\/\/|^www\./iu;

/**
 * One sentence split again at every glued `?` or `!`, the pieces of a bare URL's query joined back up.
 *
 * @returns the sentences, in order
 */
function gluedSentencesOf({ sentence }: { sentence: string }): readonly string[] {
  const pieces: string[] = [];
  for (const piece of sentence.split(GLUED)) {
    const before = pieces.at(-1);
    const word = before?.slice(before.search(/\S*$/u));
    if (word !== undefined && BARE_URL.test(word)) {
      pieces[pieces.length - 1] = `${before}${piece}`;
    } else {
      pieces.push(piece);
    }
  }
  return pieces;
}

/** A second-person word: the reader is being spoken to. `\b` holds at an apostrophe, so `you’re` matches. */
const SECOND_PERSON = /\byou(?:rs?|rself|rselves)?\b/iu;

/** A word-bearing token: a letter or digit, or an opaque or address token. */
const WORD_BEARING = new RegExp(`[\\p{L}\\p{N}${ADDRESS}${OPAQUE}]`, "u");

/** The tails that never count: "no rush", and bare `:emoji:` shortcodes. */
const ALLOWED_TAIL = /\bno\s+rush\b|:[a-z0-9_+-]+:/giu;

/**
 * One paragraph projected for sentence analysis: authored text kept, everything else one token, each surrounded by
 * spaces so neighbouring runs never weld.
 *
 * @returns the projected paragraph
 */
function projectedOf({ runs }: { runs: readonly DripInlineRun[] }): string {
  return runs
    .map((run) => {
      if (run.type === "text") {
        return run.code === true || run.quoted === true ? ` ${OPAQUE} ` : run.text;
      }
      if (run.type === "link") {
        return ` ${OPAQUE} `;
      }
      return ` ${ADDRESS} `;
    })
    .join("");
}

/**
 * Whether one sentence asks the reader something.
 *
 * @returns true for a `?` sentence carrying a second-person word or an address token
 */
function isAsk({ sentence }: { sentence: string }): boolean {
  return ENDS_ON_QUESTION.test(sentence) && (sentence.includes(ADDRESS) || SECOND_PERSON.test(sentence));
}

/**
 * How many sentences run on after a paragraph's first ask — zero when it never asks, ends on its ask, or trails only
 * with "no rush" or emoji. Pure.
 *
 * @param runs one counted paragraph's runs
 * @returns the word-bearing sentences after the ask, in that paragraph
 */
export function sentencesAfterAsk({ runs }: { runs: readonly DripInlineRun[] }): number {
  const sentences = projectedOf({ runs })
    .split(SENTENCE_BREAK)
    .flatMap((sentence) => gluedSentencesOf({ sentence }))
    .map((sentence) => sentence.trim());
  const ask = sentences.findIndex((sentence) => isAsk({ sentence }));
  if (ask === -1) {
    return 0;
  }
  return sentences.slice(ask + 1).filter((sentence) => WORD_BEARING.test(sentence.replaceAll(ALLOWED_TAIL, " ")))
    .length;
}
