/**
 * The census checks behind `tools/generateKnockSurfaces.ts`: every measured number compared with the pinned
 * one, refusing on the first disagreement.
 *
 * Pure checks split out of the generator so it stays under the file-size cap. This module never imports the
 * generator, which runs `main()` at import.
 */
import type { KnockRouteRow } from "../src/atlas/knock/dashboardRoutes.js";
import { KNOCK_VOLUMINOUS_PREFIXES } from "../src/atlas/knock/dispositions.js";
import { KNOCK_ROUTE_CENSUS, KNOCK_SPEC_CENSUS, KNOCK_SURFACE_CENSUS } from "../src/atlas/knock/generated/specLock.js";
import type { KnockApi } from "../src/atlas/knock/surfaceNaming.js";
import type { KnockSurfaceRow } from "../src/atlas/knock/surfaceRow.js";
import { isRecord } from "../src/lib/parsers.js";
import { type RawOperation, refuse } from "./knockSurfacesRows.js";

/**
 * Compare a measured census against the pinned one, field by field, refusing on the first disagreement.
 *
 * Takes both as plain number maps rather than as their own types, so nothing here needs an assertion to
 * index one by the other's keys — `no-unsafe-type-assertion` refuses that, and refuses correctly: a claim
 * that two record types share a key set is exactly the thing a census exists to CHECK.
 *
 * @param actual what this run measured
 * @param expected what was reviewed
 * @param subject what the census is about, named in the refusal
 */
function expectCensus({
  actual,
  expected,
  subject,
}: {
  actual: Readonly<Record<string, number>>;
  expected: Readonly<Record<string, number>>;
  subject: string;
}): void {
  for (const [field, want] of Object.entries(expected)) {
    const got = actual[field] ?? 0;
    if (got !== want) {
      refuse(`${subject}'s ${field} is ${String(got)}, and the pinned census says ${String(want)}`);
    }
  }
}

/**
 * Every tag one operation declares, not only its first.
 *
 * Kept separate from the operation's first tag because the two counts DIFFER on the data API — 16 distinct
 * first tags against 20 distinct tags overall — so four of Knock's own groupings are only ever a second tag
 * and a reader counting the row's `tag` field would conclude they do not exist.
 *
 * @param operation the operation object
 * @returns every tag string it declares, in document order
 */
function declaredTags({ operation }: { operation: Record<string, unknown> }): readonly string[] {
  const tags = operation["tags"];
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [];
}

/**
 * Assert one document's census, naming what actually came back when it disagrees.
 *
 * @param api which published API the document is
 * @param document the parsed OpenAPI document
 * @param raw the raw operations extracted from it
 * @param rows the compiled rows for it
 */
export function checkSpecCensus({
  api,
  document,
  raw,
  rows,
}: {
  api: KnockApi;
  document: Record<string, unknown>;
  raw: readonly RawOperation[];
  rows: readonly KnockSurfaceRow[];
}): void {
  const paths = document["paths"];
  const components = document["components"];
  const schemas = isRecord(components) && isRecord(components["schemas"]) ? components["schemas"] : {};
  const actual = {
    deprecated: rows.filter((entry) => entry.deprecated).length,
    getOperations: rows.filter((entry) => entry.method === "GET").length,
    operations: rows.length,
    paths: isRecord(paths) ? Object.keys(paths).length : 0,
    schemas: Object.keys(schemas).length,
    suffixedOperationIds: rows.filter((entry) => / \(\d+\)$/.test(entry.operationId)).length,
    firstTags: new Set(rows.map((entry) => entry.tag)).size,
    tags: new Set(raw.flatMap((entry) => declaredTags({ operation: entry.operation }))).size,
  };
  // `KnockSpecCensus` is an interface, so it declares no index signature and is not assignable to the
  // `Record<string, number>` `expectCensus` reads. The spread is what gives it an anonymous shape that is.
  expectCensus({ actual, expected: { ...KNOCK_SPEC_CENSUS[api] }, subject: `the ${api} document` });
}

/**
 * Assert the route census, naming what actually came back when it disagrees.
 *
 * @param rows the compiled dashboard routes
 */
export function checkRouteCensus({ rows }: { rows: readonly KnockRouteRow[] }): void {
  const byScope: Record<string, number> = {};
  for (const row of rows) {
    byScope[row.scope] = (byScope[row.scope] ?? 0) + 1;
  }
  const walkPages = rows.filter((row) => row.walkable && (row.scope === "account" || row.scope === "environment"));
  const actual = {
    routes: rows.length,
    unbackedRoutes: rows.filter((row) => !row.apiBacked).length,
    unbackedWalkPages: walkPages.filter((row) => !row.apiBacked).length,
    walkPages: walkPages.length,
    walkableRoutes: rows.filter((row) => row.walkable).length,
  };
  expectCensus({
    actual,
    expected: {
      routes: KNOCK_ROUTE_CENSUS.routes,
      unbackedRoutes: KNOCK_ROUTE_CENSUS.unbackedRoutes,
      unbackedWalkPages: KNOCK_ROUTE_CENSUS.unbackedWalkPages,
      walkPages: KNOCK_ROUTE_CENSUS.walkPages,
      walkableRoutes: KNOCK_ROUTE_CENSUS.walkableRoutes,
    },
    subject: "the dashboard",
  });
  expectCensus({ actual: byScope, expected: KNOCK_ROUTE_CENSUS.byScope, subject: "the dashboard's route scopes" });
}

/**
 * Assert the disposition and identifier tallies, naming what actually came back when one disagrees.
 *
 * @param rows the compiled operation rows
 */
export function checkSurfaceCensus({ rows }: { rows: readonly KnockSurfaceRow[] }): void {
  const tally = (values: readonly string[]): Readonly<Record<string, number>> => {
    const counts: Record<string, number> = {};
    values.forEach((value) => {
      counts[value] = (counts[value] ?? 0) + 1;
    });
    return counts;
  };
  expectCensus({
    actual: tally(rows.map((row) => row.disposition)),
    expected: KNOCK_SURFACE_CENSUS.dispositions,
    subject: "the registry's dispositions",
  });
  expectCensus({
    actual: tally(rows.map((row) => row.identifierFrom)),
    expected: KNOCK_SURFACE_CENSUS.identifiers,
    subject: "the registry's identifier sources",
  });
}

/**
 * Assert every voluminous prefix still matches at least one declared operation.
 *
 * @param rows the compiled operation rows
 */
export function checkVoluminousPrefixes({ rows }: { rows: readonly KnockSurfaceRow[] }): void {
  for (const prefix of KNOCK_VOLUMINOUS_PREFIXES) {
    if (!rows.some((row) => row.path === prefix || row.path.startsWith(`${prefix}/`))) {
      refuse(
        `KNOCK_VOLUMINOUS_PREFIXES names ${prefix}, which no declared operation matches any more — ` +
          "retire it from dispositions.ts or correct it",
      );
    }
  }
}
