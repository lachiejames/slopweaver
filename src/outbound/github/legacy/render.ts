/**
 * The PURE renderer: a stamped form in, the exact bytes of a pull-request body out.
 *
 * The order is the order a reviewer reads in: the derived badges (`./badgeRow.ts`), what can go wrong if this
 * merges, what the change does and why (`./renderWhat.ts`) — its claims, then the visible Proof screenshots — then
 * the code. The literals and the inline renderers they share are `./renderLayout.ts`. Every block carries a key,
 * which is what a block a human pasted on github.com is re-placed by (`./pastedMedia.ts`).
 * Every block is separated by one blank line, and every
 * content block is ONE line of HTML (a list or table is one line per row), because GitHub parses no Markdown
 * inside an HTML block and a stray blank line would end one early. The Longer notes are the exception on
 * purpose: they sit inside a `<details>` with blank lines around them so their fenced code renders. The Codex
 * review leftovers, after the risk, are the other: a Markdown heading and list, because the landing verbs read
 * those exact lines back (`../../codex/reviewLeftovers.ts`).
 *
 * The badge row carries the write stamp, the seen day and the review, which is what lets `./parse.ts` invert
 * this byte for byte.
 */
import { err, ok, type Result } from "#lib/result.js";
import { escapeCell, imageTag } from "../htmlText.js";
import { reviewerRowAnchors } from "../reviewerTable.js";
import { badgeRowOf } from "./badgeRow.js";
import type { ReadingOrderError } from "./errors.js";
import { LEFTOVERS_HEADING, leftoverEntryLine } from "./leftoverLines.js";
import { joinWithPasted, type KeyedBlock, type PastedMediaBlock } from "./pastedMedia.js";
import { LAYOUT, namedAnchor, renderContent } from "./renderLayout.js";
import { whatBlocks } from "./renderWhat.js";
import { type RiskRowCheck, type RiskRowShape, riskRowLine } from "./riskRow.js";
import type { BadgeRowShape } from "./tooltips.js";
import type {
  Content,
  GoldAnchor,
  PrForm,
  ProofBlock,
  RepoRef,
  ReviewerRow,
  ReviewLeftoverEntry,
  RiskItem,
  StampedPrBody,
} from "./types.js";

export { BADGE_TARGETS } from "./badgeRow.js";
export { LAYOUT, renderContent } from "./renderLayout.js";

/**
 * One block of the Longer notes.
 *
 * A code block is fenced with a backtick run longer than any inside its own text, so content carrying a
 * fence cannot close the block early. A `details` block collapses its nested leaf blocks behind a `<summary>`,
 * so overflow moved there is not counted against the notes word cap.
 *
 * @param block the block to render
 * @returns the markup for it
 */
