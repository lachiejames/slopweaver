/**
 * Comparing ONE metric across TWO environment tags — the "which branch is slower" fold. Pure: no clock, no
 * network, no filesystem. `src/cli/commands/datadog/compareEnvsRun.ts` runs the two queries.
 *
 * ## What this is for, and the shape it assumes
 *
 * A release-incident bisect that never named a culprit is replaced by this recipe:
 * stand two worktrees up, drive the same work through each, have both post to Datadog, and compare. The
 * comparison half is the part a verb can own, and the estate already has the convention it needs — an
 * environment tag per side. MEASURED on this organisation, the SUP-2619 before/after proof
 * ran under `env:coder-octocat-sup2619-before` and `env:coder-octocat-sup2619-after`, and
 * the local-proof recipe uses `deployment.environment.name=local-proof-<slug>` the same way
 * (`CAPABILITY-local-e2e-dd-load-repro.md`). So the unit here is a TAG, never a branch name: whatever
 * stands the two sides up decides what they are called, and this reads what came back.
 *
 * ## Why a per-group delta rather than one number
 *
 * One number says "it got slower" and sends the reader back to the console. What names a culprit is WHICH
 * resource, operation or endpoint moved, which is one grouped query per side and a join on the group key.
 * One such comparison measured 3,219 `postgresql.query` spans against 39 for the same request: that is a group
 * row, not a summary statistic, and it is the row a bisect acts on.
 *
 * ## A group present on one side only is a FINDING, not a gap
 *
 * An outer join, deliberately. A resource that appears only in the after run is new work the change
 * introduced, and one that disappears is work it removed; both are exactly what a reader is hunting. They
 * are carried with a `null` on the missing side and ranked by the side they do have, never dropped and
 * never silently zero-filled — a zero would claim Datadog reported none, when nothing was reported at all.
 */

/** One side's buckets, keyed by the group values that identify each. */
export interface EnvSide {
  /** The environment tag this side was queried under, as the caller wrote it. */
  readonly env: string;
  /** The buckets, in whatever order Datadog returned them. */
  readonly buckets: readonly EnvBucket[];
}

/** One grouped measurement from one side. */
export interface EnvBucket {
  /** The group tag values that identify this bucket, e.g. `{ resource_name: "POST /api/graphql" }`. */
  readonly by: Readonly<Record<string, string>>;
  readonly value: number;
}

/** One group's before/after pair, with the movement between them. */
export interface EnvComparisonRow {
  /** The group tag values, identical on both sides by construction. */
  readonly by: Readonly<Record<string, string>>;
  /** The before side's value, or `null` when this group appeared only in the after run. */
  readonly before: number | null;
  /** The after side's value, or `null` when this group appeared only in the before run. */
  readonly after: number | null;
  /** `after - before`, or `null` when either side is absent — a delta against nothing is not a measurement. */
  readonly delta: number | null;
  /**
   * The delta as a fraction of `before`, or `null` when either side is absent OR `before` is zero.
   *
   * Zero is excluded rather than reported as infinity because a percentage off a zero baseline says nothing
   * a reader can act on, while the absolute delta beside it already says everything true.
   */
  readonly ratio: number | null;
}

/** What a comparison established, in the order a reader should read it. */
export interface EnvComparison {
  readonly beforeEnv: string;
  readonly afterEnv: string;
  /** Every group either side reported, worst regression first. */
  readonly rows: readonly EnvComparisonRow[];
  /** Groups the after run reported and the before run did not — work the change ADDED. */
  readonly onlyAfter: readonly EnvComparisonRow[];
  /** Groups the before run reported and the after run did not — work the change REMOVED. */
  readonly onlyBefore: readonly EnvComparisonRow[];
}

/**
 * One group's tag pairs in sorted key order — the shared basis of its join key and its printed label.
 *
 * `Object.entries` rather than keys plus a lookup, so no value is ever reached through an index that could
 * be absent: the pairs a record has are exactly the pairs it has.
 *
 * @param by the group tag values
 * @returns the `[tag, value]` pairs, sorted by tag
 */
export function sortedTagPairs({
  by,
}: {
  by: Readonly<Record<string, string>>;
}): readonly (readonly [string, string])[] {
  return Object.entries(by).toSorted(([left], [right]) => left.localeCompare(right));
}

/** A group's stable identity: its sorted tag pairs, serialised, so two sides join on the same string. */
function groupKey({ by }: { by: Readonly<Record<string, string>> }): string {
  return JSON.stringify(sortedTagPairs({ by }));
}

/**
 * How one group ranks against another, worst regression first.
 *
 * Ordered by the delta a reader acts on, and a row with no delta (present on one side only) sorts after
 * every measured one rather than being scored against a number it does not have.
 *
 * @param a the first row
 * @param b the second row
 * @returns a comparator result, largest positive delta first
 */
