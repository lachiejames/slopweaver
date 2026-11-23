/**
 * Find ONE comment among a Linear document's comments — what a document reply checks its `parentId` against
 * before it is sent.
 *
 * Paged to the end rather than bounded: "that comment is not on this document" is only true once every page
 * has been read, so a first page that does not hold it proves nothing. The connection is the document's own,
 * so a comment on a different document resolves as absent here by construction.
 */
import { LinearDocument } from "@linear/sdk";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "./errors.js";
import type { LinearReadRequest } from "./read.js";

/** The SDK's own document-comments query: `document(id).comments(first, after, includeArchived)`. */
const DOCUMENT_COMMENTS_QUERY = String(LinearDocument.Document_CommentsDocument);

/**
 * Comments per page. Kept modest because the SDK's `Comment` fragment carries the WHOLE document content on
 * every comment node, so a page's bytes scale with the document's length times this number.
 */
const PAGE_SIZE = 50;

/** The fields of a found comment a reply needs: whether it is itself a reply, and what it says. */
export interface LinearDocumentComment {
  readonly id: string;
  /** The comment this one replies to; `undefined` for a thread's root. */
  readonly parentId: string | undefined;
  /** Its markdown body, as Linear stores it. */
  readonly body: string | undefined;
}

/** One page of the connection, reduced to what the search walks. */
interface CommentPage {
  readonly comments: readonly LinearDocumentComment[];
  /** The cursor of the page after this one; `undefined` only on the last page. */
  readonly next: string | undefined;
}

/**
 * Reduce one provider response to a page, or say why it is not one.
 *
 * Strict on purpose, because an answer of "absent" is only as good as the pages behind it: a node with no id
 * could BE the comment searched for, and a `pageInfo` that does not say whether another page follows cannot
 * end the search — so both refuse as a read failure rather than being read as "not here" and "no more".
 *
 * @param response the `document_comments` response
 * @param documentId the document asked about, for the error
 * @param opening whether this is the read's first page, which must say nothing comes before it
 * @returns the page, or a named read failure
 */
function pageOf({
  response,
  documentId,
  opening,
}: {
  response: unknown;
  documentId: string;
  opening: boolean;
}): Result<CommentPage, LinearLiveError> {
  const document = isRecord(response) ? response["document"] : undefined;
  if (!isRecord(document)) {
    return err(LinearLiveErrors.notFound({ identity: documentId, kind: "document" }));
  }
  const connection = document["comments"];
  const nodes = isRecord(connection) ? connection["nodes"] : undefined;
  const pageInfo = isRecord(connection) ? connection["pageInfo"] : undefined;
  if (!Array.isArray(nodes) || !isRecord(pageInfo)) {
    return err(
      LinearLiveErrors.readFailed({ message: `Linear returned no comments connection for document ${documentId}` }),
    );
  }
  const hasNextPage = pageInfo["hasNextPage"];
  const hasPreviousPage = pageInfo["hasPreviousPage"];
  const comments = nodes.flatMap(commentOf);
  // Every page states both directions; forward paging may report `false` after a cursor, per Relay.
  const unstated = typeof hasNextPage !== "boolean" || typeof hasPreviousPage !== "boolean";
  const openedMidway = opening && hasPreviousPage !== false;
  if (unstated || comments.length !== nodes.length || openedMidway) {
    return err(
      LinearLiveErrors.readFailed({
        message: `Linear returned a malformed comments page for document ${documentId}, so absence cannot be read from it`,
      }),
    );
  }
  if (!hasNextPage) {
    return ok({ comments, next: undefined });
  }
  const endCursor = pageInfo["endCursor"];
  if (typeof endCursor !== "string" || endCursor.length === 0) {
    // Refused here, before any match is looked for, so no comment is ever taken off a malformed page.
    return err(
      LinearLiveErrors.readFailed({
        message: `Linear said document ${documentId} has more comments but gave no cursor to read them`,
      }),
    );
  }
  return ok({ comments, next: endCursor });
}

/**
 * Whether a node states its parent, twice and consistently. The SDK's `Comment` fragment selects both `parentId`
 * and the `parent { id }` relation (live document reads carry both), so a root is `null` in each and a reply the
 * same non-empty id in each. A node whose two disagree says it is both a root and a reply, and is malformed
 * rather than read by whichever field happens to be checked.
 *
 * @param node one comment node
 * @returns true when both fields are stated and name the same parent
 */
function parentAgrees({ node }: { node: Record<string, unknown> }): boolean {
  const parentId = node["parentId"];
  const relation = node["parent"];
  if (parentId === null) {
    return relation === null;
  }
  if (typeof parentId !== "string" || parentId.length === 0 || !isRecord(relation)) {
    return false;
  }
  return relation["id"] === parentId;
}

