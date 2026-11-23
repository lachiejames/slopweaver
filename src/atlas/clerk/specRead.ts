/**
 * Reading the four pinned Clerk documents into operation rows and webhook-event rows.
 *
 * ## Why this parses documents rather than importing an SDK
 *
 * `@clerk/backend` is a hand-written client over a subset of the Backend API — it declares no Frontend API
 * and no Platform API at all — so compiling from it would report what its authors chose to wrap rather than
 * what Clerk offers. The documents Clerk publishes ARE the declaration, and `specLock.ts` pins them to an
 * immutable commit so a reader can fetch the exact bytes.
 *
 * ## Every number this produces is asserted against the pin
 *
 * A census that moved means the vendor re-published — which cannot happen behind a commit pin, so a
 * mismatch is a change in THIS reader instead. `sync.ts` refuses on one. A compiled channel whose
 * denominator drifts silently is a coverage fraction that stops meaning anything, which is the one property
 * atlases exist to keep.
 *
 * ## Response FIELDS, not response values
 *
 * Nothing here ever calls Clerk, so a field name is all there is to have. Resolution follows each
 * document's own chain — `responses.200.content["application/json"].schema.$ref` into
 * `components.schemas` — and for a paginated list response it descends one more hop into `data.items`,
 * because "what fields does a user have" is the question a reader is asking and the envelope's own two
 * properties are not the answer. `allOf` bases are merged, since Clerk expresses several payloads that way.
 */
import { parse } from "yaml";

import { incrementCount } from "../../lib/collections.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { openapiComponentSection, openapiFieldNames } from "../kit/openapiSchema.js";

import { clerkDispositionFor } from "./dispositions.js";
import { ClerkAtlasErrors, clerkAtlasErrorLines } from "./errors.js";
import type { ClerkApi, ClerkDisposition } from "./model.js";
import { parameterNames } from "./operationParameters.js";
import { MAX_SCHEMA_DEPTH, resolveFields, successEntitySchema, webhookPayloadSchema } from "./payloadSchema.js";
import type { ClerkSpecDocument } from "./specLock.js";
import {
  CLERK_PLATFORM_PATH_PREFIX,
  clerkPaginationOf,
  clerkProviderId,
  clerkServerPath,
  clerkWirePath,
} from "./surfaceNaming.js";

/** The HTTP methods this atlas reads out of a document. Anything else is not an operation. */
const HTTP_METHODS: readonly string[] = ["get", "post", "patch", "put", "delete"];

/**
 * One operation, as the compiled channel knows it.
 *
 * @internal
 */
export interface ClerkOperationRow {
  readonly api: ClerkApi;
  readonly document: ClerkSpecDocument;
  readonly method: string;
  /** The document's own path key, kept for the error message when something cannot be resolved. */
  readonly declaredPath: string;
  readonly wirePath: string;
  readonly providerId: string;
  readonly operationId: string;
  readonly summary: string | null;
  readonly tags: readonly string[];
  readonly pathParams: readonly string[];
  readonly queryParams: readonly string[];
  readonly pagination: string;
  readonly security: readonly string[];
  readonly responseSchema: string | null;
  readonly responseFields: readonly string[];
  readonly disposition: ClerkDisposition;
  readonly dispositionReason: string;
  readonly dispositionRuleId: string;
}

/**
 * One webhook event, as the compiled channel knows it.
 *
 * @internal
 */
export interface ClerkWebhookEventRow {
  readonly event: string;
  readonly description: string | null;
  readonly payloadSchema: string | null;
  readonly payloadFields: readonly string[];
}

/**
 * What one document says about itself, measured rather than trusted.
 *
 * @internal
 */
export interface ClerkSpecCensus {
  readonly document: ClerkSpecDocument;
  readonly pathCount: number;
  readonly operationCount: number;
  readonly methodCounts: Readonly<Record<string, number>>;
  readonly schemaCount: number;
  readonly webhookEventCount: number;
}

/**
 * Everything the four documents together declare.
 *
 * @internal
 */
export interface ClerkCompiledSurface {
  readonly operations: readonly ClerkOperationRow[];
  readonly webhookEvents: readonly ClerkWebhookEventRow[];
  readonly censuses: readonly ClerkSpecCensus[];
}

/**
 * The security scheme names one operation requires, falling back to the document's own default.
 *
 * An empty array means the operation is genuinely public — the Frontend API declares several — and that is
 * a fact worth keeping rather than a missing value, because "what does this need to be called" is the
 * second question after "what does it return".
 *
 * @param operation the operation node
 * @param doc the whole document, for its top-level `security`
 * @returns the scheme names, sorted and de-duplicated
 */
