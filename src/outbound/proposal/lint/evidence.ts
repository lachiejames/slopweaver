/**
 * The citation detectors: a figure with no source, and a raw URL that is not anchored over its own words.
 *
 * These are the rules the golden shape is actually FOR. A proposal is a claim a team is asked to act on, and
 * the difference between one that can be checked and one that has to be believed is whether every number
 * links the thing it came from.
 *
 * Pure: prose in, findings out.
 */
import type { ProposalFinding } from "./findings.js";

/**
 * How far from a figure a citation may sit and still count as citing it.
 *
 * A sentence, generously. Ported from the V1 rule rather than invented, but re-stated here because the
 * number is doing real work: too small and a figure cited at the end of its own sentence is flagged, too
 * large and an unrelated link two paragraphs down excuses everything between.
 */
const CITATION_WINDOW_CHARS = 200;

/** A figure that needs a source: a percentage, a unit-bearing number, or a bare number of 3+ digits. */
const NUMERIC = /\b\d+(?:[.,]\d+)?\s*(?:s|ms|μs|ns|min|hr|h|k|M|%)(?![\w])|\b\d{3,}(?![\w])/gi;

/** An external link, in markdown or Slack form. */
const EXTERNAL_LINK = /\[[^\]]+\]\(https?:\/\/[^)]+\)|<https?:\/\/[^>|]+(?:\|[^>]+)?>/;

/** An in-document anchor link, which only counts when the anchor it names actually exists. */
const ANCHOR_LINK = /\[[^\]]+\]\(#([\w-]+)\)/g;

/** An anchor a `[text](#id)` link could resolve to. */
const ANCHOR_TARGET = /id=["']([\w-]+)["']/g;

/**
 * Strip fenced and inline code, whose contents are quoted data rather than authored claims.
 *
 * @param markdown the document body
 * @returns the same text with every code region blanked, so a figure or a URL inside one is not flagged
 */
export function stripCode({ markdown }: { markdown: string }): string {
  return markdown.replaceAll(/```[\s\S]*?```/g, " ").replaceAll(/`[^`\n]*`/g, " ");
}

/**
 * HARD: every figure has a source within a sentence of it.
 *
 * A source is an external link, or an in-document `[text](#anchor)` whose anchor really exists — a local
 * proposal's source is often a re-runnable command in its own appendix rather than a URL. A DANGLING anchor
 * does not count, which is the case a looser check gets wrong: it reads as a citation and resolves to
 * nothing.
 *
 * @param markdown the document body
 * @returns one finding naming the uncited figures, or nothing
 */
export function figuresAreCited({ markdown }: { markdown: string }): ProposalFinding | undefined {
  const prose = stripCode({ markdown });
  const anchors = new Set([...prose.matchAll(ANCHOR_TARGET)].map((match) => match[1]!));
  const uncited: string[] = [];
  for (const match of prose.matchAll(NUMERIC)) {
    const from = Math.max(0, match.index - CITATION_WINDOW_CHARS);
    const to = Math.min(prose.length, match.index + match[0].length + CITATION_WINDOW_CHARS);
    const window = prose.slice(from, to);
    const anchored = [...window.matchAll(ANCHOR_LINK)].some((link) => anchors.has(link[1]!));
    if (!EXTERNAL_LINK.test(window) && !anchored) {
      uncited.push(match[0].trim());
    }
  }
  if (uncited.length === 0) {
    return undefined;
  }
  return {
    message:
      `figure(s) with no source nearby: ${uncited.slice(0, 5).join(", ")}. Link the number over its own ` +
      "words, to the run, query or row it came from.",
    rule: "uncited-figure",
    severity: "blocker",
  };
}

/**
 * HARD: no raw URL in prose — a citation is a link ON the meaningful words, never a pasted address.
 *
 * @param markdown the document body
 * @returns the finding, or nothing
 */
export function urlsAreAnchored({ markdown }: { markdown: string }): ProposalFinding | undefined {
  const masked = stripCode({ markdown })
    .replaceAll(/!?\[[^\]]*\]\([^)]*\)/g, " ")
    .replaceAll(/<https?:\/\/[^>]*>/g, " ");
  const match = /https?:\/\/\S+/.exec(masked);
  if (match === null) {
    return undefined;
  }
  return {
    message: `raw URL ${JSON.stringify(match[0].slice(0, 60))} in prose. Anchor it over the words it supports: [text](url).`,
    rule: "bare-url",
    severity: "blocker",
  };
}

/**
 * HARD: no `[v1]`-style reference marker. The citation is the link on the words, not a footnote tag.
 *
 * @param markdown the document body
 * @returns the finding, or nothing
 */
export function noReferenceMarkers({ markdown }: { markdown: string }): ProposalFinding | undefined {
  const match = /\[(v\d+|\d+)\](?!\()/.exec(stripCode({ markdown }));
  if (match === null) {
    return undefined;
  }
  return {
    message: `reference marker ${match[0]} in prose. A reader should click the words, not hunt for a footnote.`,
    rule: "reference-marker",
    severity: "blocker",
  };
}
