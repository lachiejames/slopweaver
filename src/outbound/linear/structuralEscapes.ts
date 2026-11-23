/**
 * The checks one authored string on a Linear form owes: markdown that would escape the shape it was put in.
 * Every text-bearing block, an acceptance item and a `details` title run through these; `./schema.ts` decides
 * which field gets which check, and why each refusal exists is recorded there. The comment and update forms'
 * one-line summaries and evidence labels call {@link hasRawHtml} directly.
 */
import { parse, postprocess, preprocess } from "micromark";
import { gfm } from "micromark-extension-gfm";
import type { z } from "zod";

import { RAW_MENTION_MARKUP } from "./mentionIndex.js";

/**
 * Every line ending a renderer may honour, Unicode's own included — the class `documentReader.ts` splits
 * Linear's text on. A pattern's `m` flag splits on `\n`, `\r` and U+2028/U+2029 only, so a delimiter after a
 * vertical tab or form feed would pass an `m`-anchored check and still start its own line.
 */
const LINE_BREAK = /\r\n|[\n\r\v\f\x85\p{Zl}\p{Zp}]/u;

/**
 * A markdown heading line — the escape the named sections exist to prevent. A bare `###` is one too: an empty
 * ATX heading, as `documentReader.ts`'s `HEADING_TITLE` reads it.
 */
const HEADING_LINE = /^[ \t]*#{1,6}(?:[ \t]|$)/;

/**
 * A collapsible delimiter at the start of a line, in either documented form: a bare closer, or an opener
 * followed by a title. An INLINE `foo +++ bar` is not structural and is deliberately not matched — refusing
 * it would reject ordinary prose for no measured reason.
 */
const DELIMITER_LINE = /^[ \t]*\+\+\+(?:[ \t].*)?$/;

/**
 * A fence opener in a paragraph.
 *
 * A paragraph carrying ```` ``` ```` opens a code block that nothing closes, so the following section
 * headings and the collapsible are swallowed into it and the required dropdown never renders. Verified
 * against the renderer, not reasoned about. Code belongs in a `code` block, which fences collision-proof.
 */