function securitySchemes({ operation, doc }: { operation: Record<string, unknown>; doc: unknown }): readonly string[] {
  const own = operation["security"];
  const fallback = isRecord(doc) ? doc["security"] : undefined;
  let chosen: readonly unknown[] = [];
  if (Array.isArray(own)) {
    chosen = own;
  } else if (Array.isArray(fallback)) {
    chosen = fallback;
  }
  const names = chosen.flatMap((entry): readonly string[] => (isRecord(entry) ? Object.keys(entry) : []));
  return [...new Set(names)].toSorted();
}

/**
 * Which API one document's operations belong to.
 *
 * Decided from the DOCUMENT plus, for the two that share a server, the path prefix. The webhooks document
 * declares no operation at all, so it never reaches here.
 *
 * @param document which pinned document declared the operation
 * @param wirePath the absolute path the request goes to
 * @returns the API
 */
export function clerkApiForDocument({
  document,
  wirePath,
}: {
  document: ClerkSpecDocument;
  wirePath: string;
}): ClerkApi {
  if (document === "fapi") {
    return "fapi";
  }
  if (document === "platform") {
    return "platform";
  }
  return wirePath.startsWith(CLERK_PLATFORM_PATH_PREFIX) ? "platform" : "bapi";
}

/**
 * Read one pinned Clerk document into operation rows, webhook-event rows and its own census.
 *
 * @param text the document's own bytes, already digest-verified by the caller
 * @param document which document this is, which decides the API its operations belong to
 * @returns the rows and the census, or why the document could not be read
 */
export function readClerkDocument({ text, document }: { text: string; document: ClerkSpecDocument }): Result<{
  operations: readonly ClerkOperationRow[];
  webhookEvents: readonly ClerkWebhookEventRow[];
  census: ClerkSpecCensus;
}> {
  let doc: unknown;
  try {
    doc = parse(text) as unknown;
  } catch (cause: unknown) {
    return err(clerkAtlasErrorLines({ error: ClerkAtlasErrors.documentUnparseable({ cause, document }) }));
  }
  if (!isRecord(doc)) {
    return err(clerkAtlasErrorLines({ error: ClerkAtlasErrors.documentNotMapping({ document }) }));
  }
  const servers = doc["servers"];
  const firstServer = Array.isArray(servers) ? servers[0] : undefined;
  const serverUrl = isRecord(firstServer) && typeof firstServer["url"] === "string" ? firstServer["url"] : "";
  const paths = isRecord(doc["paths"]) ? doc["paths"] : {};
  const schemas = openapiComponentSection({ doc, section: "schemas" });
  const collected = collectOperations({
    doc,
    document,
    parameters: openapiComponentSection({ doc, section: "parameters" }),
    paths,
    schemas,
    serverPath: clerkServerPath({ serverUrl }),
  });
  const webhookEvents = collectWebhookEvents({ doc, schemas });
  return ok({
    census: {
      document,
      methodCounts: collected.methodCounts,
      operationCount: collected.rows.length,
      pathCount: Object.keys(paths).length,
      schemaCount: Object.keys(schemas).length,
      webhookEventCount: webhookEvents.length,
    },
    operations: collected.rows,
    webhookEvents,
  });
}

/** Walk every path and every method in one document, building one row each. */
function collectOperations({
  paths,
  schemas,
  parameters,
  serverPath,
  document,
  doc,
}: {
  paths: Record<string, unknown>;
  schemas: Record<string, unknown>;
  parameters: Record<string, unknown>;
  serverPath: string;
  document: ClerkSpecDocument;
  doc: unknown;
}): { rows: readonly ClerkOperationRow[]; methodCounts: Readonly<Record<string, number>> } {
  const rows: ClerkOperationRow[] = [];
  const methodCounts = new Map<string, number>();
  const fieldCache = new Map<string, readonly string[]>();
  for (const [declaredPath, item] of Object.entries(paths)) {
    if (!isRecord(item)) {
      continue;
    }
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!isRecord(operation)) {
        continue;
      }
      incrementCount({ counts: methodCounts, key: method });
      rows.push(
        operationRow({
          declaredPath,
          doc,
          document,
          fieldCache,
          method,
          operation,
          parameters,
          pathItem: item,
          schemas,
          serverPath,
        }),
      );
    }
  }
  return { methodCounts: Object.fromEntries(methodCounts), rows };
}