export function renderProofBlock({ block }: { block: ProofBlock }): string {
  if (block.kind === "para") {
    return renderContent({ content: block.content });
  }
  if (block.kind === "details") {
    const inner = block.blocks.map((nested) => renderProofBlock({ block: nested })).join("\n\n");
    return `<details>\n<summary>${escapeCell({ text: block.summary })}</summary>\n\n${inner}\n\n</details>`;
  }
  if (block.kind === "image") {
    return imageTag(block);
  }
  const longestRun = [...block.text.matchAll(/`+/g)].reduce((max, m) => Math.max(max, m[0].length), 0);
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${block.lang}\n${block.text}\n${fence}`;
}

/** The one-line gloss a `proof-patch-id:` line carries. */
const PATCH_ID_GLOSS =
  "a fingerprint of this branch's own change — it survives a plain rebase that only moves the commit above";

/** One ranked risk item's whole `<li>` line, in the given row shape (`./riskRow.ts`). */
function riskItemRow({ item, shape }: { item: RiskItem; shape: RiskRowShape }): string {
  const check: RiskRowCheck =
    item.check.kind === "checked"
      ? { html: renderContent({ content: item.check.check }), kind: "checked" }
      : { html: renderContent({ content: item.check.why }), kind: "unchecked" };
  const fields = {
    check,
    impact: item.impact,
    likelihood: item.likelihood,
    priority: item.priority,
    reachHtml: renderContent({ content: item.reach }),
    worstHtml: renderContent({ content: item.worst }),
  };
  return riskRowLine({ fields, shape });
}

/** A list, one item per line. */
function list({ tag, items }: { tag: "ol" | "ul"; items: readonly string[] }): string {
  return [`<${tag}>`, ...items.map((item) => `<li>${item}</li>`), `</${tag}>`].join("\n");
}

/** The two anchor lines, in the shape `./proof.ts`'s `anchorPattern` reads. */
function anchorLines({ goldAnchor, repo }: { goldAnchor: GoldAnchor; repo: RepoRef }): string {
  const url = `https://github.com/${repo.owner}/${repo.repo}/commit/${goldAnchor.commit}`;
  const lines = [`proof-commit: [\`${goldAnchor.commit}\`](${url})`];
  if (goldAnchor.patchId !== undefined) {
    lines.push(`proof-patch-id: ${goldAnchor.patchId} — ${PATCH_ID_GLOSS}`);
  }
  return lines.join("\n");
}

/** The collapsed Longer notes, or nothing when there are neither notes nor an anchor. */
function notesBlock({
  notes = [],
  anchor,
}: {
  notes?: readonly ProofBlock[] | undefined;
  anchor: { goldAnchor: GoldAnchor; repo: RepoRef } | undefined;
}): readonly KeyedBlock[] {
  const parts = notes.map((block) => renderProofBlock({ block }));
  if (anchor !== undefined) {
    parts.push(anchorLines({ goldAnchor: anchor.goldAnchor, repo: anchor.repo }));
  }
  if (parts.length === 0) {
    return [];
  }
  return [{ key: "notes", text: `${LAYOUT.notesOpen}\n\n${parts.join("\n\n")}\n\n</details>` }];
}

/** A files cell lists its paths inline up to this many; past it they fold behind a count. */
const REVIEWER_FILES_INLINE_MAX = 5;

/** One reviewer cell: the row's anchor, every reviewer it tags, and the tokens a picked person stands in for. */
function reviewerWhoCell({ row, anchor }: { row: ReviewerRow; anchor: string }): string {
  const tagged = row.who.map((token) => escapeCell({ text: token })).join(" or ");
  const standsIn =
    row.standsInFor.length === 0
      ? ""
      : ` for ${row.standsInFor.map((token) => `<code>${escapeCell({ text: token })}</code>`).join(", ")}`;
  return `${namedAnchor({ name: anchor })}${tagged}${standsIn}`;
}

/** One files cell: the paths as code, one per line, folded behind a count past the inline cap. */
function reviewerLookCell({ row }: { row: ReviewerRow }): string {
  if (row.look.kind === "rest") {
    return LAYOUT.reviewersEverythingElse;
  }
  const { files } = row.look;
  const listed = files.map((file) => `<code>${escapeCell({ text: file })}</code>`).join("<br>");
  if (files.length <= REVIEWER_FILES_INLINE_MAX) {
    return listed;
  }
  return `<details><summary>${String(files.length)} files</summary>${listed}</details>`;
}

/** The Who reviews what section, or nothing when the body carries no table. */
function reviewersBlocks({ reviewers }: { reviewers: readonly ReviewerRow[] | undefined }): readonly KeyedBlock[] {
  if (reviewers === undefined) {
    return [];
  }
  const anchors = reviewerRowAnchors({ rows: reviewers });
  const rows = reviewers.map(
    (row, index) =>
      `<tr><td>${reviewerWhoCell({ anchor: anchors[index]!, row })}</td><td>${reviewerLookCell({ row })}</td></tr>`,
  );
  return [
    { key: "reviewers-heading", text: LAYOUT.reviewersHeading },
    { key: "reviewers", text: ["<table>", LAYOUT.reviewersHeader, ...rows, "</table>"].join("\n") },
  ];
}

/** The risk section's blocks. */
function riskBlocks({
  body,
  verdictLine,
  shape,
}: {
  body: StampedPrBody;
  verdictLine: string;
  shape: RiskRowShape;
}): readonly KeyedBlock[] {
  const rows = body.risk.items.map((item) => riskItemRow({ item, shape }));
  return [
    { key: "risk-heading", text: LAYOUT.riskHeading },
    { key: "risk-line", text: `<p><strong>${verdictLine}</strong> ${renderContent({ content: body.risk.line })}</p>` },
    { key: "risk-items", text: ["<ol>", ...rows, "</ol>"].join("\n") },
    { key: "blast-radius", text: `${LAYOUT.blastOpen}${renderContent({ content: body.risk.blastRadius })}</p>` },
  ];
}

/**
 * The Codex review leftovers: the exact heading the landing verbs search for, then the entries folded below it
 * (`AGENTS.md` rule 7). Each block is one canonical block, so `./parse.ts` reads them one at a time.
 */
function leftoverBlocks({ entries }: { entries: readonly ReviewLeftoverEntry[] | undefined }): readonly KeyedBlock[] {
  if (entries === undefined) {
    return [];
  }
  return [
    { key: "leftovers-heading", text: LEFTOVERS_HEADING },
    { key: "leftovers-open", text: leftoversOpen({ count: entries.length }) },
    { key: "leftovers", text: entries.map((entry) => leftoverEntryLine({ entry })).join("\n") },
    { key: "leftovers-close", text: "</details>" },
  ];
}

/**
 * The folded leftovers' opening, which carries their count.
 *
 * @param count how many leftovers the body names
 * @returns the `details` opening and its summary
 */
export function leftoversOpen({ count }: { count: number }): string {
  const findings = count === 1 ? "1 finding stands" : `${String(count)} findings stand`;
  return `<details>\n<summary>${findings} after the second and last review pass</summary>`;
}

/** The code section's blocks. */
function codeBlocks({ body }: { body: StampedPrBody }): readonly KeyedBlock[] {
  const blocks: KeyedBlock[] = [{ key: "code-heading", text: LAYOUT.codeHeading }];
  if (body.whyApproach !== undefined) {
    blocks.push(
      { key: "why-heading", text: LAYOUT.whyHeading },
      {
        key: "why",
        text: list({ items: body.whyApproach.map((content: Content) => renderContent({ content })), tag: "ul" }),
      },
    );
  }
  blocks.push(
    { key: "where-heading", text: LAYOUT.whereHeading },
    {
      key: "where",
      text: list({ items: body.whereToLook.map((content: Content) => renderContent({ content })), tag: "ol" }),
    },
  );
  return blocks;
}

/** What one stamped render takes: the body, its anchor and the two row shapes. */
interface StampedRender {
  readonly body: StampedPrBody;
  readonly anchor: { goldAnchor: GoldAnchor; repo: RepoRef } | undefined;
  readonly riskRows: RiskRowShape;
  readonly badges: BadgeRowShape;
}

/**
 * A stamped body's canonical blocks, each with the key a pasted block is anchored by (`./pastedMedia.ts`).
 *
 * @param body the stamped body
 * @param anchor the gold anchor and the repository its commit link points into, when the body carries one
 * @param riskRows the risk items' row shape
 * @param badges the badge row's shape
 * @returns the blocks in render order, or a refusal when a badge cannot be derived
 */
export function renderStampedBlocks({
  body,
  anchor,
  riskRows,
  badges,
}: StampedRender): Result<readonly KeyedBlock[], ReadingOrderError> {
  const row = badgeRowOf({ body, shape: badges });
  if (row.isErr()) {
    return err(row.error);
  }
  return ok([
    { key: "badges", text: row.value.row },
    ...reviewersBlocks({ reviewers: body.reviewers }),
    ...riskBlocks({ body, shape: riskRows, verdictLine: row.value.riskLine }),
    ...leftoverBlocks({ entries: body.reviewLeftovers }),
    ...whatBlocks({ body }),
    ...codeBlocks({ body }),
    ...notesBlock({ anchor, notes: body.notes }),
  ]);
}

/**
 * A stamped body's exact bytes, with any media a human pasted into it put back where it was.
 *
 * The anchor's repository is an argument beside the body because the body's bytes carry it only inside the
 * commit link: a whole form supplies its target, and `./parse.ts` supplies what it read off that link.
 *
 * @param body the stamped body
 * @param anchor the gold anchor and the repository its commit link points into, when the body carries one
 * @param riskRows the risk items' row shape: `sentence` for anything written, `dotted` only to re-render a body
 *   `./parse.ts` read in that shape
 * @param badges the badge row's shape: `plain` for anything written, `withSolved` only to re-render a body
 *   `./parse.ts` read in that shape
 * @param pasted media a human pasted between the body's blocks on github.com, each re-placed after its key
 * @returns the bytes, or a refusal when a badge cannot be derived (unranked items, a malformed or future day)
 */
export function renderStampedBody({
  pasted = [],
  ...render
}: StampedRender & { pasted?: readonly PastedMediaBlock[] | undefined }): Result<string, ReadingOrderError> {
  return renderStampedBlocks(render).map((blocks) => `${joinWithPasted({ blocks, pasted })}\n`);
}

/**
 * A whole stamped form's body bytes; the gold anchor's commit link points into the form's own target. Every
 * write renders through here, so every write emits the sentence risk rows.
 *
 * @param form the validated, stamped form
 * @param pasted media a human pasted into the live description, which an edit keeps where it was
 * @returns the exact body to send, or a refusal when a badge cannot be derived
 */
export function renderPrBody({
  form,
  pasted = [],
}: {
  form: PrForm;
  pasted?: readonly PastedMediaBlock[] | undefined;
}): Result<string, ReadingOrderError> {
  return renderStampedBody({ anchor: formAnchor({ form }), badges: "plain", body: form, pasted, riskRows: "sentence" });
}

/**
 * The anchor a whole form's body carries: its gold anchor, pointing into the form's own target.
 *
 * @param form the stamped form
 * @returns the anchor, or undefined when the form carries none
 */
function formAnchor({ form }: { form: PrForm }): { goldAnchor: GoldAnchor; repo: RepoRef } | undefined {
  return form.goldAnchor === undefined ? undefined : { goldAnchor: form.goldAnchor, repo: form.target };
}
