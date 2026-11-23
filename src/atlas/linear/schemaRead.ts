/**
 * The schema half of the API surface: every type name, every type in batches, then the census again.
 *
 * A leaf: `apiSurface.ts` calls {@link readSchema} and this module imports nothing from it, type-only or
 * otherwise. Every request goes through the same caller-supplied {@link LinearRequest} that file's header
 * describes.
 *
 * ## A schema read is whole or it is refused
 *
 * Two integrity checks, both from a Codex review pass, both closing a hole that would look
 * exactly like a smaller API. Every batch must return one non-null `__type` per alias it asked for, so a
 * dropped alias is a refusal rather than a schema that quietly lost fifty types. And the whole walk takes
 * about eleven seconds against a continuously deployed API, so the type census is read again afterwards and
 * compared: a fingerprint that moved means the generation would be half one schema and half another, which
 * on disk is indistinguishable from a correct one.
 */
import type { LinearRequest } from "../../corpus/linear/transport.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";

import { type LinearAtlasError, LinearAtlasErrors } from "./errors.js";
import {
  INTROSPECTION_BATCH_SIZE,
  type IntrospectedType,
  introspectedTypeSchema,
  introspectionBatchQuery,
  missingFromBatch,
  schemaFingerprint,
  TYPE_NAME_QUERY,
} from "./introspection.js";

/** Every type NAME the schema declares plus its root-field counts — the cheap read the batches below slice. */
async function readTypeNames({
  request,
}: {
  request: LinearRequest;
}): Promise<Result<{ names: readonly string[]; roots: Readonly<Record<string, number>> }, LinearAtlasError>> {
  let data: unknown;
  try {
    data = await request({ query: TYPE_NAME_QUERY, variables: {} });
  } catch (cause: unknown) {
    return err(LinearAtlasErrors.schemaUnreadable({ cause }));
  }
  const schema = isRecord(data) ? data["__schema"] : null;
  const listed = isRecord(schema) ? schema["types"] : null;
  if (!Array.isArray(listed)) {
    return err(LinearAtlasErrors.schemaMalformed({ issues: ["__schema.types was not a list"] }));
  }
  const names = listed
    .map((entry) => (isRecord(entry) && typeof entry["name"] === "string" ? entry["name"] : null))
    .filter((name): name is string => name !== null);
  return names.length === 0
    ? err(LinearAtlasErrors.schemaMalformed({ issues: ["the schema declares no types at all"] }))
    : ok({ names, roots: rootCountsOf({ schema }) });
}

