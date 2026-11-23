/**
 * Which admitted operations a sync runs, in what order, and which ones it cannot run yet.
 *
 * Derived entirely from the generated registry rather than hand-listed, so a specification bump that adds
 * an operation adds it to the plan — the alternative is a second, smaller definition of what the atlas
 * covers, which is the "everything means the calls the plan chose" trap the CrowdStrike run measured.
 *
 * ## How a path parameter gets its value, and why the rule is derivable rather than tabulated
 *
 * 488 operations are admitted and most of them carry a `{brace}` parameter. A hand-written table mapping
 * each parameter to a source would be 400 rows nobody could keep true. The rule instead: **a parameter is
 * bound from the provider ids of the ROOT COLLECTION IT EXTENDS**, falling back to its own kind's pool when
 * no admitted root is its parent. `/api/v2/systems/{system_id}/policystatuses` has no `/api/v2/systems`
 * root, so it falls back to kind `systems`'s pool and takes `/api/systems`'s ids;
 * `/api/v2/saas-management/applications/{application_id}` has one and takes only ITS ids. One rule, no
 * table, and it stays true across a specification bump. {@link bindingRootFor} carries the measurement for
 * why the fallback is not the whole rule.
 *
 * Three shapes the rule does not reach, and every one is REPORTED rather than dropped:
 *
 * - an operation with a SECOND parameter (`/api/v2/providers/{provider_id}/policygrouptemplates/{id}`) has
 *   no derivable source for the inner id, so it is unbindable this generation;
 * - a POST needs a request body, and this atlas will not invent one. A body is a claim about what is being
 *   asked for, and guessing it is how a read turns into something else;
 * - an operation the provider refuses without a QUERY parameter whose value belongs to another kind, or
 *   which it rejects in every spelling it names — `./requestContracts.ts`'s `JUMPCLOUD_QUERY_UNBINDABLE`.
 *
 * All three publish a coverage cell naming the operation and what would unblock it. An operation that
 * vanished from the plan would read as an operation that does not exist, which is the silence the
 * every-family-in-full ruling refuses.
 *
 * ## The shape-indexed families are not walked here, and the list is `./volume.ts`'s
 *
 * Four whole kinds and two operations inside otherwise-entity kinds are catalogued as SHAPES rather than
 * stored, on the owner's volume ruling — `./volume.ts` is the one place that decision lives and both tables below
 * are derived from it. The ruling is the Datadog treatment: index what kinds exist and what their fields
 * look like, never the records. The property that treatment has to satisfy is stronger than erasure (see
 * {@link JUMPCLOUD_SHAPE_INDEXED}), and it needs the pinned specification's own aggregate schema, which is
 * why each family is declared here rather than being walked with everything else.
 */
import type { AtlasVolumeVerdict } from "../kit/volume.js";
import { pathParameters } from "./client.js";
import { JUMPCLOUD_UNPROJECTABLE_PATHS } from "./generated/specLock.js";
import { JUMPCLOUD_SURFACES } from "./generated/surfaces.js";
import { JUMPCLOUD_KINDS, type JumpcloudKind } from "./model.js";
import { JUMPCLOUD_QUERY_UNBINDABLE } from "./requestContracts.js";
import type { JumpcloudSurfaceRow } from "./surfaceRow.js";
import { JUMPCLOUD_KIND_VOLUMES } from "./volume.js";

/** One admitted operation, with what the plan worked out about it. */
export interface JumpcloudOperation {
  readonly row: JumpcloudSurfaceRow;
  readonly kind: JumpcloudKind;
  /** Every `{brace}` parameter its path declares, in declaration order. */
  readonly parameters: readonly string[];
}

/**
 * Why an admitted operation is not run this generation.
 *
 * `shape-indexed` is the one that is a settled DECISION rather than a gap: the other four say "this could
 * run once somebody pins something", and it says "this family is catalogued as a shape, by the owner's
 * volume ruling, and a row per record is what it must never publish". It is a reason rather than a silent skip
 * because `docs/atlas-intent/06-holdings.md` is explicit that a voluminous family is enumerated and declared — an
 * operation that vanished from the plan would read as an operation that does not exist.
 */
export type JumpcloudUnrunnableReason =
  "nested-parameter" | "query-unbindable" | "request-body-unpinned" | "schema-unprojectable" | "shape-indexed";

/** One admitted operation that is not run, and why. */
interface JumpcloudUnrunnable {
  readonly operation: JumpcloudOperation;
  readonly reason: JumpcloudUnrunnableReason;
  /** What a reader of coverage is told, and what would change it. */
  readonly detail: string;
}

