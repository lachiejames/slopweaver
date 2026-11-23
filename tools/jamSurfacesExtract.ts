/**
 * The pure extraction `tools/generateJamSurfaces.ts` runs over the documents it fetched: operations out of
 * the OpenAPI description, scope rows out of the authorization server, integration pages out of the sitemap.
 * Split out so the generator stays under the file-size cap; nothing here reaches the network or the
 * filesystem.
 */
import type { JamIntegrationRow, JamOperationRow, JamScopeRow } from "../src/atlas/jam/surfaceRow.js";

/** How deep a response schema is walked for field names. Stated here and in the descriptor. */
const FIELD_DEPTH = 2;

/**
 * Whether a value is a plain object, so a walk over untyped JSON never indexes a string.
 *
 * @returns true when the value is a non-null, non-array object
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every field path one schema node declares, to {@link FIELD_DEPTH}, `[]` marking an array. */
function fieldPaths({ node, prefix, level }: { node: unknown; prefix: string; level: number }): readonly string[] {
  if (!isRecord(node)) {
    return [];
  }
  if (node["type"] === "array" && node["items"] !== undefined) {
    return fieldPaths({ level, node: node["items"], prefix: `${prefix}[]` });
  }
  const properties = node["properties"];
  if (!isRecord(properties)) {
    return [];
  }
  const found: string[] = [];
  for (const [name, sub] of Object.entries(properties)) {
    const next = prefix === "" ? name : `${prefix}.${name}`;
    found.push(next);
    if (level < FIELD_DEPTH) {
      found.push(...fieldPaths({ level: level + 1, node: sub, prefix: next }));
    }
  }
  return found;
}

/**
 * Extract every operation the description declares.
 *
 * @returns the operation rows, sorted by method then path
 */
export function operationsOf({
  document,
  serverUrl,
}: {
  document: Record<string, unknown>;
  serverUrl: string;
}): readonly JamOperationRow[] {
  const paths = document["paths"];
  if (!isRecord(paths)) {
    throw new Error("the description declares no `paths` object");
  }
  const rows: JamOperationRow[] = [];
  for (const [path, node] of Object.entries(paths)) {
    if (!isRecord(node)) {
      continue;
    }
    for (const [method, operation] of Object.entries(node)) {
      if (!isRecord(operation)) {
        continue;
      }
      const upper = method.toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(upper)) {
        continue;
      }
      const declaredParameters = Array.isArray(operation["parameters"]) ? operation["parameters"] : [];
      const parameters = declaredParameters
        .filter(isRecord)
        .map((entry) => entry["name"])
        .filter((name): name is string => typeof name === "string");
      const security = Array.isArray(operation["security"]) ? operation["security"] : [];
      const schemes = security
        .filter(isRecord)
        .flatMap((entry) => Object.keys(entry))
        .toSorted((left, right) => left.localeCompare(right));
      const scopes = security
        .filter(isRecord)
        .flatMap((entry) => Object.values(entry))
        .flatMap((value) => (Array.isArray(value) ? value : []))
        .filter((value): value is string => typeof value === "string")
        .toSorted((left, right) => left.localeCompare(right));
      const responses = isRecord(operation["responses"]) ? operation["responses"] : {};
      const success = responses["200"] ?? responses["201"];
      const content = isRecord(success) && isRecord(success["content"]) ? success["content"] : {};
      const json = content["application/json"];
      const schema = isRecord(json) ? json["schema"] : null;
      const tag = Array.isArray(operation["tags"]) ? operation["tags"][0] : null;
      const summary = operation["summary"] ?? operation["description"];
      const write = upper !== "GET";
      rows.push({
        callable: !write,
        excludedBecause: write
          ? `${upper} is a write on an OAuth authorisation server — registering, exchanging or revoking a ` +
            "credential. This atlas maps it and never calls it"
          : null,
        kind: "operation",
        method: upper,
        parameters: [...new Set(parameters)].toSorted((left, right) => left.localeCompare(right)),
        path,
        responseFields: [...new Set(fieldPaths({ level: 0, node: schema, prefix: "" }))].toSorted((left, right) =>
          left.localeCompare(right),
        ),
        scopes,
        security: [...new Set(schemes)].toSorted((left, right) => left.localeCompare(right)),
        serverUrl,
        synopsis: typeof summary === "string" && summary.length > 0 ? summary : null,
        tag: typeof tag === "string" && tag.length > 0 ? tag : null,
      });
    }
  }
  return rows.toSorted((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`));
}

/**
 * The scope rows, joining the authorization server's list to what each resource and operation claims.
 *
 * @returns one row per scope the authorization server declares, sorted by scope
 */
export function scopesOf({
  authorizationServer,
  resources,
  operations,
}: {
  authorizationServer: Record<string, unknown>;
  resources: readonly { readonly id: string; readonly document: Record<string, unknown> }[];
  operations: readonly JamOperationRow[];
}): readonly JamScopeRow[] {
  const declared = authorizationServer["scopes_supported"];
  if (!Array.isArray(declared)) {
    throw new Error("the authorization server declares no `scopes_supported` array");
  }
  return declared
    .filter((scope): scope is string => typeof scope === "string")
    .toSorted((left, right) => left.localeCompare(right))
    .map((scope) => ({
      claimedByResources: resources
        .filter((resource) => {
          const supported = resource.document["scopes_supported"];
          return Array.isArray(supported) && supported.includes(scope);
        })
        .map((resource) => resource.id)
        .toSorted((left, right) => left.localeCompare(right)),
      namedBy: operations
        .filter((operation) => operation.scopes.includes(scope))
        .map((operation) => `${operation.method} ${operation.path}`)
        .toSorted((left, right) => left.localeCompare(right)),
      scope,
    }));
}

/**
 * The integration pages the marketing sitemap declares.
 *
 * @returns one row per distinct integration slug, sorted by slug
 */
export function integrationsOf({ sitemap }: { sitemap: string }): readonly JamIntegrationRow[] {
  const found = [...sitemap.matchAll(/<loc>https:\/\/jam\.dev\/integrations\/(?<slug>[a-z0-9-]+)<\/loc>/g)];
  const slugs = found
    .map((match) => match.groups?.["slug"])
    .filter((slug): slug is string => typeof slug === "string" && slug.length > 0);
  return [...new Set(slugs)]
    .toSorted((left, right) => left.localeCompare(right))
    .map((slug) => ({ pageUrl: `https://jam.dev/integrations/${slug}`, slug }));
}
