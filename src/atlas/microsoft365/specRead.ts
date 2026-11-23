/**
 * Reading the pinned Microsoft Graph specification into operation rows.
 *
 * ## Why this parses a document rather than importing a client
 *
 * The sibling Notion and Slack atlases compile their API surface from an installed SDK's own generated
 * modules. There is no equivalent here that would be honest: the Graph JavaScript client is a request builder
 * over a metadata document rather than a declaration of endpoints, so compiling from it would report what the
 * client's authors chose to generate rather than what Graph offers. The document Microsoft publishes IS the
 * declaration, and `specLock.ts` pins it to an immutable commit so a reader can fetch the exact bytes.
 *
 * ## Every number this produces is asserted against the pin
 *
 * A census that moved means the vendor regenerated the surface. This module REPORTS the census and
 * {@link syncMicrosoft365CompiledSurface} refuses on a mismatch — a compiled channel whose denominator drifts
 * silently is a coverage fraction that stops meaning anything, which is the one property atlases exist to
 * keep.
 *
 * ## Response FIELDS, not response values
 *
 * Nothing here ever calls Graph, so a field name is all there is to have. Resolution follows the document's
 * own chain — `responses["2XX"].$ref` into `components.responses`, then the JSON schema's `$ref` into
 * `components.schemas` — and for a collection response it descends one more hop into `value.items`, because
 * "what fields does a user have" is the question a reader is actually asking and the collection wrapper's own
 * three properties are not the answer. `allOf` bases are merged, since Graph expresses inheritance that way
 * and half of `microsoft.graph.user`'s fields live on `microsoft.graph.directoryObject`.
 */
import { parse } from "yaml";
import { absentAsNull } from "#lib/absent.js";
import { incrementCount } from "#lib/collections.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { openapiComponentSection, openapiFieldNames, openapiRefName } from "../kit/openapiSchema.js";
import { microsoft365DispositionFor } from "./dispositions.js";
import { Microsoft365AtlasErrors, microsoft365AtlasErrorLines } from "./errors.js";
import type { Microsoft365Disposition, Microsoft365Kind } from "./model.js";
import {
  microsoft365AliasOf,
  microsoft365KindOf,
  microsoft365PaginationOf,
  microsoft365ProviderId,
  microsoft365RootSegmentOf,
} from "./surfaceNaming.js";

/** The HTTP methods this atlas reads out of the document. Anything else is not an operation. */
const HTTP_METHODS: readonly string[] = ["get", "post", "patch", "put", "delete"];

/** How deep `allOf` inheritance is followed before the walk gives up. Graph's own chains are two or three. */
const MAX_SCHEMA_DEPTH = 8;

/**
 * One operation, as the compiled channel knows it.
 *
 * @internal
 */
export interface Microsoft365OperationRow {
  readonly kind: Microsoft365Kind;
  readonly method: string;
  readonly pathShape: string;
  readonly providerId: string;
  readonly operationId: string;
  readonly summary: string | null;
  readonly tags: readonly string[];
  readonly pathParams: readonly string[];
  readonly queryParams: readonly string[];
  readonly pagination: string;
  readonly responseSchema: string | null;
  readonly responseFields: readonly string[];
  readonly aliasOf: string | null;
  readonly disposition: Microsoft365Disposition;
  readonly dispositionReason: string;
  readonly dispositionRuleId: string;
}

/**
 * What the document says about itself, measured rather than trusted.
 *
 * @internal
 */
export interface Microsoft365SpecCensus {
  readonly pathCount: number;
  readonly operationCount: number;
  readonly methodCounts: Readonly<Record<string, number>>;
  readonly rootCount: number;
  readonly schemaCount: number;
}

/**
 * The whole compiled surface: every operation, the census, and what the document held that this cannot map.
 *
 * @internal
 */
export interface Microsoft365CompiledSurface {
  readonly rows: readonly Microsoft365OperationRow[];
  readonly census: Microsoft365SpecCensus;
  /**
   * First path segments the document declares that `MICROSOFT365_KINDS` does not.
   *
   * Never silently dropped: a new root is Microsoft adding a workload, which is precisely the unknown unknown
   * this atlas exists to surface, so it becomes a refusal rather than a shrunken surface.
   */
  readonly unknownRoots: readonly string[];
}

/** The schema a `components.responses` entry declares for `application/json`, as a `$ref` name. */
function responseSchemaName({
  response,
  responses,
}: {
  response: unknown;
  responses: Record<string, unknown>;
}): string | null {
  const direct = isRecord(response) ? response : null;
  const viaRef = direct === null ? null : openapiRefName({ ref: direct["$ref"] });
  const resolved = viaRef === null ? direct : absentAsNull({ value: responses[viaRef] });
  if (!isRecord(resolved)) {
    return null;
  }
  const content = resolved["content"];
  if (!isRecord(content)) {
    return null;
  }
  const json = content["application/json"];
  if (!isRecord(json)) {
    return null;
  }
  const schema = json["schema"];
  return isRecord(schema) ? openapiRefName({ ref: schema["$ref"] }) : null;
}

