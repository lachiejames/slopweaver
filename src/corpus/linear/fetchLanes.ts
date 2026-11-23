/**
 * The BOUNDED lanes of the Linear seam — the curated (initiatives, documents) and bulk-entity lanes — as
 * opposed to the two walking lanes in {@link ./fetchCollect}, which stream progress and commit page by page.
 *
 * None of these aborts the crawl. A missing lane yields nothing; a failed or truncated one yields what it
 * reached and names itself in `incomplete`, which the caller turns into a coverage gap. A lane Linear answers
 * `Forbidden` is the one exception: it is a warning, for the reason {@link recordLaneFailure} gives.
 */
import { LinearError, LinearErrorType } from "@linear/sdk";

import { appendAll } from "../../lib/arrays.js";
import { collectCursorPages, pushCursorWarning } from "../../lib/paging.js";
import type { LinearApi, LinearEntityLane } from "./apiTypes.js";
import type { LinearDocumentItem, LinearInitiativeItem } from "./items.js";

/**
 * The curated lanes (initiatives + documents). Neither aborts the crawl: a missing lane yields nothing, and a
 * failed or truncated one yields what it reached and names itself in `incomplete`.
 *
 * `incomplete` is what the caller turns into coverage gaps, so a lane that did not arrive FAILS the source
 * and holds its cursor rather than letting Linear be stamped fresh without it. It used to be a warning, and
 * a warning changes nothing about a cursor (`ingestJob.ts`'s `CoverageGap`).
 *
 * @param api the injected Linear seam
 * @param maxItems optional per-lane fetch cap (`--fetch-cap`)
 * @returns the initiatives + documents collected, advisory warnings, and every lane that did not arrive whole
 */
export async function fetchLinearCurated({ api, maxItems }: { api: LinearApi; maxItems?: number }): Promise<{
  initiatives: readonly LinearInitiativeItem[];
  documents: readonly LinearDocumentItem[];
  warnings: readonly string[];
  incomplete: readonly string[];
}> {
  const warnings: string[] = [];
  const incomplete: string[] = [];
  const initiatives = await bestEffortLane({
    fetch: api.initiatives,
    incomplete,
    label: "initiatives",
    pick: (page) => ({
      items: page.initiatives,
      nextCursor: page.nextCursor,
      ...(page.warnings !== undefined ? { warnings: page.warnings } : {}),
    }),
    warnings,
    ...(maxItems !== undefined ? { maxItems } : {}),
  });
  const documents = await bestEffortLane({
    fetch: api.documents,
    incomplete,
    label: "documents",
    pick: (page) => ({ items: page.documents, nextCursor: page.nextCursor }),
    warnings,
    ...(maxItems !== undefined ? { maxItems } : {}),
  });
  return { documents, incomplete, initiatives, warnings };
}

/**
 * The four bulk entities that become searchable RECORDS, as raw node lists.
 *
 * All four are best-effort. `templates` is the odd one out and cannot be paged at all — `Query.templates` is
 * `[Template]` with no arguments — so it is fetched as a single call and a paging loop written against it would
 * silently do nothing.
 *
 * @param api the injected Linear seam
 * @param maxItems optional per-lane fetch cap (`--fetch-cap`)
 * @returns each entity's raw node list, every lane that did not arrive whole — see {@link fetchLinearCurated}
 *   for why that is not a warning — and the warnings, which name each lane Linear refused as `Forbidden`
 */
export async function fetchLinearRecordEntities({ api, maxItems }: { api: LinearApi; maxItems?: number }): Promise<{
  customerNeeds: readonly unknown[];
  projectMilestones: readonly unknown[];
  initiativeUpdates: readonly unknown[];
  templates: readonly unknown[];
  incomplete: readonly string[];
  warnings: readonly string[];
}> {
  const incomplete: string[] = [];
  const warnings: string[] = [];
  const cap = maxItems !== undefined ? { maxItems } : {};
  return {
    customerNeeds: await entityLane({
      fetch: api.customerNeeds,
      incomplete,
      label: "customerNeeds",
      warnings,
      ...cap,
    }),
    incomplete,
    initiativeUpdates: await entityLane({
      fetch: api.initiativeUpdates,
      incomplete,
      label: "initiativeUpdates",
      warnings,
      ...cap,
    }),
    projectMilestones: await entityLane({
      fetch: api.projectMilestones,
      incomplete,
      label: "projectMilestones",
      warnings,
      ...cap,
    }),
    templates: await templatesLane({ fetch: api.templates, incomplete, warnings }),
    warnings,
  };
}

