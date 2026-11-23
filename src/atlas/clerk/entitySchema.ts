/**
 * Which named schema a Clerk response is ABOUT, as opposed to the envelope it arrives in.
 *
 * Split from `specRead.ts` along the one seam that reads a schema node rather than an operation: everything
 * here is a pure walk over a parsed document's `components.schemas`, so it is testable on a hand-built map.
 */
import { isRecord } from "../../lib/parsers.js";
import { openapiRefName } from "../kit/openapiSchema.js";

/**
 * The ENTITY schema behind a response, descending through a paginated envelope when there is one.
 *
 * Clerk's list endpoints answer `{ data: [...], total_count }`, so the envelope's own two properties are
 * not what a reader is asking about. An array response with no envelope descends through `items` instead.
 *
 * @param node the response's own schema node
 * @param schemas the document's `components.schemas` map
 * @returns the entity schema name, or `null` when the response declares no named schema at all
 */
export function clerkEntitySchemaName({
  node,
  schemas,
}: {
  node: Record<string, unknown>;
  schemas: Record<string, unknown>;
}): string | null {
  const direct = openapiRefName({ ref: node["$ref"] });
  if (direct !== null) {
    return unwrapEnvelope({ name: direct, schemas });
  }
  const items = node["items"];
  if (isRecord(items)) {
    const inner = openapiRefName({ ref: items["$ref"] });
    if (inner !== null) {
      return inner;
    }
  }
  return null;
}

/** One hop through a `{ data: [...] }` paginated envelope, when the named schema is one. */
function unwrapEnvelope({ name, schemas }: { name: string; schemas: Record<string, unknown> }): string {
  const schema = schemas[name];
  if (!isRecord(schema)) {
    return name;
  }
  const properties = schema["properties"];
  if (!isRecord(properties)) {
    return name;
  }
  const data = properties["data"];
  if (!isRecord(data)) {
    return name;
  }
  const items = data["items"];
  // An envelope whose items name no schema has nothing to unwrap to, so the envelope is the entity.
  const inner = isRecord(items) ? openapiRefName({ ref: items["$ref"] }) : null;
  if (inner === null) {
    return name;
  }
  return inner;
}
