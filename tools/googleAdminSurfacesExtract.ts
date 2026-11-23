/**
 * The pure extraction `tools/generateGoogleAdminSurfaces.ts` runs over the discovery documents it loaded:
 * the method walk, one registry row per method, and one record shape per kind. Split out so the generator
 * stays under the file-size cap; nothing here reaches the network or the filesystem, and a method whose
 * kind, name or disposition cannot be decided THROWS.
 */
import { googleAdminDispositionFor } from "../src/atlas/googleAdmin/dispositions.js";
import {
  type GoogleAdminDocument,
  googleAdminApiFor,
  googleAdminKindFor,
  googleAdminOperationName,
  googleAdminPagingFor,
} from "../src/atlas/googleAdmin/surfaceNaming.js";
import type { GoogleAdminSurfaceRow } from "../src/atlas/googleAdmin/surfaceRow.js";

/** The HTTP methods a discovery document declares. */
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/** What one kind's declared record shape is, as the generated table holds it. */
export interface GoogleAdminRecordShape {
  readonly fields: readonly string[];
  readonly kind: string;
  readonly schemaName: string;
  readonly sourceOperation: string;
}

/**
 * Whether a value is a plain object, so a walk over untyped JSON never indexes a string.
 *
 * @returns true when the value is a non-null, non-array object
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One loaded document, as the extraction reads it. */
export interface LoadedDocument {
  readonly document: GoogleAdminDocument;
  readonly json: Record<string, unknown>;
  readonly bytes: Buffer;
}

/** One method as the walk finds it: where it sits, and the object Google declared. */
interface WalkedMethod {
  readonly path: readonly string[];
  readonly method: Record<string, unknown>;
}

/**
 * Every method in one document, with the resource path that declares it, plus which prefixes carry methods.
 *
 * @param json the parsed document
 * @returns the walked methods and the set of method-carrying resource paths
 */
function walkMethods({ json }: { json: Record<string, unknown> }): {
  readonly methods: readonly WalkedMethod[];
  readonly carriesMethods: ReadonlySet<string>;
} {
  const methods: WalkedMethod[] = [];
  const carriesMethods = new Set<string>();
  const descend = ({ resources, path }: { resources: unknown; path: readonly string[] }): void => {
    if (!isRecord(resources)) {
      return;
    }
    for (const [name, resource] of Object.entries(resources)) {
      if (!isRecord(resource)) {
        continue;
      }
      const here = [...path, name];
      const declared = resource["methods"];
      if (isRecord(declared) && Object.keys(declared).length > 0) {
        carriesMethods.add(here.join("/"));
        for (const value of Object.values(declared)) {
          if (isRecord(value)) {
            methods.push({ method: value, path: here });
          }
        }
      }
      descend({ path: here, resources: resource["resources"] });
    }
  };
  descend({ path: [], resources: json["resources"] });
  return { carriesMethods, methods };
}

/**
 * The schema name a `$ref` points at, or `null` when the value is not a reference.
 *
 * @param value the `request` or `response` object Google declared
 * @returns the bare schema name
 */
function refName({ value }: { value: unknown }): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const ref = value["$ref"];
  return typeof ref === "string" && ref.length > 0 ? ref : null;
}

/**
 * The top-level property names one named schema declares, sorted.
 *
 * @param json the parsed document
 * @param schemaName the schema to read
 * @returns its property names, or an empty array when the document declares no such schema
 */
function schemaFieldNames({
  json,
  schemaName,
}: {
  json: Record<string, unknown>;
  schemaName: string;
}): readonly string[] {
  const schemas = json["schemas"];
  const schema = isRecord(schemas) ? schemas[schemaName] : null;
  const properties = isRecord(schema) ? schema["properties"] : null;
  return isRecord(properties) ? Object.keys(properties).toSorted() : [];
}

/**
 * Build one registry row from one walked method.
 *
 * @param loaded the document it came from
 * @param walked the method and its resource path
 * @param carriesMethods which resource paths in this document declare methods of their own
 * @returns the row
 */
