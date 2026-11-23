/**
 * BARE REFERENCES in a Linear body — resolving `#N`/`SUP-123` into real markdown links, and reporting
 * whatever `../linkify/bareRefs.ts` could not resolve.
 *
 * `./types.ts`'s own header states the rule this module has to respect: text here is MARKDOWN, not the
 * `InlineRun` vocabulary `../artifact/bareRefRuns.ts` walks, so a resolved reference is spliced in as
 * `[label](url)` (via `../linkify/bareRefs.ts`'s `linkifyMarkdown`) rather than as a typed run. `./schema.ts`
 * deliberately does NOT scan prose — "no prose scanning, no banned terms… IN THIS FILE" — and this module
 * follows the same discipline: it is a STRUCTURAL rewrite (a reference becomes a link), never a content
 * judgement, so it belongs at the same door layer `../../cli/aboveFoldDoor.ts` already occupies rather than
 * inside `./schema.ts` itself.
 *
 * Which fields it reaches — including `aiPrompt`, which renders collapsed but is still read once a reader
 * expands it — is `./mapText.ts`'s decision, not this file's. That fan-out moved there when `./mentionRewrite.ts`
 * became the second gate needing exactly the same set: two copies of it is how one gate quietly stops
 * covering a nested list item.
 */
import {
  type BareRefContext,
  type BareRefIssue,
  bareRefRefusalMessage,
  linkifyMarkdown,
  linkifyPlainUrl,
} from "../linkify/bareRefs.js";

import type { LinearCommentArtifact } from "./commentTypes.js";
import type { LinearInitiativeFields, LinearInitiativeUpdateArtifact } from "./initiativeTypes.js";
import {
  mapCommentArtifactText,
  mapDocumentContentText,
  mapIssueArtifactText,
  mapProjectUpdateArtifactText,
  type TextMapper,
} from "./mapText.js";
import type { LinearMilestoneFields, LinearProjectFields } from "./projectTypes.js";
import type { LinearProjectUpdateArtifact } from "./projectUpdateTypes.js";
import type { FreeformBlock, LinearIssueArtifact } from "./types.js";

/**
 * The rewrite itself: one authored string, its resolvable references spliced in as links, its residue
 * reported at its own path.
 *
 * @param context what the references can resolve against
 * @returns the mapper `./mapText.ts` applies to every authored string
 */
function bareRefMapper({ context }: { context: BareRefContext }): TextMapper {
  return ({ text, path }) => {
    const linkified = linkifyMarkdown({ context, text });
    return {
      issues: linkified.unresolved.map((span) => ({
        message: bareRefRefusalMessage({ context: linkified.context, span }),
        path,
      })),
      text: linkified.text,
    };
  };
}

/** The result of linkifying a whole issue body: the rewritten artifact, plus every reference still bare. */
interface LinkifiedIssueArtifact {
  readonly artifact: LinearIssueArtifact;
  readonly issues: readonly BareRefIssue[];
}

/**
 * A complete Linear issue body, with every resolvable bare reference rewritten as a markdown link.
 *
 * @param artifact the composed issue body, structured or freeform
 * @param context what the caller knows about the destination
 * @returns the rewritten artifact, plus every reference still bare afterward
 */
export function linkifyIssueArtifact({
  artifact,
  context,
}: {
  artifact: LinearIssueArtifact;
  context: BareRefContext;
}): LinkifiedIssueArtifact {
  return mapIssueArtifactText({ artifact, map: bareRefMapper({ context }) });
}

/** The result of linkifying a whole comment: the rewritten artifact, plus every reference still bare. */
interface LinkifiedCommentArtifact {
  readonly artifact: LinearCommentArtifact;
  readonly issues: readonly BareRefIssue[];
}

/**
 * A complete Linear comment, with every resolvable bare reference rewritten as a markdown link.
 *
 * @param artifact the composed comment
 * @param context what the caller knows about the destination
 * @returns the rewritten artifact, plus every reference still bare afterward
 */
export function linkifyCommentArtifact({
  artifact,
  context,
}: {
  artifact: LinearCommentArtifact;
  context: BareRefContext;
}): LinkifiedCommentArtifact {
  return mapCommentArtifactText({ artifact, map: bareRefMapper({ context }) });
}
/** The result of linkifying a project update: the rewritten artifact, plus every reference still bare. */
interface LinkifiedProjectUpdateArtifact {
  readonly artifact: LinearProjectUpdateArtifact;
  readonly issues: readonly BareRefIssue[];
}

/**
 * Rewrite every bare reference in a project update, in the summary and in the detail blocks.
 *
 * This one carries more weight than the comment's does: a status update's claims ARE ticket references
 * ("JJJJ-690 and JJJJ-564 shipped"), so this gate is what turns those claims into things a reader can open.
 * `./projectUpdateTypes.ts` says why that lets the form leave `evidence` optional.
 *
 * @param artifact the validated project-update body
 * @param context what the references can resolve against
 * @returns the rewritten artifact and every reference that stayed bare
 */
export function linkifyProjectUpdateArtifact({
  artifact,
  context,
}: {
  artifact: LinearProjectUpdateArtifact;
  context: BareRefContext;
}): LinkifiedProjectUpdateArtifact {
  return mapProjectUpdateArtifactText({ artifact, map: bareRefMapper({ context }) });
}

/** The result of linkifying a project's fields: the rewritten fields, plus every reference still bare. */
interface LinkifiedProjectFields {
  readonly fields: LinearProjectFields;
  readonly issues: readonly BareRefIssue[];
}

