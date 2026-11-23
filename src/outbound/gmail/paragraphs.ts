/**
 * The shape a mail body's lines take: a paragraph is ONE line, a blank line separates paragraphs, and a list
 * item or a quoted line starts a line of its own. Everything else wraps where the reader's client wraps it.
 *
 * A sent reply once sat at eighty columns under a thread of single-line paragraphs, with new lines the
 * email client's own wrapping should have supplied. The composer had typed `I think only one host is` and
 * `reporting into it so far.` as two lines of one sentence.
 *
 * The body is REFUSED rather than reflowed (`AGENTS.md` rule 7: shape by schema, a violation refused, never
 * repaired). A reflow would have to guess which breaks the author meant, and a guessed-at mail is exactly
 * what an approval digest must never be taken over.
 */

/**
 * A line that opens a list item: a bullet (`-`, `*`, `•`) or an ordinal (`1.`, `1)`), then a space. Leading
 * indentation is allowed because a nested item is still a list item; a wrapped item's indented continuation
 * carries no marker and is refused.
 */
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s/u;

/** A quoted line, as a reply's quoted tail writes it. The quote is somebody else's wrapping. */
const QUOTED_LINE = /^\s*>/u;

/** How many offending line numbers a refusal names before it summarises the rest. */
const NAMED_LINES_MAX = 5;

/** How many code points of an offending line the refusal quotes, so the author can find it. */
const SNIPPET_WIDTH = 40;

/** Whether a line may begin straight after another non-blank line: a list item or a quoted line. */
function startsItsOwnLine({ line }: { line: string }): boolean {
  return LIST_ITEM.test(line) || QUOTED_LINE.test(line);
}

/**
 * Every hard line break a body carries INSIDE a paragraph, as one refusal naming where they are.
 *
 * The criterion is a break between two non-blank lines where the second is neither a list item nor a quoted
 * line. So `Intro:` followed by `- a` passes, a wrapped list item's continuation is refused, and a two-line
 * sign-off is refused too — it is written as one line or as two paragraphs, which is how the rest of the
 * thread writes one.
 *
 * The body is only READ here: a lone `\r` counts as a break like `\r\n` and `\n`, so a carriage-return-only
 * body cannot slip past, and nothing normalised is ever handed back.
 *
 * @param body the mail body exactly as the form carries it
 * @returns an empty list when every break separates paragraphs or opens a list item, else one problem line
 */
export function hardWrapProblems({ body }: { body: string }): readonly string[] {
  const lines = body.split(/\r\n?|\n/u);
  const offending: { readonly lineNumber: number; readonly text: string }[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1]!;
    const line = lines[index]!;
    const previousBlank = previous.trim().length === 0;
    const blank = line.trim().length === 0;
    if (!previousBlank && !blank && !startsItsOwnLine({ line })) {
      offending.push({ lineNumber: index + 1, text: line.trim() });
    }
  }
  const first = offending[0];
  if (first === undefined) {
    return [];
  }
  const named = offending
    .slice(0, NAMED_LINES_MAX)
    .map((entry) => String(entry.lineNumber))
    .join(", ");
  const more = offending.length > NAMED_LINES_MAX ? ` and ${String(offending.length - NAMED_LINES_MAX)} more` : "";
  const codePoints = Array.from(first.text);
  const snippet = codePoints.length > SNIPPET_WIDTH ? `${codePoints.slice(0, SNIPPET_WIDTH).join("")}…` : first.text;
  const count = offending.length === 1 ? "1 hard line break" : `${String(offending.length)} hard line breaks`;
  const lineWord = offending.length === 1 ? "line" : "lines";
  return [
    `body: ${count} inside a paragraph (${lineWord} ${named}${more}; first "${snippet}") — write each paragraph as ONE ` +
      "line and let the reader's mail client wrap it; separate paragraphs with a blank line, and start a new " +
      "line only for a list item or a quoted line",
  ];
}
