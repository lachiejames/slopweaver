/**
 * Read the pinned Hex OpenAPI document into the operations it declares — every method, every path, every
 * parameter name, every response field name, and the credential each requires.
 *
 * ## Pure, so the compile is settled by unit tests rather than by a live fetch
 *
 * Nothing here reaches the network or the disk. `specFetch.ts` obtains the document and verifies its
 * digest; this turns one already-parsed document into operations. That split is what lets a fixture prove
 * the behaviour on a `$ref` cycle, on a response with no JSON content, and on the one path key Hex writes
 * that is not a path template at all.
 *
 * ## The path key that is not a template, and why it is kept verbatim
 *
 * MEASURED against the published document: one of its 37 path keys is
 * `/v1/semantic-(projects|models)/{semanticProjectId}`, which is a REGULAR EXPRESSION written into a field
 * OpenAPI defines as a literal path with `{brace}` parameters. It is a defect in Hex's document rather than
 * in this reader, and it is kept byte-exact rather than expanded into the two paths it clearly means: the
 * provider id IS the key, so rewriting it here would make the atlas's own row uncitable against the
 * document a reader opens. `apiProbe.ts` records separately that BOTH `semantic-projects` and
 * `semantic-models` are mounted, so the fact the regex was trying to state is held as a measurement rather
 * than as this repository's interpretation.
 *
 * ## Field PATHS to two levels, because one level answers nothing
 *
 * Hex's list endpoints return `{ values: [...], pagination: {...} }`, so a top-level-only projection would
 * record two names for most operations and could not answer the question a surface map exists for — "is
 * there any call that hands me a project's owner". {@link HEX_FIELD_DEPTH} counts NESTING STEPS past the
 * top level, and **an array hop is transparent and does not spend a step**: a list endpoint's records live
 * one array down, so charging for the hop would spend the whole budget arriving at them.
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

import { type HexDisposition, hexDispositionFor, hexWithholdingFor } from "./disposition.js";
import { HEX_METHODS, type HexMethod, hexExclusionFor } from "./exclusions.js";

/**
 * How many nesting steps past the top level a response field path records — so a recorded path carries at
 * most this many dots, and an array hop is free. See this file's header, and `descriptor.ts` for where the
 * resulting truncation is declared.
 */
export const HEX_FIELD_DEPTH = 2;

/** The response status codes a success schema is looked for under, in the order Hex uses them. */
const SUCCESS_CODES = ["200", "201", "202", "204", "default"] as const;

/** The request content types Hex declares an operation's inputs under. */
const REQUEST_CONTENT_TYPES = ["application/json", "application/x-www-form-urlencoded"] as const;

/**
 * One operation, as the pinned document declares it.
 *
 * @internal
 */
export interface HexOperation {
  readonly disposition: HexDisposition;
  /** Why this atlas never calls it, or `null` when it observes. */
  readonly excludedBecause: string | null;
  /** The origin this operation answers on, or `null` when the document declares no server. */
  readonly host: string | null;
  readonly method: HexMethod;
  /** Hex's own `operationId`, when it declares one. */
  readonly operationId: string | null;
  /** Every declared parameter name, from `parameters` and the request body alike, sorted. */
  readonly parameters: readonly string[];
  /** The document's own path key, byte-exact — see this file's header. */
  readonly path: string;
  /** Response field paths to {@link HEX_FIELD_DEPTH} levels, `[]` marking an array, sorted. */
  readonly responseFields: readonly string[];
  /** The security scheme names this operation requires, sorted — which credential reaches it. */
  readonly securitySchemes: readonly string[];
  /** Why this operation is never called for its BODY, or `null` when it is not withheld. */
  readonly withheldBecause: string | null;
}

/** Everything the pinned document declares. */
export interface HexSpecSurface {
  /** Every origin its operations answer on, sorted. */
  readonly hosts: readonly string[];
  readonly operations: readonly HexOperation[];
  readonly pathCount: number;
  /** Every security scheme its operations require, sorted. */
  readonly securitySchemes: readonly string[];
  /** This atlas's own id for the document. */
  readonly specId: string;
  /** `info.title` as Hex writes it. */
  readonly title: string;
}

/**
 * The key two channels and two document versions match one operation on, byte-exactly.
 *
 * @param method the HTTP method
 * @param path the document's own path key
 * @returns `<METHOD> <path>`
 */
export function hexMethodProviderId({ method, path }: { method: string; path: string }): string {
  return `${method} ${path}`;
}

/** The server a path item declares for itself, else the document's own. */
function hostOf({ item, documentHost }: { item: Record<string, unknown>; documentHost: string | null }): string | null {
  const own = firstServerUrl({ servers: item["servers"] });
  if (own == null) {
    return documentHost;
  }
  return own;
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
}): readonly HexOperation[] {
  if (!isRecord(item)) {
    return [];
  }
  const host = hostOf({ documentHost, item });
  const operations: HexOperation[] = [];
  for (const method of HEX_METHODS) {
    const operation = item[method.toLowerCase()];
    if (!isRecord(operation)) {
      continue;
    }
    const own = securitySchemeNames({ requirements: operation["security"] });
    const operationId = operation["operationId"];
    operations.push({
      disposition: hexDispositionFor({ path }),
      excludedBecause: hexExclusionFor({ method }),
      host,
      method,
      operationId: typeof operationId === "string" && operationId.length > 0 ? operationId : null,
      parameters: operationInputNames({ contentTypes: REQUEST_CONTENT_TYPES, document, operation }),
      path,
      responseFields: schemaFieldPaths({
        depth: HEX_FIELD_DEPTH,
        document,
        schema: jsonSuccessSchema({ codes: SUCCESS_CODES, document, operation }),
      }),
      securitySchemes: own.length > 0 ? own : documentSecurity,
      withheldBecause: hexWithholdingFor({ path }),
    });
  }
  return operations;
}

/**
 * Read one already-parsed OpenAPI document into the operations it declares.
 *
 * @param document the parsed definition, as JSON
 * @param specId this atlas's own id for the document
 * @returns the operations, sorted by method and path, or why the document could not be read
 */
export function readHexSpecSurface({
  document,
  specId,
}: {
  document: unknown;
  specId: string;
}): Result<HexSpecSurface> {
  return readOpenApiDocument<HexOperation>({
    document,
    hostOf: ({ operation }) => operation.host,
    operationsOnPath,
    securitySchemesOf: ({ operation }) => operation.securitySchemes,
    sortKeyOf: ({ operation }) => hexMethodProviderId({ method: operation.method, path: operation.path }),
    specId,
  });
}
