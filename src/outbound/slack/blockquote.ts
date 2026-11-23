/**
 * A line that opens with `> ` is a QUOTE, and inside `rich_text` only a `rich_text_quote` draws one.
 *
 * `rich_text` does not parse its text runs, so the mrkdwn quote marker a person types reaches a reader as a
 * literal greater-than sign. MEASURED: the bot's no-fold correction in the engineering thread,
 * `slopweaver slack read-thread 'https://acme.slack.com/archives/C0SYN000002/p1790224958879279?thread_ts=1790221327.473429&cid=C0SYN000002' --around 0`,
 * stored `{"type":"text","text":"> Confirming the FE commit isn't the cause."}` as the first element of a
 * `rich_text_section`, and the owner read the `>` on screen. The form vocabulary has no quote run, and a
 * writer reaching for `> ` is writing exactly what Slack's own composer turns into a quote, so the renderer
 * honours the marker rather than every form growing a field for it.
 *
 * Two halves, like `../artifact/typedRuns.ts` and `./typedRunsOnly.ts`: {@link quoteMarkedLines} converts at
 * render time, and `./renderCheck.ts` reports a marker that still reaches the wire, so a renderer that skips
 * this conversion is refused before a send and named on the read-back.
 */
import type {
  RichTextBlock,
  RichTextBlockElement,
  RichTextElement,
  RichTextQuote,
  RichTextSection,
} from "@slack/types";

/** The mrkdwn quote marker: a greater-than sign and the space after it, at the very start of a line. */
const QUOTE_MARKER = "> ";

/** Whether a rich-text element is PLAIN text, the only kind the quote bar trims: a code span is literal by request. */
function isPlainText(element: RichTextElement): element is Extract<RichTextElement, { type: "text" }> {
  return element.type === "text" && element.style?.code !== true;
}

/** Whether a rich-text element is plain text carrying nothing but whitespace, which the quote bar drops. */
function isGap({ element }: { element: RichTextElement }): boolean {
  return isPlainText(element) && element.text.trim() === "";
}

/**
 * Whether a rich-text element is a paragraph gap the RENDERER added: a `text` element of line breaks alone.
 * A no-fold or drip run the author wrote cannot be one, because those schemas refuse a `\n` inside a run; a
 * card run that is one opens a new visible line anyway, so the marker after it still starts that line.
 */
function isLineBreakGap({ element }: { element: RichTextElement }): boolean {
  return isPlainText(element) && /^[\r\n]+$/u.test(element.text);
}

/**
 * The index of the first element of a line that is not a renderer's paragraph gap, or -1 when there is none.
 *
 * A card paragraph opens with an embedded `\n` gap when another block precedes it (`./render.ts`'s
 * `paragraphGaps`), so the marker is looked for AFTER the gap, not at element zero. An authored space is
 * NOT skipped: ` ` then `> quoted` shows ` > quoted`, which is not a quote.
 */
function firstContentIndex({ elements }: { elements: readonly RichTextElement[] }): number {
  return elements.findIndex((element) => !isLineBreakGap({ element }));
}

/**
 * A line's elements with the opening quote marker removed and the edges trimmed, or undefined when the line
 * does not open with the marker or quotes nothing.
 *
 * The marker is matched across as many plain `text` runs as it takes, because a reader sees the runs joined:
 * `>` then ` quoted` shows `> quoted` exactly as one run does. A code span never counts,
 * being literal by request, and a bare `> ` quotes nothing, since an empty `rich_text_quote` is not legal.
 */
function unmarkedContent({ section }: { section: RichTextSection }): RichTextElement[] | undefined {
  const elements = section.elements.slice(firstContentIndex({ elements: section.elements }));
  let pending = QUOTE_MARKER;
  let index = 0;
  let opener: Extract<RichTextElement, { type: "text" }> | undefined;
  while (pending !== "") {
    const element = elements[index];
    if (element?.type !== "text" || element.style?.code === true) {
      return undefined;
    }
    const taken = element.text.slice(0, pending.length);
    if (!pending.startsWith(taken)) {
      return undefined;
    }
    pending = pending.slice(taken.length);
    opener = { ...element, text: element.text.slice(taken.length) };
    index += 1;
  }
  const unmarked = trimEdges({ elements: [opener!, ...elements.slice(index)] });
  return unmarked.length > 0 ? unmarked : undefined;
}

/**
 * Whether a line's visible text opens with the quote marker — in plain `text`, never a code span, which is
 * literal by request.
 *
 * @param section one line of a `rich_text` block
 * @returns true when a reader would see a literal `> ` at the start of the line
 */
export function opensWithQuoteMarker({ section }: { section: RichTextSection }): boolean {
  return unmarkedContent({ section }) !== undefined;
}

/**
 * Elements with the whitespace at both edges removed, a text element left empty by that dropped whole: a gap
 * inside the quote bar draws a blank line, and a space at either edge sits visibly inside it. The marker's own
 * run, a split run and a trailing run each leave one behind.
 */
function trimEdges({ elements }: { elements: readonly RichTextElement[] }): RichTextElement[] {
  const trimmed = [...elements];
  while (trimmed[0] !== undefined && isGap({ element: trimmed[0] })) {
    trimmed.shift();
  }
  const head = trimmed[0];
  if (head !== undefined && isPlainText(head)) {
    trimmed[0] = { ...head, text: head.text.trimStart() };
  }
  while (trimmed.length > 0 && isGap({ element: trimmed[trimmed.length - 1]! })) {
    trimmed.pop();
  }
  const tail = trimmed.at(-1);
  if (tail !== undefined && isPlainText(tail)) {
    trimmed[trimmed.length - 1] = { ...tail, text: tail.text.trimEnd() };
  }
  return trimmed;
}

/**
 * A `rich_text` block with every top-level line that opens with `> ` drawn as a `rich_text_quote`.
 *
 * Only a block's own sections are considered: a bullet inside a `rich_text_list` stays a bullet, because a
 * list item cannot hold a quote. Byte-identical to its input when no line carries the marker, so it can sit
 * on every renderer's output without moving an existing message.
 *
 * @param block the rendered block
 * @returns the block, its marked lines quoted
 */
export function quoteMarkedLines({ block }: { block: RichTextBlock }): RichTextBlock {
  const marked = block.elements.some(
    (element) => element.type === "rich_text_section" && opensWithQuoteMarker({ section: element }),
  );
  if (!marked) {
    return block;
  }
  const elements: RichTextBlockElement[] = block.elements.map((element) => {
    const quoted = element.type === "rich_text_section" ? unmarkedContent({ section: element }) : undefined;
    // A `rich_text_quote` is its own paragraph, so the line's spacing gaps stay out of the quote bar.
    return quoted === undefined ? element : ({ elements: quoted, type: "rich_text_quote" } satisfies RichTextQuote);
  });
  return { ...block, elements };
}
