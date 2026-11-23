/**
 * GraphQL transport and payload parsing for `./write.ts`'s mutation seam.
 *
 * Split out of `write.ts` (file-size ratchet) rather than merged into `./fetch.ts`: this is still the WRITE
 * side — the query/mutation strings, the false-success parsing (a 200 that did not actually create anything),
 * and the `sendGraphql`/`mutateVia`/`deleteVia`/`readVia` sequence every mutation method in `write.ts` and
 * `./writeCreateOnly.ts` is built from. `write.ts` owns the public `LinearWriteApi` shape and wiring; this file owns how one round trip
 * to Linear is sent and how its payload is turned into a typed identity or a typed error.
 */
import { type LinearClient, LinearDocument } from "@linear/sdk";

import { isGraphqlMutation } from "../../lib/graphqlOperation.js";
import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { RateScheduler } from "../../lib/resilience.js";
import { err, ok, type Result, type ResultAsync } from "../../lib/result.js";
import { invalidDatadogHostHatchOpen, refuseInvalidDatadogHost } from "../../outbound/invalidDatadogHost.js";
import { type LinearWritePrivacy, refuseLinearWriteOnPrivacy } from "../../outbound/linear/writePrivacy.js";
import { type LinearPayloadError, LinearPayloadErrors } from "./errors.js";
import type { LinearRequest } from "./transport.js";
import type { WrittenObject, WrittenRelation } from "./write.js";

/**
 * Every document this lane sends, bound to `@linear/sdk`'s own generated operation.
 *
 * `String(...)` rather than the value itself because the SDK ships each document as a `TypedDocumentString`
 * — a `String` object carrying phantom result/variable types — and the transport signs `query: string`. The
 * types are recovered at the call site by the mapper each `mutateVia` is given, not by this binding.
 *
 * Two consequences of using the SDK's selections rather than our own are load-bearing and are handled by the
 * callers rather than hidden here:
 *
 * 1. **A mutation payload returns `{ id }` and nothing else.** `IssuePayload`, `CommentPayload`,
 *    `ProjectPayload` and the rest select `__typename`, `lastSyncId`, `success` and the object's bare id —
 *    verified by reading the fragments out of the pinned bundle. Our own mutations used to return
 *    `id identifier url` in the same round trip. So a caller that needs an identifier or a URL takes it from
 *    the READ-BACK, which `src/cli/commands/linear/run.ts` already performs on every create and update
 *    because "the create's own response is not proof".
 * 2. **The read-back documents are far richer than ours were.** `IssueDocument` carries the whole `Issue`
 *    fragment — `identifier`, `url`, `title`, `description`, `updatedAt` and every other scalar — where
 *    `READ_QUERY` selected six fields. Nothing is lost on the read side; there is simply more of it.
 */
export const CREATE_MUTATION = String(LinearDocument.CreateIssueDocument);
export const UPDATE_MUTATION = String(LinearDocument.UpdateIssueDocument);
export const READ_QUERY = String(LinearDocument.IssueDocument);
export const DELETE_MUTATION = String(LinearDocument.DeleteIssueDocument);

export const CREATE_PROJECT_MUTATION = String(LinearDocument.CreateProjectDocument);
export const UPDATE_PROJECT_MUTATION = String(LinearDocument.UpdateProjectDocument);
export const READ_PROJECT_QUERY = String(LinearDocument.ProjectDocument);
export const DELETE_PROJECT_MUTATION = String(LinearDocument.DeleteProjectDocument);

export const CREATE_MILESTONE_MUTATION = String(LinearDocument.CreateProjectMilestoneDocument);
export const READ_MILESTONE_QUERY = String(LinearDocument.ProjectMilestoneDocument);
export const DELETE_MILESTONE_MUTATION = String(LinearDocument.DeleteProjectMilestoneDocument);

export const CREATE_COMMENT_MUTATION = String(LinearDocument.CreateCommentDocument);
export const READ_COMMENT_QUERY = String(LinearDocument.CommentDocument);
export const DELETE_COMMENT_MUTATION = String(LinearDocument.DeleteCommentDocument);

