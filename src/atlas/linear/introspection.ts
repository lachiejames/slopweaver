/**
 * The API surface, reduced: GraphQL introspection JSON in, `operation` and `type` records out. PURE.
 *
 * ## Why introspection is BATCHED, measured rather than assumed
 *
 * A single whole-schema introspection is REFUSED by Linear. Measured against the live API:
 * `Query too complex. Complexity: 65536. Maximum allowed complexity: 10000.` The cost is per TYPE and very
 * nearly linear — 1 type costs 33 points, 5 cost 164, 20 cost 655, 100 cost 3,270 — so
 * {@link INTROSPECTION_BATCH_SIZE} types per query sits at about a third of the per-query ceiling with
 * room for a schema that grows. The whole schema then costs 13 requests and 38,430 points against budgets
 * of 2,500 requests and 3,000,000 points per hour. Reproduce the numbers with:
 *
 * ```bash
 * slopweaver atlas linear sync --dry-run --json | jq '.api.requests, .api.complexity'
 * ```
 *
 * ## Two records from one read, because they answer different questions
 *
 * A root field's own `responsePaths` reach one level into its return type, matching the Slack atlas. That
 * makes "what does this call hand back" answerable, and leaves "is there ANY call that can hand me this
 * field" unanswerable — a field two hops down appears in no root field's path list. The `type` record is
 * that second question, and it is why the whole type list is walked rather than only the reachable half.
 *
 * ## An operation's key carries its root kind, because a bare name is not unique
 *
 * Measured on the live schema: `initiativeUpdate` and `projectUpdate` are each declared BOTH as
 * a `Query` field and as a `Mutation` field. So the provider key is `<rootKind>.<name>`, and the browser
 * channel produces the same key by parsing the client's own document — where the operation type is written
 * down — rather than by inferring one from a response body, which cannot say.
 *
 * ## The three root types, because the schema declares three
 *
 * `Subscription` is walked alongside `Query` and `Mutation`. It is part of the surface whether or not this
 * installation ever opens one, and `descriptor.ts` records that its TRANSPORT is unverified here — a
 * declaration catalogued is not a capability measured.
 */
import { z } from "zod";

import { absentAs, absentAsEmpty, absentAsNumber } from "#lib/absent.js";
import type { LinearOperationApiDetail, LinearRootKind, LinearTypeApiDetail } from "./model.js";

/**
 * How many types one introspection query asks for.
 *
 * 100 was MEASURED at 3,270 complexity points against Linear's 10,000-point per-query ceiling — see this
 * file's header for the whole curve and the command that reproduces it. Raising it toward the ceiling
 * would make the run one bad schema-growth away from a hard refusal, and lowering it buys nothing: the
 * whole schema already fits in 13 requests.
 */
export const INTROSPECTION_BATCH_SIZE = 100;

/** A type reference, which introspection nests through `ofType` for every non-null and list wrapper. */
interface TypeRef {
  readonly kind: string;
  readonly name: string | null;
  readonly ofType?: TypeRef | null | undefined;
}

const typeRefSchema: z.ZodType<TypeRef> = z.lazy(() =>
  z
    .object({
      kind: z.string(),
      name: z.string().nullable(),
      ofType: z.union([typeRefSchema, z.null()]).optional(),
    })
    .strict(),
);

const fieldSchema = z
  .object({
    args: z.array(z.object({ name: z.string() }).loose()),
    deprecationReason: z.string().nullable(),
    description: z.string().nullable(),
    isDeprecated: z.boolean(),
    name: z.string(),
    type: typeRefSchema,
  })
  .loose();

/** One `__type` result, as the batched introspection query selects it. */
export const introspectedTypeSchema = z
  .object({
    description: z.string().nullable(),
    enumValues: z.array(z.object({ isDeprecated: z.boolean(), name: z.string() }).loose()).nullable(),
    fields: z.array(fieldSchema).nullable(),
    inputFields: z.array(z.object({ name: z.string() }).loose()).nullable(),
    kind: z.string(),
    name: z.string(),
  })
  .loose();

export type IntrospectedType = z.infer<typeof introspectedTypeSchema>;

/** Which named type sits under a stack of non-null and list wrappers. */
function unwrapTypeName({ ref }: { ref: TypeRef }): string {
  let current: TypeRef | null | undefined = ref;
  while (current?.name === null) {
    current = current.ofType;
  }
  return absentAs({ value: current?.name, whenAbsent: "Unknown" });
}

