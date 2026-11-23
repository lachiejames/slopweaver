/**
 * Turning the two compiled inventories into atlas entities.
 *
 * Both projections here are OFFLINE. The operation surface comes from the registry generated from Knock's
 * two published OpenAPI documents, and the route surface from the dashboard's own build manifest — so
 * `slopweaver atlas knock sync` publishes the whole surface map with no network call and no credential,
 * exactly as `atlas figma sync` and `atlas prisma-data-platform sync` do.
 *
 * What is NOT here is the entity projection — a workflow, a guide, a broadcast, a recipient. Those need a
 * credential this installation does not hold, and inventing a shape for them before one exists would be a
 * contract nothing has ever satisfied. `descriptor.ts` says so, and each of those kinds publishes a
 * `not-configured` coverage cell naming what would fill it.
 *
 * ## Every row carries a deep link, and each one is the honest kind
 *
 * An operation's link is its page on Knock's own reference site, built from the API and the operation's own
 * tag and id — the address a human opens to read what it does. It is `provider-provided`: the id and the
 * tag are Knock's, not this atlas's. A dashboard route's link is `unavailable` rather than constructed,
 * because a route PATTERN is not an address — `/[slug]/[environment]/workflows` cannot be opened without
 * this account's own slug, and those two segments are provider identifiers this repository may not carry.
 * A walk fills the real address into the browser channel; the API channel says it has none, which is a
 * different fact from nobody having looked.
 */
import type { KnockRouteRow } from "./dashboardRoutes.js";
import { KNOCK_ROUTES } from "./generated/routes.js";
import { KNOCK_DASHBOARD_MANIFEST_PIN, KNOCK_SPEC_PINS } from "./generated/specLock.js";
import { KNOCK_SURFACES } from "./generated/surfaces.js";
import { knockEntityId } from "./identity.js";
import type { KnockEntity, KnockMethodApiDetail, KnockRouteApiDetail } from "./model.js";
import type { KnockSurfaceRow } from "./surfaceRow.js";

/**
 * The surface name the two OpenAPI documents' coverage and provenance are recorded under.
 * @internal
 */
export const KNOCK_SPEC_SURFACE = "spec-declared";

/**
 * The surface name the dashboard's route inventory is recorded under.
 * @internal
 */
export const KNOCK_ROUTES_SURFACE = "browser-routes";

/**
 * The surface name a driven walk of the dashboard records under.
 * @internal
 */
export const KNOCK_WALK_SURFACE = "dashboard-walk";

/** Where Knock publishes a reference page for one operation. */
const REFERENCE_ROOTS = { data: "api-reference", management: "mapi-reference" } as const;

/**
 * The provider key a method entity is matched on across channels.
 *
 * The API is part of the key because the two documents SHARE paths — both declare `GET /v1/workflows`, and
 * they answer different things — so `<METHOD> <path>` alone would collide two genuinely different
 * operations into one row.
 */
function methodProviderId({ row }: { row: KnockSurfaceRow }): string {
  return `${row.api} ${row.method} ${row.path}`;
}

/**
 * The reference page for one operation.
 *
 * Built from Knock's own tag and operation id rather than guessed at: its documentation site is generated
 * from the same documents this registry is, and the tag is the section. The `(2)` suffix Knock's generator
 * appends to a colliding id is stripped, because the page it names carries the plain form.
 */
function referenceUrl({ row }: { row: KnockSurfaceRow }): string {
  const section = row.tag.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  const operation = row.operationId.replace(/ \(\d+\)$/, "");
  return `https://docs.knock.app/${REFERENCE_ROOTS[row.api]}/${section}/${operation}`;
}

/** What the pinned documents state about one operation, reduced to names and this atlas's decisions. */
function methodDetail({ row }: { row: KnockSurfaceRow }): KnockMethodApiDetail {
  return {
    api: row.api,
    deprecated: row.deprecated,
    disposition: row.disposition,
    dispositionBecause: row.dispositionBecause,
    environmentScoped: row.environmentScoped,
    exclusionReason: row.exclusionReason,
    identifierFrom: row.identifierFrom,
    method: row.method,
    operationId: row.operationId,
    paging: row.paging,
    path: row.path,
    probeEvidence: row.probeEvidence,
    responseFieldCount: row.responseFieldCount,
    summary: row.summary,
    tag: row.tag,
  };
}

/**
 * Every operation in the generated registry, as a `method` entity carrying only its `api` channel.
 *
 * @param at this run's ISO timestamp
 * @returns one entity per operation, in the registry's own order
 */
export function projectKnockMethods({ at }: { at: string }): readonly KnockEntity[] {
  return KNOCK_SURFACES.map((row): KnockEntity => {
    const providerId = methodProviderId({ row });
    return {
      channels: {
        api: {
          channel: "api",
          detail: methodDetail({ row }),
          firstSeenAt: at,
          lastSeenAt: at,
          source: {
            artifacts: [],
            channel: "api",
            deepLink: referenceUrl({ row }),
            deepLinkStatus: "provider-provided",
            endpoint: `${KNOCK_SPEC_PINS[row.api].url}#${row.operationId}`,
            observedAt: at,
          },
          state: "observed",
        },
        browser: null,
      },
      id: knockEntityId({ kind: "method", providerId }),
      kind: "method",
      providerId,
      scope: null,
    };
  });
}

/** What the dashboard's own manifest states about one route. */
function routeDetail({ row }: { row: KnockRouteRow }): KnockRouteApiDetail {
  return {
    apiBacked: row.apiBacked,
    kind: row.kind,
    parameters: [...row.parameters],
    scope: row.scope,
    walkable: row.walkable,
  };
}

/**
 * Every route the dashboard declares, as a `dashboard-route` entity carrying only its `api` channel.
 *
 * The route table is reached over HTTP with no browser, so it is the API channel that holds it even though
 * its subject is the browser surface. That is the honest attribution: `browser` is what a driven browser
 * SAW, and nothing has been driven yet when this projection runs.
 *
 * @param at this run's ISO timestamp
 * @returns one entity per route, in the registry's own order
 */
export function projectKnockRoutes({ at }: { at: string }): readonly KnockEntity[] {
  return KNOCK_ROUTES.map((row): KnockEntity => {
    return {
      channels: {
        api: {
          channel: "api",
          detail: routeDetail({ row }),
          firstSeenAt: at,
          lastSeenAt: at,
          source: {
            artifacts: [],
            channel: "api",
            // A route PATTERN is not an address — see this file's header.
            deepLink: null,
            deepLinkStatus: "unavailable",
            endpoint: `${KNOCK_DASHBOARD_MANIFEST_PIN.landingUrl}_next/static/${KNOCK_DASHBOARD_MANIFEST_PIN.buildId}/_buildManifest.js#${row.route}`,
            observedAt: at,
          },
          state: "observed",
        },
        browser: null,
      },
      id: knockEntityId({ kind: "dashboard-route", providerId: row.route }),
      kind: "dashboard-route",
      providerId: row.route,
      scope: null,
    };
  });
}
