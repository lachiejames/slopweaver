/**
 * The one markdown shape that reaches a Notion page already broken: a link nested inside another link.
 *
 * ## What this is, and what it deliberately is NOT
 *
 * The handover this was built for recorded two suspects for a record table whose link cells rendered as raw
 * text, and MEASURING both on a live page cleared them both:
 *
 *  - "a cell that mixes prose with an inline link renders literally" — it does not.
 *    `see [the incident thread](https://…) for detail` renders as prose around a working link.
 *  - "a lone-link cell whose label equals the URL's last path segment renders literally" — it does not.
 *    `[acme](https://www.notion.so/acme)` and `[N](https://…/pull/<n>)` both render as links.
 *
 * The real cause was this repository's own bare-reference linkifier rewriting a reference that was ALREADY
 * inside a link, turning `[DDDD-839](https://linear.app/acme/issue/DDDD-839)` into
 * `[[DDDD-839](https://…)](https://…)` — and corrupting the URL of any link whose PATH happened to carry a
 * ticket key. That is fixed at source in `../linkify/bareRefs.ts`; this module is the backstop, because a
 * nested link is unpublishable however it got written and a body carrying one should never reach a page.
 *
 * So there is no refusal here for either shape the handover suspected. Refusing a body that renders
 * perfectly would have been worse than the defect: it would have taught every future author to reach for a
 * break-glass to publish correct markdown.
 *
 * Refusal, never repair — the same rule `./markdownBody.ts` states for every other body check, and there is
 * no override, because no author ever wants a nested link.
 *
 * Pure: markdown in, issues out.
 */

/** One place a link was written inside another link. */
export interface NestedLinkIssue {
  /** 1-based line number in the body as published. */
  readonly line: number;
  /** The offending markdown, clipped. */
  readonly excerpt: string;
  /** What a reader would see instead, and where it came from. */
  readonly message: string;
}

/** A markdown link whose LABEL is itself a markdown link: `[[label](url)](url)`. */
const NESTED_LABEL = /\[\s*\[[^\]\n]*\]\([^)\n]*\)[^\]\n]*\]\(/;

/**
 * A markdown link whose URL carries a `[` — a link spliced into what should be a path.
 *
 * Deliberately stops at the first `[` rather than matching the whole spliced link. Requiring the closing
 * `](` too needs a second unbounded run inside the first, which is polynomial backtracking and is what the
 * `redos-check` gate refuses. A `[` inside a URL is already conclusive: a real address percent-encodes one.
 */
const LINK_INSIDE_URL = /\]\([^)\n[]*\[/;

/** A line's offending fragment, clipped so one issue cannot flood a report. */
function excerptOf({ line }: { line: string }): string {
  const trimmed = line.trim();
  return trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed;
}

/**
 * Every line of a body that carries a link nested inside another link.
 *
 * Runs over the body as it will be PUBLISHED — after bare-reference linkification — because that pass is
 * where the shape historically came from. Checking the authored body would miss the one case this exists
 * for.
 *
 * @param markdown the body as it would be sent, without its H1 title line
 * @returns one issue per offending line, in document order
 */
export function nestedLinkIssues({ markdown }: { markdown: string }): readonly NestedLinkIssue[] {
  const issues: NestedLinkIssue[] = [];
  for (const [index, line] of markdown.split(/\r?\n/u).entries()) {
    const nestedLabel = NESTED_LABEL.test(line);
    const insideUrl = LINK_INSIDE_URL.test(line);
    if (!nestedLabel && !insideUrl) {
      continue;
    }
    const what = nestedLabel
      ? "a markdown link whose LABEL is itself a link"
      : "a markdown link whose URL has another link spliced into it";
    issues.push({
      excerpt: excerptOf({ line }),
      line: index + 1,
      message:
        `line ${String(index + 1)} carries ${what}: ${JSON.stringify(excerptOf({ line }))}. Notion renders a ` +
        "nested link as literal text, so this row would reach readers broken. It is almost always a " +
        "reference that was linkified twice — write the link once, and leave its label and URL alone.",
    });
  }
  return issues;
}
