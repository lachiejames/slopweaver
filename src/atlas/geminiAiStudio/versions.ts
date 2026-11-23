/**
 * Folding the same operation's three published versions into one row, and recording where they disagree.
 *
 * ## Why the fold exists
 *
 * Google publishes `generativelanguage` at `v1`, `v1beta` and `v1alpha` simultaneously, and most operations
 * appear in more than one. Three rows for `models.list` would triple the atlas's apparent size and hide the
 * only interesting question about them, which is whether the three agree. So the entity is ONE operation
 * carrying the versions that declare it, and `identity.ts` deliberately keeps the version out of the id.
 *
 * ## The disagreement is an OUTPUT, not a build-time check
 *
 * `docs/atlas-intent/04-corroboration.md`: corroboration between surfaces is a thing the atlas SHOWS, not a check it
 * performs and discards. The same reasoning applies one level down, between two versions of one surface —
 * an operation whose response schema changed between `v1` and `v1beta` is exactly what a reader needs to
 * know before writing a call, and it is invisible in either document read alone.
 *
 * Nothing here picks a winner. Both records are kept: the folded row carries the UNION of the parameter,
 * field and scope names across versions, so a name that only one version declares is never lost, and the
 * disagreement names which fields differed so a reader can go and look. Choosing between two versions is a
 * consumer's decision, and §4 reserves the general form of that question for the owner anyway.
 *
 * ## Which version's scalar values the folded row shows
 *
 * The last version in `specLock.ts`'s own order that declares the operation — `v1beta` where it exists,
 * otherwise `v1alpha`, otherwise `v1`. That is a stated rule rather than a judgement about which version is
 * better, and every value it did not take is still reachable through the disagreement it produced.
 */
import type { GeminiAiStudioDisposition, GeminiAiStudioKind } from "./model.js";
import type { GeminiAiStudioOperationRow } from "./specRead.js";

/**
 * One operation, as this atlas holds it after the versions are folded together.
 *
 * @internal
 */
export interface GeminiAiStudioFoldedOperation {
  readonly kind: GeminiAiStudioKind;
  readonly providerId: string;
  /** Every published version declaring this operation, sorted. */
  readonly apiVersions: readonly string[];
  readonly method: string;
  readonly operationId: string;
  readonly pathShape: string;
  readonly pathParams: readonly string[];
  /** The UNION of query parameter names across the declaring versions, sorted. */
  readonly queryParams: readonly string[];
  readonly responseSchema: string | null;
  /** The UNION of response field names across the declaring versions, sorted. */
  readonly responseFields: readonly string[];
  /** The UNION of declared OAuth scopes across the declaring versions, sorted. */
  readonly scopes: readonly string[];
  readonly summary: string | null;
  readonly hasMediaUpload: boolean;
  readonly disposition: GeminiAiStudioDisposition;
  readonly dispositionReason: string;
  readonly dispositionRuleId: string;
}

/**
 * One operation two versions describe differently.
 *
 * @internal
 */
export interface GeminiAiStudioVersionDisagreement {
  readonly kind: GeminiAiStudioKind;
  readonly providerId: string;
  /** Which fields differ, sorted — `method`, `pathShape`, `responseSchema`, `queryParams`, `responseFields`. */
  readonly fields: readonly string[];
  /** What each version said, one clause per differing field. */
  readonly reason: string;
}

/**
 * What the fold produced.
 *
 * @internal
 */
export interface GeminiAiStudioFoldOutcome {
  readonly operations: readonly GeminiAiStudioFoldedOperation[];
  readonly disagreements: readonly GeminiAiStudioVersionDisagreement[];
}

/** The scalar fields whose disagreement is worth naming, and how to read each off a row. */
const SCALAR_FIELDS: readonly {
  readonly name: string;
  readonly read: (row: GeminiAiStudioOperationRow) => string;
}[] = [
  { name: "method", read: (row) => row.method },
  { name: "pathShape", read: (row) => row.pathShape },
  { name: "responseSchema", read: (row) => responseSchemaLabel({ row }) },
];

/** A row's response schema as a disagreement clause prints it: `(none)` for a method that declares no response. */
function responseSchemaLabel({ row }: { row: GeminiAiStudioOperationRow }): string {
  if (row.responseSchema === null) {
    return "(none)";
  }
  return row.responseSchema;
}

