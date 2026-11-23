/**
 * The PURE renderer: a C3 form in, the exact bytes of a pull-request body out.
 *
 * The order is the order a reader meets it: the derived badges (`./badgeRow.ts`), the explainer, **Proof of the
 * problem** and **Proof of the solution** (each a screenshot under the line it proves, or a one-line reason, its
 * heading then reading `: not shown`), **Checks** as dot points with any labelled group nested after the base ones,
 * **Not checked, and why**, then the re-run fold. Blocks are separated by ONE blank line and every content block is
 * one line of HTML (a list is one line per item), because GitHub parses no Markdown inside an HTML block and a stray
 * blank line would end one early. The re-run fold is the one exception on purpose: its items sit inside a `<details>`
 * with blank lines around them so a fenced command renders.
 *
 * ## Two layouts, one renderer
 *
 * Every write renders {@link CURRENT_LAYOUT}. Layout 1 is what every body published before it carries: `###`
 * headings, no `: not shown`, and each check its own paragraph under the solution. It stays renderable here so
 * `./parse.ts` can prove a read of an older body byte for byte, which is what keeps every open pull request's
 * description readable and its CI check green without rewriting it. Layout 1 has no check groups, so a body carrying
 * one is refused there rather than rendered without them.
 *
 * Nothing here depends on the day of the write, a reviewer, a grade or an anchor: the bytes are a function of the
 * form and the layout alone, which is what lets `./parse.ts` invert them exactly.
 */
import { err, ok, type Result } from "#lib/result.js";
import { BADGE_TARGETS, badgeRowOf } from "./badgeRow.js";
import { type PrBodyError, PrBodyErrors } from "./errors.js";
import { imageTag, renderContent } from "./htmlText.js";
import type { BodyLayout, CheckGroup, PrBody, PrForm, ProofSlot, RerunItem, UncheckedItem } from "./types.js";

export { renderContent } from "./htmlText.js";

/** The layout every write renders. */
export const CURRENT_LAYOUT: BodyLayout = 2;

/**
 * A heading's own anchor, written at its start: a pull-request heading gets no id from GitHub.
 *
 * @param name the anchor a badge links to
 * @returns the empty named anchor
 */
function namedAnchor({ name }: { name: string }): string {
  return `<a name="${name}"></a>`;
}

/** What a proof heading adds when its slot holds a reason, so a reader sees there is nothing to look at. */
export const NOT_SHOWN = ": not shown";

/** The literals layout 1 emits between content, read back verbatim by `./parse.ts`. */
const LAYOUT_1 = {
  checksHeading: undefined,
  notCheckedHeading: `### ${namedAnchor({ name: BADGE_TARGETS.notChecked })}Not checked, and why`,
  problemHeading: `### ${namedAnchor({ name: BADGE_TARGETS.problem })}Proof of the problem`,
  solutionHeading: `### ${namedAnchor({ name: BADGE_TARGETS.solution })}Proof of the solution`,
} as const;

/** The literals layout 2 emits between content. GitHub draws a rule under a `##` heading, so none is added. */
const LAYOUT_2 = {
  checksHeading: `## ${namedAnchor({ name: BADGE_TARGETS.checks })}Checks`,
  notCheckedHeading: `## ${namedAnchor({ name: BADGE_TARGETS.notChecked })}Not checked, and why`,
  problemHeading: `## ${namedAnchor({ name: BADGE_TARGETS.problem })}Proof of the problem`,
  solutionHeading: `## ${namedAnchor({ name: BADGE_TARGETS.solution })}Proof of the solution`,
} as const;

/** The headings one layout writes; the checks heading is absent in layout 1, which writes none. */
export interface LayoutHeadings {
  readonly checksHeading: string | undefined;
  readonly notCheckedHeading: string;
  readonly problemHeading: string;
  readonly solutionHeading: string;
}

/**
 * The headings a layout writes.
 *
 * @returns that layout's literals
 */
export function headingsOf({ layout }: { layout: BodyLayout }): LayoutHeadings {
  return layout === 1 ? LAYOUT_1 : LAYOUT_2;
}

/** Every literal the CURRENT renderer emits between content, read back verbatim by `./parse.ts`. */
export const LAYOUT = {
  ...LAYOUT_2,
  rerunClose: "</details>",
  rerunOpen: "<details>\n<summary>Re-run</summary>",
} as const;

/** Every heading any layout writes, for shape detection (`./bodyMarkers.ts`). */
export const ALL_LAYOUT_HEADINGS: readonly string[] = [
  LAYOUT_1.problemHeading,
  LAYOUT_1.solutionHeading,
  LAYOUT_1.notCheckedHeading,
  LAYOUT_2.problemHeading,
  LAYOUT_2.solutionHeading,
  LAYOUT_2.checksHeading,
  LAYOUT_2.notCheckedHeading,
];

/**
 * A proof slot's heading in a layout: layout 2 says `: not shown` when the slot holds a reason.
 *
 * @param heading the slot's bare heading
 * @param slot what the section holds, a screenshot or a reason, which decides the mark
 * @returns the heading line
 */
function proofHeadingOf({ heading, slot, layout }: { heading: string; slot: ProofSlot; layout: BodyLayout }): string {
  return layout === 2 && slot.kind === "reason" ? `${heading}${NOT_SHOWN}` : heading;
}

/**
 * One proof slot's block: the line a screenshot proves above the picture, or the one-line reason there is none.
 *
 * @returns its block, one line for a reason and two for a screenshot
 */
