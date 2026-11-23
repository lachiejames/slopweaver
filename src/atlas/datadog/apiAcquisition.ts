/**
 * What the LIVE `api` pass is allowed to issue — computed from the committed registry, never authored.
 *
 * ## The closed registry is a DERIVATION, which is what makes it closed
 *
 * `descriptor.ts` claims that this atlas's acquisition is closed. A hand-kept allowlist would satisfy that
 * sentence and not the property: a list somebody maintains beside the registry drifts from it, and the
 * drift is invisible because both files look deliberate. So the admitted set is a total function of
 * `generated/surfaces.ts` — two predicates, no table — and there is no name a caller can pass that the
 * committed registry does not already carry a row for.
 *
 * The two predicates, and why each is the boundary rather than a convenience:
 *
 * 1. **`disposition === "entity"`.** An `excluded` row has no callable variant anywhere in this module, so a
 *    mutation, a side-effecting GET and a secret-bearing path are unreachable rather than merely unused.
 *    `probe-only` is credential posture and publishes nothing. `shape-index` is a DIFFERENT pass, deferred
 *    below rather than quietly folded in — see {@link DATADOG_API_SHAPE_INDEX_DEFERRED}.
 * 2. **The path carries no `{parameter}`.** Not a shortcut: an operation like
 *    `GET /api/v1/dashboard/{dashboard_id}` cannot be issued at all without an id, and the only honest
 *    source of that id is an entity this atlas has already stored. That is a FAN-OUT, it is a second pass
 *    with its own failure modes, and it does not exist yet. Admitting such a row with a guessed or blank
 *    parameter would issue a request nobody designed.
 *
 * ## The deferred remainder is enumerated, never dropped
 *
 * Both remainders are exported with their own counts and kinds, because the number this pass leaves behind
 * is the number a coverage cell has to state. An atlas whose live pass silently walked what it could and
 * reported success over that is the sibling Slack atlas's "reported N, reached one" — the failure
 * `descriptor.ts`'s header names.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { type DatadogAtlasError, DatadogAtlasErrors } from "./errors.js";
import { DATADOG_SURFACES } from "./generated/surfaces.js";
import type { DatadogSurfaceRow } from "./surfaceRow.js";

/**
 * Whether an operation can be issued without an identifier this atlas would have to supply.
 *
 * @param path the SDK's own path template, `{brace}` parameters intact
 * @returns `true` when the template names no parameter
 * @internal
 */
export function datadogPathIsSelfContained({ path }: { path: string }): boolean {
  return !path.includes("{");
}

/**
 * Every operation the live `api` pass may issue, in registry order.
 *
 * MEASURED on the pinned registry: 329 rows, 328 GET and one POST, spanning 99 of the 115 kinds that carry
 * entity rows. Reproduce with `yarn tsx tools/datadogKindCensus.ts`.
 * @internal
 */
export const DATADOG_API_ADMITTED: readonly DatadogSurfaceRow[] = DATADOG_SURFACES.filter(
  (row) => row.disposition === "entity" && datadogPathIsSelfContained({ path: row.path }),
);

/**
 * Entity operations this pass cannot issue because they take an identifier it has no pass to supply.
 *
 * Exported so the coverage cell and the gap can both state the exact remainder rather than each computing
 * its own — two independently derived counts of the same thing is how a report starts disagreeing with
 * itself.
 * @internal
 */
export const DATADOG_API_FANOUT_DEFERRED: readonly DatadogSurfaceRow[] = DATADOG_SURFACES.filter(
  (row) => row.disposition === "entity" && !datadogPathIsSelfContained({ path: row.path }),
);

/**
 * Shape-index operations, which this pass does not issue at all.
 *
 * Deferred rather than admitted because a shape index is a different ACT, not a different projection of the
 * same one: it needs a bounded time window the registry does not carry, most of its families require that
 * window as a mandatory query parameter or a request body, and what it stores is a
 * {@link import("./documents.js").DatadogShapeIndex} rather than a provider record. Folding it in here
 * would have meant issuing 72 requests with a guessed window and folding whatever came back into the wrong
 * schema.
 * @internal
 */
export const DATADOG_API_SHAPE_INDEX_DEFERRED: readonly DatadogSurfaceRow[] = DATADOG_SURFACES.filter(
  (row) => row.disposition === "shape-index",
);

