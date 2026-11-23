/**
 * Read one pinned Twilio API definition into the operations it declares — every method, every path, every
 * parameter name, every response field name, the host it answers on and the credential it requires.
 *
 * ## Pure, so the compile is settled by unit tests rather than by a live fetch
 *
 * Nothing here reaches the network or the disk. `specFetch.ts` obtains a document and verifies its digest;
 * this turns one already-parsed document into operations. That split is what lets a fixture prove the
 * behaviour on a `$ref` cycle, a path item that overrides the document's server, and a response with no
 * JSON content at all — three shapes Twilio's own definitions really contain.
 *
 * ## A parameter is not only a query parameter, and on Twilio that is most of them
 *
 * Twilio's writes take `application/x-www-form-urlencoded` bodies, so an operation's real inputs live in
 * `requestBody` rather than in `parameters`. Recording only the latter would map `POST …/Messages.json` as
 * taking one path parameter and answer that Twilio has no way to set a message's `To`. So both are
 * collected into one sorted list: what a caller can pass, wherever the definition happens to declare it.
 *
 * ## The HOST is part of the answer, because Twilio has sixty of them
 *
 * Almost every product answers on its own subdomain, and a path item may override the document's own
 * server, so the origin is resolved per operation rather than per document. "Where does this live" is a
 * real question about Twilio in a way it is not about a single-origin product.
 *
 * ## Field PATHS to two levels, because one level answers nothing
 *
 * Every Twilio list endpoint returns `{ <plural>: [...], meta: {...} }`, so a top-level-only projection
 * would record two names for hundreds of operations and could not answer the question the surface map
 * exists for — "is there any call that hands me a message's error code". {@link TWILIO_FIELD_DEPTH} counts
 * NESTING STEPS past the top level, and **an array hop is transparent and does not spend a step**: a list
 * endpoint's records live one array down, so charging for the hop would spend the whole budget arriving at
 * them and record `messages[]` with nothing underneath it.
 */
import { isRecord } from "../../lib/parsers.js";
import type { Result } from "../../lib/result.js";
import {
  firstServerUrl,
  jsonSuccessSchema,
  operationInputNames,
  readOpenApiDocument,
  schemaFieldPaths,
  securitySchemeNames,
} from "../kit/openApiSurface.js";

import { type TwilioDisposition, twilioDispositionFor } from "./disposition.js";
import { TWILIO_METHODS, type TwilioMethod, twilioExclusionFor } from "./exclusions.js";

/**
 * How many nesting steps past the top level a response field path records — so a recorded path carries at
 * most this many dots, and an array hop is free. See this file's header, and `descriptor.ts` for where the
 * resulting truncation is declared.
 */
export const TWILIO_FIELD_DEPTH = 2;

/** The response status codes a success schema is looked for under, in the order Twilio uses them. */
const SUCCESS_CODES = ["200", "201", "202", "204", "default"] as const;

/** The request content types Twilio declares an operation's inputs under. */
const REQUEST_CONTENT_TYPES = ["application/x-www-form-urlencoded", "application/json"] as const;

/** One operation, as one pinned definition declares it. */
interface TwilioOperation {
  readonly disposition: TwilioDisposition;
  /** Why this atlas never calls it, or `null` when it observes. */
  readonly excludedBecause: string | null;
  /**
   * The origin this operation answers on, e.g. `https://messaging.twilio.com`, or `null` when neither the
   * path item nor the document declares a server.
   *
   * Nullable rather than an empty string: "Twilio publishes no origin for this operation" is a fact worth
   * a reader knowing, and an empty string is that fact written so it reads like a value.
   */
  readonly host: string | null;
  readonly method: TwilioMethod;
  /** Twilio's own `x-twilio.mountName` for the resource, when it declares one. */
  readonly mountName: string | null;
  /** Every declared parameter name, from `parameters` and the request body alike, sorted. */
  readonly parameters: readonly string[];
  /** Twilio's own `x-twilio.parent` — the resource this one hangs off, when it declares one. */
  readonly parent: string | null;
  /** The definition's own path key, `{brace}` parameters intact. */
  readonly path: string;
  /** Twilio's own `x-twilio.pathType` — `list` or `instance`, when it declares one. */
  readonly pathType: string | null;
  /** Response field paths to {@link TWILIO_FIELD_DEPTH} levels, `[]` marking an array, sorted. */
  readonly responseFields: readonly string[];
  /** The security scheme names this operation requires, sorted — which credential reaches it. */
  readonly securitySchemes: readonly string[];
}

