"use client";

import { type ReactElement, useState } from "react";

import type { RecordLine } from "../../lib/recordLines";
import { CitationChip } from "./CitationChip";
import { InlineText } from "./InlineText";

/** No addresses beyond a line's own text. */
const NONE: readonly string[] = [];

/*
 * The disclosure under a queue card: what the record carries, one short labelled line per field.
 *
 * It replaces two raw surfaces at once — the `<p>{card.what.whole}</p>` fold, which expanded into a wall, and `AskPanel`'s fake-terminal `<pre>`, which printed a row's whole question and its whole
 * reason as unbroken prose (and those two strings are the same string — see `reasonBeyondQuestion`).
 *
 * Nothing here decides what fits. `site/lib/recordLines.ts` is the only place a line is constructed, and its
 * `folded` arm hands over a head already inside the cap: this component draws that head and, only once the reader presses
 * "show all", the whole field in its place. A notice drawn instead of the field looks like a bug.
 */

/**
 * The record's own fields as short labelled lines, behind a disclosure the reader chooses to open.
 *
 * @param lines the derived lines, in the order the register writes them
 * @param summary what the disclosure calls itself
 * @param known the addresses the row carries, so a number a line names links exactly as it does above the fold
 * @returns the disclosure
 */
export function RecordLines({
  lines,
  summary,
  known = NONE,
}: {
  lines: readonly RecordLine[];
  summary: string;
  known?: readonly string[];
}): ReactElement {
  return (
    <details className="mt-[0.4rem] border-t border-border pt-[0.8rem] text-[0.82rem] [&>*:not(summary)]:mt-[0.7rem]">
      <summary className="cursor-pointer text-[0.78rem] text-primary marker:text-muted-foreground">{summary}</summary>
      <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-[0.35rem] text-[0.8rem] leading-[1.6] [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:wrap-anywhere [&_dt]:font-mono [&_dt]:text-primary">
        {lines.map((line) => (
          <RecordRow key={line.label} known={known} line={line} />
        ))}
      </dl>
    </details>
  );
}

/**
 * One labelled line.
 *
 * @param line the line
 * @param known the row's addresses
 * @returns the label and its value
 */
function RecordRow({ line, known }: { line: RecordLine; known: readonly string[] }): ReactElement {
  return (
    <>
      <dt>{line.label}</dt>
      <dd data-kind={line.kind}>
        <RecordValue known={known} line={line} />
      </dd>
    </>
  );
}

/**
 * What one line says, by its kind.
 *
 * @param line the line
 * @param known the row's addresses
 * @returns the value, the link, the stated absence, or the folded field
 */
function RecordValue({ line, known }: { line: RecordLine; known: readonly string[] }): ReactElement {
  // Through the same resolver as the card above it, so a folded `step` line links its pull-request numbers rather
  // than printing them as plain text.
  if (line.kind === "value") {
    return (
      <span>
        <InlineText text={line.value} known={known} />
      </span>
    );
  }
  // A cited record like every other link on a card: its hover card names where it goes, and a pull request's
  // carries its diff — the one link an ask's pull request kept once the chip row under the card was retired.
  if (line.kind === "link") {
    return (
      <CitationChip reference={{ kind: "address", url: line.url }} look="inline">
        {line.text}
      </CitationChip>
    );
  }
  if (line.kind === "absent") {
    return <span className="text-muted-foreground italic">{line.why}</span>;
  }
  return <FoldedValue key={line.whole} head={line.head} known={known} whole={line.whole} />;
}

/**
 * A field past the line cap: its head, and the whole field in its place once the reader presses "show all".
 *
 * Keyed by the whole text at the call site, so a row whose record changes under it starts folded again rather
 * than drawing new long text nobody asked for.
 *
 * @param head what is drawn unasked, inside the cap
 * @param whole the field entire, drawn only after the press
 * @param known the row's addresses
 * @returns the head or the whole, and the toggle between them
 */
function FoldedValue({ head, whole, known }: { head: string; whole: string; known: readonly string[] }): ReactElement {
  const [open, setOpen] = useState(false);
  let toggle = `show all ${whole.length.toLocaleString()} characters`;
  let text = head;
  if (open) {
    toggle = "show less";
    text = whole;
  }
  return (
    <span>
      <InlineText text={text} known={known} />{" "}
      <button
        type="button"
        aria-expanded={open}
        className="cursor-pointer text-[0.75rem] text-primary underline-offset-2 hover:underline"
        onClick={() => {
          setOpen(!open);
        }}
      >
        {toggle}
      </button>
    </span>
  );
}