/** What one kind's sync will actually do. */
export interface JumpcloudKindPlan {
  readonly kind: JumpcloudKind;
  /** Collections callable with no binding at all. Read first; their ids bind everything else. */
  readonly roots: readonly JumpcloudOperation[];
  /** One-parameter operations, bound from this kind's own root ids. */
  readonly fanouts: readonly JumpcloudOperation[];
  /** Admitted, not run this generation, each carrying why. */
  readonly unrunnable: readonly JumpcloudUnrunnable[];
  /** Inventoried and never callable. Present so a reader learns the endpoint exists. */
  readonly excluded: readonly JumpcloudSurfaceRow[];
}

/**
 * Every whole KIND that is indexed by SHAPE rather than walked, with the reason it is not yet indexed
 * either. Derived from `./volume.ts`, which is where the verdicts and their measurements live.
 *
 * The agreed treatment was "never persist an event, at most three examples per kind, scalars replaced by
 * type tokens". That proves erasure and not non-interference, and it leaks four ways: per-kind counts
 * depend on multiplicity; structural-signature sets depend on optional-field co-occurrence; a "sampled"
 * example depends on which real events arrived, so differencing two generations can reveal that exactly one
 * event of a rare kind occurred in an interval; and an object KEY can itself carry an address or free text
 * while every value is tokenised.
 *
 * So the property to build to is: for any two event histories sharing the same allowed kind and path/type
 * vocabulary but differing arbitrarily in ids, timestamps, values, ordering, multiplicity and
 * co-occurrence, every persistent derivative is byte-identical. Signatures are then functions of the
 * ALLOWED AGGREGATE SCHEMA rather than fingerprints of observed shapes, and examples are canonical
 * synthetic projections of that schema rather than selected records.
 *
 * That schema is what neither kind has today. `/insights/directory/v1/events` declares
 * `additionalProperties: true` and is on the specification lock's own unprojectable list, and the three
 * pinned specification files are not on this machine to derive `commandresults` from. A shape index built
 * from observed records instead would be exactly the interfering derivative above, so neither is built —
 * and each says so in its own coverage cell rather than being quietly missing.
 */
export const JUMPCLOUD_SHAPE_INDEXED: Readonly<Record<string, string>> = Object.fromEntries(
  JUMPCLOUD_KIND_VOLUMES.verdicts
    .filter((verdict) => verdict.disposition === "shape-index" && verdict.operation === undefined)
    .map((verdict) => [verdict.kind, shapeIndexedDetail({ verdict })]),
);

/**
 * Every shape-indexed OPERATION inside a kind that is otherwise entity-bearing, keyed by operation name.
 *
 * Two of them, and both are why §6 insists the criterion is applied per operation. `v2-policyresults-list`
 * sits under `policies` beside the policies an administrator authored; `v2-list-device-asset-history` sits
 * under `assets` beside the device assets themselves. Dropping either KIND to drop the telemetry would
 * take the configuration with it, which is the trade a per-kind-only declaration cannot avoid.
 */
export const JUMPCLOUD_SHAPE_INDEXED_OPERATIONS: Readonly<Record<string, string>> = Object.fromEntries(
  JUMPCLOUD_KIND_VOLUMES.verdicts.flatMap((verdict) => {
    if (verdict.disposition !== "shape-index" || verdict.operation === undefined) {
      return [];
    }
    return [[verdict.operation, shapeIndexedDetail({ verdict })]];
  }),
);

/**
 * What a reader is told about one shape-indexed family, composed from the verdict rather than typed twice.
 *
 * The declaration in `./volume.ts` is the one place the reason lives, so this renders it: §6's criterion as
 * the verdict states it, the measurement when the family has been weighed, and the standing reason no index
 * has been BUILT yet. That last clause is the honest half — a family can be correctly withheld from the
 * generation while its catalogued shape is still owed, and saying so is what keeps the coverage cell from
 * claiming an index that does not exist.
 *
 * @param verdict the family's own volume verdict
 * @returns the sentence its coverage cell carries
 */
function shapeIndexedDetail({ verdict }: { verdict: AtlasVolumeVerdict<JumpcloudKind> }): string {
  if (verdict.disposition !== "shape-index") {
    return "indexed by shape rather than stored";
  }
  const weighed =
    verdict.volume.basis === "measured"
      ? `${verdict.volume.magnitude}. `
      : `Not yet weighed — ${verdict.volume.wouldBeMeasuredBy}. `;
  return (
    `${verdict.because}. ${weighed}So the family is indexed by shape rather than stored, on the owner's volume ` +
    "ruling. The index is not built yet: a non-interfering signature must be a function of the pinned " +
    "specification's allowed aggregate schema rather than a fingerprint of observed records, and the three " +
    "pinned specification files are not on this machine — recover them, then build the index from the schema"
  );
}