function rowOf({
  loaded,
  walked,
  carriesMethods,
}: {
  loaded: LoadedDocument;
  walked: WalkedMethod;
  carriesMethods: ReadonlySet<string>;
}): GoogleAdminSurfaceRow {
  const api = googleAdminApiFor({ document: loaded.document });
  const httpMethod = walked.method["httpMethod"];
  if (typeof httpMethod !== "string" || !METHODS.has(httpMethod)) {
    throw new Error(
      `${loaded.document}: method ${String(walked.method["id"])} declares httpMethod ${String(httpMethod)}`,
    );
  }
  const id = walked.method["id"];
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`${loaded.document}: a method under ${walked.path.join("/")} declares no id`);
  }
  const kind = googleAdminKindFor({
    api,
    declaresMethods: ({ prefix }) => carriesMethods.has(prefix.join("/")),
    path: walked.path,
  });
  const parameterBag = walked.method["parameters"];
  const parameters = isRecord(parameterBag) ? Object.keys(parameterBag).toSorted() : [];
  const parametersRequired = isRecord(parameterBag)
    ? Object.entries(parameterBag)
        .filter(([, value]) => isRecord(value) && value["required"] === true)
        .map(([name]) => name)
        .toSorted()
    : [];
  const responseSchema = refName({ value: walked.method["response"] });
  const responseFields =
    responseSchema === null ? [] : schemaFieldNames({ json: loaded.json, schemaName: responseSchema });
  const scopes = Array.isArray(walked.method["scopes"])
    ? walked.method["scopes"].filter((scope): scope is string => typeof scope === "string").toSorted()
    : [];
  const supportsMediaUpload = walked.method["supportsMediaUpload"] === true;
  const description = walked.method["description"];
  const firstLine = typeof description === "string" ? (description.split("\n")[0] ?? "").trim() : "";
  const flatPath = walked.method["flatPath"] ?? walked.method["path"];
  if (typeof flatPath !== "string" || flatPath.length === 0) {
    throw new Error(`${loaded.document}: ${id} declares no path`);
  }
  const verdict = googleAdminDispositionFor({ id, kind, method: httpMethod, supportsMediaUpload });
  return {
    api,
    baseUrl: String(loaded.json["baseUrl"]),
    description: firstLine.length > 0 ? firstLine : null,
    disposition: verdict.disposition,
    dispositionBecause: verdict.dispositionBecause,
    document: loaded.document,
    exclusionReason: verdict.exclusionReason,
    id,
    kind,
    // `as`: narrowed by the METHODS membership check above, which TypeScript cannot carry through a Set.
    // oxlint-disable-next-line no-unsafe-type-assertion
    method: httpMethod as GoogleAdminSurfaceRow["method"],
    name: googleAdminOperationName({ document: loaded.document, id }),
    paging: googleAdminPagingFor({ parameters, responseFields }),
    parameters,
    parametersRequired,
    path: flatPath,
    requestSchema: refName({ value: walked.method["request"] }),
    responseFields,
    responseSchema,
    scopes,
    supportsMediaUpload,
  };
}

/**
 * Every row one document contributes.
 *
 * @param loaded the document
 * @returns its rows, in walk order
 */
export function rowsOf({ loaded }: { loaded: LoadedDocument }): readonly GoogleAdminSurfaceRow[] {
  const { carriesMethods, methods } = walkMethods({ json: loaded.json });
  const top = loaded.json["methods"];
  const all = isRecord(top)
    ? [
        ...methods,
        ...Object.values(top)
          .filter(isRecord)
          .map((method) => ({ method, path: [] as readonly string[] })),
      ]
    : methods;
  return all.map((walked) => rowOf({ carriesMethods, loaded, walked }));
}

/**
 * One record shape per kind, taken from that kind's least-parameterised readable method.
 *
 * Fewest required parameters first, then GET before a write, so `directory.users.list` decides the
 * `directory-users` shape rather than `directory.users.watch`. A list method's response is an ENVELOPE, so
 * where its schema's properties name exactly one other schema by `$ref`, that inner schema is the record
 * and the envelope is not.
 *
 * @param documents every loaded document
 * @param rows the extracted registry, which decides each method's kind
 * @returns one shape per kind that has one, sorted by kind
 */
export function recordShapes({
  documents,
  rows,
}: {
  documents: readonly LoadedDocument[];
  rows: readonly GoogleAdminSurfaceRow[];
}): readonly GoogleAdminRecordShape[] {
  const byKind = new Map<string, GoogleAdminRecordShape>();
  const ranked = [...rows].toSorted((left, right) => {
    const byRequired = left.parametersRequired.length - right.parametersRequired.length;
    if (byRequired !== 0) {
      return byRequired;
    }
    if (left.method !== right.method) {
      return left.method === "GET" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
  for (const row of ranked) {
    if (byKind.has(row.kind) || row.responseSchema === null) {
      continue;
    }
    const loaded = documents.find((candidate) => candidate.document === row.document);
    if (loaded === undefined) {
      continue;
    }
    const resolved = innerRecordSchema({ json: loaded.json, schemaName: row.responseSchema });
    const fields = schemaFieldNames({ json: loaded.json, schemaName: resolved });
    if (fields.length === 0) {
      continue;
    }
    byKind.set(row.kind, { fields, kind: row.kind, schemaName: resolved, sourceOperation: row.name });
  }
  return [...byKind.values()].toSorted((left, right) => left.kind.localeCompare(right.kind));
}

/**
 * Unwrap a list envelope to the record schema inside it, when there is exactly one.
 *
 * @param json the parsed document
 * @param schemaName the response schema the method declared
 * @returns the inner schema's name, or the envelope's own when it is not one
 */
function innerRecordSchema({ json, schemaName }: { json: Record<string, unknown>; schemaName: string }): string {
  const schemas = json["schemas"];
  const schema = isRecord(schemas) ? schemas[schemaName] : null;
  const properties = isRecord(schema) ? schema["properties"] : null;
  if (!isRecord(properties)) {
    return schemaName;
  }
  const named = new Set<string>();
  for (const value of Object.values(properties)) {
    if (!isRecord(value)) {
      continue;
    }
    const direct = refName({ value });
    const items = isRecord(value["items"]) ? refName({ value: value["items"] }) : null;
    const inner = direct ?? items;
    if (inner !== null) {
      named.add(inner);
    }
  }
  return named.size === 1 ? ([...named][0] ?? schemaName) : schemaName;
}
