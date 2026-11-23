/**
 * Compile the PUBLISHED API surface out of the OpenAPI documents the tenant itself serves.
 *
 * ## The denominator is the vendor's, not a list written here
 *
 * The web client names its own documentation endpoints, and this module fetches those rather than a table
 * somebody typed — the same property that makes the CrowdStrike walk's coverage claim checkable. A document
 * the client names and the tenant does not serve is a GAP with the document's name on it, which is a fact
 * about the platform; a hand list could only ever have been a fact about this repository.
 *
 * MEASURED: the client names four documents and the tenant serves two of them — `apps` (18
 * operations) and `people` (9). The other two answer `404 Not Found`, and that is exactly the kind of thing
 * an atlas exists to notice.
 *
 * ## This is a MAP and never data
 *
 * Reading a document establishes what the published API declares. It establishes nothing about what this
 * installation may call: measured in the same sitting, the published API answers `403` to the session
 * cookie every first-party call is authorised by, because it wants an OAuth2 client this installation does
 * not hold. `apiKindFiles.ts` writes that as a separate `not-configured` cell rather than letting a complete map
 * imply reachable data.
 *
 * ## Everything below is a NAME
 *
 * A parameter name, a response field name, a security-scheme name, the document's own summary. No example,
 * no default and no enum value is read, so a document that embeds a real customer value in an example
 * cannot carry it into the generation.
 */

import { absentAsNull } from "#lib/absent.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type TrelicaAtlasError, TrelicaAtlasErrors } from "./errors.js";
import type { TrelicaPublishedDocumentBody, TrelicaPublishedOperationBody } from "./publishedDocumentBoundary.js";

/**
 * The documentation paths the vendor's own web client names, in the order it lists them.
 *
 * Committed because they name the vendor's product areas and no customer. They are the DECLARED set: a
 * document here that the tenant does not serve becomes a gap rather than a silent absence, which is the
 * whole reason the list is explicit instead of discovered by probing.
 *
 * @internal
 */
export const TRELICA_PUBLISHED_DOCUMENTS = ["apps", "auth", "flow", "people"] as const;

/** One of the vendor's own published API documents. */
export type TrelicaPublishedDocument = (typeof TRELICA_PUBLISHED_DOCUMENTS)[number];

/**
 * The path one published document is served at.
 *
 * @returns the absolute path beneath the tenant origin
 */
export function trelicaPublishedDocumentPath({ document }: { document: TrelicaPublishedDocument }): string {
  return `/api/${document}/docs/v1/swagger.json`;
}

/** The HTTP methods an OpenAPI path item may declare an operation under. */
const OPERATION_METHODS = ["get", "put", "post", "patch", "delete", "head", "options", "trace"] as const;

/** One operation the published API declares, reduced to names. */
interface TrelicaPublishedOperation {
  readonly httpMethod: string;
  readonly path: string;
  readonly operationId: string | null;
  readonly summary: string | null;
  readonly document: TrelicaPublishedDocument;
  readonly pathParams: readonly string[];
  readonly queryParams: readonly string[];
  readonly bodyParams: readonly string[];
  readonly responseFields: readonly string[];
  readonly security: readonly string[];
}

/** What one document contributed. */
export interface TrelicaPublishedDocumentSurface {
  readonly document: TrelicaPublishedDocument;
  readonly title: string;
  readonly version: string;
  /** The servers the document nominates — origins, which name the vendor's regions and no customer. */
  readonly servers: readonly string[];
  readonly securitySchemes: readonly string[];
  readonly operations: readonly TrelicaPublishedOperation[];
}

/** The whole published surface, plus the documents that could not be read. */
export interface TrelicaPublishedSurface {
  readonly documents: readonly TrelicaPublishedDocumentSurface[];
  readonly unreadable: readonly { readonly document: TrelicaPublishedDocument; readonly reason: string }[];
}