/**
 * Whether this kind is indexed by shape rather than walked.
 *
 * @param kind the kind to judge
 * @returns `true` for every whole-kind family `JUMPCLOUD_KIND_VOLUMES` declares shape-indexed
 */
export function isShapeIndexedKind({ kind }: { kind: string }): boolean {
  return Object.hasOwn(JUMPCLOUD_SHAPE_INDEXED, kind);
}

/**
 * Classify one admitted operation.
 *
 * @param row the registry row
 * @returns the operation, with its declared parameters resolved
 */
function operationOf({ row }: { row: JumpcloudSurfaceRow }): JumpcloudOperation {
  // `as`: every reachable row's kind came from the same generator that produced JUMPCLOUD_KINDS, and
  // `model.test.ts` asserts the two agree exactly.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return { kind: row.kind as JumpcloudKind, parameters: pathParameters({ path: row.path }), row };
}

/**
 * Why this operation cannot be run, or `null` when it can.
 *
 * @param operation the admitted operation
 * @returns the reason and its detail, or `null` when the operation is runnable
 */
function unrunnableReason({ operation }: { operation: JumpcloudOperation }): JumpcloudUnrunnable | null {
  const name = operation.row.name;
  const shapeIndexed = JUMPCLOUD_SHAPE_INDEXED_OPERATIONS[name];
  if (shapeIndexed !== undefined) {
    return { detail: shapeIndexed, operation, reason: "shape-indexed" };
  }
  const unbindable = JUMPCLOUD_QUERY_UNBINDABLE[name];
  if (unbindable !== undefined) {
    return { detail: unbindable, operation, reason: "query-unbindable" };
  }
  if (JUMPCLOUD_UNPROJECTABLE_PATHS.some((path) => operation.row.path.endsWith(path))) {
    return {
      detail: `${name} is admitted, and the pinned specification describes its success response with an empty or open schema — so no closed projection exists for it and calling it would store whatever the provider sent. Pin a reviewed field contract for it, then it runs`,
      operation,
      reason: "schema-unprojectable",
    };
  }
  if (operation.row.method === "POST") {
    return {
      detail: `${name} is admitted and needs a request body, which this atlas will not invent — a body is a claim about what is being asked for. Pin its body contract and it runs; the family it reads is already covered by its own collection`,
      operation,
      reason: "request-body-unpinned",
    };
  }
  if (operation.parameters.length > 1) {
    return {
      detail: `${name} declares ${String(operation.parameters.length)} path parameters (${operation.parameters.join(", ")}) and only the first has a derivable source — a parameter is bound from its own kind's root collection, and nothing supplies the inner one`,
      operation,
      reason: "nested-parameter",
    };
  }
  return null;
}

/**
 * Plan one kind's sync from the registry alone.
 *
 * @param kind the kind to plan
 * @returns what will be read, what will not, and why
 */
export function planJumpcloudKind({ kind }: { kind: JumpcloudKind }): JumpcloudKindPlan {
  const rows = JUMPCLOUD_SURFACES.filter((row) => row.kind === kind);
  const excluded = rows.filter((row) => row.coverage === "excluded");
  const roots: JumpcloudOperation[] = [];
  const fanouts: JumpcloudOperation[] = [];
  const unrunnable: JumpcloudUnrunnable[] = [];
  for (const row of rows) {
    if (row.coverage === "excluded") {
      continue;
    }
    const operation = operationOf({ row });
    const refused = unrunnableReason({ operation });
    if (refused !== null) {
      unrunnable.push(refused);
      continue;
    }
    if (operation.parameters.length === 0) {
      roots.push(operation);
      continue;
    }
    fanouts.push(operation);
  }
  return {
    excluded,
    fanouts: fanouts.toSorted((left, right) => left.row.name.localeCompare(right.row.name)),
    kind,
    roots: roots.toSorted((left, right) => left.row.name.localeCompare(right.row.name)),
    unrunnable: unrunnable.toSorted((left, right) => left.operation.row.name.localeCompare(right.operation.row.name)),
  };
}

