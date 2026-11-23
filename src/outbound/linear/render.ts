/**
 * The Linear issue renderer — pure, deterministic, and the only place the byte layout lives.
 *
 * ## The collapsible's byte form is MEASURED, not chosen
 *
 * Across 426 real titled collapsibles in the corpus, every well-formed one has exactly this shape:
 *
 * ```
 * +++ Prompt for AI agents
 * <blank>
 * <content>
 * <blank>
 * +++
 * ```
 *
 * 404 of 404 carry the blank line after the opener AND before the closer; none carries trailing whitespace;
 * none is indented. Both of the owner's confirmed reference tickets match it exactly.
 *
 * Two authoring forms FAIL to render as a collapsed dropdown, and both exist in the real corpus:
 *
 *  - `+++ Prompt for AI agents +++` on ONE line — 22 occurrences. Opener and closer collapse into a single
 *    line and Linear renders it as text.
 *  - `## Prompt for AI agents` as a heading instead of a delimiter — 9 of the owner's own tickets. This is
 *    the "sometimes it doesn't render as a dropdown" that motivated pinning the form here.
 *
 * Neither is reachable from this module: the delimiter is emitted by code, and the schema refuses a `+++`
 * line in every field EXCEPT a `code` block — where it is safe precisely because {@link fenceFor} makes the
 * fence unclosable from inside, so a unified diff's `+++ b/path` headers are inert rather than structural.
 * That is the point of the split: the form makes a wrong body unrepresentable, and this file makes the right
 * one byte-stable.
 *
 * Determinism matters beyond tidiness: `update` re-renders the same form, so identical input must produce
 * identical bytes or every edit looks like a change. Nothing here reads a clock, the filesystem or the
 * environment.
 */
import type { LinearCommentArtifact } from "./commentTypes.js";
import type { LinearInitiativeUpdateArtifact } from "./initiativeTypes.js";
import type { LinearProjectUpdateArtifact } from "./projectUpdateTypes.js";
import type {
  DetailsBlock,
  FreeformBlock,
  FreeformIssue,
  LinearIssueArtifact,
  ListItem,
  SectionBlock,
  StructuredIssue,
} from "./types.js";

/** The collapsible's title. Fixed, because it is the string the owner's tooling and eye both look for. */
const AI_PROMPT_TITLE = "Prompt for AI agents";

/**
 * The title of a COMMENT's collapsible.
 *
 * Deliberately not {@link AI_PROMPT_TITLE}: that string is what the owner's tooling greps for to find the
 * agent brief on a ticket, and a comment's fold holds the opposite thing — the evidence behind a claim
 * already made. Reusing it would make every commented ticket look like it carried a second brief.
 */
const COMMENT_DETAIL_TITLE = "Detail and evidence";

/** The one blank line that separates every top-level construct. */
const GAP = "\n\n";

/** Whether a media block should embed as an image rather than link as a file. */
function isImage({ mime }: { mime: string }): boolean {
  return mime.toLowerCase().startsWith("image/");
}

/**
 * Escape the characters that let alt text break out of its own link construct.
 *
 * Without this, `alt: "x](https://attacker.test/p) ![y"` renders as TWO image constructs pointing at a URL
 * the caller never supplied, and a byte-golden test asserts the injected bytes just as happily as the right
 * ones. Alt text is caller-supplied prose, so it is escaped rather than refused: refusing would reject a
 * legitimate caption containing a bracket.
 *
 * The angle brackets are escaped too, because escaping the backslash is itself a transform the schema never
 * saw: an authored `\<textarea>` is escaped markdown and passes the raw-HTML refusal, then doubling its
 * backslash leaves `<textarea>` raw, swallowing the fold closer after it.
 */
function escapeAlt({ text }: { text: string }): string {
  return text.replace(/([[\]\\<>])/g, "\\$1");
}

/**
 * A code fence guaranteed longer than any backtick run inside the content.
 *
 * A fixed triple fence is closed by the first ``` inside the body, so the rest of the block, the following
 * sections and the collapsible all leak out as prose. Same defect and same fix as `src/codex/artifact.ts`.
 * Because the fence cannot be closed early, content inside it is inert — which is what makes it safe to
 * carry a unified diff whose header lines begin with `+++`.
 */
