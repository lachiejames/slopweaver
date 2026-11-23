/**
 * What a reader sees on a Linear issue or comment BEFORE expanding anything.
 *
 * Linear's fold is its `+++` collapsible, and both forms already put the workings inside one. An issue's
 * `aiPrompt` renders collapsed, so `## Problem` (plus `proofOfProblem`, which renders under the same
 * heading) and `## Solution` are the whole above-the-fold region. A comment is simpler still: its `summary`
 * is the entire message a reader sees without acting, which is why the schema already caps it alone.
 *
 * `../voice/aboveFold.ts` owns the rules; this module owns which text they see. A `media` block's alt text
 * and a `code` block's verbatim content are skipped, exactly as the section word cap skips them — neither is
 * prose a reader is asked to read through, and a code block is the one place a semicolon means something.
 *
 * Acceptance criteria are deliberately NOT here. They are single-line checkbox items rather than prose, and
 * a colon in "Given X: Y happens" is the item's own grammar rather than a packed sentence.
 */
import type { AboveFoldCell } from "../voice/aboveFold.js";
import type { LinearCommentArtifact } from "./commentTypes.js";
import type { LinearInitiativeUpdateArtifact } from "./initiativeTypes.js";
import type { LinearProjectUpdateArtifact } from "./projectUpdateTypes.js";
import type { FreeformBlock, LinearIssueArtifact, ListItem, SectionBlock } from "./types.js";

/** One block's authored prose, or nothing when the block carries none. */
function proseOfBlock({ block }: { block: FreeformBlock | SectionBlock }): readonly string[] {
  if (block.kind === "para" || block.kind === "heading") {
    return [block.text];
  }
  if (block.kind === "media" || block.kind === "code") {
    return [];
  }
  if (block.kind === "checklist") {
    return block.items.map((item) => item.text);
  }
  return block.items.flatMap((item) => proseOfItem({ item }));
}

/** One list item's prose: its own line, then the prose of whatever is nested under it. */
function proseOfItem({ item }: { item: ListItem }): readonly string[] {
  // `nested` is optional on a list item: an item without any is its own line alone.
  if (item.nested === undefined) {
    return [item.text];
  }
  return [item.text, ...item.nested.flatMap((nested) => proseOfBlock({ block: nested }))];
}

/** One named section as a single cell, so a rule sees the section's sentences rather than each block's. */
function sectionCell({
  blocks,
  path,
}: {
  blocks: readonly (FreeformBlock | SectionBlock)[];
  path: string;
}): readonly AboveFoldCell[] {
  const text = blocks.flatMap((block) => proseOfBlock({ block })).join("\n");
  return text.trim().length === 0 ? [] : [{ path, text }];
}

/**
 * Every above-the-fold region of a Linear issue form.
 *
 * @param artifact the validated issue, structured or freeform
 * @returns the regions a reader meets before opening the collapsible
 */
export function linearIssueAboveFoldCells({ artifact }: { artifact: LinearIssueArtifact }): readonly AboveFoldCell[] {
  if (artifact.kind === "freeform") {
    return sectionCell({ blocks: artifact.body, path: "artifact.body" });
  }
  // `proofOfProblem` is optional: an issue that offers no proof has `problem` alone above the fold.
  const problem =
    artifact.proofOfProblem === undefined ? artifact.problem : [...artifact.problem, ...artifact.proofOfProblem];
  return [
    ...sectionCell({ blocks: problem, path: "artifact.problem" }),
    ...sectionCell({ blocks: artifact.solution, path: "artifact.solution" }),
  ];
}

/**
 * The above-the-fold region of a Linear comment form, which is its summary and nothing else.
 *
 * @param artifact the validated comment
 * @returns the one region, or none when the summary is blank
 */
export function linearCommentAboveFoldCells({
  artifact,
}: {
  artifact: LinearCommentArtifact;
}): readonly AboveFoldCell[] {
  return artifact.summary.trim().length === 0 ? [] : [{ path: "artifact.summary", text: artifact.summary }];
}

/**
 * The above-the-fold cells of a project status update: its summary, which is the whole report a reader sees
 * in the project feed without opening anything.
 *
 * @param artifact the validated project-update body
 * @returns one cell for a non-empty summary, or none
 */
export function linearProjectUpdateAboveFoldCells({
  artifact,
}: {
  artifact: LinearProjectUpdateArtifact;
}): readonly AboveFoldCell[] {
  return artifact.summary.trim().length === 0 ? [] : [{ path: "artifact.summary", text: artifact.summary }];
}

/**
 * The above-the-fold cells of an initiative status update.
 *
 * Delegates to {@link linearProjectUpdateAboveFoldCells}: the two artifacts carry the same summary field and
 * Linear shows both in the same feed, so what is above the fold is decided by the same rule. See
 * `./initiativeTypes.ts` for why the two artifact types are nonetheless declared apart.
 *
 * @param artifact the validated initiative-update body
 * @returns one cell for a non-empty summary, or none
 */
export function linearInitiativeUpdateAboveFoldCells({
  artifact,
}: {
  artifact: LinearInitiativeUpdateArtifact;
}): readonly AboveFoldCell[] {
  return linearProjectUpdateAboveFoldCells({ artifact });
}

/** A document body split at its first heading: the lead a reader meets first, and every section after it. */
function documentRegions({ content }: { content: readonly FreeformBlock[] }): {
  readonly lead: readonly FreeformBlock[];
  readonly sections: readonly FreeformBlock[];
} {
  const firstHeading = content.findIndex((block) => block.kind === "heading");
  if (firstHeading === -1) {
    return { lead: content, sections: [] };
  }
  return { lead: content.slice(0, firstHeading), sections: content.slice(firstHeading) };
}

/**
 * The above-the-fold region of a Linear document: its lead, every block before the first heading.
 *
 * A document has no collapsible, so its fold is the one a page reader already applies: the opening
 * paragraphs say what this is and what it asks, and a reader who stops there has to have been told. A
 * document that opens on a heading has no lead and so nothing here, which is a shape choice the caller made.
 *
 * @param content the validated document blocks
 * @returns one cell for a non-empty lead, or none
 */
export function linearDocumentAboveFoldCells({
  content,
}: {
  content: readonly FreeformBlock[];
}): readonly AboveFoldCell[] {
  return sectionCell({ blocks: documentRegions({ content }).lead, path: "content.lead" });
}

/**
 * The below-the-fold region of a Linear document: every block from the first heading on, which the voice
 * rules read as warnings rather than refusals.
 *
 * @param content the validated document blocks
 * @returns one cell for the non-empty remainder, or none
 */
export function linearDocumentBelowFoldCells({
  content,
}: {
  content: readonly FreeformBlock[];
}): readonly AboveFoldCell[] {
  return sectionCell({ blocks: documentRegions({ content }).sections, path: "content.sections" });
}