/**
 * The root collection a fan-out's path parameter is bound FROM — the root it extends, not its kind's pool.
 *
 * ## The defect this replaces, measured
 *
 * "A parameter is bound from its own KIND's root collection" is right as far as it goes, and it silently
 * assumes a kind has ONE root. Several have more, and then every root's ids were pooled and every id was
 * bound into every fan-out. MEASURED on a published generation: kind `saas-management` has
 * three roots — `/applications`, `/application-catalog` (catalogue records, ids like `github` and
 * `mangoboard`) and `/application-licenses` — so every catalogue id was bound into
 * `/applications/{application_id}`, `/applications/{application_id}/usage` and
 * `/application-licenses/{application_id}`. Every one of those is **a call that could only ever fail**, and
 * they did: HTTP 400 and HTTP 422 per catalogue id, and a `saas-management` cell reporting an open gap for
 * each. The
 * same shape hit `workflows` (`/workflows` and `/workflows/runs`) and `assets` (six collections).
 * Reproduce: `slopweaver atlas jumpcloud coverage --kind saas-management --json`.
 *
 * ## The rule, still derivable and still not a table
 *
 * A fan-out's path is its parent collection's path plus `/{parameter}` plus whatever follows, so the parent
 * is the ADMITTED ROOT whose path is the longest prefix of the fan-out's path up to its first `{brace}`.
 * `/api/v2/saas-management/applications/{application_id}/usage` picks `/api/v2/saas-management/applications`
 * and nothing else. One rule, no row per operation, and it stays true across a specification bump.
 *
 * Where no root is a prefix the answer is `null` and the caller falls back to the kind's pool — which is
 * today's behaviour and is CORRECT for the common case: `/api/v2/systems/{system_id}/policies` has no
 * `/api/v2/systems` root at all, because this kind's collection is v1's `/api/systems`.
 *
 * **Two residues, stated rather than left to be rediscovered.**
 *
 * A parameter named for a different family than the collection it sits under is bound from the collection —
 * `/application-licenses/{application_id}` takes application ids by name and licence ids by this rule. Here
 * that is invisible on a tenancy holding no licence contracts, because `/application-licenses` answers an
 * empty collection and the operation is reported unbound rather than called; on one holding them it would be a
 * wrong bind, and closing it needs the pinned specifications' own parameter contracts rather than a guess.
 *
 * The fallback itself hides one operation that is bound wrongly TODAY, found by review.
 * `v2-get-device-asset-by-jcsystem-id` is `/api/v2/assets/devices/jc-system/{jcSystemId}`, so its prefix is
 * `/api/v2/assets/devices/jc-system`, no root matches, and it takes the `assets` pool. Its parameter names a
 * JumpCloud SYSTEM id, which lives in kind `systems` and appears in no assets collection at all, so every
 * call it makes is wrong — MEASURED: the stored `assets` file holds ZERO entities from that operation
 * while `v2-get-device-asset` beside it fills
 * (`slopweaver atlas jumpcloud read --kind assets --json`). It is the same shape as
 * `./requestContracts.ts`'s `JUMPCLOUD_QUERY_UNBINDABLE` — a parameter whose source is another kind — and
 * differs only in being a PATH parameter, so it falls through to the pool instead of being declared.
 * Closing it needs a cross-kind binding rule or a path-parameter sibling of that table; the fallback must
 * NOT simply be removed, because `/api/v2/systems/{system_id}/…` depends on it.
 *
 * @param fanout the one-parameter operation being bound
 * @param roots the kind's admitted root collections
 * @returns the root to take ids from, or `null` when none is a prefix and the kind's pool is the fallback
 */
export function bindingRootFor({
  fanout,
  roots,
}: {
  fanout: JumpcloudOperation;
  roots: readonly JumpcloudOperation[];
}): JumpcloudOperation | null {
  const brace = fanout.row.path.indexOf("{");
  if (brace < 0) {
    return null;
  }
  // The segment boundary before the parameter: `/a/b/{id}` → `/a/b`. Trailing slash removed so a root's own
  // path compares equal rather than one character short.
  const parent = fanout.row.path.slice(0, brace).replace(/\/$/, "");
  const matched = roots.find((root) => root.row.path === parent);
  if (matched === undefined) {
    return null;
  }
  return matched;
}

/**
 * Plan every kind, in the order a sync runs them.
 *
 * @returns one plan per declared kind, in kind order
 */
export function planJumpcloudSync(): readonly JumpcloudKindPlan[] {
  return JUMPCLOUD_KINDS.map((kind) => planJumpcloudKind({ kind }));
}

/**
 * The provider's own identifier for one record, or `null` when it carries none.
 *
 * JumpCloud is consistent about `_id` on v1 and `id` on v2, and a handful of families key by neither. A
 * record with no id is not dropped by this function — the caller falls back to the bound path it was read
 * from, which is stable across runs in exactly the way an id is.
 *
 * @param record one provider document
 * @returns the id, or `null` when the record declares none
 */
export function providerIdOf({ record }: { record: unknown }): string | null {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return null;
  }
  const fields: Record<string, unknown> = { ...record };
  for (const key of ["_id", "id", "objectId", "uuid", "systemId", "name"]) {
    const value = fields[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}