function renderProofSlot({ slot }: { slot: ProofSlot }): string {
  if (slot.kind === "reason") {
    return `<p>${renderContent({ content: slot.reason })}</p>`;
  }
  return `<p>${renderContent({ content: slot.proves })}</p>\n<p>${imageTag(slot.image)}</p>`;
}

/**
 * One "Not checked, and why" item's interior: the check, a full stop, then why.
 *
 * @returns the `<li>` interior
 */
function renderUnchecked({ item }: { item: UncheckedItem }): string {
  return `${renderContent({ content: item.check })}. ${renderContent({ content: item.why })}`;
}

/**
 * One labelled group as one list row: its label, then its checks nested on the same line, which keeps every row one
 * line of HTML.
 *
 * @returns the `<li>` row
 */
function renderGroup({ group }: { group: CheckGroup }): string {
  const items = group.items.map((content) => `<li>${renderContent({ content })}</li>`).join("");
  return `<li>${renderContent({ content: group.label })}<ul>${items}</ul></li>`;
}

/**
 * The fence a command is wrapped in: the shortest run of backticks, three at least, longer than any inside it, so
 * the command cannot close its own block early.
 *
 * @param text the command text
 * @returns the fence
 */
export function fenceFor({ text }: { text: string }): string {
  const longest = [...text.matchAll(/`+/g)].reduce((max, run) => Math.max(max, run[0].length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * One re-run item's block.
 *
 * @returns its markup
 */
function renderRerunItem({ item }: { item: RerunItem }): string {
  if (item.kind === "note") {
    return `<p>${renderContent({ content: item.content })}</p>`;
  }
  if (item.kind === "tests") {
    return ["<ul>", ...item.items.map((content) => `<li>${renderContent({ content })}</li>`), "</ul>"].join("\n");
  }
  const fence = fenceFor({ text: item.text });
  return `${fence}${item.lang}\n${item.text}\n${fence}`;
}

/** The checks' blocks in a layout: layout 1's paragraphs, or layout 2's heading over one list. */
function checkBlocks({ body, layout }: { body: PrBody; layout: BodyLayout }): readonly string[] {
  const heading = headingsOf({ layout }).checksHeading;
  if (heading === undefined) {
    return body.checks.map((content) => `<p>${renderContent({ content })}</p>`);
  }
  const rows = body.checks.map((content) => `<li>${renderContent({ content })}</li>`);
  if (body.checkGroups !== undefined) {
    rows.push(...body.checkGroups.map((group) => renderGroup({ group })));
  }
  return rows.length === 0 ? [] : [heading, ["<ul>", ...rows, "</ul>"].join("\n")];
}

/**
 * A body's blocks in render order, the badge row first.
 *
 * @returns the blocks, or a refusal when a badge cannot be derived
 */
function renderBlocks({ body, layout }: { body: PrBody; layout: BodyLayout }): Result<readonly string[], PrBodyError> {
  const headings = headingsOf({ layout });
  return badgeRowOf({ body, layout }).map((row) => {
    const blocks = [
      row,
      `<p>${renderContent({ content: body.explainer })}</p>`,
      proofHeadingOf({ heading: headings.problemHeading, layout, slot: body.problemProof }),
      renderProofSlot({ slot: body.problemProof }),
      proofHeadingOf({ heading: headings.solutionHeading, layout, slot: body.solutionProof }),
      renderProofSlot({ slot: body.solutionProof }),
      ...checkBlocks({ body, layout }),
    ];
    if (body.notChecked.length > 0) {
      const items = body.notChecked.map((item) => `<li>${renderUnchecked({ item })}</li>`);
      blocks.push(headings.notCheckedHeading, ["<ul>", ...items, "</ul>"].join("\n"));
    }
    if (body.rerun.length > 0) {
      const inner = body.rerun.map((item) => renderRerunItem({ item })).join("\n\n");
      blocks.push(`${LAYOUT.rerunOpen}\n\n${inner}\n\n${LAYOUT.rerunClose}`);
    }
    return blocks;
  });
}

/**
 * A body's exact bytes in one layout: its blocks joined by one blank line, ending on a newline. `./parse.ts` calls
 * this with the layout it read; every write goes through {@link renderBody}.
 *
 * @param layout the layout to render in
 * @returns the bytes, or a refusal when a badge cannot be derived, or a check group asked of layout 1
 */
export function renderBodyIn({ body, layout }: { body: PrBody; layout: BodyLayout }): Result<string, PrBodyError> {
  if (layout === 1 && body.checkGroups !== undefined && body.checkGroups.length > 0) {
    return err(PrBodyErrors.nonCanonical());
  }
  return renderBlocks({ body, layout }).andThen((blocks) => ok(`${blocks.join("\n\n")}\n`));
}

/**
 * A body's exact bytes in the current layout.
 *
 * @returns the bytes, or a refusal when a badge cannot be derived (unranked risk, a malformed day, a long hover)
 */
export function renderBody({ body }: { body: PrBody }): Result<string, PrBodyError> {
  return renderBodyIn({ body, layout: CURRENT_LAYOUT });
}

/**
 * A whole form's body bytes. Every write renders through here.
 *
 * @param form the validated form
 * @returns the exact body to send, or a refusal when a badge cannot be derived
 */
export function renderPrBody({ form }: { form: PrForm }): Result<string, PrBodyError> {
  return renderBody({ body: form });
}
