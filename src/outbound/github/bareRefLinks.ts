/**
 * BARE REFERENCES in the pull-request run vocabulary (`./types.ts`'s `Inline`/`Content`) — resolving
 * a bare hash number or `SUP-123` into `link` runs across every authored cell of a pull-request form and a comment's blocks,
 * and reporting whatever `../linkify/bareRefs.ts` could not resolve.
 *
 * Same convert-then-refuse-residue shape as `../artifact/bareRefRuns.ts`, over a DIFFERENT vocabulary — this
 * one discriminates on `kind` rather than `type`, and has no `mention`/`broadcast`/`citation` runs to skip.
 * A PR body's own repo is never ambiguous: the form's `target` names it directly, so a caller building
 * {@link BareRefContext} for this door has no reason to leave `repos` empty or plural. Which cells a form has
 * is `./formContent.ts`'s one walk, so a section added to the form is linked without this file changing.
 */
import {
  type AttestedNumber,
  attestedNumbersInUrls,
  type BareRefContext,
  type BareRefIssue,
  type BareRefSpan,
  bareRefRefusalMessage,
  resolveBareRef,
  scanBareRefs,
} from "../linkify/bareRefs.js";
import type { GithubCommentArtifact } from "./commentTypes.js";
import { contentFieldsOf, mapContentFields } from "./formContent.js";
import type { ProofBlockLeaf } from "./legacy/types.js";
import type { Content, Inline, PrBody } from "./types.js";

/** The `Inline` kinds that carry authored prose a bare reference could sit inside. */
function convertibleInline(run: Inline): run is Extract<Inline, { kind: "text" | "strong" | "em" }> {
  return run.kind === "text" || run.kind === "strong" || run.kind === "em";
}

/** One prose run, rewritten as the runs its bare references deserve. Untouched when it carries none. */
function linkifyInline({
  run,
  context,
}: {
  run: Extract<Inline, { kind: "text" | "strong" | "em" }>;
  context: BareRefContext;
}): readonly Inline[] {
  const spans = scanBareRefs({ context, text: run.text });
  if (spans.length === 0) {
    return [run];
  }
  const out: Inline[] = [];
  let cursor = 0;
  const keepText = ({ end }: { end: number }): void => {
    const slice = run.text.slice(cursor, end);
    if (slice.length > 0) {
      out.push({ ...run, text: slice });
    }
  };
  for (const span of spans) {
    const resolved = resolveBareRef({ context, span });
    if (resolved === undefined) {
      continue;
    }
    keepText({ end: span.start });
    out.push({ kind: "link", text: resolved.label, url: resolved.url });
    cursor = span.end;
  }
  keepText({ end: run.text.length });
  return out;
}

/**
 * One cell's content, with every resolvable bare reference promoted to a `link` run.
 *
 * Byte-identical to its input when the content carries no bare reference, which is what lets this sit
 * unconditionally in front of every pull-request write without moving an untouched body by a byte.
 *
 * @param content the composed cell content
 * @param context what the caller knows about the destination — the form's `target` names the repo directly
 * @returns the content with resolvable bare references replaced by `link` runs, in the same order
 */
export function linkifyContent({ content, context }: { content: Content; context: BareRefContext }): Content {
  return content.flatMap((run) => (convertibleInline(run) ? linkifyInline({ context, run }) : [run]));
}

/** The bare references a cell's content STILL carries after linkifying — always unresolvable by construction. */
function bareRefResidueOfContent({
  content,
  context,
}: {
  content: Content;
  context: BareRefContext;
}): readonly BareRefSpan[] {
  return content.flatMap((run) =>
    convertibleInline(run)
      ? scanBareRefs({ context, text: run.text }).filter((span) => resolveBareRef({ context, span }) === undefined)
      : [],
  );
}

/**
 * The residue issues for one cell's content, after linkifying has already had its turn.
 *
 * @param content the linkified cell content
 * @param context what the caller knows about the destination
 * @param path the JSON path of the cell, for the issue
 * @returns one issue per surviving bare reference
 */
function bareRefIssuesOfContent({
  content,
  context,
  path,
}: {
  content: Content;
  context: BareRefContext;
  path: readonly (string | number)[];
}): readonly BareRefIssue[] {
  return bareRefResidueOfContent({ content, context }).map((span) => ({
    message: bareRefRefusalMessage({ context, span }),
    path,
  }));
}

/** One leaf block (para/code/image), linkified. Only `para` carries prose to touch. */
function linkifyProofBlockLeaf({ block, context }: { block: ProofBlockLeaf; context: BareRefContext }): ProofBlockLeaf {
  return block.kind === "para" ? { ...block, content: linkifyContent({ content: block.content, context }) } : block;
}