/** A string the document declares, an empty or absent one read as absent so `""` never reaches a `min(1)` schema. */
function textOf({ value }: { value: string | undefined }): string | null {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

/** Follow one `$ref` into the document's own component map, one hop, without recursing. */
function resolveRef({ document, node }: { document: Record<string, unknown>; node: unknown }): unknown {
  if (!isRecord(node)) {
    return node;
  }
  const ref = node["$ref"];
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    return node;
  }
  let cursor: unknown = document;
  for (const segment of ref.slice(2).split("/")) {
    if (!isRecord(cursor)) {
      return null;
    }
    cursor = cursor[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  return absentAsNull({ value: cursor });
}

/**
 * Every property name a schema declares, one level down, following at most one `$ref` per hop.
 *
 * Deliberately shallow. The point is to answer "does this endpoint hand me a field called X", and a
 * fully-resolved recursive walk over a document with cyclic components is a different, much larger job that
 * buys a reader nothing at the top level.
 */
function schemaFieldNames({ document, schema }: { document: Record<string, unknown>; schema: unknown }): string[] {
  const resolved = resolveRef({ document, node: schema });
  if (!isRecord(resolved)) {
    return [];
  }
  const items = resolved["items"];
  if (items !== undefined) {
    return schemaFieldNames({ document, schema: items });
  }
  const properties = resolved["properties"];
  return isRecord(properties) ? Object.keys(properties).toSorted() : [];
}

/** The parameter names one operation declares, split by where they travel. */
function parameterNames({ operation }: { operation: TrelicaPublishedOperationBody }): {
  path: string[];
  query: string[];
} {
  const path: string[] = [];
  const query: string[] = [];
  if (operation.parameters === undefined) {
    return { path, query };
  }
  for (const parameter of operation.parameters) {
    const name = textOf({ value: parameter.name });
    if (name === null) {
      continue;
    }
    if (parameter.in === "path") {
      path.push(name);
    } else if (parameter.in === "query") {
      query.push(name);
    }
  }
  return { path: path.toSorted(), query: query.toSorted() };
}

/** A body's media types, as the boundary admitted them. */
type MediaTypes = NonNullable<TrelicaPublishedOperationBody["requestBody"]>["content"];

/** The first JSON media-type schema on a request or response body, or `null` when it declares none. */
function jsonSchemaOf({ content }: { content: MediaTypes | undefined }): unknown {
  if (content === undefined) {
    return null;
  }
  for (const [mediaType, media] of Object.entries(content)) {
    if (mediaType.toLowerCase().includes("json")) {
      if (media.schema === undefined) {
        // OpenAPI's Media Type Object makes `schema` OPTIONAL: a JSON media type with none declares no fields.
        return null;
      }
      return media.schema;
    }
  }
  return null;
}

/** The success response's media types — `200`'s if it declares one, else the lowest 2xx's. */
function successContent({ operation }: { operation: TrelicaPublishedOperationBody }): MediaTypes | undefined {
  const codes = Object.keys(operation.responses)
    .filter((code) => /^2\d\d$/.test(code))
    .toSorted();
  const chosen = codes.includes("200") ? "200" : codes[0];
  if (chosen === undefined) {
    return undefined;
  }
  return operation.responses[chosen]?.content;
}

/** The security-scheme names one operation requires, falling back to the document's own default. */
function securityNames({
  operation,
  documentDefault,
}: {
  operation: TrelicaPublishedOperationBody;
  documentDefault: readonly string[];
}): readonly string[] {
  if (operation.security === undefined) {
    return documentDefault;
  }
  return [...new Set(operation.security.flatMap((requirement) => Object.keys(requirement)))].toSorted();
}

/**
 * Reduce one admitted OpenAPI document to the operations it declares. The boundary has already refused a
 * document whose shape drifted; what stays here is the one refusal it cannot express, a blank title or version.
 *
 * @param json the document as `publishedDocumentBoundary.ts` admitted it
 * @returns the operations, security schemes and servers it declares, or why it could not be read
 *
 * @internal
 */
export function parseTrelicaPublishedDocument({
  document,
  json,
}: {
  document: TrelicaPublishedDocument;
  json: TrelicaPublishedDocumentBody;
}): Result<TrelicaPublishedDocumentSurface, TrelicaAtlasError> {
  const title = textOf({ value: json.info.title });
  if (title === null) {
    return err(TrelicaAtlasErrors.documentUnreadable({ detail: "the document's info declares no title", document }));
  }
  const version = textOf({ value: json.info.version });
  if (version === null) {
    return err(TrelicaAtlasErrors.documentUnreadable({ detail: "the document's info declares no version", document }));
  }
  const dangling = danglingRefs({ json });
  if (dangling.length > 0) {
    const detail = `a schema it reads references ${dangling.join(", ")}, which the document does not define`;
    return err(TrelicaAtlasErrors.documentUnreadable({ detail, document }));
  }
  // No document carries a top-level `security` (the boundary refuses one), so an operation declaring none
  // inherits every scheme the document defines.
  const schemes = Object.keys(securitySchemesOf({ json })).toSorted();
  return ok({
    document,
    operations: operationsOf({ document, documentDefault: schemes, json }),
    securitySchemes: schemes,
    servers: serverUrls({ json }),
    title,
    version,
  });
}

/** Every `$ref` one read schema carries, down its `items` chain. */
function refsAlong({ schema }: { schema: unknown }): string[] {
  if (!isRecord(schema)) {
    return [];
  }
  const ref = schema["$ref"];
  return [...(typeof ref === "string" ? [ref] : []), ...refsAlong({ schema: schema["items"] })];
}

/**
 * Every component a read `$ref` names that the document does not define. The boundary fixes a reference's FORM;
 * whether its target exists is this document's own consistency, and a dangling one would read as no fields.
 */
function danglingRefs({ json }: { json: TrelicaPublishedDocumentBody }): readonly string[] {
  const components = json.components?.schemas;
  const defined = new Set(components === undefined ? [] : Object.keys(components));
  const operationSchemas = Object.values(json.paths).flatMap((item) =>
    OPERATION_METHODS.flatMap((method) => {
      const operation = item[method];
      if (operation === undefined) {
        return [];
      }
      const request = jsonSchemaOf({ content: operation.requestBody?.content });
      return [request, jsonSchemaOf({ content: successContent({ operation }) })];
    }),
  );
  const roots = [...(components === undefined ? [] : Object.values(components)), ...operationSchemas];
  const named = roots
    .flatMap((schema) => refsAlong({ schema }))
    .map((ref) => ref.slice("#/components/schemas/".length).replaceAll("~1", "/").replaceAll("~0", "~"));
  return [...new Set(named.filter((name) => !defined.has(name)))].toSorted();
}

/** The security schemes a document defines, `{}` when it declares no components at all. */
function securitySchemesOf({ json }: { json: TrelicaPublishedDocumentBody }): Readonly<Record<string, unknown>> {
  if (json.components?.securitySchemes === undefined) {
    return {};
  }
  return json.components.securitySchemes;
}

/** The server URLs a document nominates — origins, which name the vendor's regions and no customer. */
function serverUrls({ json }: { json: TrelicaPublishedDocumentBody }): readonly string[] {
  if (json.servers === undefined) {
    return [];
  }
  return json.servers
    .flatMap((server) => {
      const url = textOf({ value: server.url });
      return url === null ? [] : [url];
    })
    .toSorted();
}

/** One path item's operations, reduced to names. */
function pathItemOperations({
  document,
  json,
  path,
  item,
  documentDefault,
}: {
  document: TrelicaPublishedDocument;
  json: TrelicaPublishedDocumentBody;
  path: string;
  item: TrelicaPublishedDocumentBody["paths"][string];
  documentDefault: readonly string[];
}): readonly TrelicaPublishedOperation[] {
  return OPERATION_METHODS.flatMap((httpMethod): readonly TrelicaPublishedOperation[] => {
    const operation = item[httpMethod];
    if (operation === undefined) {
      return [];
    }
    const parameters = parameterNames({ operation });
    return [
      {
        bodyParams: schemaFieldNames({
          document: json,
          schema: jsonSchemaOf({ content: operation.requestBody?.content }),
        }),
        document,
        httpMethod: httpMethod.toUpperCase(),
        operationId: textOf({ value: operation.operationId }),
        path,
        pathParams: parameters.path,
        queryParams: parameters.query,
        responseFields: schemaFieldNames({
          document: json,
          schema: jsonSchemaOf({ content: successContent({ operation }) }),
        }),
        security: securityNames({ documentDefault, operation }),
        summary: textOf({ value: operation.summary }),
      },
    ];
  });
}

/** Every operation across every path item, in a stable order. */
function operationsOf({
  document,
  json,
  documentDefault,
}: {
  document: TrelicaPublishedDocument;
  json: TrelicaPublishedDocumentBody;
  documentDefault: readonly string[];
}): readonly TrelicaPublishedOperation[] {
  return Object.entries(json.paths)
    .flatMap(([path, item]) => pathItemOperations({ document, documentDefault, item, json, path }))
    .toSorted((left, right) => `${left.path} ${left.httpMethod}`.localeCompare(`${right.path} ${right.httpMethod}`));
}

/** How one document is fetched and admitted. Injected so the compile is testable without a tenant or a network. */
export type TrelicaDocumentFetcher = (input: {
  document: TrelicaPublishedDocument;
}) => Promise<Result<TrelicaPublishedDocumentBody, TrelicaAtlasError>>;

/**
 * Compile the published surface from every document the vendor's client names.
 *
 * A document that cannot be read does not fail the compile — it is recorded in
 * {@link TrelicaPublishedSurface.unreadable}, and `sync.ts` raises a gap naming it. A vendor serving three
 * of four documents is a fact about the vendor, and an atlas that refused to publish anything until all
 * four answered would hold nothing at all.
 *
 * @returns every document that parsed, and every one that did not with the reason
 */
export async function compileTrelicaPublishedSurface({
  fetchDocument,
}: {
  fetchDocument: TrelicaDocumentFetcher;
}): Promise<TrelicaPublishedSurface> {
  const documents: TrelicaPublishedDocumentSurface[] = [];
  const unreadable: { document: TrelicaPublishedDocument; reason: string }[] = [];
  for (const document of TRELICA_PUBLISHED_DOCUMENTS) {
    const fetched = await fetchDocument({ document });
    if (fetched.isErr()) {
      unreadable.push({ document, reason: fetched.error.message });
      continue;
    }
    const parsed = parseTrelicaPublishedDocument({ document, json: fetched.value });
    if (parsed.isErr()) {
      unreadable.push({ document, reason: parsed.error.message });
      continue;
    }
    documents.push(parsed.value);
  }
  return { documents, unreadable };
}
