/**
 * The DOCUMENT lane of the Linear write API — the long-form page a proposal is written into.
 *
 * Its own file and its own factory for the reason `./writeInitiative.ts` records: a separate seam keeps every
 * existing fake of `LinearWriteApi` valid, and the client, pacer and quota scope still come from `./write.ts`'s
 * `makeLinearSendContext`, because Linear's quota is per-USER and a second pacer over one budget holds neither
 * half of it.
 *
 * A document CAN be updated, unlike a comment or a status update: a page is read when it is opened rather than
 * pushed to anyone's inbox, so re-rendering one from its form changes what the next reader sees and rewrites
 * nothing somebody was already notified about.
 */
import { LinearDocument } from "@linear/sdk";

import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { type RateScheduler } from "../../lib/resilience.js";
import { type ResultAsync } from "../../lib/result.js";

import type { LinearWritePrivacy } from "../../outbound/linear/writePrivacy.js";
import { type LinearRequest } from "./transport.js";
import { makeLinearSendContext, type WrittenObject } from "./write.js";
import { deleteVia, mutateVia, readVia, str } from "./writeGraphql.js";

/**
 * What a document read-back yields.
 *
 * `content` is `string | undefined` rather than defaulting to `""`, for the reason `./write.ts`'s `ReadIssue`
 * gives its description: `""` means Linear stored an empty page, `undefined` means it returned no content at
 * all, and a caller comparing what it sent needs the two apart. The three parent ids are each read from the
 * nested reference the `Document` fragment selects; a team-scoped document carries none of them, because the
 * fragment selects no team.
 */
export interface ReadLinearDocument {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly slugId: string;
  readonly content: string | undefined;
  readonly updatedAt: string;
  readonly projectId: string | undefined;
  readonly initiativeId: string | undefined;
  readonly issueId: string | undefined;
}

/**
 * Every operation this lane sends, bound to `@linear/sdk`'s own generated document — the binding
 * `./writeGraphql.ts` makes for every other lane. The mutation payloads echo `{ id }` alone, so a title, URL
 * or stored content comes from the READ-BACK.
 */
const CREATE_DOCUMENT_MUTATION = String(LinearDocument.CreateDocumentDocument);
const UPDATE_DOCUMENT_MUTATION = String(LinearDocument.UpdateDocumentDocument);
const READ_DOCUMENT_QUERY = String(LinearDocument.DocumentDocument);
const DELETE_DOCUMENT_MUTATION = String(LinearDocument.DeleteDocumentDocument);

/** One nested reference's id, or undefined when the reference is absent or null. */
function nestedId({ node, key }: { node: Record<string, unknown>; key: string }): string | undefined {
  const ref = node[key];
  return isRecord(ref) ? str({ key: "id", node: ref }) : undefined;
}

/**
 * Shape a document read-back. A MISSING document is `undefined` rather than an error, for the reason
 * `./writeReadBack.ts`'s `readIssueFrom` records: "this id does not exist" is a real answer.
 *
 * @param data the raw GraphQL data
 * @returns the document, or undefined when Linear has no such id
 */
export function readDocumentFrom({ data }: { data: unknown }): ReadLinearDocument | undefined {
  const node = isRecord(data) ? data["document"] : undefined;
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ key: "id", node });
  const title = str({ key: "title", node });
  const url = str({ key: "url", node });
  const slugId = str({ key: "slugId", node });
  const updatedAt = str({ key: "updatedAt", node });
  if (id === undefined || title === undefined || url === undefined || slugId === undefined || updatedAt === undefined) {
    return undefined;
  }
  // Read RAW rather than through `str`, which collapses `""` to undefined — see the interface doc.
  const rawContent = node["content"];
  return {
    content: typeof rawContent === "string" ? rawContent : undefined,
    id,
    initiativeId: nestedId({ key: "initiative", node }),
    issueId: nestedId({ key: "issue", node }),
    projectId: nestedId({ key: "project", node }),
    slugId,
    title,
    updatedAt,
    url,
  };
}

/** The document methods, exposed as their own seam for the reason this module's doc records. */
export interface LinearDocumentWriteApi {
  /** Create a document at a CALLER-CHOSEN id. Never retried: a lost response may still have created it. */
  createDocument(args: {
    id: string;
    input: Readonly<Record<string, unknown>>;
  }): ResultAsync<WrittenObject, IngestError>;
  /** Replace fields on an existing document. Never retried. */
  updateDocument(args: {
    id: string;
    input: Readonly<Record<string, unknown>>;
  }): ResultAsync<WrittenObject, IngestError>;
  /** Read one document back by id. Retries transiently, the same posture every read-back here takes. */
  readDocument(args: { id: string }): ResultAsync<ReadLinearDocument | undefined, IngestError>;
  /** Delete a document. TEST-CLEANUP ONLY — no CLI verb exposes this, same as `deleteIssue`. */
  deleteDocument(args: { id: string }): ResultAsync<boolean, IngestError>;
}

/**
 * The Linear DOCUMENT write API, bound to a token.
 *
 * @param token the token the writes are made as
 * @param request the GraphQL transport seam; omit for the production `rawRequest`
 * @param scheduler the shared rate scheduler; omit for the production one, which is what keeps these writes
 *   inside the same rate block as every other Linear call
 * @param privacy the outbound privacy policy every mutation is judged under, from the verb's own home
 * @returns the document write API
 */
export function makeLinearDocumentWriteApi({
  token,
  request,
  scheduler,
  privacy,
}: {
  token: string;
  request?: LinearRequest;
  scheduler?: RateScheduler;
  privacy: LinearWritePrivacy;
}): LinearDocumentWriteApi {
  const ctx = makeLinearSendContext({ privacy, request, scheduler, token });
  return {
    createDocument: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "documentCreate",
        node: "document",
        operation: "linear.documentCreate",
        query: CREATE_DOCUMENT_MUTATION,
        // The caller-chosen id rides INSIDE the input, as every create here does — that is what makes the
        // write addressable before it is acknowledged.
        variables: { input: { ...input, id } },
      }),
    deleteDocument: ({ id }) =>
      deleteVia({
        ctx,
        field: "documentDelete",
        id,
        operation: "linear.documentDelete",
        query: DELETE_DOCUMENT_MUTATION,
      }),
    readDocument: ({ id }) =>
      readVia({ ctx, id, operation: "linear.document.readBack", query: READ_DOCUMENT_QUERY, shape: readDocumentFrom }),
    updateDocument: ({ id, input }) =>
      mutateVia({
        ctx,
        field: "documentUpdate",
        node: "document",
        operation: "linear.documentUpdate",
        query: UPDATE_DOCUMENT_MUTATION,
        variables: { id, input },
      }),
  };
}