function fenceFor({ content }: { content: string }): string {
  const longest = [...content.matchAll(/`+/g)].reduce((max, run) => Math.max(max, run[0].length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

/** Two spaces — the indent that makes a block a CHILD of the list item above it rather than a sibling. */
const NEST_INDENT = "  ";

/**
 * One list item, plus anything nested beneath it.
 *
 * Nested blocks are indented by {@link NEST_INDENT} on EVERY line, including the blank line between them:
 * an unindented blank line terminates the list item in markdown, so the image would detach and float after
 * the whole list — exactly the association this feature exists to preserve.
 *
 * @param item the list item
 * @returns its markdown, with no trailing newline
 */
function renderListItem({ item }: { item: ListItem }): string {
  const lead = `- ${item.text}`;
  const nested = item.nested;
  // `nested` is optional on a list item: one without any renders as its own line alone.
  if (nested === undefined || nested.length === 0) {
    return lead;
  }
  const body = nested
    .map((block) => renderBlock({ block }))
    .join(GAP)
    .split("\n")
    // EVERY line, blank ones included. An earlier version trimmed the indent off blank lines, which reads as
    // tidier and is wrong: the blank line between two nested blocks then sits at column zero, terminating the
    // list item, so the second block detaches and floats after the whole list. Caught by the golden test.
    .map((line) => `${NEST_INDENT}${line}`)
    .join("\n");
  return `${lead}\n${NEST_INDENT}\n${body}`;
}

/**
 * One block's markdown. No trailing newline: the caller joins with {@link GAP}, so a block never decides its
 * own spacing and two adjacent blocks cannot disagree about it.
 *
 * @param block the block to render
 * @returns its markdown
 */
export function renderBlock({ block }: { block: FreeformBlock }): string {
  switch (block.kind) {
    case "para":
      return block.text;
    case "heading":
      return `## ${block.text}`;
    case "bullets":
      return block.items.map((item) => renderListItem({ item })).join("\n");
    case "checklist":
      return block.items.map((item) => `- [${item.done ? "x" : " "}] ${item.text}`).join("\n");
    case "media": {
      // An image embeds; anything else links. `![](…)` around a PDF renders a broken image in Linear, which
      // is why `mime` is required on the form rather than guessed from a URL that carries no extension.
      // The URL is angle-bracketed so a `)` inside it cannot terminate the construct early; the schema
      // separately refuses whitespace and angle brackets, which is the part escaping cannot rescue.
      const bang = isImage({ mime: block.mime }) ? "!" : "";
      return `${bang}[${escapeAlt({ text: block.alt })}](<${block.url}>)`;
    }
    case "code": {
      const fence = fenceFor({ content: block.text });
      return `${fence}${block.lang}\n${block.text}\n${fence}`;
    }
  }
}

/** Join a block sequence with one blank line between each. */
function renderBlocks({ blocks }: { blocks: readonly FreeformBlock[] }): string {
  return blocks.map((block) => renderBlock({ block })).join(GAP);
}

/** A `## Heading` followed by its body. */
function renderSection({ heading, blocks }: { heading: string; blocks: readonly FreeformBlock[] }): string {
  return `## ${heading}${GAP}${renderBlocks({ blocks })}`;
}

/**
 * The collapsible, in the measured byte form.
 *
 * @param blocks the prompt body
 * @returns the `+++` block, opener through closer
 */
export function renderAiPrompt({ blocks }: { blocks: readonly SectionBlock[] }): string {
  return renderFold({ blocks, title: AI_PROMPT_TITLE });
}

/** One titled collapsible in the measured byte form — the AI prompt's and every `details` fold's. */
function renderFold({ title, blocks }: { title: string; blocks: readonly SectionBlock[] }): string {
  return `+++ ${title}${GAP}${renderBlocks({ blocks })}${GAP}+++`;
}

/** An issue's optional `details` folds, in caller order. An issue declaring none renders none. */
function renderDetails({ details }: { details: readonly DetailsBlock[] | undefined }): readonly string[] {
  if (details === undefined) {
    return [];
  }
  return details.map((fold) => renderFold({ blocks: fold.blocks, title: fold.title }));
}

/**
 * The structured body.
 *
 * `proofOfProblem` is appended INSIDE the Problem section with no heading of its own: it is evidence for the
 * problem, not a peer section, and giving it a heading would put it in the same visual rank as Solution.
 */
function renderStructured({ issue }: { issue: StructuredIssue }): string {
  // `proofOfProblem` is optional: an issue that offers no proof renders its Problem section as `problem` alone.
  const problem = issue.proofOfProblem === undefined ? issue.problem : [...issue.problem, ...issue.proofOfProblem];
  const parts = [renderSection({ blocks: problem, heading: "Problem" })];
  parts.push(renderSection({ blocks: issue.solution, heading: "Solution" }));
  if (issue.acceptance !== undefined) {
    const items = issue.acceptance.map((text) => `- [ ] ${text}`).join("\n");
    parts.push(`## Acceptance criteria${GAP}${items}`);
  }
  parts.push(...renderDetails({ details: issue.details }));
  parts.push(renderAiPrompt({ blocks: issue.aiPrompt }));
  return parts.join(GAP);
}

/** The freeform body: the caller's own ordering, any `details` folds, then the required collapsible. */
function renderFreeform({ issue }: { issue: FreeformIssue }): string {
  return [
    renderBlocks({ blocks: issue.body }),
    ...renderDetails({ details: issue.details }),
    renderAiPrompt({ blocks: issue.aiPrompt }),
  ].join(GAP);
}

/**
 * Render an issue body to the exact markdown sent as Linear's `description`.
 *
 * @param artifact the filled form
 * @returns the description markdown, with no trailing newline
 */
export function renderIssueBody({ artifact }: { artifact: LinearIssueArtifact }): string {
  return artifact.kind === "structured" ? renderStructured({ issue: artifact }) : renderFreeform({ issue: artifact });
}

/**
 * The evidence list: one bullet per link, under its own bold lead.
 *
 * `**Evidence**` as a bold paragraph rather than a `## Evidence` heading, because this renders INSIDE the
 * collapsible and a heading there escapes the block on Linear's own grammar — the same escape the issue
 * form's named sections refuse in a field.
 */
function renderEvidence({
  evidence,
}: {
  evidence: readonly { readonly label: string; readonly url: string }[];
}): string {
  const items = evidence.map((entry) => `- [${escapeAlt({ text: entry.label })}](<${entry.url}>)`).join("\n");
  return `**Evidence**${GAP}${items}`;
}

/**
 * Render a comment body to the exact markdown sent as Linear's comment `body`.
 *
 * The arrangement IS rule 7 rather than a layout choice: the summary is the whole message a reader sees
 * without acting, and everything supporting it sits inside Linear's collapsible. The schema caps the summary
 * and requires the evidence, so a wall of text and an unsourced claim are both unrepresentable here rather
 * than merely discouraged.
 *
 * @param artifact the filled comment form's body
 * @returns the comment markdown, with no trailing newline
 */
export function renderCommentBody({ artifact }: { artifact: LinearCommentArtifact }): string {
  const folded = [
    ...(artifact.detail === undefined ? [] : [renderBlocks({ blocks: artifact.detail })]),
    renderEvidence({ evidence: artifact.evidence }),
  ].join(GAP);
  return [artifact.summary, `+++ ${COMMENT_DETAIL_TITLE}${GAP}${folded}${GAP}+++`].join(GAP);
}

/**
 * Render a comment on a Linear DOCUMENT to the exact markdown sent as Linear's `body`.
 *
 * The issue arrangement, with the project update's empty-fold rule: a document comment may carry no evidence
 * (its quoted passage is its provenance), and one with neither detail nor evidence is its summary alone rather
 * than a summary over an empty fold.
 *
 * @param artifact the filled comment form's body
 * @returns the comment markdown, with no trailing newline
 */
export function renderDocumentCommentBody({ artifact }: { artifact: LinearCommentArtifact }): string {
  return renderProjectUpdateBody({
    artifact: {
      ...(artifact.detail === undefined ? {} : { detail: artifact.detail }),
      ...(artifact.evidence.length === 0 ? {} : { evidence: artifact.evidence }),
      summary: artifact.summary,
    },
  });
}

/**
 * Render a project status update to the exact markdown sent as Linear's `body`.
 *
 * The same rule-7 arrangement as a comment, with one difference that is the whole point of this surface: a
 * status update whose supporting detail and evidence are both absent gets NO collapsible at all, rather than
 * an empty one. A fold a reader opens onto nothing teaches them not to open the next one, which costs more
 * than the tidiness of a uniform shape.
 *
 * @param artifact the filled project-update form's body
 * @returns the update markdown, with no trailing newline
 */
export function renderProjectUpdateBody({ artifact }: { artifact: LinearProjectUpdateArtifact }): string {
  const folded = [
    ...(artifact.detail === undefined ? [] : [renderBlocks({ blocks: artifact.detail })]),
    ...(artifact.evidence === undefined ? [] : [renderEvidence({ evidence: artifact.evidence })]),
  ].join(GAP);
  if (folded.length === 0) {
    return artifact.summary;
  }
  return [artifact.summary, `+++ ${COMMENT_DETAIL_TITLE}${GAP}${folded}${GAP}+++`].join(GAP);
}

/**
 * Render an initiative status update to the exact markdown sent as Linear's `body`.
 *
 * Delegates to {@link renderProjectUpdateBody} rather than duplicating it, and the delegation IS the claim:
 * Linear renders an initiative update in the same feed, the same digest and the same collapsible grammar as
 * a project update, so the two arrangements are one arrangement. Two copies would let them drift apart with
 * nothing to notice — and the empty-fold rule that function documents (no collapsible at all when there is
 * nothing to fold) is exactly as load-bearing here.
 *
 * @param artifact the filled initiative-update form's body
 * @returns the update markdown, with no trailing newline
 */
export function renderInitiativeUpdateBody({ artifact }: { artifact: LinearInitiativeUpdateArtifact }): string {
  return renderProjectUpdateBody({ artifact });
}
