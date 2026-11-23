/**
 * Which named schema a Clerk success response or webhook payload declares, and the field names it carries.
 *
 * Split from `specRead.ts` along the seam that reads a response or request-body node rather than walking a
 * document: everything here is a pure walk over one node and the document's `components.schemas`.
 */
import { isRecord } from "../../lib/parsers.js";
import { openapiFieldNames, openapiJsonSchemaNode, openapiRefName } from "../kit/openapiSchema.js";

import { clerkEntitySchemaName } from "./entitySchema.js";

/** How deep `allOf` inheritance is followed before the walk gives up. Clerk's own chains are one or two. */
export const MAX_SCHEMA_DEPTH = 8;

/**
 * The entity schema behind one operation's declared SUCCESS response.
 *
 * `200`, then `201`, then the `2XX` range — in that order rather than "the first 2xx key", because a
 * document that declares both a `201` and a `2XX` means the specific one, and iteration order over an
 * untyped object is not a contract.
 *
 * @param operation the operation node
 * @param schemas the document's `components.schemas` map
 * @returns the entity schema's name, or `null` when the operation declares no named success schema
 */
export function successEntitySchema({
  operation,
  schemas,
}: {
  operation: Record<string, unknown>;
  schemas: Record<string, unknown>;
}): string | null {
  const responses = isRecord(operation["responses"]) ? operation["responses"] : {};
  // The first of the three the document declares at all; none declared is no named success schema.
  const success = ["200", "201", "2XX"].map((status) => responses[status]).find((declared) => declared != null);
  const node = openapiJsonSchemaNode({ node: success });
  return node === null ? null : clerkEntitySchemaName({ node, schemas });
}

/**
 * The response field names for one entity schema, memoised across a document's own operations.
 *
 * The cache is what keeps the walk linear: Clerk's list and single-entity reads of one resource resolve to
 * the SAME entity schema, so a document with 185 paths resolves each of its 167 schemas once rather than
 * once per operation that mentions it.
 *
 * @param entity the entity schema's name, or `null` when the operation declares no named response
 * @param schemas the document's `components.schemas` map
 * @param fieldCache the per-document memo
 * @returns the distinct field names, sorted; empty when there is no named schema to resolve
 */
export function resolveFields({
  entity,
  schemas,
  fieldCache,
}: {
  entity: string | null;
  schemas: Record<string, unknown>;
  fieldCache: Map<string, readonly string[]>;
}): readonly string[] {
  if (entity === null) {
    return [];
  }
  const cached = fieldCache.get(entity);
  if (cached !== undefined) {
    return cached;
  }
  const resolved = openapiFieldNames({ depth: MAX_SCHEMA_DEPTH, name: entity, schemas });
  fieldCache.set(entity, resolved);
  return resolved;
}

/**
 * The `data` schema one webhook event's payload declares.
 *
 * The payload is an `allOf` of the shared `WebhookEventPayload` envelope and a node declaring `data`, so
 * the event's own shape is the `data` property's `$ref` rather than the envelope. Returning the envelope
 * instead would give all 45 events the same three field names, which is the shape of an answer that looks
 * complete and says nothing.
 *
 * @param post the event's `post` node
 * @returns the `data` schema's name, or `null` when the event declares none
 */
export function webhookPayloadSchema({ post }: { post: Record<string, unknown> }): string | null {
  const body = post["requestBody"];
  if (!isRecord(body)) {
    return null;
  }
  const node = openapiJsonSchemaNode({ node: body });
  if (node === null) {
    return null;
  }
  const candidates = [node, ...(Array.isArray(node["allOf"]) ? node["allOf"] : [])];
  for (const candidate of candidates) {
    const named = dataSchemaOf({ node: candidate });
    if (named !== null) {
      return named;
    }
  }
  return null;
}

/**
 * The `data` property's schema name on one payload node, direct or through the first arm of a `oneOf`.
 *
 * The first arm rather than a merge of every arm, because `oneOf` is a CHOICE: flattening it would report a
 * field present on one shape as present on the event, which is an overstatement in a catalogue whose whole
 * job is to say what an event carries.
 *
 * @param node the candidate payload node
 * @returns the schema name, or `null` when this node declares no `data` schema
 */
function dataSchemaOf({ node }: { node: unknown }): string | null {
  if (!isRecord(node)) {
    return null;
  }
  const properties = node["properties"];
  if (!isRecord(properties)) {
    return null;
  }
  const data = properties["data"];
  if (!isRecord(data)) {
    return null;
  }
  const named = openapiRefName({ ref: data["$ref"] });
  if (named !== null) {
    return named;
  }
  const oneOf = Array.isArray(data["oneOf"]) ? data["oneOf"] : [];
  const first = oneOf.find((entry) => isRecord(entry) && openapiRefName({ ref: entry["$ref"] }) !== null);
  return isRecord(first) ? openapiRefName({ ref: first["$ref"] }) : null;
}
