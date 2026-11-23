/**
 * A top-level CHANNEL post opens with what it is and what it asks of the reader, before any detail.
 *
 * ## The ruling
 *
 * Two parked posts opened a pilot channel without saying what the pilot was. The owner's own opener never made
 * clear it was piloting a way of working, and the bot card under it opened on detail ("Five real MFA asks from
 * the support channel, each worded differently") that left readers unsure whether it would act on them, since the
 * frame it came from was never stated. The recut that led with the question the post was asking read far
 * stronger. Doctrine rule 7 puts shape in the schema, so this is the form's job rather than a reviewer's.
 *
 * ## A declaration, the same shape as `./problemReach.ts`
 *
 * No content scan can tell whether a sentence says what a post IS (`.claude/rules/area-outbound.md`: which fact leads
 * is not computable), so the composer DECLARES it: `opening: {"what": "<words>", "asks": {"kind": "react" | "reply" |
 * "review" | "decide" | "nothing", "text": "<words>"}}`. Every composed form accepts the field and, when it is present,
 * refuses a top region that does not carry `what` and then `asks.text` in the author's own plain words. `slack draft
 * record` REQUIRES it on a top-level post outside a DM (`../../cli/commands/slack/channelOpeningDeclared.ts`), which is
 * where a reader arrives without the frame; a DM and a thread reply already have one and owe nothing.
 *
 * ## What "opens with" means
 *
 * The top region is the one `./problemReach.ts` names: a drip's first message, a one-card's first line, a
 * one-list's or no-fold's `lead`, an update's intro and `tldr`. Every later region is the detail, so carrying both
 * declared phrases there, `what` first, is "before any detail". A greeting and the tags ahead of them stay allowed —
 * a post opens by tagging the people it is for. A phrase matches as whole words, never inside a longer one, and
 * matching ignores case, runs of whitespace and a declared phrase's trailing full stop; code, a link label, a mention and a quote are not the author's words and never satisfy it.
 *
 * ## Stated residue
 *
 * The schema proves the post declared what it is and what it asks, and that those words sit where a reader meets
 * them first. It cannot prove the words are clear, or that `asks.kind` matches `asks.text`.
 *
 * Pure: no network, no clock, no filesystem.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";
import { addProblemReachIssue, authoredTextOf } from "./problemReach.js";
import type { InlineRun, OpeningAsk, OpeningDeclaration, ProblemDeclaration } from "./types.js";

/** The asks, in the order a reader's effort rises — `nothing` first, since an FYI is the commonest honest answer. */
const OPENING_ASKS: readonly [OpeningAsk, ...OpeningAsk[]] = ["nothing", "react", "reply", "review", "decide"];

/** The fewest words a declared phrase carries: one word says nothing about a post ("hey", "FYI"). */
const OPENING_PHRASE_MIN_WORDS = 2;

/**
 * Whether a phrase carries at least {@link OPENING_PHRASE_MIN_WORDS} words with a letter or digit in them.
 *
 * @returns true when it does
 */
function carriesEnoughWords({ phrase }: { phrase: string }): boolean {
  return phrase.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length >= OPENING_PHRASE_MIN_WORDS;
}

/** One declared phrase: trimmed, and two words or more. */
const phraseSchema = z
  .string()
  .trim()
  .refine((phrase) => carriesEnoughWords({ phrase }), {
    message: `a declared opening phrase carries at least ${OPENING_PHRASE_MIN_WORDS} words, copied from the top region`,
  });

/** The declaration every composed form accepts, and `slack draft record` requires on a top-level channel post. */
export const openingDeclarationSchema: z.ZodType<OpeningDeclaration> = strictForm({
  asks: strictForm({ kind: z.enum(OPENING_ASKS), text: phraseSchema }),
  what: phraseSchema,
});

/** U+FFFC, the object replacement character, standing where a run that is not the author's words sat. */
const SKIPPED_RUN_MARK = "\u{FFFC}";
const SKIPPED_RUN = ` ${SKIPPED_RUN_MARK} `;

/**
 * A top region's runs as the reader sees the author's words: adjacent text runs concatenate exactly as Slack renders
 * them, so a bold span starting mid-word stays one word, and every run that is not the author's words (code, a quote, a link
 * label, a mention, a chip) becomes {@link SKIPPED_RUN}, so a phrase is never completed by one or matched across one.
 * The mark is removed from authored text and from a declared phrase alike, so the placeholder is the only place one
 * can stand and the two sides still normalise the same.
 *
 * @param runs the top region's runs
 * @returns the authored text, with the placeholder wherever a skipped run sat
 */
export function openingTextOf({ runs }: { runs: readonly InlineRun[] }): string {
  return runs
    .map((run) =>
      run.type === "text" && run.code !== true && run.quoted !== true
        ? run.text.replaceAll(SKIPPED_RUN_MARK, "")
        : SKIPPED_RUN,
    )
    .join("");
}

/**
 * Text as the match reads it: case folded, whitespace collapsed, and no space on either side of any punctuation mark
 * or symbol — the top region's authored text joins its runs with a space, so a bold word ending in a comma would
 * otherwise read "pilot ,", and "a pilot — for" and "a pilot— for" are the same words. Both sides of the match go
 * through it, so dropping the space never makes two phrases disagree.
 *
 * @returns the normalised text
 */
function normalised({ text }: { text: string }): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/\s+/gu, " ")
    .replace(/ ?([\p{P}\p{S}]) ?/gu, "$1")
    .trim();
}

/**
 * A declared phrase as the match reads it: normalised, with a trailing full stop dropped so "a pilot." matches
 * "a pilot, so …", and any skipped-run mark removed so a declaration cannot reach across one.
 *
 * @returns the phrase to look for
 */
