/**
 * The prose a hand step's poster wrote for the owner to read, as words — what the two command posting rules,
 * `./commandInProse.ts` and `./secretName.ts`, read.
 *
 * A monitor card's `unblocks` is not a poster's prose: `../monitor/card.ts` builds it from a subject's own label — a
 * pull request's title, a recipe's failure text, a rehearsal's reason — so a title reading "`slopweaver secrets set`
 * refuses a name" is quoted data, not a command hidden from the owner's copy block. Read, it would refuse that pull
 * request's code-owner card, and the `plainWhat` retry, which swaps only `what`, could not rescue it. So
 * a step carrying {@link MONITOR_WITNESS} has its `unblocks` skipped; the monitor's declared `what` and `where` are
 * still read. The residue, stated: `hand post --witness` accepts that same string, so a session could set it and post
 * an `unblocks` unread — a row a reader sees claiming a monitor's settling command it never ran.
 */
import { type HandStep, MONITOR_WITNESS } from "./step.js";

/**
 * A secret's name as prose spells it: lowercase parts of two characters or more, joined by `-`, `.` or `_` — which every
 * registry row is (`unit/hand/secretName.test.ts` guards it), and which "when", "then" or "e.g" is not. A hyphenated
 * English word ("up-front") is the residue.
 */
export const SECRET_SHAPE = /^[a-z0-9]{2,}(?:[-._][a-z0-9]{2,})+$/;

/** {@link SECRET_SHAPE} at the start of a word, whatever shorthand is glued behind it. */
const SECRET_PREFIX = /^[a-z0-9]{2,}(?:[-._][a-z0-9]{2,})+/;

/**
 * The secret's name a prose word opens with — the whole word, or the name in front of shorthand glued to it, so
 * "google-secops-client-id/-secret" names `google-secops-client-id` rather than nothing.
 *
 * @param word the word, edge punctuation already stripped
 * @returns the name, or `undefined` when the word does not open with one
 */
export function secretNameIn({ word }: { word: string }): string | undefined {
  return SECRET_PREFIX.exec(word)?.[0];
}

/** What a word carries in front of it in prose that is not the word: a quote, a backtick, a bracket. */
const LEADING_PUNCTUATION = /^[`'"(<[]+/;

/** What a word carries behind it in prose that is not the word: a quote, a backtick, a bracket, a stop. */
const TRAILING_PUNCTUATION = /[`'".,;:!?)>\]]+$/;

/** A word opening a code span: a backtick, behind at most a bracket or quote. */
const CODE_SPAN_OPENING = /^[("'<[]*`/;

/** A word that is a whole code span by itself — `` `sudo` `` — so no command runs past it. */
const CODE_SPAN_WHOLE = /^[("'<[]*`[^`]+`/;

/** A placeholder a reader fills in — `<name>` — behind at most a backtick, quote or bracket. */
const PLACEHOLDER_OPENING = /^[`'"(]*</;

/** One whitespace-split word of prose, as written and with its edge punctuation stripped. */
export interface ProseToken {
  /** The word as written, punctuation and all — what says it opens a code span or is a placeholder. */
  readonly raw: string;
  /** The word a reader of commands sees, case kept, so "Claude" is not `claude`. */
  readonly word: string;
}

/** The prose fields a poster writes for the owner to read, in the order a refusal names them. */
export type ProseField = "what" | "where" | "unblocks" | "ifIgnored" | "checklist";

/**
 * A prose field's words: split on whitespace, quotes, backticks, brackets and a closing stop off each edge, empty
 * words gone.
 *
 * @param text the field
 * @returns its tokens, in order
 */
export function proseTokens({ text }: { text: string }): readonly ProseToken[] {
  return text
    .split(/\s+/)
    .map((raw) => ({ raw, word: raw.replace(LEADING_PUNCTUATION, "").replace(TRAILING_PUNCTUATION, "") }))
    .filter((token) => token.word.length > 0);
}

/**
 * A prose field's words, without what each was written as.
 *
 * @param text the field
 * @returns its words, in order
 */
export function proseWords({ text }: { text: string }): readonly string[] {
  return proseTokens({ text }).map((token) => token.word);
}

/**
 * Whether a word as written opens a code span running past it, so it and what follows are set as a command — never a
 * one-word span, which names a program ("the `sudo` prompt") rather than running one.
 *
 * @param token the word
 * @returns true for `` `op `` or `` (`sudo ``, false for `` `sudo` ``
 */
export function opensCodeSpan({ token }: { token: ProseToken }): boolean {
  return CODE_SPAN_OPENING.test(token.raw) && !CODE_SPAN_WHOLE.test(token.raw);
}

/**
 * Whether a word as written is a placeholder, `<name>`, which names no secret.
 *
 * @param token the word
 * @returns true when it opens with `<`
 */
export function isPlaceholder({ token }: { token: ProseToken }): boolean {
  return PLACEHOLDER_OPENING.test(token.raw);
}

/**
 * The prose a poster wrote on the step — `what`, `where`, `unblocks` and `ifIgnored` when set, less a monitor card's
 * `unblocks` and `ifIgnored` (both built from a subject's data), then every checklist line's sentence (a line's command
 * is its copy block, never prose).
 *
 * @param step the step a caller is about to record
 * @returns each field present and read, in order, with its text
 */
export function posterProse({ step }: { step: HandStep }): readonly { field: ProseField; text: string }[] {
  const fields: readonly ("what" | "where" | "unblocks" | "ifIgnored")[] =
    step.witness === MONITOR_WITNESS ? ["what", "where"] : ["what", "where", "unblocks", "ifIgnored"];
  const read = fields.flatMap((field) => {
    const text = step[field];
    return text === undefined ? [] : [{ field, text }];
  });
  if (step.checklist === undefined) {
    return read;
  }
  return [...read, ...step.checklist.map((item) => ({ field: "checklist" as const, text: item.action }))];
}
