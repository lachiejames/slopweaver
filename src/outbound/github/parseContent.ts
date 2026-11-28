import type { Content, ImageRun, Inline } from "./types.js";

/** Match at the start of an anchor tag, shared by every parser that reads a `renderPrBody` anchor. */
const ANCHOR_TEXT = /^<a href="([^"]*)">/;
/**
 * Match a canonical `<img>` tag, shared by every parser that reads a `renderPrBody` image: `src`, `alt`, then an
 * optional `width` last, exactly as `./htmlText.ts`'s `imageTag` writes them.
 */
export const IMG = /^<img src="([^"]*)" alt="([^"]*)"(?: width="([0-9]+)")?>/;

/**
 * The image run one {@link IMG} match reads as. A width the renderer would not write back the same way (a leading
 * zero) still reads here; the caller's byte-exact re-render is what refuses it.
 *
 * @param match the match {@link IMG} returned
 * @returns the image run, its width present only when the tag carried one
 */
export function imageRunOf({ match }: { match: RegExpExecArray }): ImageRun {
  const run: ImageRun = { alt: decodeAttr({ text: match[2]! }), kind: "image", url: decodeAttr({ text: match[1]! }) };
  return match[3] === undefined ? run : { ...run, width: Number(match[3]) };
}

/**
 * Reverse `escapeCell`, exactly one layer.
 *
 * The order is the reverse of the renderer's and it is load-bearing: `&amp;lt;` must come back as the literal
 * text `&lt;`, NOT as `<`. Decoding `&lt;` first cannot touch it, because `&amp;lt;` contains no `&lt;`
 * substring, and only the final `&amp;` step restores the ampersand.
 *
 * Nothing else is decoded. A numeric character entity (an ampersand, a hash and digits) therefore survives as text, re-escapes with
 * its ampersand escaped, and fails the exact re-render — which is the correct outcome for a body this renderer did not
 * produce.
 *
 * @returns the decoded text
 */
export function decodeCell({ text }: { text: string }): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/**
 * Reverse `escapeAttr`, one layer. `&quot;` is undone before `&amp;`, for the reason `decodeCell` gives.
 *
 * @returns the decoded attribute text
 */
export function decodeAttr({ text }: { text: string }): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

/** The inline tags the renderer can emit, longest-first so `<code>` never shadows a prefix. */
const INLINE_TAGS: readonly {
  readonly kind: "strong" | "em" | "code";
  readonly open: string;
  readonly close: string;
}[] = [
  { close: "</strong>", kind: "strong", open: "<strong>" },
  { close: "</code>", kind: "code", open: "<code>" },
  { close: "</em>", kind: "em", open: "<em>" },
];

/** Match one non-text run at the head of `rest`, or undefined when none starts there. */
function inlineTagAt({ rest }: { rest: string }): { run: Inline; length: number } | undefined {
  for (const tag of INLINE_TAGS) {
    if (!rest.startsWith(tag.open)) {
      continue;
    }
    const end = rest.indexOf(tag.close, tag.open.length);
    if (end < 0) {
      return undefined;
    }
    const text = decodeCell({ text: rest.slice(tag.open.length, end) });
    return { length: end + tag.close.length, run: { kind: tag.kind, text } };
  }
  return undefined;
}

/**
 * Match an anchor run at the head of `rest`, or undefined when none starts there.
 *
 * @returns the matched run and its length, or `undefined`
 */
function linkAt({ rest }: { rest: string }): { run: Inline; length: number } | undefined {
  const open = ANCHOR_TEXT.exec(rest);
  if (open === null) {
    return undefined;
  }
  const end = rest.indexOf("</a>", open[0].length);
  if (end < 0) {
    return undefined;
  }
  return {
    length: end + "</a>".length,
    run: {
      kind: "link",
      text: decodeCell({ text: rest.slice(open[0].length, end) }),
      url: decodeAttr({ text: open[1]! }),
    },
  };
}

/**
 * The markup run opening at the head of `rest`, tried in order: an inline tag, then an anchor. Undefined when
 * `rest` does not open with `<`, or opens with one neither matcher reads — which {@link parseContent} refuses.
 */
function markupRunAt({ rest }: { rest: string }): { run: Inline; length: number } | undefined {
  if (!rest.startsWith("<")) {
    return undefined;
  }
  const tag = inlineTagAt({ rest });
  if (tag !== undefined) {
    return tag;
  }
  return linkAt({ rest });
}

/**
 * Recover a cell's inline runs.
 *
 * One uninterrupted stretch of plain text reads as ONE run. A write may not carry two text runs side by side
 * (`ADJACENT_TEXT_RUNS`, `./contentRunRules.ts`), so a cell has one spelling and this reads back the runs it was
 * written with.
 *
 * @returns the parsed runs, or `undefined` when the cell is empty or unreadable
 */
export function parseContent({ source }: { source: string }): Content | undefined {
  const runs: Inline[] = [];
  let text = "";
  let pos = 0;
  const flush = (): void => {
    if (text.length > 0) {
      runs.push({ kind: "text", text: decodeCell({ text }) });
      text = "";
    }
  };
  while (pos < source.length) {
    const rest = source.slice(pos);
    const matched = markupRunAt({ rest });
    if (matched !== undefined) {
      flush();
      runs.push(matched.run);
      pos += matched.length;
      continue;
    }
    if (rest.startsWith("<")) {
      return undefined;
    }
    text += source[pos];
    pos += 1;
  }
  flush();
  return runs.length === 0 ? undefined : runs;
}