/**
 * A schema description, as a string a reader can hold.
 *
 * An `if` rather than `?? ""` or a ternary: the house rule bans the first and the linter prefers `??` over
 * the second, so a named function spelling out both cases is the only construction that satisfies both. The
 * empty string here is a REAL value with a meaning — "the schema declares this field and documents it
 * nowhere" — rather than a coalesce papering over an absent one.
 *
 * @param text the description introspection returned, which is null when the schema declares none
 * @returns the description, or the empty string that means the schema documents this nowhere
 */
function describe({ text }: { text: string | null }): string {
  if (text === null) {
    return "";
  }
  return text;
}

/** Sorted, de-duplicated names — every stored name list in this atlas is built through here. */
function sortedUnique({ values }: { values: readonly string[] }): readonly string[] {
  return [...new Set(values)].toSorted((left, right) => left.localeCompare(right));
}

/**
 * Which root type name introspection uses for each of the three root kinds, in walk order.
 *
 * A list of pairs rather than a record, so the iteration below reads the kinds off a typed literal instead
 * of asserting `Object.keys` back into the union — which is a narrowing the compiler cannot check.
 */
const ROOT_TYPES: readonly (readonly [LinearRootKind, string])[] = [
  ["mutation", "Mutation"],
  ["query", "Query"],
  ["subscription", "Subscription"],
];

/** One reduced root field, with the provider key the store matches on. */
export interface LinearOperationRecord {
  /** `<rootKind>.<name>` — see this file's header on why the bare name is not unique. */
  readonly providerId: string;
  readonly detail: LinearOperationApiDetail;
}

/** One reduced named type. */
export interface LinearTypeRecord {
  readonly providerId: string;
  readonly detail: LinearTypeApiDetail;
}

/**
 * Every response field path one root field can hand back: the return type's own field names, plus one level
 * down through each of those fields' own return types.
 *
 * One level rather than a full walk, matching the Slack atlas: this schema has 5,146 object fields, so a
 * transitive closure under each of 627 root fields would store the type graph hundreds of times over. The
 * graph itself is what {@link typeRecords} is for.
 *
 * @param returnTypeName the unwrapped name of the type the root field returns
 * @param byName every introspected type, indexed by its own name
 * @returns the dotted paths, sorted and de-duplicated
 */
function responsePathsFor({
  returnTypeName,
  byName,
}: {
  returnTypeName: string;
  byName: ReadonlyMap<string, IntrospectedType>;
}): readonly string[] {
  const returnType = byName.get(returnTypeName);
  if (returnType?.fields == null) {
    return [];
  }
  const paths: string[] = [];
  for (const field of returnType.fields) {
    paths.push(field.name);
    const nested = byName.get(unwrapTypeName({ ref: field.type }));
    for (const child of absentAsEmpty({ value: nested?.fields })) {
      paths.push(`${field.name}.${child.name}`);
    }
  }
  return sortedUnique({ values: paths });
}

/**
 * Reduce introspection into one record per ROOT field, across all three root types.
 *
 * @param types every introspected type the batched read returned
 * @returns one record per root field, ordered by provider key
 */
export function operationRecords({ types }: { types: readonly IntrospectedType[] }): readonly LinearOperationRecord[] {
  const byName = new Map(types.map((type) => [type.name, type]));
  const records: LinearOperationRecord[] = [];
  for (const [rootKind, rootTypeName] of ROOT_TYPES) {
    const rootType = byName.get(rootTypeName);
    for (const field of absentAsEmpty({ value: rootType?.fields })) {
      const returnType = unwrapTypeName({ ref: field.type });
      records.push({
        detail: {
          deprecationReason: field.deprecationReason,
          description: describe({ text: field.description }),
          isDeprecated: field.isDeprecated,
          paramNames: [...sortedUnique({ values: field.args.map((arg) => arg.name) })],
          responsePaths: [...responsePathsFor({ byName, returnTypeName: returnType })],
          returnType,
          rootKind,
        },
        providerId: `${rootKind}.${field.name}`,
      });
    }
  }
  return records.toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}

/**
 * Reduce introspection into one record per named type, introspection's own meta types excluded.
 *
 * `__Schema`, `__Type` and their siblings describe introspection rather than Linear, so storing them would
 * put the same six types into every atlas built this way and answer "does this API expose `ofType`" with a
 * yes that is true of every GraphQL server on earth.
 *
 * @param types every introspected type the batched read returned
 * @returns one record per named type, ordered by name
 */
export function typeRecords({ types }: { types: readonly IntrospectedType[] }): readonly LinearTypeRecord[] {
  return types
    .filter((type) => !type.name.startsWith("__"))
    .map((type) => ({ detail: typeDetail({ type }), providerId: type.name }))
    .toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}

/**
 * One named type's stored detail. GraphQL introspection answers `fields`, `enumValues` and `inputFields` with
 * `null` for a kind that has none — an enum has no fields, an object no members, only an input object input
 * fields — so a null list is that kind's own empty answer and each name list is empty for it.
 */