/**
 * Page one optional BULK-ENTITY lane to exhaustion; a missing lane yields `[]`, and a failing or truncated one
 * yields what it reached and names itself in `incomplete`.
 *
 * A lane the token cannot read BY DESIGN is not walked at all — `auditEntries` answers 403 for this token and
 * is therefore absent from `makeLinearApi`. A lane the WORKSPACE turns off is walked and answers `Forbidden`,
 * which lands in `warnings` ({@link recordLaneFailure}); any other throw is a lane that should have arrived.
 *
 * @param fetch the lane's pager, or undefined when this deployment has no such lane
 * @param label the lane's name, used in the line it records
 * @param incomplete the running list of lanes that did not arrive whole, MUTATED in place — a lane failure is
 *   recorded rather than thrown, so one entity type cannot sink the records the others DID fetch
 * @param warnings the running advisory list, MUTATED in place with a lane Linear refused as `Forbidden`
 * @param maxItems per-lane fetch cap (`--fetch-cap`)
 * @returns every node the lane yielded, or empty for a missing or failing lane
 */
export async function entityLane({
  fetch,
  label,
  incomplete,
  warnings,
  maxItems,
}: {
  fetch: LinearEntityLane | undefined;
  label: string;
  incomplete: string[];
  warnings: string[];
  maxItems?: number;
}): Promise<readonly unknown[]> {
  if (fetch === undefined) {
    return [];
  }
  try {
    const walk = await collectCursorPages<unknown>({
      fetchPage: ({ cursor, pageSize }) =>
        fetch({ pageSize, ...(cursor !== undefined ? { cursor } : {}) }).then((page) => ({
          items: page.nodes,
          nextCursor: page.nextCursor,
        })),
      ...(maxItems !== undefined ? { maxItems } : {}),
    });
    pushCursorWarning({ end: walk.end, lane: `linear ${label}`, warnings: incomplete });
    return walk.items;
  } catch (error: unknown) {
    recordLaneFailure({ error, incomplete, label, warnings });
    return [];
  }
}

/**
 * Record a lane that threw: a `Forbidden` answer is a WARNING, anything else is `incomplete`.
 *
 * `Forbidden` is what `@linear/sdk` types both a GraphQL `extensions.type: "forbidden"` and an HTTP 403 as —
 * the token or the workspace may not read this lane at all. That is a STATE, not a partial walk: re-reading
 * the window cannot recover it, so holding the pooled cursor on it fails Linear on every run and stalls every
 * lane that DID arrive. MEASURED: the workspace switched Customer Requests off, `customerNeeds`
 * answered `Forbidden` ("Customer requests are not available in this workspace."), and `resync-corpus-linear`
 * failed every firing on it. Reproduce: `slopweaver refresh --source linear --store` prints the warning.
 * Every other throw (network, rate limit, schema drift) is one the next pass can recover, so it stays a gap.
 */
function recordLaneFailure({
  error,
  label,
  incomplete,
  warnings,
}: {
  error: unknown;
  label: string;
  incomplete: string[];
  warnings: string[];
}): void {
  const message = error instanceof Error ? error.message : "unknown";
  if (error instanceof LinearError && error.type === LinearErrorType.Forbidden) {
    warnings.push(`linear ${label} lane is forbidden for this token or workspace, so it holds nothing: ${message}`);
    return;
  }
  incomplete.push(`linear ${label} lane unavailable: ${message}`);
}

/** The templates lane: ONE call, no paging (the root field takes no arguments and returns a plain list). */
async function templatesLane({
  fetch,
  incomplete,
  warnings,
}: {
  fetch: (() => Promise<{ nodes: readonly unknown[] }>) | undefined;
  incomplete: string[];
  warnings: string[];
}): Promise<readonly unknown[]> {
  if (fetch === undefined) {
    return [];
  }
  try {
    return (await fetch()).nodes;
  } catch (error: unknown) {
    recordLaneFailure({ error, incomplete, label: "templates", warnings });
    return [];
  }
}

/**
 * Page one optional curated lane to exhaustion (or to `maxItems`); a missing lane `[]`, a failing one records
 * itself through {@link recordLaneFailure} and yields `[]`. A page's own nested-connection notes stay advisory
 * `warnings`.
 */
async function bestEffortLane<TItem, TPage>({
  fetch,
  pick,
  label,
  warnings,
  incomplete,
  maxItems,
}: {
  fetch: ((args: { cursor?: string; pageSize?: number | undefined }) => Promise<TPage>) | undefined;
  pick: (page: TPage) => { items: readonly TItem[]; nextCursor: string | undefined; warnings?: readonly string[] };
  label: string;
  warnings: string[];
  incomplete: string[];
  maxItems?: number;
}): Promise<readonly TItem[]> {
  if (fetch === undefined) {
    return [];
  }
  try {
    const walk = await collectCursorPages({
      fetchPage: ({ cursor, pageSize }) =>
        fetch({ pageSize, ...(cursor !== undefined ? { cursor } : {}) })
          .then(pick)
          .then((page) => {
            // A nested walk inside this page reported incompleteness; carry it out before the page is folded
            // into a bare item list, which is the last point at which it still exists.
            if (page.warnings !== undefined) {
              appendAll({ from: page.warnings, into: warnings });
            }
            return page;
          }),
      ...(maxItems !== undefined ? { maxItems } : {}),
    });
    pushCursorWarning({ end: walk.end, lane: `linear ${label}`, warnings: incomplete });
    return walk.items;
  } catch (error: unknown) {
    recordLaneFailure({ error, incomplete, label, warnings });
    return [];
  }
}
