/**
 * The operation walk behind `tools/generatePrismaDataPlatformSurfaces.ts`: Prisma's OpenAPI document in,
 * `PrismaSurfaceRow`s out, with the refusal every step shares.
 *
 * Pure extraction helpers split out of the generator so it stays under the file-size cap. This module never
 * imports the generator, which runs `main()` at import.
 */
import { prismaProbeEvidenceFor } from "../src/atlas/prismaDataPlatform/apiProbe.js";
import { prismaDispositionOf } from "../src/atlas/prismaDataPlatform/dispositions.js";
import { prismaDataPlatformKindFor } from "../src/atlas/prismaDataPlatform/kinds.js";
import {
  PRISMA_AUTH_METHODS,
  PRISMA_HTTP_METHODS,
  type PrismaAuthMethod,
  type PrismaHttpMethod,
  prismaPagingOf,
} from "../src/atlas/prismaDataPlatform/surfaceNaming.js";
import type { PrismaSurfaceRow } from "../src/atlas/prismaDataPlatform/surfaceRow.js";
import { isRecord } from "../src/lib/parsers.js";

/** Fail loudly. A generator that carries on past a broken assumption writes a table nobody can trust. */
export function refuse(message: string): never {
  process.stderr.write(`generatePrismaDataPlatformSurfaces: ${message}\n`);
  process.exit(1);
}

/** One declared operation, with everything its path item shares folded in. */
export interface DeclaredOperation {
  readonly method: string;
  readonly operation: Record<string, unknown>;
  readonly path: string;
  readonly shared: readonly unknown[];
}

/**
 * Every operation the document declares, in path order.
 *
 * @param spec the parsed OpenAPI document
 * @returns one declared operation per path and verb
 */
export function operationsOf({ spec }: { spec: Record<string, unknown> }): readonly DeclaredOperation[] {
  const paths = spec["paths"];
  if (!isRecord(paths)) {
    return refuse("the document declares no `paths` object");
  }
  const found: DeclaredOperation[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) {
      continue;
    }
    const shared = Array.isArray(item["parameters"]) ? item["parameters"] : [];
    for (const method of PRISMA_HTTP_METHODS) {
      const operation = item[method.toLowerCase()];
      if (isRecord(operation)) {
        found.push({ method, operation, path, shared });
      }
    }
  }
  return found;
}

/** Every parameter an operation declares, its path item's shared ones included. */
function parametersOf({ entry }: { entry: DeclaredOperation }): readonly Record<string, unknown>[] {
  const own = Array.isArray(entry.operation["parameters"]) ? entry.operation["parameters"] : [];
  return [...own, ...entry.shared].filter(isRecord);
}

/**
 * Every distinct field path inside one JSON Schema, `[]` marking an array hop.
 *
 * Depth-capped rather than cycle-detected, because this document inlines every shape and declares no
 * `components/schemas` at all, so there is no `$ref` and no cycle to find — only nesting.
 */
function fieldPaths({
  schema,
  prefix = "",
  depth = 0,
}: {
  schema: unknown;
  prefix?: string;
  depth?: number;
}): string[] {
  if (!isRecord(schema) || depth > 12) {
    return [];
  }
  const found: string[] = [];
  for (const key of ["allOf", "anyOf", "oneOf"]) {
    const branch = schema[key];
    if (Array.isArray(branch)) {
      branch.forEach((member) => found.push(...fieldPaths({ depth: depth + 1, prefix, schema: member })));
    }
  }
  if (schema["items"] !== undefined) {
    found.push(...fieldPaths({ depth: depth + 1, prefix: `${prefix}[]`, schema: schema["items"] }));
  }
  const properties = schema["properties"];
  if (isRecord(properties)) {
    for (const [name, sub] of Object.entries(properties)) {
      const path = prefix.length === 0 ? name : `${prefix}.${name}`;
      found.push(path);
      found.push(...fieldPaths({ depth: depth + 1, prefix: path, schema: sub }));
    }
  }
  return found;
}

/** How many distinct response field paths one operation declares across every status code. */
function responseFieldCountOf({ entry }: { entry: DeclaredOperation }): number {
  const responses = entry.operation["responses"];
  if (!isRecord(responses)) {
    return 0;
  }
  const paths = new Set<string>();
  for (const response of Object.values(responses)) {
    if (!isRecord(response)) {
      continue;
    }
    const content = response["content"];
    if (!isRecord(content)) {
      continue;
    }
    for (const media of Object.values(content)) {
      if (isRecord(media)) {
        fieldPaths({ schema: media["schema"] }).forEach((path) => paths.add(path));
      }
    }
  }
  return paths.size;
}

/** Every response media type one operation declares. */
function mediaTypesOf({ entry }: { entry: DeclaredOperation }): readonly string[] {
  const responses = entry.operation["responses"];
  if (!isRecord(responses)) {
    return [];
  }
  const types = new Set<string>();
  for (const response of Object.values(responses)) {
    if (isRecord(response) && isRecord(response["content"])) {
      Object.keys(response["content"]).forEach((type) => types.add(type));
    }
  }
  return [...types];
}

