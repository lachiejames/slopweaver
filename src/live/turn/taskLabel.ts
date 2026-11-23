/**
 * The one label a turn carries — the bracketed task on the author row — and the addressing strip it is
 * built from. Cut out of `run.ts` because seven call sites outside the turn loop (the capture card, the
 * progress card, `turn block`, `turn status`, `turn watch`, `turn unblock` and the dispatch sweep) label a
 * task the same way, and none of them wants the turn loop itself as the price of a label. Pure; its one import
 * is `./quotedQuestion.ts`, the markup rewrite the label must run before it clamps.
 */
import { questionForPlainField } from "./quotedQuestion.js";

/** How long a task label may be before the author row starts wrapping. Cosmetic, so a clamp not a refusal. */
const TASK_LABEL_MAX = 48;

/**
 * Every `@(id)` the ask OPENS with — the addressing, not the question.
 *
 * `../listen/mention.ts` normalises `<@U123>` to `@(U123)` so the rest of the system never handles a raw
 * Slack tag, and the brief's `question` keeps that normalised text whole. The card's title is built from it,
 * which is how a live card came to read `answering: @(U0BOT) where are we up to on the github…` —
 * measured on that ask's own brief, and reported by the owner as one of two things on the card
 * that read as broken.
 *
 * Only the LEADING run is stripped, and stripped rather than resolved. Leading, because that run is pure
 * addressing — it names the bot being spoken to and carries nothing about the question. Stripped, because
 * the alternative is inventing a display name for an id from a roster that may not know it, and a title is a
 * label rather than the message: a mention deeper inside a long question is almost always past the 48-char
 * clamp anyway, and showing an id there is honest where guessing a name would not be.
 *
 * **This helper owns the NORMALISED `@(id)` form only, and `./quotedQuestion.ts` owns the RAW `<@U…>` one.**
 * Two forms because two intake paths: `../listen/mention.ts` normalises on the socket path, and the
 * ask-lifecycle register keeps Slack's own text. The two helpers COMPOSE — the card sites call
 * `questionForPlainField({ question: strippedAddressing({ question }) })` — and neither grows the other's
 * concern. Its fallback is this one's doctrine, quoted above, rather than a second opinion.
 */
const LEADING_ADDRESSING = /^(?:\s*@\([^)]*\))+\s*/;

/**
 * A person tag as a card can carry it: the normalised `@(U…)` form, or the bare `@U…` one
 * `./quotedQuestion.ts` leaves when it has no name for a raw `<@U…>`. `./cardNames.ts` names both.
 */
export const PERSON_TAG_SOURCE = String.raw`@\(([UW][A-Z0-9]+)\)|@([UW][A-Z0-9]{6,})\b`;

/**
 * Where to cut `text` so no person tag is split — `at` itself, or the start of a tag it would land inside.
 *
 * A clamp that cuts `@(U0SYN000003)` to `@(U0SY…` leaves a fragment nothing can name, so `./cardNames.ts`'s
 * renderer would show a broken id where a name belonged (a question of
 * forty characters and a tag ends `@(U0SY…` under the 48-character label clamp). Moving the cut to the tag's
 * start drops the tag whole instead, which reads as an ordinary shortening.
 *
 * @param text the text about to be clamped
 * @param at the index the clamp would cut at
 * @returns the index to cut at, never greater than `at`
 */
export function tagSafeCut({ text, at }: { text: string; at: number }): number {
  for (const match of text.matchAll(new RegExp(PERSON_TAG_SOURCE, "g"))) {
    const start = match.index;
    if (start < at && at < start + match[0].length) {
      return start;
    }
  }
  return at;
}

/**
 * Drop an ask's leading addressing, leaving the question.
 *
 * Exported because the CARD quotes the question too — as step 0's own finding — and a raw id there is the
 * same defect the title had. One helper, so the two can never disagree about what counts as addressing.
 *
 * @param question the ask's normalised text
 * @returns the text with any leading `@(id)` run removed
 */
export function strippedAddressing({ question }: { question: string }): string {
  return question.replace(LEADING_ADDRESSING, "");
}

/**
 * The task label shown in brackets on the author row.
 *
 * One label for the whole turn, not one per step. That is the owner's model — a task carries a name — and
 * it is also what keeps the label stable across the edits that advance the checklist, so the identity does
 * not appear to change while one piece of work is running.
 *
 * **Slack markup is rewritten to prose BEFORE the clamp**, by `./quotedQuestion.ts`'s `questionForPlainField`
 * and under the ordering rule it states. The label is a plain TEXT run, and the wire guard
 * (`../../outbound/slack/typedRunsOnly.ts`) refuses a raw span in one. MEASURED on ask
 * `C0SYN000001`/`1790222247.843029`: `• close <https://linear.app/acme/issue/HELP-2878/…|HELP-2878> • …`
 * clamped to `• close <https://linear.app/acme/issue/HELP-…` — an unclosed angle form the scanner reads as
 * a bare URL — so the capture-time checklist and the dispatch card were both refused and the tag got no
 * card. Rewritten first, the link is its author's own `|label` (`HELP-2878`), and a URL with none loses
 * its scheme.
 *
 * **And rewritten once more AFTER the clamp.** A cut can expose a span the whole text hid: an unrecognised
 * `<x https://…>` is one opaque candidate until its `>` is dropped, and a token that does not parse as a URL
 * can parse once truncated. Chasing those shapes at the cut is a list
 * that never closes; a rewrite pass only ever shortens the text, so the label it returns carries no span the
 * wire guard could refuse, by construction.
 *
 * @param question the question being answered
 * @returns the bracketed label's text, clamped
 */
export function turnTaskLabel({ question }: { question: string }): string {
  const trimmed = questionForPlainField({ question: strippedAddressing({ question }) }).trim();
  if (trimmed.length === 0) {
    return "answering";
  }
  const [head = trimmed] = trimmed.split("\n");
  if (head.length <= TASK_LABEL_MAX) {
    return `answering: ${head}`;
  }
  return questionForPlainField({
    question: `answering: ${head.slice(0, tagSafeCut({ at: TASK_LABEL_MAX - 1, text: head }))}…`,
  });
}