function typeDetail({ type }: { type: IntrospectedType }): LinearTypeApiDetail {
  const fieldNames = type.fields === null ? [] : type.fields.map((field) => field.name);
  const deprecatedFieldNames =
    type.fields === null ? [] : type.fields.filter((field) => field.isDeprecated).map((field) => field.name);
  const enumValues = type.enumValues === null ? [] : type.enumValues.map((value) => value.name);
  const inputFieldNames = type.inputFields === null ? [] : type.inputFields.map((field) => field.name);
  return {
    deprecatedFieldNames: [...sortedUnique({ values: deprecatedFieldNames })],
    description: describe({ text: type.description }),
    enumValues: [...sortedUnique({ values: enumValues })],
    fieldNames: [...sortedUnique({ values: fieldNames })],
    inputFieldNames: [...sortedUnique({ values: inputFieldNames })],
    typeKind: type.kind,
  };
}

/**
 * The batched introspection query for one slice of type names.
 *
 * Built here rather than in the reader so the exact selection a reviewer has to read lives beside the
 * reduction that consumes it. Names are interpolated through `JSON.stringify`, which is what makes a type
 * name that is not a bare identifier impossible to smuggle into the document.
 *
 * @param typeNames the type names this query should ask about
 * @returns the GraphQL document
 */
export function introspectionBatchQuery({ typeNames }: { typeNames: readonly string[] }): string {
  const selection = `
    name kind description
    fields(includeDeprecated: true) {
      name description isDeprecated deprecationReason
      args { name }
      type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
    }
    inputFields { name }
    enumValues(includeDeprecated: true) { name isDeprecated }`;
  const aliases = typeNames
    .map((name, index) => `  t${String(index)}: __type(name: ${JSON.stringify(name)}) {${selection}\n  }`)
    .join("\n");
  return `query LinearAtlasIntrospection {\n${aliases}\n}`;
}

/**
 * The cheap census: every type NAME and kind, plus every ROOT FIELD name.
 *
 * The root fields are here because of a Codex review pass. An earlier version compared only
 * type counts and kinds between the two censuses, so a deploy that added `Query.brandNew: String` mid-read
 * — no new type, no changed kind — passed the comparison, and the generation published as `synced` while
 * silently missing a root field Linear declares. Root fields are exactly what the `operation` kind IS, so a
 * census that cannot see them cannot guard it.
 */
export const TYPE_NAME_QUERY = `query LinearAtlasTypeNames {
  __schema {
    types { name kind }
    queryType { fields(includeDeprecated: true) { name } }
    mutationType { fields(includeDeprecated: true) { name } }
    subscriptionType { fields(includeDeprecated: true) { name } }
  }
}`;

/**
 * A fingerprint of the schema's own census: how many types it declares, of which kinds, and how many root
 * fields hang off each root type.
 *
 * Read BEFORE and AFTER the batched walk and compared. Thirteen requests take about eleven seconds and
 * Linear deploys continuously, so a walk can straddle a deployment and publish a generation that is half
 * one schema and half another — a mixed generation that would look completely normal on disk. A moved
 * fingerprint refuses the publish instead.
 *
 * @param types every introspected type
 * @returns a stable fingerprint string
 */
export function schemaFingerprint({ types }: { types: readonly IntrospectedType[] }): string {
  const kinds = [...Map.groupBy(types, (type) => type.kind).entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([kind, members]) => `${kind}=${String(members.length)}`)
    .join(",");
  const roots = ROOT_TYPES.map(([, name]) => name)
    .toSorted((left, right) => left.localeCompare(right))
    .map(
      (name) =>
        `${name}=${String(absentAsNumber({ value: types.find((type) => type.name === name)?.fields?.length, whenAbsent: 0 }))}`,
    )
    .join(",");
  return `types=${String(types.length)};${kinds};${roots}`;
}

/**
 * Which requested type names did not come back from a batch.
 *
 * A batch asks for one alias per type name and must get one non-null `__type` for each. A silent hole —
 * an alias the server answered `null`, or one it dropped — makes the schema look smaller than it is, with
 * every consequence flowing from a number nobody can tell is wrong. This is the check that turns that into
 * a refusal.
 *
 * @param requested the type names this batch asked for
 * @param returned the type names this batch actually produced
 * @returns the names that went missing, sorted; empty when the batch was whole
 */
export function missingFromBatch({
  requested,
  returned,
}: {
  requested: readonly string[];
  returned: readonly string[];
}): readonly string[] {
  const got = new Set(returned);
  return requested.filter((name) => !got.has(name)).toSorted((left, right) => left.localeCompare(right));
}