/**
 * A `linear project create|update` form's `description`, with every resolvable bare reference rewritten.
 *
 * `description` is a project's plain single-line summary, never markdown (see `../../cli/commands/linear/
 * projectSchema.ts`'s module doc) — a resolved reference here is spliced in as its bare URL via
 * `../linkify/bareRefs.ts`'s `linkifyPlainUrl`, never `[label](url)`, because a plain field has no link
 * syntax to render.
 *
 * @param fields the validated project fields
 * @param context what the caller knows about the destination
 * @returns the rewritten fields, plus every reference still bare afterward
 */
export function linkifyProjectFields({
  fields,
  context,
}: {
  fields: LinearProjectFields;
  context: BareRefContext;
}): LinkifiedProjectFields {
  if (fields.description === undefined) {
    return { fields, issues: [] };
  }
  const linkified = linkifyPlainUrl({ context, text: fields.description });
  return {
    fields: { ...fields, description: linkified.text },
    issues: linkified.unresolved.map((span) => ({
      message: bareRefRefusalMessage({ context: linkified.context, span }),
      path: ["description"],
    })),
  };
}

/**
 * A document body, with every resolvable bare reference rewritten as a markdown link.
 *
 * A proposal's claims are as often ticket references as a status update's are, and its body is markdown, so
 * a resolved reference becomes `[label](url)` exactly as it does in an issue body.
 *
 * @param content the validated document blocks
 * @param context what the references can resolve against
 * @returns the rewritten blocks, plus every reference still bare afterward
 */
export function linkifyDocumentContent({
  content,
  context,
}: {
  content: readonly FreeformBlock[];
  context: BareRefContext;
}): { readonly content: readonly FreeformBlock[]; readonly issues: readonly BareRefIssue[] } {
  return mapDocumentContentText({ content, map: bareRefMapper({ context }) });
}

/** The result of linkifying a milestone's fields: the rewritten fields, plus every reference still bare. */
interface LinkifiedMilestoneFields {
  readonly fields: LinearMilestoneFields;
  readonly issues: readonly BareRefIssue[];
}

/**
 * A `linear milestone create` form's `description`, with every resolvable bare reference rewritten as a
 * markdown link.
 *
 * A milestone's `description` IS genuine markdown per Linear's own field doc (see `projectTypes.ts`'s module
 * doc), unlike a project's plain-text one, so this reuses the same `[label](url)` splice every issue/comment
 * body already gets rather than `linkifyProjectFields`'s bare-URL one.
 *
 * @param fields the validated milestone fields
 * @param context what the caller knows about the destination
 * @returns the rewritten fields, plus every reference still bare afterward
 */
export function linkifyMilestoneFields({
  fields,
  context,
}: {
  fields: LinearMilestoneFields;
  context: BareRefContext;
}): LinkifiedMilestoneFields {
  if (fields.description === undefined) {
    return { fields, issues: [] };
  }
  const mapped = bareRefMapper({ context })({ path: ["description", "text"], text: fields.description });
  return { fields: { ...fields, description: mapped.text }, issues: mapped.issues };
}

/** The result of linkifying an initiative update: the rewritten artifact, plus every reference still bare. */
interface LinkifiedInitiativeUpdateArtifact {
  readonly artifact: LinearInitiativeUpdateArtifact;
  readonly issues: readonly BareRefIssue[];
}

/**
 * Rewrite every bare reference in an initiative update, in the summary and in the detail blocks.
 *
 * Runs the project update's own mapper: the two artifacts carry the same three fields and are rendered by
 * the same function (`./render.ts`'s `renderInitiativeUpdateBody` delegates), so a second traversal here
 * could only ever be the same walk with a chance to drift out of step with it.
 *
 * @param artifact the validated initiative-update body
 * @param context what the references can resolve against
 * @returns the rewritten artifact and every reference that stayed bare
 */
export function linkifyInitiativeUpdateArtifact({
  artifact,
  context,
}: {
  artifact: LinearInitiativeUpdateArtifact;
  context: BareRefContext;
}): LinkifiedInitiativeUpdateArtifact {
  return mapProjectUpdateArtifactText({ artifact, map: bareRefMapper({ context }) });
}

/** The result of linkifying an initiative's fields: the rewritten fields, plus every reference still bare. */
interface LinkifiedInitiativeFields {
  readonly fields: LinearInitiativeFields;
  readonly issues: readonly BareRefIssue[];
}

/**
 * A `linear initiative create|update` form's `description`, with every resolvable bare reference rewritten.
 *
 * `description` is an initiative's plain single-line summary, never markdown — the same call
 * `./initiativeSchema.ts` makes and the same one `linkifyProjectFields` documents — so a resolved reference
 * is spliced in as its bare URL, never `[label](url)`.
 *
 * @param fields the validated initiative fields
 * @param context what the caller knows about the destination
 * @returns the rewritten fields, plus every reference still bare afterward
 */
export function linkifyInitiativeFields({
  fields,
  context,
}: {
  fields: LinearInitiativeFields;
  context: BareRefContext;
}): LinkifiedInitiativeFields {
  if (fields.description === undefined) {
    return { fields, issues: [] };
  }
  const linkified = linkifyPlainUrl({ context, text: fields.description });
  return {
    fields: { ...fields, description: linkified.text },
    issues: linkified.unresolved.map((span) => ({
      message: bareRefRefusalMessage({ context: linkified.context, span }),
      path: ["description"],
    })),
  };
}