/** Parse one batch's answer, and refuse the whole read when an alias did not come back. */
function typesFromBatch({
  data,
  requested,
}: {
  data: unknown;
  requested: readonly string[];
}): Result<readonly IntrospectedType[], LinearAtlasError> {
  const parsedTypes: IntrospectedType[] = [];
  const issues: string[] = [];
  for (const value of isRecord(data) ? Object.values(data) : []) {
    const parsed = introspectedTypeSchema.safeParse(value);
    if (parsed.success) {
      parsedTypes.push(parsed.data);
      continue;
    }
    issues.push(
      ...parsed.error.issues.slice(0, 2).map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`),
    );
  }
  const missing = missingFromBatch({ requested, returned: parsedTypes.map((type) => type.name) });
  if (missing.length === 0) {
    return ok(parsedTypes);
  }
  return err(
    LinearAtlasErrors.schemaMalformed({
      issues: [
        `a batch asked for ${String(requested.length)} type(s) and ${String(missing.length)} did not come back: ${missing.slice(0, 8).join(", ")}`,
        "refusing rather than publishing a schema that is quietly missing types",
        ...issues.slice(0, 4),
      ],
    }),
  );
}

/**
 * Read the whole schema: every type name, then every type in batches, then the census again.
 *
 * The final re-read is the mixed-generation guard — see this file's header on why eleven seconds against a
 * continuously deployed API is long enough to straddle a deployment.
 *
 * @returns every introspected type, how many batches the walk took and the schema's fingerprint, or the
 *   failure that refused the read
 */
export async function readSchema({
  request,
}: {
  request: LinearRequest;
}): Promise<Result<{ types: readonly IntrospectedType[]; batches: number; fingerprint: string }, LinearAtlasError>> {
  const names = await readTypeNames({ request });
  if (names.isErr()) {
    return err(names.error);
  }
  const types: IntrospectedType[] = [];
  let batches = 0;
  for (let start = 0; start < names.value.names.length; start += INTROSPECTION_BATCH_SIZE) {
    const slice = names.value.names.slice(start, start + INTROSPECTION_BATCH_SIZE);
    let data: unknown;
    try {
      data = await request({ query: introspectionBatchQuery({ typeNames: slice }), variables: {} });
    } catch (cause: unknown) {
      return err(LinearAtlasErrors.schemaUnreadable({ cause }));
    }
    batches += 1;
    const fromBatch = typesFromBatch({ data, requested: slice });
    if (fromBatch.isErr()) {
      return err(fromBatch.error);
    }
    types.push(...fromBatch.value);
  }
  const after = await readTypeCensus({ request });
  if (after.isErr()) {
    return err(after.error);
  }
  const before = censusFingerprintOf({ names: names.value.names, roots: names.value.roots, types });
  if (after.value !== before) {
    return err(
      LinearAtlasErrors.schemaMalformed({
        issues: [
          `the schema census moved while it was being read: ${before} became ${after.value}`,
          "refusing rather than publishing a generation that is half one schema and half another",
        ],
      }),
    );
  }
  return ok({ batches, fingerprint: schemaFingerprint({ types }), types });
}

/**
 * The cheap census, in the same shape both readings compare on: how many types, of which kinds, and how
 * many ROOT FIELDS on each root type.
 *
 * The root-field half is the one that matters most and it was missing until a Codex review pass produced
 * the counterexample — see {@link TYPE_NAME_QUERY}'s own comment.
 */
function censusFingerprintOf({
  names,
  types,
  roots,
}: {
  names: readonly string[];
  types: readonly IntrospectedType[];
  roots: Readonly<Record<string, number>>;
}): string {
  const kinds = [...Map.groupBy(types, (type) => type.kind).entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([kind, members]) => `${kind}=${String(members.length)}`)
    .join(",");
  const rootCounts = Object.entries(roots)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name}=${String(count)}`)
    .join(",");
  return `types=${String(names.length)};${kinds};roots:${rootCounts}`;
}

/** How many fields each root type declares, read off a census response. */
function rootCountsOf({ schema }: { schema: unknown }): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const key of ["queryType", "mutationType", "subscriptionType"]) {
    const rootType = isRecord(schema) ? schema[key] : null;
    const fields = isRecord(rootType) ? rootType["fields"] : null;
    counts[key] = Array.isArray(fields) ? fields.length : 0;
  }
  return counts;
}

/** Re-read the cheap census, so a schema that moved mid-walk is caught rather than published. */
async function readTypeCensus({ request }: { request: LinearRequest }): Promise<Result<string, LinearAtlasError>> {
  let data: unknown;
  try {
    data = await request({ query: TYPE_NAME_QUERY, variables: {} });
  } catch (cause: unknown) {
    return err(LinearAtlasErrors.schemaUnreadable({ cause }));
  }
  const schema = isRecord(data) ? data["__schema"] : null;
  const listed = isRecord(schema) ? schema["types"] : null;
  if (!Array.isArray(listed)) {
    return err(LinearAtlasErrors.schemaMalformed({ issues: ["the re-read census did not return a type list"] }));
  }
  const parsed = listed.flatMap((entry): readonly IntrospectedType[] => {
    if (!isRecord(entry) || typeof entry["kind"] !== "string" || typeof entry["name"] !== "string") {
      return [];
    }
    return [
      {
        description: null,
        enumValues: null,
        fields: null,
        inputFields: null,
        kind: entry["kind"],
        name: entry["name"],
      },
    ];
  });
  return ok(
    censusFingerprintOf({
      names: listed.map((_, index) => String(index)),
      roots: rootCountsOf({ schema }),
      types: parsed,
    }),
  );
}
