/**
 * The parameter names one Clerk operation declares, resolved through `components.parameters`.
 *
 * Split from `specRead.ts` along the seam that reads an operation's parameter list rather than building its
 * row: everything here is a pure walk over a path item, an operation and the document's parameter map.
 */
import { isRecord } from "../../lib/parsers.js";
import { openapiRefName } from "../kit/openapiSchema.js";

/**
 * Parameter names an operation declares, split by where they live.
 *
 * A `$ref` into `components.parameters` is resolved rather than skipped: Clerk declares `limit` and
 * `offset` by reference on most of its list endpoints, and a reader taking names inline alone would report
 * the whole Backend API as unpageable — the exact quiet, plausible undercount that made the sibling
 * Microsoft 365 reader wrong about all 9,378 of its GETs.
 *
 * Path-level parameters are merged in too, because Clerk declares `{user_id}` once on the path item and not
 * on each of its methods.
 *
 * @param operation the operation node
 * @param pathItem the path node the operation hangs off, for its shared parameters
 * @param parameters the document's `components.parameters` map
 * @returns path names in declaration order, query names sorted, and every name for the pagination test
 */
export function parameterNames({
  operation,
  pathItem,
  parameters,
}: {
  operation: Record<string, unknown>;
  pathItem: Record<string, unknown>;
  parameters: Record<string, unknown>;
}): { path: readonly string[]; query: readonly string[]; all: readonly string[] } {
  const declared = [
    ...(Array.isArray(pathItem["parameters"]) ? pathItem["parameters"] : []),
    ...(Array.isArray(operation["parameters"]) ? operation["parameters"] : []),
  ];
  const resolved = declared.flatMap((entry) => resolveParameter({ entry, parameters }));
  return {
    all: resolved.map((one) => one.name),
    path: resolved.filter((one) => one.location === "path").map((one) => one.name),
    query: [...new Set(resolved.filter((one) => one.location === "query").map((one) => one.name))].toSorted(),
  };
}

/**
 * One declared parameter, resolved through `components.parameters` when it arrived by reference.
 *
 * @param entry the parameter node, inline or a `$ref`
 * @param parameters the document's `components.parameters` map
 * @returns the parameter's name and where it lives, or an empty list when it cannot be read
 */
function resolveParameter({
  entry,
  parameters,
}: {
  entry: unknown;
  parameters: Record<string, unknown>;
}): readonly { name: string; location: unknown }[] {
  if (!isRecord(entry)) {
    return [];
  }
  const ref = openapiRefName({ ref: entry["$ref"] });
  const resolved = ref === null ? entry : parameters[ref];
  if (!isRecord(resolved) || typeof resolved["name"] !== "string") {
    return [];
  }
  return [{ location: resolved["in"], name: resolved["name"] }];
}