/** Everything one pinned definition declares. */
export interface TwilioSpecSurface {
  /** Every origin this document's operations answer on, sorted. */
  readonly hosts: readonly string[];
  readonly operations: readonly TwilioOperation[];
  readonly pathCount: number;
  /** Every security scheme its operations require, sorted. */
  readonly securitySchemes: readonly string[];
  /** Twilio's own file stem this document is pinned under. */
  readonly specId: string;
  /** `info.title` as Twilio writes it. */
  readonly title: string;
}

/**
 * A Twilio `x-twilio` extension's string field, wherever the extension is hung.
 *
 * @param node the path item or operation carrying the extension
 * @param field the field to read — `pathType`, `parent`, `mountName`
 * @returns the value, or `null` when the extension or the field is absent
 */
function twilioExtension({ node, field }: { node: Record<string, unknown>; field: string }): string | null {
  const extension = node["x-twilio"];
  if (!isRecord(extension)) {
    return null;
  }
  const value = extension[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The key two channels and two definition versions match one operation on, byte-exactly.
 *
 * @param method the HTTP method
 * @param path the definition's own path key
 * @returns `<METHOD> <path>`
 */
export function twilioMethodProviderId({ method, path }: { method: string; path: string }): string {
  return `${method} ${path}`;
}

/** Compile every method one path item declares. */
function operationsOnPath({
  document,
  path,
  item,
  documentHost,
  documentSecurity,
}: {
  document: Record<string, unknown>;
  path: string;
  item: unknown;
  documentHost: string | null;
  documentSecurity: readonly string[];
}): readonly TwilioOperation[] {
  if (!isRecord(item)) {
    return [];
  }
  const host = pathItemHost({ documentHost, item });
  const operations: TwilioOperation[] = [];
  for (const method of TWILIO_METHODS) {
    const operation = item[method.toLowerCase()];
    if (!isRecord(operation)) {
      continue;
    }
    const own = securitySchemeNames({ requirements: operation["security"] });
    operations.push({
      disposition: twilioDispositionFor({ path }),
      excludedBecause: twilioExclusionFor({ method }),
      host,
      method,
      mountName: twilioExtension({ field: "mountName", node: item }),
      parameters: operationInputNames({ contentTypes: REQUEST_CONTENT_TYPES, document, operation }),
      parent: twilioExtension({ field: "parent", node: item }),
      path,
      pathType: twilioExtension({ field: "pathType", node: item }),
      responseFields: schemaFieldPaths({
        depth: TWILIO_FIELD_DEPTH,
        document,
        schema: jsonSuccessSchema({ codes: SUCCESS_CODES, document, operation }),
      }),
      securitySchemes: own.length > 0 ? own : documentSecurity,
    });
  }
  return operations;
}

/** The server a path item declares for itself, else the document's own. */
function pathItemHost({
  item,
  documentHost,
}: {
  item: Record<string, unknown>;
  documentHost: string | null;
}): string | null {
  const own = firstServerUrl({ servers: item["servers"] });
  if (own == null) {
    return documentHost;
  }
  return own;
}

/**
 * Read one already-parsed OpenAPI document into the operations it declares.
 *
 * @param document the parsed definition, as JSON
 * @param specId Twilio's own file stem this document is pinned under
 * @returns the operations, sorted by method and path, or why the document could not be read
 */
export function readTwilioSpecSurface({
  document,
  specId,
}: {
  document: unknown;
  specId: string;
}): Result<TwilioSpecSurface> {
  return readOpenApiDocument<TwilioOperation>({
    document,
    hostOf: ({ operation }) => operation.host,
    operationsOnPath,
    securitySchemesOf: ({ operation }) => operation.securitySchemes,
    sortKeyOf: ({ operation }) => twilioMethodProviderId({ method: operation.method, path: operation.path }),
    specId,
  });
}
