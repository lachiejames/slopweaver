/**
 * The operation walk behind `tools/generateKnockSurfaces.ts`: Knock's OpenAPI documents in, compiled
 * `KnockSurfaceRow`s out, with the refusal every step shares.
 *
 * Pure extraction helpers split out of the generator so it stays under the file-size cap. This module never
 * imports the generator, which runs `main()` at import.
 */
import { declaredParameterNames, jsonSuccessSchema, schemaFieldPaths } from "../src/atlas/kit/openApiSurface.js";
import {
  isKnockVoluminousPath,
  KNOCK_PROBE_ONLY_PATH,
  knockCrossApiProducer,
  knockIdentifierSources,
} from "../src/atlas/knock/dispositions.js";
import { knockKindForPath } from "../src/atlas/knock/kinds.js";
import {
  KNOCK_HTTP_METHODS,
  type KnockApi,
  type KnockHttpMethod,
  knockPagingOf,
} from "../src/atlas/knock/surfaceNaming.js";
import type { KnockIdentifierSource, KnockSurfaceRow } from "../src/atlas/knock/surfaceRow.js";
import { isRecord } from "../src/lib/parsers.js";

/**
 * How many nesting steps past the top level a response schema is walked.
 *
 * Two, matching the Twilio and Jam atlases. Knock's schemas are mutually recursive — a workflow carries
 * steps which carry templates which carry a workflow — so an uncapped walk does not terminate, and the
 * descriptor states the resulting truncation rather than leaving a reader to infer it.
 */
const FIELD_DEPTH = 2;

/** The success status codes Knock answers, in the order it uses them. */
const SUCCESS_CODES = ["200", "201", "202", "204"] as const;

/** Fail loudly. A generator that carries on past a broken assumption writes a table nobody can trust. */
export function refuse(message: string): never {
  process.stderr.write(`generateKnockSurfaces: ${message}\n`);
  process.exit(1);
}

/** One operation, as the walk over a document's `paths` object yields it. */
export interface RawOperation {
  readonly api: KnockApi;
  readonly method: KnockHttpMethod;
  readonly operation: Record<string, unknown>;
  readonly path: string;
  /** Every query parameter name, the path item's shared ones included. */
  readonly queryParams: readonly string[];
  /** Every parameter name of any kind, the path item's shared ones included. */
  readonly params: readonly string[];
}

/**
 * Every operation one document declares, in the order its `paths` object lists them.
 *
 * @param api which published API the document is
 * @param document the parsed OpenAPI document
 * @returns one raw operation per path and verb
 */
export function readOperations({
  api,
  document,
}: {
  api: KnockApi;
  document: Record<string, unknown>;
}): RawOperation[] {
  const paths = document["paths"];
  if (!isRecord(paths)) {
    refuse(`the ${api} document has no paths object`);
  }
  const rows: RawOperation[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) {
      refuse(`the ${api} document's path ${path} is not an object`);
    }
    const shared = declaredParameterNames({ operation: item });
    const sharedQuery = queryNames({ node: item });
    for (const [verb, operation] of Object.entries(item)) {
      if (verb === "parameters") {
        continue;
      }
      const method = verb.toUpperCase();
      if (!isKnockHttpMethod(method)) {
        refuse(`the ${api} document declares ${method} on ${path}, which surfaceNaming.ts does not name`);
      }
      if (!isRecord(operation)) {
        refuse(`the ${api} document's ${method} ${path} is not an object`);
      }
      rows.push({
        api,
        method,
        operation,
        params: [...new Set([...shared, ...declaredParameterNames({ operation })])].toSorted(),
        path,
        queryParams: [...new Set([...sharedQuery, ...queryNames({ node: operation })])].toSorted(),
      });
    }
  }
  return rows;
}

/** Whether a verb is one `surfaceNaming.ts` names. */
function isKnockHttpMethod(method: string): method is KnockHttpMethod {
  return (KNOCK_HTTP_METHODS as readonly string[]).includes(method);
}

/** Every QUERY parameter name one node declares, ignoring path and header parameters. */
function queryNames({ node }: { node: Record<string, unknown> }): readonly string[] {
  const declared = node["parameters"];
  if (!Array.isArray(declared)) {
    return [];
  }
  return declared.flatMap((entry) =>
    isRecord(entry) && entry["in"] === "query" && typeof entry["name"] === "string" ? [entry["name"]] : [],
  );
}

/**
 * Every GET path each document declares, so a templated read's identifiers can be traced to a collection.
 *
 * @param operations every raw operation across both documents
 * @returns the GET paths of each API
 */
export function collectionPaths({
  operations,
}: {
  operations: readonly RawOperation[];
}): Readonly<Record<KnockApi, Set<string>>> {
  const byApi = { data: new Set<string>(), management: new Set<string>() };
  for (const row of operations) {
    if (row.method === "GET") {
      byApi[row.api].add(row.path);
    }
  }
  return byApi;
}

