/**
 * The Linear COMMENT vocabulary — the second thing this door writes into an issue, and deliberately a
 * different shape from the issue body itself.
 *
 * An issue description is a document: it has named sections, it is replaced wholesale, and it is read by
 * whoever picks the ticket up. A comment is a MESSAGE: it lands in someone's inbox, it is appended and never
 * replaced, and its whole job is to say one thing and show where that thing came from. So it reuses the
 * issue's block vocabulary (`./types.ts`) for its detail — markdown positioning is the same problem — and
 * nothing else.
 *
 * ## Its shape is rule 7, not a preference
 *
 * "No walls of text, ever, on any outbound surface" makes the arrangement structural: `summary` is the whole
 * message a reader sees without acting, and `detail` plus `evidence` render inside Linear's own collapsible.
 * The cap on `summary` is enforced by the schema, so an over-long lead is REFUSED rather than truncated —
 * the same choice `../artifact/schema.ts` makes for a Slack card's above-the-fold run.
 *
 * ## Why `evidence` is required
 *
 * This is the one field that is about content rather than structure, and it is here on purpose. The comment
 * form exists so an agent can report what it found on a ticket, and the standing rule for that report is
 * that every claim links to the record it came from. A comment with no link is a claim with no provenance —
 * and unlike a wall of text, nothing downstream can detect it after the fact. A comment that genuinely has
 * no evidence is one a human should type into Linear directly; this door does not need to be able to send it.
 */
import type { SectionBlock } from "./types.js";

/** One piece of evidence: what it is, and where to see it. */
interface CommentEvidence {
  readonly label: string;
  readonly url: string;
}

/** The body of one comment. */
export interface LinearCommentArtifact {
  /**
   * The whole message above the fold — one line, and capped.
   *
   * Not a heading and not a title: Linear shows a comment inline in the activity feed, so this IS the
   * comment as far as anyone scrolling past is concerned.
   */
  readonly summary: string;
  /** Optional ordered blocks, rendered inside the collapsible. */
  readonly detail?: readonly SectionBlock[] | undefined;
  /** Where the summary came from. Required and non-empty — see the module doc. */
  readonly evidence: readonly CommentEvidence[];
}

/** A comment on an issue's activity feed. */
export interface LinearIssueCommentFields {
  readonly issueId: string;
}

/**
 * A comment on a Linear DOCUMENT (an RFC, a spec), optionally anchored inline to a passage of it.
 *
 * `documentId` is the document's id or slug id. `quotedText` is the passage the comment answers, as a reader
 * sees it rendered — the door refuses one that is not in the document's current content, because an inline
 * comment anchored to text that is not there is pinned to nowhere.
 *
 * `parentId` makes it a REPLY in an existing thread on that document. A reply carries no `quotedText` — it
 * inherits its thread's anchor — and its parent must be a thread's ROOT comment on this same document, since
 * Linear threads one level deep; the door reads the document's comments and refuses anything else.
 *
 * A document comment may carry an EMPTY evidence list, the one exception to the module doc's rule: the quoted
 * passage is its provenance, and a reply to an RFC in a person's own voice does not grow an evidence fold.
 */
export interface LinearDocumentCommentFields {
  readonly documentId: string;
  readonly quotedText?: string | undefined;
  readonly parentId?: string | undefined;
}

/** The non-body fields of a comment write: the issue or the document it lands on. */
export type LinearCommentFields = LinearDocumentCommentFields | LinearIssueCommentFields;

/** Where a comment lands, with the discriminant a caller branches on. */
export type LinearCommentDestination =
  | { readonly kind: "issue"; readonly id: string }
  | {
      readonly kind: "document";
      readonly id: string;
      readonly quotedText: string | undefined;
      readonly parentId: string | undefined;
    };

/**
 * Name a comment's destination once, so every caller branches on `kind` rather than on which key is present.
 *
 * @param fields the validated destination fields
 * @returns the destination, discriminated
 */
export function commentDestination({ fields }: { fields: LinearCommentFields }): LinearCommentDestination {
  if ("issueId" in fields) {
    return { id: fields.issueId, kind: "issue" };
  }
  return { id: fields.documentId, kind: "document", parentId: fields.parentId, quotedText: fields.quotedText };
}

/** A complete comment write: the destination (an issue or a document) plus the body. */
export interface LinearCommentForm {
  readonly fields: LinearCommentFields;
  readonly artifact: LinearCommentArtifact;
}

/**
 * The three relation kinds this door writes.
 *
 * Linear's `IssueRelationType` also carries `similar`, which is deliberately not exposed: it is what
 * Linear's own similarity engine produces, not an assertion a caller makes, and an enum arm nothing writes
 * is an arm nothing tests.
 *
 * `blocks` is DIRECTED — `issueId` blocks `relatedIssueId` — while `related` and `duplicate` read the same
 * either way. That asymmetry is the whole reason the form names the two issues rather than taking a pair.
 */
type LinearRelationKind = "blocks" | "duplicate" | "related";

/** The fields of a relation write. There is no body: a relation is an edge, not a document. */
export interface LinearRelationFields {
  readonly issueId: string;
  readonly relatedIssueId: string;
  readonly type: LinearRelationKind;
}

/** A complete relation write. */
export interface LinearRelationForm {
  readonly fields: LinearRelationFields;
}