/**
 * One comment node, reduced — or nothing, for a node that is not a comment with an id and a STATED parent.
 *
 * A root is `parentId: null`, which the SDK's `Comment` fragment always selects. A node missing the field,
 * carrying anything but a non-empty string or `null`, or contradicted by its own `parent` relation, says
 * nothing about whether it is a root, and reading it as one would let a reply be sent beneath a reply — so it is malformed, never a root.
 *
 * @param node one element of the connection's `nodes`
 * @returns the comment as a one-element list, or an empty one the caller counts as malformed
 */
function commentOf(node: unknown): LinearDocumentComment[] {
  if (!isRecord(node)) {
    return [];
  }
  const id = node["id"];
  const parentId = node["parentId"];
  const hasId = typeof id === "string" && id.length > 0;
  if (!hasId || !parentAgrees({ node })) {
    return [];
  }
  const body = node["body"];
  return [
    {
      body: typeof body === "string" ? body : undefined,
      id,
      parentId: typeof parentId === "string" ? parentId : undefined,
    },
  ];
}

/**
 * Record one page's ids, refusing the first one the read has already listed. ANY repeat makes the read
 * contradictory, not only one of the comment searched for: two entries for one id may disagree about its parent,
 * and a read that cannot keep its own identities straight proves nothing about the rest.
 *
 * @param comments the page's comments
 * @param seen every id listed so far, extended in place
 * @param documentId the document asked about, for the error
 * @returns nothing on a page of new ids, or a named read failure naming the repeat
 */
function recordIds({
  comments,
  seen,
  documentId,
}: {
  comments: readonly LinearDocumentComment[];
  seen: Set<string>;
  documentId: string;
}): Result<void, LinearLiveError> {
  for (const { id } of comments) {
    if (seen.has(id)) {
      return err(
        LinearLiveErrors.readFailed({
          message: `Linear listed comment ${id} twice on document ${documentId}, so which thread it is in cannot be read`,
        }),
      );
    }
    seen.add(id);
  }
  return ok(undefined);
}

/**
 * One page request's variables: archived comments included, since an archived root still holds its thread.
 *
 * @param documentId the document's canonical id
 * @param after the cursor to read past; `undefined` for the opening page
 * @returns the `document_comments` variables
 */
function variablesFor({
  documentId,
  after,
}: {
  documentId: string;
  after: string | undefined;
}): Readonly<Record<string, unknown>> {
  const base = { first: PAGE_SIZE, id: documentId, includeArchived: true };
  if (after === undefined) {
    return base;
  }
  return { ...base, after };
}

/**
 * Find one comment on one document, reading EVERY page: a match is only trusted once no other entry for the same
 * id can contradict it, so the search never stops early.
 *
 * @param documentId the document's canonical id
 * @param commentId the comment to find
 * @param request the shared safe GraphQL transport
 * @returns the comment, `undefined` once every page has been read without it, or a named read failure —
 *   including a page that claims another page and hands back no cursor to reach it, or a cursor already
 *   followed, neither of which is absence
 */
export async function findLinearDocumentComment({
  documentId,
  commentId,
  request,
}: {
  documentId: string;
  commentId: string;
  request: LinearReadRequest;
}): Promise<Result<LinearDocumentComment | undefined, LinearLiveError>> {
  const seen = new Set<string>();
  let match: LinearDocumentComment | undefined;
  const followed = new Set<string>();
  let after: string | undefined;
  for (;;) {
    const response = await request({ query: DOCUMENT_COMMENTS_QUERY, variables: variablesFor({ after, documentId }) });
    if (response.isErr()) {
      return err(response.error);
    }
    const page = pageOf({ documentId, opening: after === undefined, response: response.value }).andThen((read) =>
      recordIds({ comments: read.comments, documentId, seen }).map(() => read),
    );
    if (page.isErr()) {
      return err(page.error);
    }
    // Ids are unique across the whole read by now, so at most one page ever holds the comment searched for.
    const onThisPage = page.value.comments.find((comment) => comment.id === commentId);
    if (onThisPage !== undefined) {
      match = onThisPage;
    }
    const next = page.value.next;
    if (next === undefined) {
      return ok(match);
    }
    if (followed.has(next)) {
      return err(
        LinearLiveErrors.readFailed({
          message: `Linear handed back cursor ${next} twice for document ${documentId}'s comments, so the read would never end`,
        }),
      );
    }
    followed.add(next);
    after = next;
  }
}
