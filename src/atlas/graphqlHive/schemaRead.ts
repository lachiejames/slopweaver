/**
 * Reading Hive's own GraphQL schema — the API surface map, in one request.
 *
 * ## Introspection IS the surface map for a GraphQL provider
 *
 * A REST atlas has to enumerate paths; a GraphQL one asks the server to enumerate itself. One `__schema`
 * query returns every root field with its arguments and every named type with its own fields, which is
 * exactly "every endpoint, every method, every parameter" plus the response-field half — and it cannot
 * drift from the running server, because the running server is what answered.
 *
 * ## Names only, never a value
 *
 * Every field reduced here is a NAME or a rendered TYPE. An argument's default VALUE is deliberately
 * reduced to a boolean: a default can be an arbitrary literal, it is not part of the surface a reader needs
 * to know exists, and storing provider literals unexamined is how an atlas ends up holding something nobody
 * decided to hold.
 *
 * ## The parse is defensive rather than trusting
 *
 * The response is provider JSON, so it is walked with type guards and anything unrecognised is skipped
 * rather than crashing the run. An introspection Hive extends next month adds fields this reducer ignores;
 * it must never make the whole atlas unreadable.
 *
 * ## What the introspection contract REQUIRES is refused when missing, never placeheld
 *
 * Two things are not "unrecognised" but malformed: a named type with no `kind`, and a named type reference
 * with no `name`. The GraphQL introspection contract declares both — the installed `graphql` package's own
 * `IntrospectionType` and `IntrospectionNamedTypeRef` (`node_modules/graphql/utilities/
 * getIntrospectionQuery.d.ts`) carry `kind` and `name` as required — so either missing is refused as
 * `MALFORMED_RESPONSE` rather than published as `UNKNOWN` or `Unknown`, which would read as a real kind
 * or a real type.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { arrayField, fieldOf, HIVE_API_ENDPOINT, isRecord, stringField } from "./client.js";
import { type HiveApiError, HiveApiErrors } from "./errors.js";
import type { HiveArgument } from "./model.js";

/** The introspection document this atlas sends. Depth 6 on the type ref covers every wrapper Hive uses. */
export const HIVE_INTROSPECTION_QUERY = `query SlopweaverHiveAtlasIntrospection {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        deprecationReason
        args { name defaultValue type { ...TypeRef } }
        type { ...TypeRef }
      }
      inputFields { name }
      enumValues(includeDeprecated: true) { name }
    }
  }
}
fragment TypeRef on __Type {
  kind
  name
  ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
}`;

/** One root field of `Query`, `Mutation` or `Subscription` — an operation a caller can send. */
export interface HiveSchemaOperation {
  readonly parentType: "Query" | "Mutation" | "Subscription";
  readonly name: string;
  readonly description: string | null;
  readonly deprecationReason: string | null;
  readonly returnType: string;
  readonly args: readonly HiveArgument[];
}

/** One named type in the schema, reduced to its kind and the names it declares. */
interface HiveSchemaType {
  readonly name: string;
  readonly typeKind: string;
  readonly description: string | null;
  readonly fields: readonly string[];
}

/** What one introspection answered, reduced to what this atlas stores. */
export interface HiveSchemaSurface {
  readonly operations: readonly HiveSchemaOperation[];
  readonly types: readonly HiveSchemaType[];
}

/** Which of the three root types a name is, or `null` when it is an ordinary type. */
const ROOT_KEYS = [
  { key: "queryType", parent: "Query" },
  { key: "mutationType", parent: "Mutation" },
  { key: "subscriptionType", parent: "Subscription" },
] as const;

/**
 * Reduce an introspection response into the operations and types this atlas stores.
 *
 * @param data the `data` object one introspection returned
 * @returns the reduced surface — empty when the response declares no `__schema`, which a caller treats as a
 *   malformed answer rather than as an empty API — or `MALFORMED_RESPONSE` when a field the introspection
 *   contract requires is missing (see this file's header)
 */
export function reduceHiveSchema({ data }: { data: Record<string, unknown> }): Result<HiveSchemaSurface, HiveApiError> {
  const schema = fieldOf({ key: "__schema", record: data });
  if (!isRecord(schema)) {
    return ok({ operations: [], types: [] });
  }
  const roots = rootTypeNames({ schema });
  const rawTypes = arrayField({ key: "types", record: schema });
  const operations: HiveSchemaOperation[] = [];
  const types: HiveSchemaType[] = [];
  for (const entry of rawTypes) {
    const typeName = isRecord(entry) ? stringField({ key: "name", record: entry }) : null;
    if (!isRecord(entry) || typeName === null || typeName.startsWith("__")) {
      continue;
    }
    const rooted = operationsIfRoot({ parent: roots.get(typeName), type: entry });
    if (rooted.isErr()) {
      return err(rooted.error);
    }
    operations.push(...rooted.value);
    const reduced = reduceType({ name: typeName, type: entry });
    if (reduced.isErr()) {
      return err(reduced.error);
    }
    types.push(reduced.value);
  }
  return ok({
    operations: operations.toSorted((left, right) =>
      providerKey({ operation: left }).localeCompare(providerKey({ operation: right })),
    ),
    types: types.toSorted((left, right) => left.name.localeCompare(right.name)),
  });
}

/**
 * The provider key one operation is tracked under — `<ParentType>.<field>`, byte-exact on both channels.
 *
 * @param operation the operation to key
 * @returns the key
 */
export function providerKey({ operation }: { operation: HiveSchemaOperation }): string {
  return `${operation.parentType}.${operation.name}`;
}

