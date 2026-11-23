/**
 * The document walk behind `tools/generateNightfallSurfaces.ts`: Nightfall's six pinned OpenAPI documents in,
 * `NightfallSurfaceRow`s out.
 *
 * Pure extraction helpers split out of the generator so it stays under the file-size cap. This module never
 * imports the generator, which runs `main()` at import.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import { nightfallDispositionFor } from "../src/atlas/nightfall/dispositions.js";
import { NIGHTFALL_SPEC_PINS } from "../src/atlas/nightfall/generated/specLock.js";
import {
  NIGHTFALL_SPEC_DOCUMENTS,
  type NightfallSpecDocument,
  nightfallApiFor,
  nightfallKindFor,
  nightfallOperationName,
  nightfallPagingFor,
} from "../src/atlas/nightfall/surfaceNaming.js";
import type { NightfallSurfaceRow } from "../src/atlas/nightfall/surfaceRow.js";

/** The methods an operation object can be keyed by, in the order a table sorts them. */
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type Method = (typeof METHODS)[number];

/**
 * Whether a value is a plain object, so a walk over untyped YAML never indexes a string.
 *
 * @returns true when the value is a non-array object
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One resolved document, as the extraction reads it. */
export interface LoadedSpec {
  readonly document: NightfallSpecDocument;
  readonly json: Record<string, unknown>;
  readonly bytes: Buffer;
}

/** Whether a pin's document name is one `surfaceNaming.ts` declares. */
function isSpecDocument(document: string): document is NightfallSpecDocument {
  return (NIGHTFALL_SPEC_DOCUMENTS as readonly string[]).includes(document);
}

/**
 * Read and parse the six documents from a directory, refusing anything the pin does not describe.
 *
 * @param specDirectory where the fetched documents live
 * @returns every document, in pin order
 */
export function loadSpecs({ specDirectory }: { specDirectory: string }): readonly LoadedSpec[] {
  return NIGHTFALL_SPEC_PINS.map((pin) => {
    const path = join(specDirectory, `${pin.document}.yaml`);
    if (!existsSync(path)) {
      throw new Error(`${path} is absent — fetch every document from the URLs in specLock.ts`);
    }
    const bytes = readFileSync(path);
    const json: unknown = parse(bytes.toString("utf8"));
    if (!isRecord(json)) {
      throw new Error(`${path} did not parse to an object`);
    }
    if (!isSpecDocument(pin.document)) {
      throw new Error(`${path} names a document surfaceNaming.ts does not declare: ${pin.document}`);
    }
    return { bytes, document: pin.document, json };
  });
}

/**
 * Check every document's bytes and declared metadata against the pin.
 *
 * @param specs the loaded documents
 */
export function verifyPins({ specs }: { specs: readonly LoadedSpec[] }): void {
  for (const spec of specs) {
    const pin = NIGHTFALL_SPEC_PINS.find((candidate) => candidate.document === spec.document);
    if (pin === undefined) {
      throw new Error(`${spec.document} is not pinned`);
    }
    if (spec.bytes.byteLength !== pin.byteLength) {
      throw new Error(`${spec.document}: ${spec.bytes.byteLength} bytes, pin says ${pin.byteLength}`);
    }
    const sha256 = createHash("sha256").update(spec.bytes).digest("hex");
    if (sha256 !== pin.sha256) {
      throw new Error(`${spec.document}: digest ${sha256}, pin says ${pin.sha256} — the vendor re-published`);
    }
    const info = spec.json["info"];
    const title = isRecord(info) ? info["title"] : null;
    if (title !== pin.title) {
      throw new Error(`${spec.document}: title ${String(title)}, pin says ${pin.title}`);
    }
    if (serverOf({ spec }) !== pin.server) {
      throw new Error(`${spec.document}: server ${serverOf({ spec })}, pin says ${pin.server}`);
    }
  }
}

/**
 * The one server URL a document declares.
 *
 * @param spec the loaded document
 * @returns its `servers[0].url`
 */
function serverOf({ spec }: { spec: LoadedSpec }): string {
  const servers = spec.json["servers"];
  if (!Array.isArray(servers) || servers.length !== 1) {
    throw new Error(`${spec.document}: expected exactly one server`);
  }
  const first: unknown = servers[0];
  const url = isRecord(first) ? first["url"] : null;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error(`${spec.document}: server declares no url`);
  }
  return url;
}

/** Every parameter name an operation declares for one `in` location, sorted. */
function parameterNames({ operation, location }: { operation: Record<string, unknown>; location: string }): string[] {
  const parameters = operation["parameters"];
  if (!Array.isArray(parameters)) {
    return [];
  }
  const names: string[] = [];
  for (const parameter of parameters) {
    if (!isRecord(parameter) || parameter["in"] !== location) {
      continue;
    }
    const name = parameter["name"];
    if (typeof name === "string" && name.length > 0) {
      names.push(name);
    }
  }
  return names.toSorted();
}

/**
 * Resolve one `$ref` a single hop into `components.schemas`.
 *
 * @param schema the schema object, which may be a reference
 * @param spec the document it came from
 * @returns the referenced schema, or the input when it is not a reference
 */