/**
 * Where the identifiers one templated read needs come from.
 *
 * `unavailable` wins over `other-api` and `other-api` over `same-api`, because the answer a caller needs is
 * the WORST case: an operation that needs three identifiers is only walkable when every one of them is.
 */
function identifierSourceOf({
  row,
  collections,
}: {
  row: RawOperation;
  collections: Readonly<Record<KnockApi, Set<string>>>;
}): KnockIdentifierSource {
  const needed = knockIdentifierSources({ path: row.path });
  if (needed.length === 0) {
    return "none";
  }
  const other: KnockApi = row.api === "data" ? "management" : "data";
  let worst: KnockIdentifierSource = "same-api";
  for (const { parameter, prefix } of needed) {
    if (collections[row.api].has(prefix)) {
      continue;
    }
    const declared = knockCrossApiProducer({ parameter, path: row.path });
    if (declared !== null && !collections.data.has(declared) && !collections.management.has(declared)) {
      refuse(
        `KNOCK_CROSS_API_IDENTIFIERS says ${row.path}'s {${parameter}} comes from ${declared}, which neither ` +
          "document declares any more — correct dispositions.ts",
      );
    }
    const producer = declared ?? prefix;
    if (collections[row.api].has(producer)) {
      continue;
    }
    if (collections[other].has(producer)) {
      worst = worst === "unavailable" ? worst : "other-api";
      continue;
    }
    worst = "unavailable";
  }
  return worst;
}

/** What this atlas does with one operation, and why. */
function dispositionOf({
  row,
  identifierFrom,
}: {
  row: RawOperation;
  identifierFrom: KnockIdentifierSource;
}): Pick<KnockSurfaceRow, "disposition" | "dispositionBecause" | "exclusionReason"> {
  if (row.method !== "GET") {
    return {
      disposition: "excluded",
      dispositionBecause: `${row.method} changes the account, and this atlas only ever reads`,
      exclusionReason: "mutating",
    };
  }
  if (row.path === KNOCK_PROBE_ONLY_PATH) {
    return {
      disposition: "probe-only",
      dispositionBecause:
        "it reports which service token THIS INSTALLATION holds and what it is scoped to, which is a fact" +
        " about the installation rather than about the organisation",
      exclusionReason: null,
    };
  }
  if (isKnockVoluminousPath({ path: row.path })) {
    return {
      disposition: "shape-index",
      dispositionBecause:
        "its records are observations Knock emits rather than configuration somebody created — unbounded," +
        " growing with the clock, identified by an instant — so only the family's shape is stored",
      exclusionReason: null,
    };
  }
  if (identifierFrom === "unavailable") {
    return {
      disposition: "excluded",
      dispositionBecause:
        "it answers about an identifier no operation in EITHER published document produces, so there is" +
        " nothing for a sync to walk",
      exclusionReason: "not-enumerable",
    };
  }
  return { disposition: "entity", dispositionBecause: null, exclusionReason: null };
}

/**
 * One compiled operation row.
 *
 * @param row the raw operation
 * @param document the document it came from
 * @param collections the GET paths each API declares
 * @returns the compiled row
 */
export function surfaceRow({
  row,
  document,
  collections,
}: {
  row: RawOperation;
  document: Record<string, unknown>;
  collections: Readonly<Record<KnockApi, Set<string>>>;
}): KnockSurfaceRow {
  const kind = knockKindForPath({ path: row.path });
  if (kind === null) {
    refuse(`no kind claims ${row.method} ${row.path} — add a prefix to src/atlas/knock/kinds.ts`);
  }
  const identifierFrom = identifierSourceOf({ collections, row });
  const tag = firstTag({ operation: row.operation });
  return {
    api: row.api,
    deprecated: row.operation["deprecated"] === true,
    environmentScoped: row.queryParams.includes("environment"),
    identifierFrom,
    kind,
    method: row.method,
    operationId: stringOr({ fallback: `${row.method} ${row.path}`, value: row.operation["operationId"] }),
    paging: knockPagingOf({ queryParams: row.queryParams }),
    path: row.path,
    probeEvidence: row.method === "GET" ? "exists-auth-required" : "unprobed-mutating",
    responseFieldCount: schemaFieldPaths({
      depth: FIELD_DEPTH,
      document,
      schema: jsonSuccessSchema({ codes: SUCCESS_CODES, document, operation: row.operation }),
    }).length,
    summary: typeof row.operation["summary"] === "string" ? row.operation["summary"] : null,
    tag,
    ...dispositionOf({ identifierFrom, row }),
  };
}

/** The operation's first tag, refusing one that declares none — the vocabulary is not optional. */
function firstTag({ operation }: { operation: Record<string, unknown> }): string {
  const tags = operation["tags"];
  const first = Array.isArray(tags) ? tags[0] : undefined;
  if (typeof first !== "string" || first.length === 0) {
    refuse("an operation declares no tag, so the provider's own vocabulary cannot be carried");
  }
  return first;
}

/** A string field, or a fallback when the document omits it. */
function stringOr({ value, fallback }: { value: unknown; fallback: string }): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