/** The set-valued fields whose disagreement is worth naming. */
const SET_FIELDS: readonly {
  readonly name: string;
  readonly read: (row: GeminiAiStudioOperationRow) => readonly string[];
}[] = [
  { name: "queryParams", read: (row) => row.queryParams },
  { name: "responseFields", read: (row) => row.responseFields },
];

/**
 * Fold every version's rows into one row per operation, and name every disagreement between them.
 *
 * @param rows every row read from every version, in the order the versions were read
 * @returns the folded operations sorted by provider id, and the disagreements sorted the same way
 */
export function foldGeminiAiStudioVersions({
  rows,
}: {
  rows: readonly GeminiAiStudioOperationRow[];
}): GeminiAiStudioFoldOutcome {
  const grouped = new Map<string, GeminiAiStudioOperationRow[]>();
  for (const row of rows) {
    const key = `${row.kind} ${row.providerId}`;
    const held = grouped.get(key);
    if (held === undefined) {
      grouped.set(key, [row]);
      continue;
    }
    held.push(row);
  }
  const operations: GeminiAiStudioFoldedOperation[] = [];
  const disagreements: GeminiAiStudioVersionDisagreement[] = [];
  for (const group of grouped.values()) {
    operations.push(foldGroup({ group }));
    const disagreement = disagreementFor({ group });
    if (disagreement !== null) {
      disagreements.push(disagreement);
    }
  }
  return {
    disagreements: disagreements.toSorted((left, right) => left.providerId.localeCompare(right.providerId)),
    operations: operations.toSorted((left, right) => left.providerId.localeCompare(right.providerId)),
  };
}

/** Fold one operation's rows, preferring the last-read version's scalars and the union of its name sets. */
function foldGroup({ group }: { group: readonly GeminiAiStudioOperationRow[] }): GeminiAiStudioFoldedOperation {
  // Non-null: `foldGeminiAiStudioVersions` only ever builds a group by pushing at least one row into it.
  const preferred = group[group.length - 1]!;
  return {
    apiVersions: group.map((row) => row.apiVersion).toSorted(),
    disposition: preferred.disposition,
    dispositionReason: preferred.dispositionReason,
    dispositionRuleId: preferred.dispositionRuleId,
    hasMediaUpload: group.some((row) => row.hasMediaUpload),
    kind: preferred.kind,
    method: preferred.method,
    operationId: preferred.operationId,
    pathParams: [...preferred.pathParams],
    pathShape: preferred.pathShape,
    providerId: preferred.providerId,
    queryParams: unionOf({ lists: group.map((row) => row.queryParams) }),
    responseFields: unionOf({ lists: group.map((row) => row.responseFields) }),
    responseSchema: preferred.responseSchema,
    scopes: unionOf({ lists: group.map((row) => row.scopes) }),
    summary: preferred.summary,
  };
}

/** The disagreement one operation's versions produce, or `null` when they all say the same thing. */
function disagreementFor({
  group,
}: {
  group: readonly GeminiAiStudioOperationRow[];
}): GeminiAiStudioVersionDisagreement | null {
  if (group.length < 2) {
    return null;
  }
  // Non-null: guarded by the length check above.
  const first = group[0]!;
  const fields: string[] = [];
  const clauses: string[] = [];
  for (const field of SCALAR_FIELDS) {
    const values = new Set(group.map((row) => field.read(row)));
    if (values.size > 1) {
      fields.push(field.name);
      clauses.push(`${field.name}: ${group.map((row) => `${row.apiVersion}=${field.read(row)}`).join(", ")}`);
    }
  }
  for (const field of SET_FIELDS) {
    const rendered = group.map((row) => [...field.read(row)].toSorted().join(","));
    if (new Set(rendered).size > 1) {
      fields.push(field.name);
      clauses.push(
        // Non-null: `rendered` was mapped from `group`, so every index into it is populated.
        `${field.name}: ${group.map((row, index) => `${row.apiVersion}=[${rendered[index]!}]`).join("; ")}`,
      );
    }
  }
  if (fields.length === 0) {
    return null;
  }
  return {
    fields: fields.toSorted(),
    kind: first.kind,
    providerId: first.providerId,
    reason: `published versions describe this operation differently — ${clauses.join(" / ")}`,
  };
}

/** The sorted union of several name lists. */
function unionOf({ lists }: { lists: readonly (readonly string[])[] }): readonly string[] {
  const seen = new Set<string>();
  for (const list of lists) {
    for (const name of list) {
      seen.add(name);
    }
  }
  return [...seen].toSorted();
}
