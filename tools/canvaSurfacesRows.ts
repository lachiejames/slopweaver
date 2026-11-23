/**
 * Read one Canva OpenAPI operation into one registry row.
 *
 * Split out of `tools/generateCanvaSurfaces.ts` so the generator stays under the file-size cap; the
 * untyped-YAML readers and the row builder live here, and the pin check, the census and the output stay there.
 */
import { canvaEffectFor } from "../src/atlas/canva/effects.js";
import { canvaEntitlementFor, canvaStabilityFor } from "../src/atlas/canva/eligibility.js";
import {
  canvaKindForTag,
  canvaNamesTheUi,
  canvaPagingFor,
  canvaSynopsisFor,
} from "../src/atlas/canva/surfaceNaming.js";
import type { CanvaSurfaceRow } from "../src/atlas/canva/surfaceRow.js";

/** The methods an operation object can be keyed by, in the order a table sorts them. */
export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type Method = (typeof METHODS)[number];

/**
 * Whether a value is a plain object, so a walk over untyped YAML never indexes a string.
 *
 * @returns true when the value is a non-null, non-array object
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The loaded document, as the extraction reads it. */
export interface LoadedSpec {
  readonly bytes: Buffer;
  readonly json: Record<string, unknown>;
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
function resolveSchema({ schema, spec }: { schema: unknown; spec: LoadedSpec }): unknown {
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
function schemaFieldNames({ schema, spec }: { schema: unknown; spec: LoadedSpec }): string[] {
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

/** The `application/json` schema of an operation's declared success response. */
function successSchema({ operation }: { operation: Record<string, unknown> }): unknown {
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

/**
 * The `application/json` schema of an operation's request body.
 *
 * Only the JSON body is read, deliberately. Two of these operations take `application/octet-stream` — the
 * asset and design uploads — and one takes `application/x-www-form-urlencoded`; a byte stream has no field
 * names to record, and recording an empty list for it says exactly the right thing.
 */
function bodySchema({ operation }: { operation: Record<string, unknown> }): unknown {
  const requestBody = operation["requestBody"];
  const content = isRecord(requestBody) ? requestBody["content"] : null;
  const json = isRecord(content) ? content["application/json"] : null;
  return isRecord(json) ? (json["schema"] ?? null) : null;
}

/** Every security scheme name an operation requires, and every scope it names, both sorted. */
function securityOf({ operation }: { operation: Record<string, unknown> }): {
  scopes: string[];
  security: string[];
} {
  const declared = operation["security"];
  if (!Array.isArray(declared)) {
    return { scopes: [], security: [] };
  }
  const schemes = new Set<string>();
  const scopes = new Set<string>();
  for (const requirement of declared) {
    if (!isRecord(requirement)) {
      continue;
    }
    for (const [scheme, granted] of Object.entries(requirement)) {
      schemes.add(scheme);
      if (Array.isArray(granted)) {
        for (const scope of granted) {
          if (typeof scope === "string") {
            scopes.add(scope);
          }
        }
      }
    }
  }
  return { scopes: [...scopes].toSorted(), security: [...schemes].toSorted() };
}

/** The path parameters a template names, in path order. */
function pathTemplateParams({ path }: { path: string }): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
}

/** The vendor's own `x-required-capabilities`, sorted. */
function capabilitiesOf({ operation }: { operation: Record<string, unknown> }): string[] {
  const declared = operation["x-required-capabilities"];
  if (!Array.isArray(declared)) {
    return [];
  }
  return declared.filter((value): value is string => typeof value === "string").toSorted();
}

/** The vendor's own per-user rate limit in requests per minute, or `null` where it declares none. */
function rateLimitOf({ operation }: { operation: Record<string, unknown> }): number | null {
  const declared = operation["x-rate-limit-per-client-user"];
  return typeof declared === "number" ? declared : null;
}

/** The single tag an operation carries, kebab-cased into this atlas's kind vocabulary. */
function tagOf({ name, operation }: { name: string; operation: Record<string, unknown> }): string {
  const tags = operation["tags"];
  if (!Array.isArray(tags) || tags.length !== 1) {
    throw new Error(`${name}: expected exactly one tag — the kind vocabulary is the vendor's own tag list`);
  }
  const tag: unknown = tags[0];
  if (typeof tag !== "string" || tag.length === 0) {
    throw new Error(`${name}: its tag is not a string`);
  }
  return tag;
}

/** The vendor's own `operationId`, which is this registry's unique name. */
function operationIdOf({
  method,
  operation,
  path,
}: {
  method: Method;
  operation: Record<string, unknown>;
  path: string;
}): string {
  const declared = operation["operationId"];
  if (typeof declared !== "string" || declared.length === 0) {
    throw new Error(`${method} ${path}: declares no operationId — the registry's names are the vendor's own`);
  }
  return declared;
}

/** The vendor's own description, which is the only place stability, entitlement and a synopsis live. */
function descriptionOf({ name, operation }: { name: string; operation: Record<string, unknown> }): string {
  const declared = operation["description"];
  if (typeof declared !== "string" || declared.length === 0) {
    throw new Error(`${name}: declares no description — every one of the pinned 59 does`);
  }
  return declared;
}

/**
 * Build one row from one operation object.
 *
 * @returns the registry row for the operation
 */
export function rowOf({
  method,
  operation,
  path,
  server,
  spec,
}: {
  method: Method;
  operation: Record<string, unknown>;
  path: string;
  server: string;
  spec: LoadedSpec;
}): CanvaSurfaceRow {
  const name = operationIdOf({ method, operation, path });
  const description = descriptionOf({ name, operation });
  const queryParams = parameterNames({ location: "query", operation });
  const responseFields = schemaFieldNames({ schema: successSchema({ operation }), spec });
  const effect = canvaEffectFor({ method, name });
  const entitlement = canvaEntitlementFor({ description, name });
  const { scopes, security } = securityOf({ operation });
  return {
    bodyParams: schemaFieldNames({ schema: bodySchema({ operation }), spec }),
    capabilities: capabilitiesOf({ operation }),
    deprecated: operation["deprecated"] === true,
    effect: effect.effect,
    effectBecause: effect.effectBecause,
    entitlement: entitlement.entitlement,
    entitlementBecause: entitlement.entitlementBecause,
    headerParams: parameterNames({ location: "header", operation }),
    kind: canvaKindForTag({ tag: tagOf({ name, operation }) }),
    method,
    name,
    namesTheCanvaUi: canvaNamesTheUi({ description }),
    paging: canvaPagingFor({ queryParams, responseFields }),
    path,
    pathParams: pathTemplateParams({ path }),
    queryParams,
    rateLimitPerUserPerMinute: rateLimitOf({ operation }),
    responseFields,
    scopes,
    security,
    server,
    stability: canvaStabilityFor({ description, name }),
    synopsis: canvaSynopsisFor({ description, name }),
  };
}