export function resolveSchema({ schema, spec }: { schema: unknown; spec: LoadedSpec }): unknown {
  if (!isRecord(schema)) {
    return schema;
  }
  const ref = schema["$ref"];
  if (typeof ref !== "string") {
    return schema;
  }
  const name = ref.split("/").at(-1);
  const components = spec.json["components"];
  const schemas = isRecord(components) ? components["schemas"] : null;
  if (name === undefined || !isRecord(schemas)) {
    return schema;
  }
  return schemas[name] ?? schema;
}

/**
 * Every top-level field name a JSON schema carries, resolving one `$ref` hop and unwrapping a bare array.
 *
 * @param schema the schema to read
 * @param spec the document it came from
 * @returns the property names, sorted
 */
export function schemaFieldNames({ schema, spec }: { schema: unknown; spec: LoadedSpec }): string[] {
  const resolved = resolveSchema({ schema, spec });
  if (!isRecord(resolved)) {
    return [];
  }
  if (resolved["type"] === "array") {
    return schemaFieldNames({ schema: resolved["items"], spec });
  }
  const properties = resolved["properties"];
  if (!isRecord(properties)) {
    return [];
  }
  return Object.keys(properties).toSorted();
}

/**
 * The `application/json` schema of an operation's declared success response.
 *
 * @returns the schema, or `null` when the operation declares none
 */
export function successSchema({ operation }: { operation: Record<string, unknown> }): unknown {
  const responses = operation["responses"];
  if (!isRecord(responses)) {
    return null;
  }
  const successKey = Object.keys(responses).find((key) => key.startsWith("2"));
  if (successKey === undefined) {
    return null;
  }
  const response = responses[successKey];
  const content = isRecord(response) ? response["content"] : null;
  const json = isRecord(content) ? content["application/json"] : null;
  return isRecord(json) ? (json["schema"] ?? null) : null;
}

/** The `application/json` schema of an operation's request body. */
function bodySchema({ operation }: { operation: Record<string, unknown> }): unknown {
  const requestBody = operation["requestBody"];
  const content = isRecord(requestBody) ? requestBody["content"] : null;
  const json = isRecord(content) ? content["application/json"] : null;
  return isRecord(json) ? (json["schema"] ?? null) : null;
}

/** Every security scheme name an operation requires, falling back to the document's own default. */
function securityNames({ operation, spec }: { operation: Record<string, unknown>; spec: LoadedSpec }): string[] {
  const declared = operation["security"] ?? spec.json["security"];
  if (!Array.isArray(declared)) {
    return [];
  }
  const names = new Set<string>();
  for (const requirement of declared) {
    if (isRecord(requirement)) {
      for (const name of Object.keys(requirement)) {
        names.add(name);
      }
    }
  }
  return [...names].toSorted();
}

/** The path parameters a template names, in path order. */
function pathTemplateParams({ path }: { path: string }): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
}

/**
 * Extract every operation one document declares.
 *
 * @param spec the loaded document
 * @returns its rows, unsorted
 */
export function rowsOf({ spec }: { spec: LoadedSpec }): readonly NightfallSurfaceRow[] {
  const api = nightfallApiFor({ document: spec.document });
  const server = serverOf({ spec });
  const paths = spec.json["paths"];
  if (!isRecord(paths)) {
    throw new Error(`${spec.document}: no paths object`);
  }
  const rows: NightfallSurfaceRow[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) {
      throw new Error(`${spec.document}: ${path} is not an object`);
    }
    for (const method of METHODS) {
      const operation = item[method.toLowerCase()];
      if (operation === undefined) {
        continue;
      }
      if (!isRecord(operation)) {
        throw new Error(`${spec.document}: ${method} ${path} is not an object`);
      }
      rows.push(rowOf({ api, method, operation, path, server, spec }));
    }
  }
  return rows;
}

/** Build one row from one operation object. */
function rowOf({
  api,
  method,
  operation,
  path,
  server,
  spec,
}: {
  api: ReturnType<typeof nightfallApiFor>;
  method: Method;
  operation: Record<string, unknown>;
  path: string;
  server: string;
  spec: LoadedSpec;
}): NightfallSurfaceRow {
  const kind = nightfallKindFor({ api, path });
  const name = nightfallOperationName({ api, method, path });
  const queryParams = parameterNames({ location: "query", operation });
  const responseFields = schemaFieldNames({ schema: successSchema({ operation }), spec });
  const verdict = nightfallDispositionFor({ kind, method, name });
  const summary = operation["summary"];
  const operationId = operation["operationId"];
  return {
    api,
    bodyParams: schemaFieldNames({ schema: bodySchema({ operation }), spec }),
    deprecated: operation["deprecated"] === true,
    disposition: verdict.disposition,
    dispositionBecause: verdict.dispositionBecause,
    exclusionReason: verdict.exclusionReason,
    headerParams: parameterNames({ location: "header", operation }),
    kind,
    method,
    name,
    operationId: typeof operationId === "string" && operationId.length > 0 ? operationId : null,
    paging: nightfallPagingFor({ queryParams, responseFields }),
    path,
    pathParams: pathTemplateParams({ path }),
    queryParams,
    responseFields,
    security: securityNames({ operation, spec }),
    server,
    specDocument: spec.document,
    summary: typeof summary === "string" && summary.length > 0 ? summary : null,
  };
}