function phraseToFind({ phrase }: { phrase: string }): string {
  return normalised({ text: phrase.replaceAll(SKIPPED_RUN_MARK, "") }).replace(/\.+$/u, "");
}

/**
 * A string opening, or closing, on a letter or digit: the characters a phrase's edge may not share with a neighbour,
 * or it is half of a word. Anchored `u` patterns read a whole code point, so an astral letter is not split into a
 * surrogate that reads as no letter at all.
 */
const OPENS_ON_WORD = /^[\p{L}\p{N}]/u;
const CLOSES_ON_WORD = /[\p{L}\p{N}]$/u;

/**
 * Where `phrase` first stands in `text` at or after `from` as whole words, or -1. An edge that is a letter or digit
 * may not touch another one, so "pilot bot" is not found in "autopilot botnet"; an edge that is a mark already ends
 * the word, since normalising took the space beside it.
 *
 * @param text the normalised top region
 * @param phrase the normalised declared phrase
 * @param from the index the search starts at
 * @returns the index of the first whole-word occurrence, or -1
 */
function wholePhraseAt({ text, phrase, from }: { text: string; phrase: string; from: number }): number {
  const opensOnWord = OPENS_ON_WORD.test(phrase);
  const closesOnWord = CLOSES_ON_WORD.test(phrase);
  for (let at = text.indexOf(phrase, from); at >= 0; at = text.indexOf(phrase, at + 1)) {
    const touchesBefore = opensOnWord && CLOSES_ON_WORD.test(text.slice(0, at));
    const touchesAfter = closesOnWord && OPENS_ON_WORD.test(text.slice(at + phrase.length));
    if (!touchesBefore && !touchesAfter) {
      return at;
    }
  }
  return -1;
}

/**
 * The refusal for a top region that does not open with the declared words, or nothing when it does or when the form
 * declares no opening.
 *
 * @param opening the form's declaration, absent when it made none
 * @param topText the authored text of the form's top region
 * @param region how the refusal names that region for this form
 * @returns the refusal message, or undefined when the top carries `what` and then `asks.text`
 */
export function openingIssue({
  opening,
  topText,
  region,
}: {
  opening: OpeningDeclaration | undefined;
  topText: string;
  region: string;
}): string | undefined {
  if (opening === undefined) {
    return undefined;
  }
  const top = normalised({ text: topText });
  const what = phraseToFind({ phrase: opening.what });
  const asks = phraseToFind({ phrase: opening.asks.text });
  const whatAt = wholePhraseAt({ from: 0, phrase: what, text: top });
  if (whatAt >= 0 && wholePhraseAt({ from: whatAt + what.length, phrase: asks, text: top }) >= 0) {
    return undefined;
  }
  let missing = `"${opening.asks.text}" after it`;
  if (whatAt < 0) {
    missing = `"${opening.what}"`;
  }
  return (
    `this post declares an opening, and its ${region} does not carry ${missing} — a top-level channel post says ` +
    "what it is and what it asks of the reader before any detail, because a reader arriving in the channel does " +
    `not have the frame. Write both phrases into the ${region} in your own words, "what" ` +
    "first (not inside code, a link or a quote), or change the declaration to the words the top actually says."
  );
}

/**
 * Refuse, inside a form's `superRefine`, a declared opening its top region does not carry. One helper so every form
 * names its region the same way.
 *
 * @param path where the issue points: the form's top region
 * @param region how the refusal names that region for this form
 * @param topText the authored text of that region
 */
export function addOpeningIssue({
  ctx,
  opening,
  path,
  region,
  topText,
}: {
  ctx: z.RefinementCtx;
  opening: OpeningDeclaration | undefined;
  path: readonly (string | number)[];
  region: string;
  topText: string;
}): void {
  const message = openingIssue({ opening, region, topText });
  if (message !== undefined) {
    ctx.addIssue({ code: "custom", message, path: [...path] });
  }
}

/**
 * Refuse, inside a run-based form's `superRefine`, a top region that omits a declared reach or a declared opening.
 * Every run-based form checks both against the same region, so they are one call rather than two blocks to keep
 * in step.
 *
 * @param artifact the form, read for its `opening` and `problem` declarations
 * @param path where an issue points: the form's top region
 * @param region how a refusal names that region for this form
 * @param runs the top region's runs
 */
export function addTopRegionIssues({
  artifact,
  ctx,
  path,
  region,
  runs,
}: {
  artifact: { opening?: OpeningDeclaration | undefined; problem?: ProblemDeclaration | undefined };
  ctx: z.RefinementCtx;
  path: readonly (string | number)[];
  region: string;
  runs: readonly InlineRun[];
}): void {
  addProblemReachIssue({ ctx, path, problem: artifact.problem, region, topText: authoredTextOf({ runs }) });
  addOpeningIssue({ ctx, opening: artifact.opening, path, region, topText: openingTextOf({ runs }) });
}

/** What `slack draft record` says when a top-level channel post's composed form declares no opening. */
export const OPENING_UNDECLARED =
  "this draft is a top-level channel post and declares no `opening`. A channel post says what it is and what it " +
  "asks of the reader before any detail, because readers do not know the frame. Add " +
  '`"opening":{"what":"<the words saying what this is>","asks":{"kind":"nothing"|"react"|"reply"|"review"|"decide",' +
  '"text":"<the words saying what you want from them, or that you want nothing>"}}` and put both phrases, "what" ' +
  "first, in the first message, line, lead or tldr. A DM and a thread reply declare none.";
