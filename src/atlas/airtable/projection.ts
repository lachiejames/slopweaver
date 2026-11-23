/**
 * Turning the two compiled inventories into atlas entities.
 *
 * Both projections here are OFFLINE. The API surface comes from the operation registry generated from
 * Airtable's own pinned OpenAPI document, and the browser surface comes from the route inventory measured
 * without an account — so `slopweaver atlas airtable sync` publishes a complete surface map with no network
 * call and no credential, exactly as `atlas notion sync` does from an installed package.
 *
 * What is NOT here is the entity projection — a base, a table, a field, a record. Those need a token this
 * installation does not hold, and inventing a shape for them before one exists would be a contract nothing
 * has ever satisfied. `descriptor.ts` says so, and each of those kinds publishes a `not-configured`
 * coverage cell naming what would fill it.
 */
import { AIRTABLE_BROWSER_PAGES, type AirtableBrowserPage } from "./browserPages.js";
import { AIRTABLE_SPEC_PIN } from "./generated/specLock.js";
import { AIRTABLE_SURFACES } from "./generated/surfaces.js";
import { airtableEntityId } from "./identity.js";
import type { AirtableAtlasKind } from "./kinds.js";
import type { AirtableAtlasEntity, AirtableMethodApiDetail } from "./model.js";
import type { AirtableSurfaceRow } from "./surfaceRow.js";

/**
 * The surface name the API channel's coverage and provenance are recorded under.
 * @internal
 */
export const AIRTABLE_SPEC_SURFACE = "spec-declared";

/**
 * The surface name the browser channel's route inventory is recorded under.
 * @internal
 */
export const AIRTABLE_ROUTE_SURFACE = "browser-routes";

/** The provider key a method entity is matched on across channels: the request line, byte-exactly. */
function methodProviderId({ row }: { row: AirtableSurfaceRow }): string {
  return `${row.method} ${row.path}`;
}

/** What the pinned document states about one operation, reduced to names and this atlas's decision. */
function methodDetail({ row }: { row: AirtableSurfaceRow }): AirtableMethodApiDetail {
  return {
    authMethods: [...row.authMethods],
    disposition: row.disposition,
    dispositionBecause: row.dispositionBecause,
    exclusionReason: row.exclusionReason,
    method: row.method,
    paging: row.paging,
    path: row.path,
    scopes: [...row.scopes],
    summary: row.summary,
    tag: row.tag,
    volumeJudgedPerScope: row.volumeJudgedPerScope,
  };
}

/**
 * Every operation in the generated registry, as a `method` entity carrying only its `api` channel.
 *
 * The deep link is the reference page for the operation, and its status is `provider-provided` rather than
 * `unverified`: Airtable's reference renders one page per operation under a slug that IS the `operationId`,
 * which is the same string the document itself declares. The link is therefore derived from the provider's
 * own key rather than guessed at.
 *
 * @param at this run's ISO timestamp
 * @returns one entity per operation, sorted by the registry's own order
 */
export function projectAirtableMethods({ at }: { at: string }): readonly AirtableAtlasEntity[] {
  return AIRTABLE_SURFACES.map((row): AirtableAtlasEntity => {
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
            deepLink: `https://airtable.com/developers/web/api/${row.name}`,
            deepLinkStatus: "provider-provided",
            endpoint: AIRTABLE_SPEC_PIN.islandPath,
            observedAt: at,
          },
          state: "observed",
        },
        browser: null,
      },
      id: airtableEntityId({ kind: "method", providerId }),
      kind: "method",
      providerId,
      scope: null,
    };
  });
}

/** What the signed-out probe established about one route, as a stored detail. */
function pageDetail({ page }: { page: AirtableBrowserPage }): Record<string, unknown> {
  return {
    evidence: page.evidence,
    holds: page.holds,
    screenshotWanted: page.screenshot,
  };
}

/**
 * Every declared route, as a `page` entity carrying only its `browser` channel.
 *
 * The detail is what a SIGNED-OUT probe established, and nothing more. That is a deliberate floor rather
 * than a placeholder: `docs/atlas-intent/06-holdings.md` says every page's EXISTENCE is recorded even where a
 * screenshot is not, and eleven of these routes have their existence CONFIRMED by a redirect no signed-in
 * session was needed for. A walk that later signs in replaces this detail with a real observation and a
 * screenshot; until then the atlas says exactly what it knows.
 *
 * The deep link is the route itself with its parameters still braced, and its status is `unverified` —
 * nothing has opened it. Recording it as `browser-discovered` would claim a walk that has not happened,
 * which is the specific dishonesty `kit/contract.ts` built the field to prevent.
 *
 * @param at this run's ISO timestamp
 * @returns one entity per declared route
 */
export function projectAirtableRoutes({ at }: { at: string }): readonly AirtableAtlasEntity[] {
  return AIRTABLE_BROWSER_PAGES.map((page): AirtableAtlasEntity => {
    return {
      channels: {
        api: null,
        browser: {
          channel: "browser",
          detail: pageDetail({ page }),
          firstSeenAt: at,
          lastSeenAt: at,
          source: {
            artifacts: [],
            deepLink: null,
            deepLinkStatus: "unverified",
            channel: "browser",
            endpoint: page.route,
            observedAt: at,
          },
          state: "observed",
        },
      },
      id: airtableEntityId({ kind: "page", providerId: page.route }),
      kind: "page",
      providerId: page.route,
      scope: null,
    };
  });
}

/**
 * The kinds this build can currently fill, so a sync can report every OTHER kind as not-configured rather
 * than leaving a reader to infer it from an empty file.
 *
 * @returns the two surface-map kinds
 */
export function airtableFillableKinds(): readonly AirtableAtlasKind[] {
  return ["method", "page"];
}