/** Which credential forms one operation accepts, from its own `security` or the document root's. */
function authMethodsOf({
  entry,
  spec,
}: {
  entry: DeclaredOperation;
  spec: Record<string, unknown>;
}): readonly string[] {
  const own = entry.operation["security"];
  const requirements = Array.isArray(own) ? own : spec["security"];
  if (!Array.isArray(requirements)) {
    return [];
  }
  if (requirements.length === 0) {
    return ["unauthenticated"];
  }
  const names = new Set<string>();
  requirements.filter(isRecord).forEach((requirement) => {
    Object.keys(requirement).forEach((name) => names.add(name));
  });
  return [...names].toSorted();
}

/** Which OAuth scopes one operation requires, from its own `security` or the document root's. */
function scopesOf({ entry, spec }: { entry: DeclaredOperation; spec: Record<string, unknown> }): readonly string[] {
  const own = entry.operation["security"];
  const requirements = Array.isArray(own) ? own : spec["security"];
  if (!Array.isArray(requirements)) {
    return [];
  }
  const scopes = new Set<string>();
  requirements.filter(isRecord).forEach((requirement) => {
    Object.values(requirement).forEach((granted) => {
      if (Array.isArray(granted)) {
        granted.filter((scope): scope is string => typeof scope === "string").forEach((scope) => scopes.add(scope));
      }
    });
  });
  return [...scopes].toSorted();
}

/** A nullable string field of the operation, so an absent summary is `null` rather than `""`. */
function textOf({ entry, key }: { entry: DeclaredOperation; key: string }): string | null {
  const value = entry.operation[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Whether a verb is one `surfaceNaming.ts` names. */
function isPrismaHttpMethod(method: string): method is PrismaHttpMethod {
  return (PRISMA_HTTP_METHODS as readonly string[]).includes(method);
}

/** Whether a security scheme name is one `surfaceNaming.ts` names. */
function isPrismaAuthMethod(name: string): name is PrismaAuthMethod {
  return (PRISMA_AUTH_METHODS as readonly string[]).includes(name);
}

/**
 * Every security scheme one operation admits, refusing a name the atlas cannot place.
 *
 * @param method the operation's verb, named in the refusal
 * @param path the operation's path, named in the refusal
 * @returns the declared scheme names, each one `surfaceNaming.ts` declares
 */
function authMethodsFor({
  entry,
  method,
  path,
  spec,
}: {
  entry: DeclaredOperation;
  method: string;
  path: string;
  spec: Record<string, unknown>;
}): readonly PrismaAuthMethod[] {
  return authMethodsOf({ entry, spec }).map((name) => {
    if (!isPrismaAuthMethod(name)) {
      return refuse(`${method} ${path} requires ${name}, which surfaceNaming.ts does not name`);
    }
    return name;
  });
}

/**
 * One registry row from one declared operation.
 *
 * @param entry the declared operation
 * @param spec the parsed OpenAPI document
 * @param pages the documentation page URL of each documented operation
 * @returns the compiled row
 */
export function rowOf({
  entry,
  spec,
  pages,
}: {
  entry: DeclaredOperation;
  spec: Record<string, unknown>;
  pages: ReadonlyMap<string, string>;
}): PrismaSurfaceRow {
  const { method, path } = entry;
  if (!isPrismaHttpMethod(method)) {
    return refuse(`${method} ${path} uses a verb surfaceNaming.ts does not name`);
  }
  const placed = prismaDataPlatformKindFor({ method, path });
  if (placed === null) {
    return refuse(
      `no kind prefix covers ${method} ${path} — add a row to KIND_BY_PATH_PREFIX in ` +
        "src/atlas/prismaDataPlatform/kinds.ts and say in the pull request which surface Prisma has added",
    );
  }
  const name = entry.operation["operationId"];
  if (typeof name !== "string" || name.length === 0) {
    return refuse(`${method} ${path} declares no operationId, so it has no stable surface name`);
  }
  const tags = entry.operation["tags"];
  const tag = Array.isArray(tags) ? tags.find((value): value is string => typeof value === "string") : undefined;
  if (tag === undefined) {
    return refuse(`${method} ${path} carries no tag`);
  }
  const decided = prismaDispositionOf({ method, path });
  const queryParams = parametersOf({ entry })
    .filter((parameter) => parameter["in"] === "query")
    .map((parameter) => (typeof parameter["name"] === "string" ? parameter["name"] : ""));
  return {
    alsoFeeds: placed.alsoFeeds,
    authMethods: authMethodsFor({ entry, method, path, spec }),
    deprecated: entry.operation["deprecated"] === true,
    disposition: decided.disposition,
    dispositionBecause: decided.dispositionBecause,
    docsUrl: pages.get(`${method} ${path}`) ?? null,
    exclusionReason: decided.exclusionReason,
    kind: placed.kind,
    method,
    name,
    paging: prismaPagingOf({ mediaTypes: mediaTypesOf({ entry }), queryParams }),
    path,
    probeEvidence: prismaProbeEvidenceFor({ method, path }),
    responseFieldCount: responseFieldCountOf({ entry }),
    scopes: scopesOf({ entry, spec }),
    stability: entry.operation["x-prisma-stability"] === "experimental" ? "experimental" : "stable",
    summary: textOf({ entry, key: "summary" }),
    tag,
  };
}