function worstFirst(a: EnvComparisonRow, b: EnvComparisonRow): number {
  if (a.delta === null && b.delta === null) {
    return 0;
  }
  if (a.delta === null) {
    return 1;
  }
  if (b.delta === null) {
    return -1;
  }
  return b.delta - a.delta;
}

/** The row for one group, given whichever sides reported it. */
function rowOf({
  by,
  before,
  after,
}: {
  by: Readonly<Record<string, string>>;
  before: number | null;
  after: number | null;
}): EnvComparisonRow {
  if (before === null || after === null) {
    return { after, before, by, delta: null, ratio: null };
  }
  const delta = after - before;
  return { after, before, by, delta, ratio: before === 0 ? null : delta / before };
}

/**
 * The row for one join key, read out of whichever side(s) hold it.
 *
 * At least one of the two is always present, because every key came from one of the two maps — so the
 * absent case is named as the impossible one it is rather than papered over with a substituted value.
 *
 * @param beforeBucket the baseline side's bucket, if it reported this group
 * @param afterBucket the candidate side's bucket, if it reported this group
 * @returns the joined row
 */
function joinedRow({
  beforeBucket,
  afterBucket,
}: {
  beforeBucket: EnvBucket | undefined;
  afterBucket: EnvBucket | undefined;
}): EnvComparisonRow {
  if (beforeBucket === undefined && afterBucket === undefined) {
    throw new Error("compareEnvSides: a join key was held by neither side, which its own maps make impossible");
  }
  if (beforeBucket === undefined) {
    return rowOf({ after: afterBucket!.value, before: null, by: afterBucket!.by });
  }
  if (afterBucket === undefined) {
    return rowOf({ after: null, before: beforeBucket.value, by: beforeBucket.by });
  }
  return rowOf({ after: afterBucket.value, before: beforeBucket.value, by: beforeBucket.by });
}

/**
 * Join two sides' buckets on their group tags and rank the result worst regression first.
 *
 * @param before the baseline side
 * @param after the candidate side
 * @returns every group either side reported, ranked, plus the one-sided groups called out separately
 */
export function compareEnvSides({ before, after }: { before: EnvSide; after: EnvSide }): EnvComparison {
  const beforeByKey = new Map(before.buckets.map((bucket) => [groupKey({ by: bucket.by }), bucket]));
  const afterByKey = new Map(after.buckets.map((bucket) => [groupKey({ by: bucket.by }), bucket]));
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])];
  const rows = keys.map((key) => joinedRow({ afterBucket: afterByKey.get(key), beforeBucket: beforeByKey.get(key) }));
  const ranked = rows.toSorted(worstFirst);
  return {
    afterEnv: after.env,
    beforeEnv: before.env,
    onlyAfter: ranked.filter((row) => row.before === null),
    onlyBefore: ranked.filter((row) => row.after === null),
    rows: ranked,
  };
}

/**
 * The query one side is read with: the caller's own query, with the environment tag it is scoped to.
 *
 * The tag is injected rather than asked for twice, so the two sides cannot drift apart in anything but the
 * environment — which is the whole premise of the comparison. A query that already names an `env` is
 * REFUSED by {@link envScopedQueryIssue} rather than silently double-scoped.
 *
 * @param query the metrics query, with no env scope of its own
 * @param env the environment tag this side runs under
 * @returns the query with `env:<tag>` added inside its brace filter
 */
export function envScopedQuery({ query, env }: { query: string; env: string }): string {
  const open = query.indexOf("{");
  const close = query.indexOf("}", open);
  if (open === -1 || close === -1) {
    return query;
  }
  const inside = query.slice(open + 1, close).trim();
  const scoped = inside === "" || inside === "*" ? `env:${env}` : `${inside},env:${env}`;
  return `${query.slice(0, open + 1)}${scoped}${query.slice(close)}`;
}

/**
 * Why a query cannot be env-scoped, or `null` when it can.
 *
 * @param query the metrics query the caller supplied
 * @returns the one reason to refuse it, or `null`
 */
export function envScopedQueryIssue({ query }: { query: string }): string | null {
  const open = query.indexOf("{");
  const close = query.indexOf("}", open);
  if (open === -1 || close === -1) {
    return `--query needs a brace filter for the env scope to go into, e.g. 'p90:trace.http.server.request{*} by {resource_name}', got '${query}'`;
  }
  if (query.slice(open + 1, close).includes("env:")) {
    return "--query already scopes `env:` itself, and this verb supplies the env for each side — remove it from the query";
  }
  return null;
}