/**
 * The project-update trio.
 *
 * Note the collision this file has to live with, which the SDK's own naming makes sharper rather than
 * softer: `projectUpdate` is BOTH the root query that reads one of these AND the root mutation that edits a
 * PROJECT. The SDK resolves it by verb — `ProjectUpdateDocument` reads a project update, while
 * `UpdateProjectDocument` edits a project — so the two now differ by word order alone. They are not
 * interchangeable and a transposition compiles.
 */
export const CREATE_PROJECT_UPDATE_MUTATION = String(LinearDocument.CreateProjectUpdateDocument);
export const READ_PROJECT_UPDATE_QUERY = String(LinearDocument.ProjectUpdateDocument);
export const DELETE_PROJECT_UPDATE_MUTATION = String(LinearDocument.DeleteProjectUpdateDocument);

export const CREATE_RELATION_MUTATION = String(LinearDocument.CreateIssueRelationDocument);
export const READ_RELATION_QUERY = String(LinearDocument.IssueRelationDocument);
export const DELETE_RELATION_MUTATION = String(LinearDocument.DeleteIssueRelationDocument);

/**
 * A string field from a GraphQL node, or undefined when absent or the wrong type.
 *
 * @returns the field's string value, or `undefined`
 */
export function str({ node, key }: { node: Record<string, unknown>; key: string }): string | undefined {
  const value = node[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The success-checked object node inside a mutation payload, or a named reason it is not there.
 *
 * This is the shared half of every false success: the three shapes a mutation can take while still answering
 * 200 are the same whatever object it wrote, so they are decided once. What each caller still does for
 * itself is pull the fields IT needs out of the node — a project missing its `slugId` and an issue missing
 * its `identifier` are different failures and say so.
 *
 * Returns the reason rather than throwing so the caller reports WHICH false success happened.
 */
function payloadNode({
  data,
  field,
  node,
}: {
  data: unknown;
  field: string;
  node: string;
}): Result<Record<string, unknown>, LinearPayloadError> {
  if (!isRecord(data)) {
    return err(LinearPayloadErrors.noData());
  }
  const payload = data[field];
  if (!isRecord(payload)) {
    return err(LinearPayloadErrors.payloadMissing({ field }));
  }
  if (payload["success"] !== true) {
    return err(LinearPayloadErrors.unsuccessful({ field, success: payload["success"] }));
  }
  const value = payload[node];
  if (!isRecord(value)) {
    // `IssuePayload.issue` and its siblings are all `Maybe<T>` in Linear's schema, so this is a real shape
    // the API can return rather than a defensive impossibility. Treating it as success is how a write gets
    // reported as landed when nothing was stored.
    return err(LinearPayloadErrors.nodeMissing({ field, node }));
  }
  return ok(value);
}

/**
 * The id inside a mutation payload, or a named reason it is not there.
 *
 * ONE parser for every object kind, where there used to be five near-identical ones. That collapse is the
 * SDK's doing rather than a tidy-up: its payload fragments are uniform — `__typename`, `lastSyncId`,
 * `success`, and the written object as a bare `{ id }` — so `issueCreate`, `commentCreate`, `projectCreate`,
 * `projectUpdateCreate`, `issueRelationCreate` and `projectMilestoneCreate` now differ only in what the
 * payload field and the node are called.
 *
 * What a caller does NOT get here is an identifier, a URL, a name or a health. Our own mutations used to
 * echo those in the same round trip; the SDK's do not. They come from the read-back instead, which every
 * caller of this lane already performs because a create's own response was never proof
 * (`src/cli/commands/linear/run.ts`: "the create's own response is not proof").
 *
 * @internal — the parser {@link mutateVia} hands to every caller; nothing outside this file names it.
 * @param data the mutation response body
 * @param field the payload field to read, e.g. `issueCreate`
 * @param node the written object inside that payload, e.g. `issue`
 * @returns the written id, or the false-success reason
 */
export function identityFrom({
  data,
  field,
  node,
}: {
  data: unknown;
  field: string;
  node: string;
}): Result<WrittenObject, LinearPayloadError> {
  const parsed = payloadNode({ data, field, node });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const id = str({ key: "id", node: parsed.value });
  return id === undefined ? err(LinearPayloadErrors.idMissing({ field, node })) : ok({ id });
}

/** The `{ id }` a relation's endpoint issue echoes, or undefined when the nested node is absent/malformed. */
function issueRefFrom({ node }: { node: unknown }): string | undefined {
  return isRecord(node) ? str({ key: "id", node }) : undefined;
}

/**
 * A relation, shaped from a create payload's node or a read-back's node.
 *
 * Both endpoints are REQUIRED, and that is what makes the read-back worth performing: a relation whose
 * `relatedIssue` came back null joined nothing, and reporting "related" on it would be a claim about an edge
 * that does not exist.
 *
 * @returns the relation, or `undefined` when either endpoint is missing
 */
export function relationFrom({ node }: { node: Record<string, unknown> }): WrittenRelation | undefined {
  const id = str({ key: "id", node });
  const type = str({ key: "type", node });
  const issueId = issueRefFrom({ node: node["issue"] });
  const relatedIssueId = issueRefFrom({ node: node["relatedIssue"] });
  return id === undefined || type === undefined || issueId === undefined || relatedIssueId === undefined
    ? undefined
    : { id, issueId, relatedIssueId, type };
}

/**
 * Turn a false-success into a typed error carrying the reason.
 *
 * `parse` rather than `http`: the request succeeded and the transport behaved. What failed is that the
 * payload does not mean what its status implies, and classifying that as an HTTP fault would make it look
 * retryable to anything reading the kind.
 */
function payloadError({ operation, reason }: { operation: string; reason: string }): IngestError {
  return { kind: "parse", message: `${operation}: ${reason}`, operation, provider: "linear" };
}

/** What one GraphQL send needs. Grouped so the seam's methods stay one call each. */
export interface SendContext {
  readonly client: LinearClient;
  readonly request: LinearRequest | undefined;
  readonly gate: RateScheduler;
  readonly scopeId: string;
  /** The outbound privacy policy every mutation is judged under, from the verb's own home. */
  readonly privacy: LinearWritePrivacy;
}

/**
 * ONE GraphQL round trip, through the door's provider call.
 *
 * The raw `rawRequest` sits lexically INSIDE `safeProviderCall`'s `execute`, which is not a style choice:
 * `boundary-residue` recognises an unwrapped boundary by proximity to a `safe*` opener, and an indirection
 * through a transport variable reads to it — correctly — as a call nobody wrapped. Keeping it here also
 * keeps the pacing gate inside the retried unit, so a post-429 retry re-acquires a rate slot.
 */
function sendGraphql({
  ctx,
  query,
  variables,
  operation,
  retryMode,
}: {
  ctx: SendContext;
  query: string;
  variables: Record<string, unknown>;
  operation: string;
  retryMode: "never" | "transient";
}): ResultAsync<unknown, IngestError> {
  return safeProviderCall({
    // The dead-Datadog-host refusal (`../../outbound/invalidDatadogHost.ts`) and then the outbound privacy check
    // (`../../outbound/linear/writePrivacy.ts`) judge a mutation's document and variables before a rate slot is
    // taken or a byte is sent — an argument written inline in the document is sent as surely as a variable. A
    // query, a search for the dead host included, is a read, and never loads the privacy policy.
    execute: async () => {
      if (isGraphqlMutation({ document: query })) {
        refuseInvalidDatadogHost({
          command: `linear ${operation}`,
          hatchIsOpen: invalidDatadogHostHatchOpen,
          payload: { document: query, variables },
        });
      }
      await refuseLinearWriteOnPrivacy({ operation, privacy: ctx.privacy, query, variables });
      return ctx.gate(async () => {
        if (ctx.request !== undefined) {
          return ctx.request({ query, variables });
        }
        const res = await ctx.client.client.rawRequest(query, variables);
        return res.data;
      });
    },
    operation,
    provider: "linear",
    retryMode,
    scopeId: ctx.scopeId,
  });
}

/**
 * ONE mutation that must hand back an identity, or fail naming which false success occurred.
 *
 * No longer generic, and no longer given a parser. Under `@linear/sdk`'s generated documents every mutation
 * payload has the same shape — `success` plus the written object as `{ id }` — so the only thing that varies
 * between object kinds is what the payload field and the node are called. Five near-identical parsers
 * collapsed into {@link identityFrom} when the documents were rebound.
 *
 * @returns the parsed identity, or the transport/false-success failure
 */
export function mutateVia({
  ctx,
  query,
  variables,
  operation,
  field,
  node,
}: {
  ctx: SendContext;
  query: string;
  variables: Record<string, unknown>;
  operation: string;
  field: string;
  node: string;
}): ResultAsync<WrittenObject, IngestError> {
  return parsedMutateVia({
    ctx,
    field,
    operation,
    parse: ({ data }) => identityFrom({ data, field, node }),
    query,
    variables,
  });
}

/**
 * ONE mutation whose payload is NOT the uniform `{ success, <node> { id } }` shape, parsed by the caller.
 *
 * Exactly one lane needs this and it is not an oversight: `fileUpload` returns a RESERVATION — a pre-signed
 * upload URL and the headers to send with it — rather than an object that was stored, so there is no id to
 * read back and nothing {@link identityFrom} could return. Every other mutation goes through
 * {@link mutateVia}.
 *
 * @param ctx the shared send context
 * @param query the GraphQL document
 * @param variables the operation's variables
 * @param operation the label the door records
 * @param field the payload field to read
 * @param parse how to turn the payload into the caller's shape
 * @returns the parsed payload, or the transport/false-success failure
 */
export function parsedMutateVia<T>({
  ctx,
  query,
  variables,
  operation,
  field,
  parse,
}: {
  ctx: SendContext;
  query: string;
  variables: Record<string, unknown>;
  operation: string;
  field: string;
  parse: (args: { data: unknown; field: string }) => Result<T, LinearPayloadError>;
}): ResultAsync<T, IngestError> {
  return sendGraphql({ ctx, operation, query, retryMode: "never", variables }).andThen((data) => {
    return parse({ data, field }).mapErr((error) => payloadError({ operation, reason: error.message }));
  });
}

/**
 * Delete, whose payload carries only a boolean — so a missing one is a failure, never a silent no-op.
 *
 * One function for every object kind: a delete payload has exactly one shape (`{ success }`) whatever it
 * deleted, so the only thing that varies is which mutation is sent and what the field is called.
 *
 * @returns `true`, or the transport/false-success failure
 */
export function deleteVia({
  ctx,
  id,
  operation,
  query,
  field,
}: {
  ctx: SendContext;
  id: string;
  operation: string;
  query: string;
  field: string;
}): ResultAsync<boolean, IngestError> {
  return sendGraphql({ ctx, operation, query, retryMode: "never", variables: { id } }).andThen((data) => {
    const payload = isRecord(data) ? data[field] : undefined;
    return isRecord(payload) && payload["success"] === true
      ? ok<boolean, IngestError>(true)
      : err<boolean, IngestError>(payloadError({ operation, reason: `${field} did not report success` }));
  });
}

/**
 * The read-back — the only repeatable call here, so the only one that retries.
 *
 * Generic over the shaped result for the same reason `mutateVia` is: the sequence (send, retry transiently,
 * shape, treat a missing object as `undefined` rather than an error) is identical for every kind, and the
 * shaping is what differs.
 *
 * @returns the shaped result, `undefined` when the object is missing, or the transport failure
 */
export function readVia<T>({
  ctx,
  id,
  operation,
  query,
  shape,
}: {
  ctx: SendContext;
  id: string;
  operation: string;
  query: string;
  shape: (args: { data: unknown }) => T | undefined;
}): ResultAsync<T | undefined, IngestError> {
  return sendGraphql({ ctx, operation, query, retryMode: "transient", variables: { id } }).andThen((data) =>
    ok<T | undefined, IngestError>(shape({ data })),
  );
}

/**
 * A read that takes no id — a workspace-level question rather than an object lookup.
 *
 * `readVia` cannot serve this: it binds `{ id }` as the only variable, which is right for every read-back
 * in this lane and wrong for a query about the organization itself. Retries transiently for the same reason
 * `readVia` does — a read is repeatable, so a transport blip is worth another attempt.
 *
 * @param ctx the shared send context
 * @param operation the label the door records
 * @param query the GraphQL document
 * @param shape how to turn the response body into the answer
 * @returns the shaped result, or the transport failure
 */
export function readAllVia<T>({
  ctx,
  operation,
  query,
  shape,
}: {
  ctx: SendContext;
  operation: string;
  query: string;
  shape: (args: { data: unknown }) => T;
}): ResultAsync<T, IngestError> {
  return sendGraphql({ ctx, operation, query, retryMode: "transient", variables: {} }).andThen((data) =>
    ok<T, IngestError>(shape({ data })),
  );
}
