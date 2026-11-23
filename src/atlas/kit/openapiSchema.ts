/**
 * Walking an OpenAPI document's `components` — the four resolutions every atlas that compiles from a
 * published specification writes identically.
 *
 * ## Why this is kit-owned
 *
 * Two atlases arrived at the same seventy lines: resolve a `$ref` to its component name, reach into
 * `components.<section>`, find the `application/json` schema a response declares, and collect a schema's
 * property names through its `allOf` bases. The `duplicate-windows` gate flagged the pair, which is the gate
 * doing its job — none of the four says anything about the PLATFORM. What a platform still owns is which
 * documents to read, which response code counts as success, how deep an envelope goes and what a row means,
 * and none of that is here.
 *
 * ## `allOf` is followed and `oneOf` is not, deliberately
 *
 * `allOf` is intersection: every base's properties genuinely are on the result, so merging them answers
 * "what fields does this carry". `oneOf` is a choice between shapes, and flattening one would report a
 * field that is present on only one arm as present on the entity — an overstatement in a structure whose
 * whole job is to say what is there. A caller that needs an arm picks it itself.
 *
 * ## The depth cap is a cycle guard, not a budget
 *
 * A document may declare a schema whose `allOf` chain returns to itself, and a walk with no ceiling never
 * comes back. Both the visited set and the remaining depth are carried, because either alone is defeatable:
 * the set cannot stop a chain through fresh inline nodes, and the counter cannot stop a two-node cycle from
 * costing its whole budget.
 */
import { isRecord } from "../../lib/parsers.js";

/**
 * A `$ref` string's final component, which is how every `components` map is keyed.
 *
 * @param ref the candidate `$ref` value, straight off an untyped document
 * @returns the component name, or `null` when the value is not a usable reference
 */
export function openapiRefName({ ref }: { ref: unknown }): string | null {
  if (typeof ref !== "string") {
    return null;
  }
  const name = ref.split("/").at(-1);
  return name === undefined || name.length === 0 ? null : name;
}

/**
 * One `components.<section>` map, or an empty one when the document declares none.
 *
 * Empty rather than `null`, because every caller iterates or indexes it and an absent section is the same
 * fact as an empty one for that purpose.
 *
 * @param doc the parsed document
 * @param section the section name, e.g. `schemas`, `parameters`, `responses`
 * @returns the section, or an empty map
 */
export function openapiComponentSection({ doc, section }: { doc: unknown; section: string }): Record<string, unknown> {
  if (!isRecord(doc)) {
    return {};
  }
  const components = doc["components"];
  if (!isRecord(components)) {
    return {};
  }
  const found = components[section];
  return isRecord(found) ? found : {};
}

/**
 * The `application/json` schema node one response or request-body node declares.
 *
 * Returned as the NODE rather than as a `$ref` name, because a document may declare the schema inline —
 * and a caller that only ever asked for a name would silently read such an operation as declaring nothing.
 *
 * @param node the response or request-body node
 * @returns the schema node, or `null` when it declares no JSON schema
 */
export function openapiJsonSchemaNode({ node }: { node: unknown }): Record<string, unknown> | null {
  if (!isRecord(node)) {
    return null;
  }
  const content = node["content"];
  if (!isRecord(content)) {
    return null;
  }
  const json = content["application/json"];
  if (!isRecord(json)) {
    return null;
  }
  const schema = json["schema"];
  return isRecord(schema) ? schema : null;
}

/**
 * Every property name one NAMED schema carries, following its `allOf` bases.
 *
 * @param name the component schema name to start from
 * @param schemas the document's `components.schemas` map
 * @param depth how many schema nodes deep the walk may still read, this one included — `1` reads only this
 *   schema's own properties and none of its bases
 * @param seen names already visited, so a cyclic `allOf` cannot loop
 * @returns every property name found, unsorted and possibly duplicated
 *
 * @internal
 */
export function openapiPropertyNames({
  name,
  schemas,
  depth,
  seen,
}: {
  name: string;
  schemas: Record<string, unknown>;
  depth: number;
  seen: Set<string>;
}): readonly string[] {
  if (depth <= 0 || seen.has(name)) {
    return [];
  }
  seen.add(name);
  const schema = schemas[name];
  if (!isRecord(schema)) {
    return [];
  }
  return openapiPropertiesOfNode({ depth, node: schema, schemas, seen });
}

/**
 * Every property name one schema NODE carries, following its `allOf` bases.
 *
 * Separate from {@link openapiPropertyNames} because the two questions differ: a node may be inline and
 * therefore have no name to visit, and a caller holding one should not have to invent a key for it.
 *
 * The depth budget binds an inline base exactly as it binds a named one: an inline `allOf` chain is still a
 * chain of hops, and only the visited set, not the budget, is specific to names.
 *
 * @param node the schema node
 * @param schemas the document's `components.schemas` map
 * @param depth how many schema nodes deep the walk may still read, this one included
 * @param seen names already visited, so a cyclic `allOf` cannot loop
 * @returns every property name found, unsorted and possibly duplicated
 *
 * @internal
 */
export function openapiPropertiesOfNode({
  node,
  schemas,
  depth,
  seen,
}: {
  node: Record<string, unknown>;
  schemas: Record<string, unknown>;
  depth: number;
  seen: Set<string>;
}): readonly string[] {
  if (depth <= 0) {
    return [];
  }
  const own = isRecord(node["properties"]) ? Object.keys(node["properties"]) : [];
  const bases = Array.isArray(node["allOf"]) ? node["allOf"] : [];
  const inherited = bases.flatMap((base): readonly string[] => {
    if (!isRecord(base)) {
      return [];
    }
    const ref = openapiRefName({ ref: base["$ref"] });
    if (ref !== null) {
      return openapiPropertyNames({ depth: depth - 1, name: ref, schemas, seen });
    }
    return openapiPropertiesOfNode({ depth: depth - 1, node: base, schemas, seen });
  });
  return [...own, ...inherited];
}

/**
 * The distinct, sorted property names one named schema carries — what a stored row keeps.
 *
 * The shape every caller actually wanted: {@link openapiPropertyNames} returns duplicates because an
 * `allOf` chain legitimately re-declares a field, and every caller then wrote the same de-duplicate-and-sort.
 *
 * @param name the component schema name
 * @param schemas the document's `components.schemas` map
 * @param depth how many schema nodes deep to read, the named one included — `1` is its own properties only
 * @returns the distinct names, sorted
 */
export function openapiFieldNames({
  name,
  schemas,
  depth,
}: {
  name: string;
  schemas: Record<string, unknown>;
  depth: number;
}): readonly string[] {
  return [...new Set(openapiPropertyNames({ depth, name, schemas, seen: new Set() }))].toSorted();
}
