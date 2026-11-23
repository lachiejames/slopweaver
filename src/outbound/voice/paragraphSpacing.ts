/**
 * The paragraph-spacing voice rule — a single message under the owner's own name breathes.
 *
 * A discussion piece that rendered as one dense block in the owner's DM was the case: the owner types a thread
 * reply of three paragraphs, each separated by a blank line, one idea per paragraph, with the `E.g.` on a line
 * of its own — which is why this rule's subject is a SINGLE as-me message rather than the `one-card` form
 * alone. A reply is a card in the owner's voice too.
 *
 * Deliberately a rule about what a READER sees, so it runs over rendered message text rather than over an
 * artifact's runs: the `one-card` form takes its breaks from `lines` and the `--body` escape hatch carries
 * the owner's own bytes, and both arrive here as the same string. That is also what keeps
 * `../slack/dripRender.ts`'s blank-line separation honest — a renderer that went back to a single `\n`
 * between lines would fail this gate rather than quietly ship dense again.
 *
 * Four continuation shapes are NOT two paragraphs and are exempt, because a person types them across
 * consecutive lines on purpose: a fenced code block, a run of `>` quoted lines, a run of list items, and a
 * quote with the line(s) answering it directly under. Anything else that touches the line above it is two
 * ideas with the air taken out from between them.
 *
 * The quote-and-answer block cuts both ways. A gate that forced a blank line after each quote in an
 * engineering-thread reply had to be hand-fixed. The answer sits directly under the line it
 * answers, so a blank line inserted BETWEEN a quote and its answer is refused too, while the blank line
 * before the next quote, or between two paragraphs of one answer, stays. The hand-fixed reply is the test's
 * fixture.
 */

/**
 * A list item as a person types one: a `-`/`*`/`•` bullet, or `1.`/`1)` numbering. `◦` is a nested one-list's
 * sub-point, as its notification fallback spells it.
 */
const LIST_ITEM = /^\s*(?:[-*•◦]\s|\d+[.)]\s)/u;

/** A quoted line — Slack's own blockquote, which is one quote however many lines it runs to. */
const QUOTE_LINE = /^\s*>/u;

/** A fence opening or closing a code block. */
const FENCE = /^\s*(?:`{3,}|~{3,})/u;

/** One run of consecutive non-blank lines, and whether a fence sits between it and the run before it. */
interface TouchingRun {
  readonly lines: readonly string[];
  readonly afterFence: boolean;
}

/** Whether a line is a quoted one. */
function isQuote({ line }: { line: string }): boolean {
  return QUOTE_LINE.test(line);
}

/**
 * Whether a touching run is one quote followed by the line(s) answering it: one or more quote lines, then
 * one or more lines that are not, and no quote after the answer has begun.
 */
function isQuoteAndAnswer({ lines }: { lines: readonly string[] }): boolean {
  const answerStart = lines.findIndex((line) => !isQuote({ line }));
  return answerStart > 0 && lines.slice(answerStart).every((line) => !isQuote({ line }));
}

/** Whether every line of a touching run is the same continuation shape, and so is one paragraph. */
function isContinuationRun({ lines }: { lines: readonly string[] }): boolean {
  return (
    lines.every((line) => LIST_ITEM.test(line)) ||
    lines.every((line) => isQuote({ line })) ||
    isQuoteAndAnswer({ lines })
  );
}

/**
 * The runs of consecutive non-blank lines outside any fenced block, in the order they appear.
 *
 * @param text the rendered message text
 * @returns one entry per touching run, each carrying its own lines and whether a fence preceded it
 */
function touchingRuns({ text }: { text: string }): readonly TouchingRun[] {
  const runs: TouchingRun[] = [];
  let current: string[] = [];
  let fenced = false;
  let afterFence = false;
  const close = (): void => {
    if (current.length > 0) {
      runs.push({ afterFence, lines: current });
      afterFence = false;
    }
    current = [];
  };
  for (const line of text.split(/\r?\n/u)) {
    if (FENCE.test(line)) {
      close();
      fenced = !fenced;
      afterFence = true;
      continue;
    }
    if (fenced || line.trim().length === 0) {
      close();
      continue;
    }
    current.push(line);
  }
  close();
  return runs;
}

/**
 * Whether rendered text packs two or more paragraphs together with no blank line between them. Pure.
 *
 * @param text the rendered message text
 * @returns true when at least one pair of adjacent paragraphs is missing its blank line
 */
export function isParagraphDense({ text }: { text: string }): boolean {
  return touchingRuns({ text }).some((run) => run.lines.length > 1 && !isContinuationRun({ lines: run.lines }));
}

/**
 * Whether rendered text puts a blank line between a quote and the answer under it. Pure.
 *
 * A run of nothing but quote lines, followed across blank lines alone by a run that does not open on a
 * quote, is a quote pushed away from its answer. A second quote after it, a fence after it, or the end of
 * the message is not: none of those is an answer.
 *
 * @param text the rendered message text
 * @returns true when at least one quote has a blank line between it and the line answering it
 */
export function isQuoteAnswerGapped({ text }: { text: string }): boolean {
  const runs = touchingRuns({ text });
  return runs.some((run, index) => {
    const next = runs[index + 1];
    return (
      next !== undefined &&
      !next.afterFence &&
      run.lines.every((line) => isQuote({ line })) &&
      !isQuote({ line: next.lines[0]! })
    );
  });
}

/**
 * The paragraph-spacing gate's verdict for one as-me message. Pure.
 *
 * @param text the rendered text of the single message a caller is about to send
 * @param escape the command that takes the one way past, quoted in the refusal
 * @returns one refusal line per spacing defect — paragraphs run together, a quote pushed off its answer —
 *   or empty when the message is spaced the way the owner types
 */
export function paragraphSpacingRefusalFor({ text, escape }: { text: string; escape: string }): readonly string[] {
  const override = `or for one deliberate exception run ${escape}; the grant sends the original content unchanged.`;
  const dense = isParagraphDense({ text })
    ? [
        "this is one message in the owner's own voice and its paragraphs run together — the owner writes a single card with a " +
          "blank line between paragraphs, one idea each, and an `E.g.` line on its own. Put an empty line " +
          "between them (a `one-card` form spaces its `lines` for you; a `--body` needs the blank line typed), " +
          override,
      ]
    : [];
  const gapped = isQuoteAnswerGapped({ text })
    ? [
        "this is one message in the owner's own voice and a quote has a blank line between it and its answer — the owner puts " +
          "the answer directly under the `>` line it answers, one block with no empty line inside it, and keeps " +
          "the blank line for between separate ideas. Take out the empty line after the quote, " +
          override,
      ]
    : [];
  return [...dense, ...gapped];
}