/**
 * The ENTITY schema behind a response, descending through a collection wrapper when there is one.
 *
 * @param name the response's own schema name
 * @param schemas the document's `components.schemas` map
 * @returns the entity schema name, or the response schema name when it is not a collection wrapper
 */
function entitySchemaName({ name, schemas }: { name: string; schemas: Record<string, unknown> }): string {
  const schema = schemas[name];
  if (!isRecord(schema)) {
    return name;
  }
  const bases = Array.isArray(schema["allOf"]) ? schema["allOf"] : [];
  const nodes = [schema, ...bases.filter((base): base is Record<string, unknown> => isRecord(base))];
  for (const node of nodes) {
    const properties = node["properties"];
    if (!isRecord(properties)) {
      continue;
    }
    const value = properties["value"];
    if (!isRecord(value)) {
      continue;
    }
    const items = value["items"];
    const inner = isRecord(items) ? openapiRefName({ ref: items["$ref"] }) : null;
    if (inner !== null) {
      return inner;
    }
  }
  return name;
}

/**
 * Parameter names an operation declares, split by where they live.
 *
 * A `$ref` into `components.parameters` is resolved rather than skipped, and that is not a detail: Graph
 * declares `$top`, `$skip`, `$count`, `$filter` and `$search` ONLY by reference, so a reader that took names
 * inline alone reported `GET /users` as unpageable and unfilterable. MEASURED before the fix — every one of
 * the 9,378 GETs lost its paging parameters, which is exactly the kind of quiet, plausible undercount an
 * atlas is supposed to catch rather than commit.
 *
 * @param operation the operation node
 * @param parameters the document's `components.parameters` map
 * @returns path names in declaration order, query names sorted, and every name for the pagination test
 */
function parameterNames({
  operation,
  parameters,
}: {
  operation: Record<string, unknown>;
  parameters: Record<string, unknown>;
}): {
  path: readonly string[];
  query: readonly string[];
  all: readonly string[];
} {
  const declared = Array.isArray(operation["parameters"]) ? operation["parameters"] : [];
  const path: string[] = [];
  const query: string[] = [];
  const all: string[] = [];
  for (const entry of declared) {
    if (!isRecord(entry)) {
      continue;
    }
    const ref = openapiRefName({ ref: entry["$ref"] });
    const resolved = ref === null ? entry : parameters[ref];
    if (!isRecord(resolved) || typeof resolved["name"] !== "string") {
      continue;
    }
    const name = resolved["name"];
    all.push(name);
    if (resolved["in"] === "path") {
      path.push(name);
    }
    if (resolved["in"] === "query") {
      query.push(name);
    }
  }
  return { all, path, query: query.toSorted() };
}

/**
 * Read one pinned Graph specification into operation rows.
 *
 * The whole document is parsed at once — MEASURED at 7.4 s and about 1.8 GB of resident memory on
 * the pinned 44 MB v1.0 file (reproduce with `slopweaver atlas microsoft365 sync --json`, which prints the
 * elapsed milliseconds). A streaming reader was considered and rejected: `$ref` resolution needs the
 * components section, which the document writes AFTER every path that refers to it.
 *
 * @param text the specification's own bytes, already digest-verified by the caller
 * @returns every operation, the census, and any root this build does not declare
 */
export function readMicrosoft365Surface({ text }: { text: string }): Result<Microsoft365CompiledSurface> {
  let doc: unknown;
  try {
    doc = parse(text) as unknown;
  } catch (cause: unknown) {
    return err(microsoft365AtlasErrorLines({ error: Microsoft365AtlasErrors.specUnparseable({ cause }) }));
  }
  if (!isRecord(doc)) {
    return err(microsoft365AtlasErrorLines({ error: Microsoft365AtlasErrors.specNotMapping() }));
  }
  const paths = doc["paths"];
  if (!isRecord(paths)) {
    return err(microsoft365AtlasErrorLines({ error: Microsoft365AtlasErrors.specWithoutPaths() }));
  }
  const schemas = openapiComponentSection({ doc, section: "schemas" });
  const collected = collectRows({
    parameters: openapiComponentSection({ doc, section: "parameters" }),
    paths,
    responses: openapiComponentSection({ doc, section: "responses" }),
    schemas,
  });
  return ok({
    census: {
      methodCounts: collected.methodCounts,
      operationCount: Object.values(collected.methodCounts).reduce((total, count) => total + count, 0),
      pathCount: Object.keys(paths).length,
      rootCount: collected.roots.size,
      schemaCount: Object.keys(schemas).length,
    },
    rows: collected.rows,
    unknownRoots: [...collected.unknownRoots].toSorted(),
  });
}

