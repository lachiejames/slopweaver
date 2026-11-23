/**
 * The reading-order renderer's shared vocabulary: the fixed literals every section emits between content, and the
 * evidence-cell renderer every section fills them with. Inline runs render through the C3 renderer's own
 * `renderContent` (`../htmlText.ts`), which this module re-exports. Pure.
 *
 * A leaf so `./render.ts` and `./renderWhat.ts` can both build on it without importing each other. `./render.ts`
 * re-exports {@link LAYOUT} and {@link renderContent}, which is where every other module reads them.
 *
 * Every inline run escapes its text, so a caller can never emit markup — which is what makes a `</td>` or a
 * nested `<table>` unreachable from the form.
 */

import { imageTag, renderInline } from "../htmlText.js";
import { REVIEWERS_ANCHOR } from "../reviewerTable.js";
import { BADGE_TARGETS } from "./badgeRow.js";
import type { EvidenceContent } from "./types.js";

export { renderContent } from "../htmlText.js";

/**
 * An evidence cell: inline runs, plus images, each image at its display width when it carries one.
 *
 * @param evidence the cell's runs
 * @returns the HTML for the cell's interior
 */
export function renderEvidence({ evidence }: { evidence: EvidenceContent }): string {
  return evidence.map((run) => (run.kind === "image" ? imageTag(run) : renderInline({ run }))).join("");
}

/**
 * A badge target's own anchor, written at the start of its heading.
 *
 * @param name the anchor a badge or a row links to
 * @returns the empty named anchor
 */
export function namedAnchor({ name }: { name: string }): string {
  return `<a name="${name}"></a>`;
}

/** Every literal the renderer emits between content, read back verbatim by `./parse.ts`. */
export const LAYOUT = {
  beforeAfterHeading: "### Before and after",
  beforeAfterHeader: "<tr><th></th><th>The problem</th><th>This PR's fix</th></tr>",
  blastOpen: "<p><strong>Blast radius:</strong> ",
  changeHeading: "### Change",
  claimsEmpty: "<p>⚠️ No claims are listed, so nothing here is proven yet.</p>",
  claimsHeader: "<tr><th>Claim</th><th>Proof</th></tr>",
  claimsHeading: `### ${namedAnchor({ name: BADGE_TARGETS.solved })}Other claims`,
  clickThroughOpen: "<p><strong>Clicked through on the running build at <code>",
  codeHeading: "## The code",
  failsOnMainOpen: "<p><strong>Fails on main, passes here:</strong> ",
  notesOpen: "<details>\n<summary>Longer notes</summary>",
  problemHeading: `### ${namedAnchor({ name: BADGE_TARGETS.problem })}Problem`,
  proofHeading: `### ${namedAnchor({ name: "proof" })}Proof`,
  reviewersEverythingElse: "Everything else",
  reviewersHeader: "<tr><th>Reviewer</th><th>Look at</th></tr>",
  reviewersHeading: `## ${namedAnchor({ name: REVIEWERS_ANCHOR })}Who reviews what`,
  riskHeading: `## ${namedAnchor({ name: BADGE_TARGETS.risk })}What can go wrong if this merges`,
  whatHeading: "## What does this PR do and why?",
  whereHeading: "### Where to look",
  whyHeading: "### Why this approach",
} as const;