/** One kind's admitted rows, so a per-kind pass never filters the whole registry itself. */
function groupByKind({
  rows,
}: {
  rows: readonly DatadogSurfaceRow[];
}): ReadonlyMap<string, readonly DatadogSurfaceRow[]> {
  const byKind = new Map<string, DatadogSurfaceRow[]>();
  for (const row of rows) {
    const held = byKind.get(row.kind);
    if (held === undefined) {
      byKind.set(row.kind, [row]);
      continue;
    }
    held.push(row);
  }
  return byKind;
}

/**
 * The admitted operations, grouped by the kind whose file they publish into.
 *
 * @returns the rows, grouped, in registry order
 */
export function datadogApiAdmittedByKind(): ReadonlyMap<string, readonly DatadogSurfaceRow[]> {
  return groupByKind({ rows: DATADOG_API_ADMITTED });
}

/**
 * The fan-out remainder, grouped by kind, so a kind reachable ONLY through identifiers can say so.
 *
 * @returns the rows, grouped, in registry order
 */
export function datadogApiFanoutDeferredByKind(): ReadonlyMap<string, readonly DatadogSurfaceRow[]> {
  return groupByKind({ rows: DATADOG_API_FANOUT_DEFERRED });
}

/**
 * The shape-index remainder, grouped by kind.
 *
 * @returns the rows, grouped, in registry order
 */
export function datadogApiShapeIndexDeferredByKind(): ReadonlyMap<string, readonly DatadogSurfaceRow[]> {
  return groupByKind({ rows: DATADOG_API_SHAPE_INDEX_DEFERRED });
}

/**
 * One kind's rows out of a grouping, with "this kind has none" said once rather than at every call site.
 *
 * The grouping is built only from kinds that HAVE rows, so a kind with none is absent rather than empty —
 * and every caller wants the same answer. Written as a named absence rather than a `??` because a kind
 * having no admitted operation is the single most consequential fact this pass reports about it: it is what
 * makes the difference between "this organisation holds none of it" and "nothing asked".
 *
 * @param byKind a grouping from one of the three functions above
 * @param kind the kind to look up
 * @returns that kind's rows, or an empty list when it has none
 */
export function datadogApiRowsFor({
  byKind,
  kind,
}: {
  byKind: ReadonlyMap<string, readonly DatadogSurfaceRow[]>;
  kind: string;
}): readonly DatadogSurfaceRow[] {
  const held = byKind.get(kind);
  if (held === undefined) {
    return [];
  }
  return held;
}

/**
 * What an excluded row says about itself, falling back to its reason code only if the prose is missing.
 *
 * The generator writes `dispositionBecause` on every excluded row, so the second branch is a contract this
 * file does not control rather than a case anybody has seen. Written as two returns rather than either a
 * `??` or a ternary because the house rule bans the first and oxlint's `prefer-nullish-coalescing` rewrites
 * the second back into it — an `if` is what both accept, and it names the absent case out loud.
 */
function exclusionDetail({ row }: { row: DatadogSurfaceRow }): string {
  const because = row.dispositionBecause;
  if (because === null) {
    return `reason \`${String(row.exclusionReason)}\``;
  }
  return because;
}

/**
 * Resolve a surface name against the closed registry, refusing anything the live pass may not issue.
 *
 * The one entry point a caller has. It is a `Result` rather than a lookup returning `undefined` because
 * every way of failing here is a DIFFERENT statement: a name nothing declares is a typo, and a name the
 * registry carries as `excluded` is a deliberate refusal whose reason the caller should show rather than
 * swallow.
 *
 * @param surface the surface name, exactly as `generated/surfaces.ts` spells it
 * @returns the admitted row, or the typed refusal that names why it is not one
 */
export function admitDatadogApiSurface({ surface }: { surface: string }): Result<DatadogSurfaceRow, DatadogAtlasError> {
  const row = DATADOG_SURFACES.find((one) => one.name === surface);
  if (row === undefined) {
    return err(DatadogAtlasErrors.surfaceRefused({ surface }));
  }
  if (row.disposition === "excluded") {
    return err(DatadogAtlasErrors.surfaceRefused({ excludedBecause: exclusionDetail({ row }), surface }));
  }
  if (row.disposition !== "entity") {
    return err(
      DatadogAtlasErrors.surfaceRefused({
        excludedBecause: `its disposition is \`${row.disposition}\`, which this pass does not issue — a shape index needs a bounded window this pass does not carry, and a probe publishes nothing`,
        surface,
      }),
    );
  }
  if (!datadogPathIsSelfContained({ path: row.path })) {
    return err(
      DatadogAtlasErrors.surfaceRefused({
        excludedBecause: `\`${row.path}\` takes an identifier, and the fan-out that would supply one from an already-stored entity does not exist yet`,
        surface,
      }),
    );
  }
  return ok(row);
}