/**
 * Walk every path and every method, building one row each.
 *
 * Split out of {@link readMicrosoft365Surface} because the two do different jobs: that one validates the
 * document and assembles the census, this one is the walk. A path whose root this build does not declare
 * contributes its NAME and no rows, so a workload Microsoft added becomes a refusal upstream rather than a
 * quietly shorter surface.
 */
function collectRows({
  paths,
  schemas,
  responses,
  parameters,
}: {
  paths: Record<string, unknown>;
  schemas: Record<string, unknown>;
  responses: Record<string, unknown>;
  parameters: Record<string, unknown>;
}): {
  rows: readonly Microsoft365OperationRow[];
  methodCounts: Readonly<Record<string, number>>;
  roots: ReadonlySet<string>;
  unknownRoots: ReadonlySet<string>;
} {
  const declaredPaths = new Set(Object.keys(paths));
  const rows: Microsoft365OperationRow[] = [];
  const methodCounts = new Map<string, number>();
  const roots = new Set<string>();
  const unknownRoots = new Set<string>();
  const fieldCache = new Map<string, readonly string[]>();
  for (const [pathShape, item] of Object.entries(paths)) {
    const root = microsoft365RootSegmentOf({ pathShape });
    if (root !== null) {
      roots.add(root);
    }
    const kind = microsoft365KindOf({ pathShape });
    if (kind === null) {
      unknownRoots.add(unknownRootName({ pathShape }));
      continue;
    }
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
        operationRow({ declaredPaths, fieldCache, kind, method, operation, parameters, pathShape, responses, schemas }),
      );
    }
  }
  return { methodCounts: Object.fromEntries(methodCounts), roots, rows, unknownRoots };
}

/**
 * What a path whose root this build declares no kind for is listed under: its first segment, or — for a path
 * key with no segment at all — the whole key, so the refusal still names exactly what the document declared.
 */
function unknownRootName({ pathShape }: { pathShape: string }): string {
  const root = microsoft365RootSegmentOf({ pathShape });
  if (root === null) {
    return pathShape;
  }
  return root;
}

/**
 * The success response an operation declares: its `2XX` range when it has one, else its `200`. An operation
 * declaring neither — a `204 No Content` delete — answers `undefined`, which names no response schema.
 */
function successResponse({ declaredResponses }: { declaredResponses: Record<string, unknown> }): unknown {
  const range = declaredResponses["2XX"];
  if (range == null) {
    return declaredResponses["200"];
  }
  return range;
}

/** The fields an earlier row already resolved for this entity, or a fresh schema walk when none has. */
function entityFields({
  cached,
  entity,
  schemas,
}: {
  cached: readonly string[] | undefined;
  entity: string;
  schemas: Record<string, unknown>;
}): readonly string[] {
  if (cached == null) {
    return openapiFieldNames({ depth: MAX_SCHEMA_DEPTH, name: entity, schemas });
  }
  return cached;
}

/** Build one row, resolving its response fields through the memoised schema walk. */
function operationRow({
  kind,
  method,
  pathShape,
  operation,
  parameters,
  responses,
  schemas,
  declaredPaths,
  fieldCache,
}: {
  kind: Microsoft365Kind;
  method: string;
  pathShape: string;
  operation: Record<string, unknown>;
  parameters: Record<string, unknown>;
  responses: Record<string, unknown>;
  schemas: Record<string, unknown>;
  declaredPaths: ReadonlySet<string>;
  fieldCache: Map<string, readonly string[]>;
}): Microsoft365OperationRow {
  const upper = method.toUpperCase();
  const ruling = microsoft365DispositionFor({ method: upper, pathShape });
  const declaredParameters = parameterNames({ operation, parameters });
  const declaredResponses = isRecord(operation["responses"]) ? operation["responses"] : {};
  const named = responseSchemaName({ response: successResponse({ declaredResponses }), responses });
  const entity = named === null ? null : entitySchemaName({ name: named, schemas });
  const cached = entity === null ? undefined : fieldCache.get(entity);
  const fields = entity === null ? [] : entityFields({ cached, entity, schemas });
  if (entity !== null && cached === undefined) {
    fieldCache.set(entity, fields);
  }
  const tags = Array.isArray(operation["tags"])
    ? operation["tags"].filter((tag): tag is string => typeof tag === "string")
    : [];
  return {
    aliasOf: microsoft365AliasOf({ declaredPaths, pathShape }),
    disposition: ruling.disposition,
    dispositionReason: ruling.reason,
    dispositionRuleId: ruling.ruleId,
    kind,
    method: upper,
    operationId: typeof operation["operationId"] === "string" ? operation["operationId"] : `${method}${pathShape}`,
    pagination: microsoft365PaginationOf({ parameterNames: declaredParameters.all }),
    pathParams: declaredParameters.path,
    pathShape,
    providerId: microsoft365ProviderId({ method: upper, pathShape }),
    queryParams: declaredParameters.query,
    responseFields: fields,
    responseSchema: entity,
    summary: typeof operation["summary"] === "string" && operation["summary"].length > 0 ? operation["summary"] : null,
    tags,
  };
}