/** One leaf's surviving residue, addressed to its own block. */
function bareRefIssuesOfProofBlockLeaf({
  block,
  context,
  path,
}: {
  block: ProofBlockLeaf;
  context: BareRefContext;
  path: readonly (string | number)[];
}): readonly BareRefIssue[] {
  return block.kind === "para"
    ? bareRefIssuesOfContent({ content: block.content, context, path: [...path, "content"] })
    : [];
}

/**
 * A GitHub top-level comment, with every resolvable bare reference in `summary` and `detail` promoted to a
 * `link` run.
 *
 * @param artifact the composed comment
 * @param context what the caller knows about the destination
 * @returns the comment with resolvable bare references replaced by `link` runs
 */
export function linkifyCommentArtifact({
  artifact,
  context,
}: {
  artifact: GithubCommentArtifact;
  context: BareRefContext;
}): GithubCommentArtifact {
  return {
    ...artifact,
    ...(artifact.detail !== undefined
      ? { detail: artifact.detail.map((block) => linkifyProofBlockLeaf({ block, context })) }
      : {}),
    summary: linkifyContent({ content: artifact.summary, context }),
  };
}

/**
 * The residue issues across a whole GitHub comment, after linkifying has already had its turn.
 *
 * @param artifact the linkified comment
 * @param context what the caller knows about the destination
 * @returns one issue per surviving bare reference, addressed to the field it is in
 */
export function bareRefIssuesOfCommentArtifact({
  artifact,
  context,
}: {
  artifact: GithubCommentArtifact;
  context: BareRefContext;
}): readonly BareRefIssue[] {
  const summaryIssues = bareRefIssuesOfContent({ content: artifact.summary, context, path: ["summary"] });
  // `detail` is optional on a comment, exactly as `linkifyCommentArtifact` above reads it: none, no issues there.
  const { detail } = artifact;
  if (detail === undefined) {
    return [...summaryIssues];
  }
  return [
    ...summaryIssues,
    ...detail.flatMap((block, index) => bareRefIssuesOfProofBlockLeaf({ block, context, path: ["detail", index] })),
  ];
}

/** Every image source and quote source link a form carries — the URLs that sit outside its content cells. */
function imageUrlsOf({ form }: { form: PrBody }): readonly string[] {
  return [form.problemProof, form.solutionProof].flatMap((slot) => {
    if (slot.kind === "screenshot") {
      return [slot.image.url];
    }
    return slot.kind === "quote" && slot.source.kind === "link" ? [slot.source.url] : [];
  });
}

/**
 * Every GitHub object number the form ALREADY names by a full link — its magnitude evidence.
 *
 * Read structurally rather than off rendered prose, because a form's references live in `link` runs and image
 * sources, which no text scan would see. Call this BEFORE linkifying: after it, a bare reference this pass would
 * have refused has already become a link attesting to the very repo it was wrongly resolved against.
 *
 * @param form the composed pull-request form, before linkifying
 * @returns one attestation per numbered GitHub URL the form carries, duplicates included
 */
export function attestedNumbersOfPrForm({ form }: { form: PrBody }): readonly AttestedNumber[] {
  const linkUrls = contentFieldsOf({ body: form }).flatMap((field) =>
    field.content.flatMap((run) => (run.kind === "link" ? [run.url] : [])),
  );
  return attestedNumbersInUrls({ urls: [...linkUrls, ...imageUrlsOf({ form })] });
}

/**
 * A complete pull-request form, with every resolvable bare reference in every authored cell promoted to a
 * `link` run.
 *
 * @param form the composed pull-request form
 * @param context what the caller knows about the destination
 * @returns the form with resolvable bare references replaced by `link` runs
 */
export function linkifyPrForm<F extends PrBody>({ form, context }: { form: F; context: BareRefContext }): F {
  return mapContentFields({ body: form, map: ({ content }) => linkifyContent({ content, context }) });
}

/**
 * The residue issues across a whole pull-request form, after linkifying has already had its turn.
 *
 * @param form the linkified pull-request form
 * @param context what the caller knows about the destination
 * @returns one issue per surviving bare reference, addressed to the field it is in
 */
export function bareRefIssuesOfPrForm({
  form,
  context,
}: {
  form: PrBody;
  context: BareRefContext;
}): readonly BareRefIssue[] {
  return contentFieldsOf({ body: form }).flatMap((field) =>
    bareRefIssuesOfContent({ content: field.content, context, path: field.path }),
  );
}