export const FENCE_LINE = /^[ \t]*(?:`{3,}|~{3,})/;

/**
 * Whether any line of a string, split on every {@link LINE_BREAK}, matches a line-anchored pattern.
 *
 * @param pattern anchored with `^`/`$` and carrying no `m` or `g` flag, so each test sees one line
 * @returns true when at least one line matches
 */
export function anyLineMatches({ text, pattern }: { text: string; pattern: RegExp }): boolean {
  return text.split(LINE_BREAK).some((line) => pattern.test(line));
}

/** The micromark tokens CommonMark reads as raw HTML: a block (`<!--`, `<div>` at a line start) or an inline tag. */
const RAW_HTML_TOKENS: ReadonlySet<string> = new Set(["htmlFlow", "htmlText"]);

/** Whether one markdown document parses to any raw-HTML token. */
function parsesToRawHtml({ markdown }: { markdown: string }): boolean {
  const events = postprocess(
    parse({ extensions: [gfm()] })
      .document()
      .write(preprocess()(markdown, undefined, true)),
  );
  return events.some(([, token]) => RAW_HTML_TOKENS.has(token.type));
}

/** The spaces and tabs CommonMark counts as a line's indent. */
const LEADING_INDENT = /^[ \t]+/u;

/**
 * Whether authored markdown carries raw HTML, judged on micromark's own tokens with GFM — the parser
 * `../../cli/commands/linear/documentReader.ts` reads Linear's markdown with — rather than on a `<` pattern. So a
 * tag inside a code span (`` `Array<string>` ``), a comparison (`a < b`) and an autolink (`<https://…>`) all
 * pass, while `<!--`, `<div>` and `<b>x</b>` do not.
 *
 * A field is not rendered alone, so one parse of it is not enough. Each reading below
 * is taken both as written and with a `-->` appended, any one refusing:
 *
 *  - **as written**, which is how a paragraph block at a line start reads;
 *  - **after other text on its line**, which is how a fold title after `+++ `, a list item after `- ` and a
 *    summary read — an indented string is code alone and inline HTML there;
 *  - **with every line's indent removed**, because a prefix moves a tab's stop: `\t<!--` is code at column
 *    zero, but the `- ` of a list item or the two-space indent of a nested block leaves it an HTML block.
 *
 * The appended `-->` is what catches a comment opened and left open — literal text to CommonMark until a
 * LATER field supplies the closer — here rather than after concatenation. `- \t<!--` was the counterexample
 * that missed every reading taken only one way.
 *
 * @returns true when any reading of the text parses as an HTML block or inline HTML
 */
export function hasRawHtml({ text }: { text: string }): boolean {
  const dedented = text
    .split(LINE_BREAK)
    .map((line) => line.replace(LEADING_INDENT, ""))
    .join("\n");
  return [text, `x ${text}`, dedented].some(
    (markdown) => parsesToRawHtml({ markdown }) || parsesToRawHtml({ markdown: `${markdown}-->` }),
  );
}

/**
 * The correction offered when a field carries raw HTML.
 *
 * Refused because an HTML block runs to its own terminator rather than to the blank line the renderer leaves:
 * an unterminated `<!--` in one paragraph swallows every `+++` closer and opener after it, the AI-prompt fold
 * included. `documentReader.ts` records the rest of the class — an element left open
 * into every following block. Linear's own editor escapes a typed `<`, so no hand-written ticket carries any.
 */
export const RAW_HTML_CORRECTION =
  "raw HTML (a tag, or a `<!--` comment) is passed through to Linear's renderer, where an unclosed one swallows " +
  "every fold delimiter after it, so the collapsibles never close or open. Write the words without the markup, " +
  "or put markup you are quoting in a `code` block or a backtick code span.";

/**
 * Whether a string carries any {@link LINE_BREAK} — the test every field that renders as one line applies.
 *
 * @returns true when the text would span more than one line in Linear's reading
 */
export function hasLineBreak({ text }: { text: string }): boolean {
  return LINE_BREAK.test(text);
}

/** The correction offered when a body carries a raw delimiter, so the caller can act rather than guess. */
const DELIMITER_CORRECTION =
  'a line beginning with "+++" is Linear\'s collapsible delimiter, so it would close the AI-prompt block ' +
  "early and silently reattach the rest of the body to the previous section. This is refused rather than " +
  "escaped because Linear documents no escape for it. If this is a unified diff, link to it instead, or " +
  "strip the ---/+++ file header lines and keep the hunks.";

/** The correction offered when a paragraph opens a code fence it cannot close. */
export const FENCE_IN_PARA_CORRECTION =
  "a paragraph containing a code fence opens a block that nothing closes, so the following sections and the " +
  "AI-prompt collapsible are swallowed into it and the dropdown never renders. Use a `code` block instead; " +
  "it fences with a backtick run longer than anything inside, so it cannot be closed early.";

/**
 * The correction offered when a comment or update summary opens a code fence. The summary renders directly above
 * the generated detail fold, so an unclosed fence there swallows the fold's opener and closer.
 */
export const SUMMARY_FENCE_CORRECTION =
  "a summary opening a code fence (```` ``` ```` or `~~~`) starts a code block nothing closes, so the detail fold " +
  "below it never opens. Quote code in single backticks, or put it in a detail `code` block.";

/**
 * The correction offered when a field hand-writes Linear's own mention markup.
 *
 * Refused for the same reason the delimiter is: it is STRUCTURE this door owns. `@[label](<user-id>)` names
 * a person by an opaque id, which is the one value a reader cannot check by eye — a transposed id puts one
 * colleague's name on another's notification and looks perfect in the diff. Write `@{key}` instead and let
 * `./mentionIndex.ts` resolve it, exactly as `#N` becomes a link rather than being pasted.
 */
const RAW_MENTION_CORRECTION =
  "`@[name](id)` is Linear's own mention markup, so this body would notify whoever owns that id with no " +
  "check that it is the person you meant. Write `@{key}` — a canonical person id, Linear user id, Linear " +
  "handle, `@handle` or the email on the Linear identity — and the door resolves it, refuses an ambiguous " +
  "one, and names the candidates. `--mention-id key=<linear-user-id>` is the escape for an id you verified " +
  "live.";

/** The correction offered when a field carries a heading marker. */
const HEADING_CORRECTION =
  'a line beginning with "#" opens a markdown heading, which would escape the section this field renders ' +
  "into. The structured form owns its headings; use the freeform kind if you need to control them.";

/**
 * Refuse structural markdown in one string field. Shared by every text-bearing block.
 *
 * @param text the authored string
 * @param path where the string sits on the form, for the issue a caller reads
 * @param ctx the refinement context to report into
 */
export function checkStructuralEscapes({
  text,
  path,
  ctx,
}: {
  text: string;
  path: readonly (string | number)[];
  ctx: z.RefinementCtx;
}): void {
  if (anyLineMatches({ pattern: DELIMITER_LINE, text })) {
    ctx.addIssue({ code: "custom", message: DELIMITER_CORRECTION, path: [...path] });
  }
  if (anyLineMatches({ pattern: HEADING_LINE, text })) {
    ctx.addIssue({ code: "custom", message: HEADING_CORRECTION, path: [...path] });
  }
  if (RAW_MENTION_MARKUP.test(text)) {
    ctx.addIssue({ code: "custom", message: RAW_MENTION_CORRECTION, path: [...path] });
  }
  if (hasRawHtml({ text })) {
    ctx.addIssue({ code: "custom", message: RAW_HTML_CORRECTION, path: [...path] });
  }
}

/**
 * Refuse a newline in a field that renders as exactly one line — a list item, a heading or a fold title.
 *
 * @param text the authored string
 * @param path where the string sits on the form, for the issue a caller reads
 * @param what the field's name in the refusal, such as "list item"
 * @param ctx the refinement context to report into
 */
export function checkSingleLine({
  text,
  path,
  what,
  ctx,
}: {
  text: string;
  path: readonly (string | number)[];
  what: string;
  ctx: z.RefinementCtx;
}): void {
  // Every LINE_BREAK, not only `\n`: a renderer that honours Unicode line endings splits the line on them, and
  // a one-line field has no reason to carry any of those invisible characters.
  if (!hasLineBreak({ text })) {
    return;
  }
  ctx.addIssue({
    code: "custom",
    message: `a ${what} renders as ONE line, so an embedded newline would break out of it. Split it into two.`,
    path: [...path],
  });
}