/** One type's root operations: none when it is not one of the three roots, which most types are not. */
function operationsIfRoot({
  parent,
  type,
}: {
  parent: HiveSchemaOperation["parentType"] | undefined;
  type: Record<string, unknown>;
}): Result<readonly HiveSchemaOperation[], HiveApiError> {
  if (parent === undefined) {
    return ok([]);
  }
  return rootOperations({ parent, type });
}

/** Map each root type's declared NAME to which of the three roots it is. */
function rootTypeNames({
  schema,
}: {
  schema: Record<string, unknown>;
}): ReadonlyMap<string, HiveSchemaOperation["parentType"]> {
  const names = new Map<string, HiveSchemaOperation["parentType"]>();
  for (const { key, parent } of ROOT_KEYS) {
    const root = fieldOf({ key, record: schema });
    const rootName = isRecord(root) ? stringField({ key: "name", record: root }) : null;
    if (rootName !== null) {
      names.set(rootName, parent);
    }
  }
  return names;
}

/** Every root field on one root type, as operations. */
function rootOperations({
  parent,
  type,
}: {
  parent: HiveSchemaOperation["parentType"];
  type: Record<string, unknown>;
}): Result<readonly HiveSchemaOperation[], HiveApiError> {
  const operations: HiveSchemaOperation[] = [];
  for (const field of arrayField({ key: "fields", record: type })) {
    const name = isRecord(field) ? stringField({ key: "name", record: field }) : null;
    if (!isRecord(field) || name === null) {
      continue;
    }
    const args = reduceArgs({ field });
    if (args.isErr()) {
      return err(args.error);
    }
    const returnType = renderTypeRef({ ref: fieldOf({ key: "type", record: field }) });
    if (returnType.isErr()) {
      return err(returnType.error);
    }
    operations.push({
      args: args.value,
      deprecationReason: stringField({ key: "deprecationReason", record: field }),
      description: stringField({ key: "description", record: field }),
      name,
      parentType: parent,
      returnType: returnType.value,
    });
  }
  return ok(operations);
}

/** One field's arguments, reduced to name, rendered type and whether a default exists. */
function reduceArgs({ field }: { field: Record<string, unknown> }): Result<readonly HiveArgument[], HiveApiError> {
  const reduced: HiveArgument[] = [];
  for (const arg of arrayField({ key: "args", record: field })) {
    const name = isRecord(arg) ? stringField({ key: "name", record: arg }) : null;
    if (!isRecord(arg) || name === null) {
      continue;
    }
    const argType = renderTypeRef({ ref: fieldOf({ key: "type", record: arg }) });
    if (argType.isErr()) {
      return err(argType.error);
    }
    const declared = fieldOf({ key: "defaultValue", record: arg });
    reduced.push({ argType: argType.value, hasDefault: declared !== null && declared !== undefined, name });
  }
  return ok(reduced.toSorted((left, right) => left.name.localeCompare(right.name)));
}

/**
 * One named type, reduced to its kind and every name it declares — fields, input fields or enum values.
 *
 * `name` is the one the caller already read and filtered on, so the type is never re-named here.
 */
function reduceType({
  name,
  type,
}: {
  name: string;
  type: Record<string, unknown>;
}): Result<HiveSchemaType, HiveApiError> {
  const names = new Set<string>();
  for (const key of ["fields", "inputFields", "enumValues"]) {
    for (const entry of arrayField({ key, record: type })) {
      const declared = isRecord(entry) ? stringField({ key: "name", record: entry }) : null;
      if (declared !== null) {
        names.add(declared);
      }
    }
  }
  const typeKind = stringField({ key: "kind", record: type });
  if (typeKind === null) {
    return err(
      HiveApiErrors.malformedResponse({
        endpoint: HIVE_API_ENDPOINT,
        reason: `the introspected type ${name} carries no kind, which the introspection contract requires`,
      }),
    );
  }
  return ok({
    description: stringField({ key: "description", record: type }),
    fields: [...names].toSorted(),
    name,
    typeKind,
  });
}

/**
 * Render one introspected type reference the way a human writes it — `[Target!]!` rather than a nest of
 * `NON_NULL`/`LIST` wrappers.
 *
 * A reference that is not an object at all renders `Unknown`: that is where the query's own `TypeRef`
 * fragment stops descending, so a wrapper nested deeper than it asks for has nothing below it to read.
 *
 * @param ref the `__Type` reference, at any wrapper depth
 * @returns the rendered type, or `MALFORMED_RESPONSE` for a named reference carrying no `name`, which the
 *   introspection contract requires
 */
export function renderTypeRef({ ref }: { ref: unknown }): Result<string, HiveApiError> {
  if (!isRecord(ref)) {
    return ok("Unknown");
  }
  const kind = stringField({ key: "kind", record: ref });
  if (kind === "NON_NULL") {
    return renderTypeRef({ ref: fieldOf({ key: "ofType", record: ref }) }).map((inner) => `${inner}!`);
  }
  if (kind === "LIST") {
    return renderTypeRef({ ref: fieldOf({ key: "ofType", record: ref }) }).map((inner) => `[${inner}]`);
  }
  const name = stringField({ key: "name", record: ref });
  if (name === null) {
    return err(
      HiveApiErrors.malformedResponse({
        endpoint: HIVE_API_ENDPOINT,
        reason: `a ${String(kind)} type reference carries no name, which the introspection contract requires`,
      }),
    );
  }
  return ok(name);
}