/** Build one operation row, resolving its response fields through the memoised schema walk. */
function operationRow({
  declaredPath,
  serverPath,
  method,
  operation,
  pathItem,
  parameters,
  schemas,
  document,
  doc,
  fieldCache,
}: {
  declaredPath: string;
  serverPath: string;
  method: string;
  operation: Record<string, unknown>;
  pathItem: Record<string, unknown>;
  parameters: Record<string, unknown>;
  schemas: Record<string, unknown>;
  document: ClerkSpecDocument;
  doc: unknown;
  fieldCache: Map<string, readonly string[]>;
}): ClerkOperationRow {
  const upper = method.toUpperCase();
  const wirePath = clerkWirePath({ declaredPath, serverPath });
  const api = clerkApiForDocument({ document, wirePath });
  const ruling = clerkDispositionFor({ method: upper, wirePath });
  const declaredParameters = parameterNames({ operation, parameters, pathItem });
  const entity = successEntitySchema({ operation, schemas });
  const resolved = resolveFields({ entity, fieldCache, schemas });
  const tags = Array.isArray(operation["tags"])
    ? operation["tags"].filter((tag): tag is string => typeof tag === "string")
    : [];
  return {
    api,
    declaredPath,
    disposition: ruling.disposition,
    dispositionReason: ruling.reason,
    dispositionRuleId: ruling.ruleId,
    document,
    method: upper,
    operationId: typeof operation["operationId"] === "string" ? operation["operationId"] : `${upper} ${wirePath}`,
    pagination: clerkPaginationOf({ parameterNames: declaredParameters.all }),
    pathParams: declaredParameters.path,
    providerId: clerkProviderId({ api, method: upper, wirePath }),
    queryParams: declaredParameters.query,
    responseFields: resolved,
    responseSchema: entity,
    security: securitySchemes({ doc, operation }),
    summary: typeof operation["summary"] === "string" && operation["summary"].length > 0 ? operation["summary"] : null,
    tags,
    wirePath,
  };
}

/**
 * Read the `x-webhooks` section, which is where Clerk declares what it will tell you without being asked.
 *
 * An OpenAPI 3.0 extension rather than 3.1's own `webhooks` key, so it is read by name. Each entry is a
 * path-item-shaped node whose `post.requestBody` carries the payload, and the payload is an `allOf` of the
 * shared envelope plus a `data` property naming the event's own schema.
 *
 * @param doc the parsed document
 * @param schemas the document's `components.schemas` map
 * @returns one row per declared event, sorted by event name
 */
function collectWebhookEvents({
  doc,
  schemas,
}: {
  doc: unknown;
  schemas: Record<string, unknown>;
}): readonly ClerkWebhookEventRow[] {
  const section = isRecord(doc) ? doc["x-webhooks"] : undefined;
  if (!isRecord(section)) {
    return [];
  }
  const rows: ClerkWebhookEventRow[] = [];
  for (const [event, item] of Object.entries(section)) {
    if (!isRecord(item)) {
      continue;
    }
    const post = item["post"];
    if (!isRecord(post)) {
      continue;
    }
    const payload = webhookPayloadSchema({ post });
    const fields = payload === null ? [] : openapiFieldNames({ depth: MAX_SCHEMA_DEPTH, name: payload, schemas });
    rows.push({
      description:
        typeof post["description"] === "string" && post["description"].length > 0 ? post["description"] : null,
      event,
      payloadFields: fields,
      payloadSchema: payload,
    });
  }
  return rows.toSorted((left, right) => left.event.localeCompare(right.event));
}

/**
 * Read every pinned document into one compiled surface.
 *
 * @param documents each pinned document's verified bytes, in pin order
 * @returns every operation, every webhook event and one census per document, or the first read failure
 */
export function readClerkSurface({
  documents,
}: {
  documents: readonly { readonly document: ClerkSpecDocument; readonly text: string }[];
}): Result<ClerkCompiledSurface> {
  const operations: ClerkOperationRow[] = [];
  const webhookEvents: ClerkWebhookEventRow[] = [];
  const censuses: ClerkSpecCensus[] = [];
  for (const entry of documents) {
    const read = readClerkDocument({ document: entry.document, text: entry.text });
    if (read.isErr()) {
      return err(read.error);
    }
    operations.push(...read.value.operations);
    webhookEvents.push(...read.value.webhookEvents);
    censuses.push(read.value.census);
  }
  return ok({ censuses, operations, webhookEvents });
}
